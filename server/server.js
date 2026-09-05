require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { connectDB } = require("./db");
const authRoutes = require("./auth/authRoutes");
const cardRoutes = require("./routes/cardRoutes");
const deckRoutes = require("./routes/deckRoutes");
const shopRoutes = require("./routes/shopRoutes");
const stageRoutes = require("./routes/stageRoutes");
const questRoutes = require("./routes/questRoutes");
const rankingRoutes = require("./routes/rankingRoutes");
const { socketAuthMiddleware } = require("./auth/socketAuth");
const { listCards } = require("./models/Card");
const { getDeckByUserId } = require("./models/Deck");
const { validateDeck } = require("./game/deckValidation");
const { Matchmaker } = require("./game/matchmaking");
const { GameRoom } = require("./game/GameRoom");
const { getStageById } = require("./models/Stage");
const { chooseCardToPlay, chooseAttack } = require("./game/aiPlayer");
const { getHighestCleared, setHighestCleared } = require("./models/StageProgress");
const { getStageDeckCardIds } = require("./models/StageDecks");
const { listRandomAiPoolCardIds } = require("./models/RandomAiPoolCards");
const { getArenaTier } = require("./data/arenaTiers");
const { addCoins, deductCoins, addRankScore } = require("./models/User");
const { recordWin } = require("./models/Quest");

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "enif-psycongroo-server" });
});
app.use("/auth", authRoutes);
app.use("/cards", cardRoutes);
app.use("/decks", deckRoutes);
app.use("/shop", shopRoutes);
app.use("/stages", stageRoutes);
app.use("/quests", questRoutes);
app.use("/rankings", rankingRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
io.use(socketAuthMiddleware);

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 30000;
const TURN_DURATION_MS = Number(process.env.TURN_DURATION_MS) || 60000;
const AI_MODE_WIN_REWARD = 2000;

/** @type {Map<string, Matchmaker>} tierId -> Matchmaker (투기장 티어별로 큐를 분리) */
const matchmakers = new Map();
function getMatchmaker(tierId) {
  if (!matchmakers.has(tierId)) matchmakers.set(tierId, new Matchmaker());
  return matchmakers.get(tierId);
}

/** @type {Map<string, GameRoom>} roomId -> GameRoom */
const rooms = new Map();
/** @type {Map<string, string>} socketId -> roomId, 소켓이 어느 방에 있는지 조회용 */
const socketToRoom = new Map();
/** @type {Map<string, {roomId: string, oldSocketId: string, timeoutHandle: NodeJS.Timeout}>} userId -> 재연결 유예 정보 */
const pendingDisconnects = new Map();
/** @type {Map<string, NodeJS.Timeout>} roomId -> 턴 제한시간 타이머 핸들 */
const turnTimers = new Map();

function clearTurnTimer(roomId) {
  clearTimeout(turnTimers.get(roomId));
  turnTimers.delete(roomId);
}

// 턴이 시작될 때마다 호출: 이전 타이머를 정리하고 TURN_DURATION_MS 뒤 자동 턴 종료를 예약한다.
function scheduleTurnTimer(room, roomId) {
  clearTurnTimer(roomId);
  if (room.isGameOver()) return;

  room.turnEndsAt = Date.now() + TURN_DURATION_MS;
  const handle = setTimeout(() => handleTurnTimeout(roomId), TURN_DURATION_MS);
  turnTimers.set(roomId, handle);
}

// 시간 초과로 자동 턴 종료. 정상적으로 턴이 끝난 경우 이 타이머는 항상 먼저
// clearTurnTimer로 정리되므로, 여기 도달했다는 것 자체가 아직 유효한 만료임을 의미한다.
function handleTurnTimeout(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.isGameOver()) return;

  const currentPlayerId = room.playerOrder[room.currentPlayerIndex];
  room.endTurn(currentPlayerId);
  if (!room.isGameOver()) scheduleTurnTimer(room, roomId);
  broadcastGameState(room);

  if (!room.isGameOver() && room.isAiMatch && room.isPlayersTurn(room.aiPlayerId)) {
    setTimeout(() => stepAiTurn(room, roomId), aiThinkDelay());
  }
}

function broadcastGameState(room) {
  for (const playerId of room.playerOrder) {
    io.to(playerId).emit("game_state_update", room.toClientState(playerId));
  }
}

function broadcastEffect(room, event, payload) {
  for (const playerId of room.playerOrder) {
    io.to(playerId).emit(event, payload);
  }
}

async function handleGameOver(room, roomId, { reason } = {}) {
  if (!room.isGameOver()) return;

  const loserId = room.playerOrder.find((id) => room.players[id].hp <= 0);
  const winnerId = room.getOpponentId(loserId);
  const winnerUserId = room.players[winnerId].userId;

  // 투기장 매치: 입장료는 이미 큐 진입시 차감됐으므로, 승자에게 winReward만 지급하면
  // 결과적으로 승자는 (winReward - entryCost) 순이익, 패자는 -entryCost 순손실이 된다.
  let winnerCoinsDelta = 0;
  let loserCoinsDelta = 0;
  if (room.tier) {
    await addCoins(winnerUserId, room.tier.winReward);
    winnerCoinsDelta = room.tier.winReward - room.tier.entryCost;
    loserCoinsDelta = -room.tier.entryCost;
    const loserUserId = room.players[loserId].userId;
    await addRankScore(winnerUserId, 50);
    await addRankScore(loserUserId, -25);
  } else if (room.isAiMatch && winnerId !== room.aiPlayerId) {
    await addCoins(winnerUserId, AI_MODE_WIN_REWARD);
    winnerCoinsDelta = AI_MODE_WIN_REWARD;
  }

  // 퀘스트 진행도는 AI/투기장/일반 매칭 승리 여부와 무관하게 항상 반영한다
  // (AI 매치의 경우 봇 자신의 "승리"는 winnerId !== room.aiPlayerId 조건으로 제외됨).
  if (!(room.isAiMatch && winnerId === room.aiPlayerId)) {
    await recordWin(winnerUserId);
  }

  io.to(winnerId).emit("game_over", { result: "win", stageId: room.stageId, reason, coinsDelta: winnerCoinsDelta });
  io.to(loserId).emit("game_over", { result: "lose", stageId: room.stageId, reason, coinsDelta: loserCoinsDelta });

  if (room.isAiMatch && winnerId !== room.aiPlayerId && room.stageId) {
    await setHighestCleared(winnerUserId, room.stageId);
  }

  clearTurnTimer(roomId);
  rooms.delete(roomId);
  socketToRoom.delete(loserId);
  socketToRoom.delete(winnerId);
}

function aiThinkDelay() {
  return 2000 + Math.random() * 1000;
}

function stepAiTurn(room, roomId) {
  if (room.isGameOver() || !room.isPlayersTurn(room.aiPlayerId)) return;
  const aiId = room.aiPlayerId;

  const card = chooseCardToPlay(room, aiId);
  if (card) {
    const result = room.playCard(aiId, card.id);
    if (result.ok) {
      broadcastEffect(room, "card_played", {
        playerId: aiId,
        card: result.card,
        effectResults: result.effectResults,
      });
      broadcastGameState(room);
    }
    handleGameOver(room, roomId);
    if (!room.isGameOver()) setTimeout(() => stepAiTurn(room, roomId), aiThinkDelay());
    return;
  }

  const attack = chooseAttack(room, aiId);
  if (attack) {
    const result = room.attack(aiId, attack.attackerCardId, attack.target);
    if (result.ok) {
      broadcastEffect(room, "attack_occurred", {
        attackerId: aiId,
        attackerCardId: attack.attackerCardId,
        target: attack.target,
        attackerCard: result.attackerCard,
        defenderDeathSkillName: result.defenderDeathSkillName,
        attackerDeathSkillName: result.attackerDeathSkillName,
        defenderDeathSkillEffect: result.defenderDeathSkillEffect,
        attackerDeathSkillEffect: result.attackerDeathSkillEffect,
        defenderRevived: result.defenderRevived,
        attackerRevived: result.attackerRevived,
        heroDamage: result.heroDamage,
        defenderDamage: result.defenderDamage,
        counterDamage: result.counterDamage,
        effectResults: result.effectResults,
      });
      broadcastGameState(room);
    }
    handleGameOver(room, roomId);
    if (!room.isGameOver()) setTimeout(() => stepAiTurn(room, roomId), aiThinkDelay());
    return;
  }

  setTimeout(() => {
    // 이 사이 턴 타이머가 먼저 만료되어 AI 턴이 이미 강제 종료됐을 수 있으므로,
    // endTurn이 실제로 성공했을 때만(정말 아직 AI 턴일 때만) 타이머를 재시작한다.
    const result = room.endTurn(aiId);
    if (result.ok) {
      scheduleTurnTimer(room, roomId);
      broadcastGameState(room);
    }
  }, aiThinkDelay());
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  const pending = pendingDisconnects.get(socket.data.userId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    pendingDisconnects.delete(socket.data.userId);

    const room = rooms.get(pending.roomId);
    if (room && room.rebindPlayer(pending.oldSocketId, socket.id)) {
      socketToRoom.set(socket.id, pending.roomId);
      console.log(`[reconnect] ${socket.data.username} resumed room ${pending.roomId}`);
      io.to(socket.id).emit("match_found", room.toClientState(socket.id));
      broadcastGameState(room);
    }
  }

  socket.on("join_queue", async ({ tier: tierId } = {}) => {
    const tier = getArenaTier(tierId);
    if (!tier) {
      socket.emit("queue_error", "잘못된 투기장입니다.");
      return;
    }

    const currentCards = await listCards();
    const cardsById = new Map(currentCards.map((card) => [card.id, card]));

    const cardIds = await getDeckByUserId(socket.data.userId);
    if (!cardIds) {
      socket.emit("queue_error", "덱이 설정되어 있지 않습니다. 덱 편집에서 먼저 덱을 구성해주세요.");
      return;
    }
    const validation = validateDeck(cardIds, cardsById);
    if (!validation.ok) {
      socket.emit("queue_error", validation.reason);
      return;
    }

    if (tier.entryCost > 0) {
      const newBalance = await deductCoins(socket.data.userId, tier.entryCost);
      if (newBalance === null) {
        socket.emit("queue_error", "코인이 부족합니다.");
        return;
      }
    }

    socket.data.currentTier = tier.id;
    const matchmaker = getMatchmaker(tier.id);
    matchmaker.addToQueue(socket.id);
    console.log(`[queue] ${socket.id} joined ${tier.id}. queue size=${matchmaker.waitingQueue.length}`);

    let pair = matchmaker.tryMatch();
    while (pair) {
      const [candidateA, candidateB] = pair;
      const userIdA = io.sockets.sockets.get(candidateA)?.data.userId;
      const userIdB = io.sockets.sockets.get(candidateB)?.data.userId;
      if (!(userIdA && userIdA === userIdB)) break;

      // 같은 계정끼리는 매칭시키지 않는다(입장료 재차감 없이 큐에 되돌려놓음).
      // 남은 큐가 비어있으면(=이 둘뿐이면) 되돌린 뒤 더 시도하지 않고 종료 — 계속 재시도하면
      // 항상 이 둘만 뽑혀 무한루프가 된다. 다른 유저가 있으면 그 유저가 앞으로 오도록
      // 순서가 바뀌므로 즉시 재시도해서 정상 매칭을 이어간다.
      const hasOtherCandidate = matchmaker.waitingQueue.length > 0;
      matchmaker.addToQueue(candidateA);
      matchmaker.addToQueue(candidateB);
      if (!hasOtherCandidate) return;
      pair = matchmaker.tryMatch();
    }
    if (!pair) return;

    const [playerA, playerB] = pair;
    const roomId = `room_${playerA}_${playerB}`;
    const players = [playerA, playerB].map((id) => ({
      id,
      username: io.sockets.sockets.get(id)?.data.username || "Unknown",
      userId: io.sockets.sockets.get(id)?.data.userId,
    }));

    for (const player of players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) playerSocket.data.currentTier = null;
    }

    const deckByPlayerId = {};
    for (const player of players) {
      const playerCardIds = await getDeckByUserId(player.userId);
      deckByPlayerId[player.id] = playerCardIds.map((cardId) => ({ ...cardsById.get(cardId) }));
    }

    const room = new GameRoom(roomId, players, deckByPlayerId, tier);
    rooms.set(roomId, room);
    socketToRoom.set(playerA, roomId);
    socketToRoom.set(playerB, roomId);
    scheduleTurnTimer(room, roomId);

    for (const playerId of [playerA, playerB]) {
      io.to(playerId).emit("match_found", room.toClientState(playerId));
    }
    console.log(`[match] ${roomId} started (tier ${tier.id})`);
  });

  socket.on("leave_queue", async () => {
    const tierId = socket.data.currentTier;
    if (!tierId) return;

    const tier = getArenaTier(tierId);
    const matchmaker = getMatchmaker(tierId);
    matchmaker.removeFromQueue(socket.id);
    socket.data.currentTier = null;
    console.log(`[queue] ${socket.id} left ${tierId}. queue size=${matchmaker.waitingQueue.length}`);

    if (tier && tier.entryCost > 0) {
      await addCoins(socket.data.userId, tier.entryCost);
    }
  });

  socket.on("start_stage_match", async ({ stageId }) => {
    if (socketToRoom.has(socket.id)) {
      socket.emit("stage_error", "이미 진행중인 게임이 있습니다.");
      return;
    }

    const stage = await getStageById(stageId);
    if (!stage) {
      socket.emit("stage_error", "존재하지 않는 스테이지입니다.");
      return;
    }

    const highestCleared = await getHighestCleared(socket.data.userId);
    if (stage.id > highestCleared + 1) {
      socket.emit("stage_error", "아직 잠긴 스테이지입니다.");
      return;
    }

    const currentCards = await listCards();
    const cardsById = new Map(currentCards.map((card) => [card.id, card]));

    const cardIds = await getDeckByUserId(socket.data.userId);
    if (!cardIds) {
      socket.emit("stage_error", "덱이 설정되어 있지 않습니다. 덱 편집에서 먼저 덱을 구성해주세요.");
      return;
    }
    const validation = validateDeck(cardIds, cardsById);
    if (!validation.ok) {
      socket.emit("stage_error", validation.reason);
      return;
    }

    const aiId = `ai_${socket.id}`;
    const roomId = `stage_room_${socket.id}`;
    const players = [
      { id: socket.id, username: socket.data.username, userId: socket.data.userId },
      { id: aiId, username: stage.aiName, userId: aiId },
    ];
    const aiDeckCardIds = (await getStageDeckCardIds(stage.id)) ?? [];
    const deckByPlayerId = {
      [socket.id]: cardIds.map((cardId) => ({ ...cardsById.get(cardId) })),
      [aiId]: aiDeckCardIds.map((cardId) => cardsById.get(cardId)).filter(Boolean).map((card) => ({ ...card })),
    };

    const room = new GameRoom(roomId, players, deckByPlayerId);
    room.isAiMatch = true;
    room.aiPlayerId = aiId;
    room.stageId = stage.id;

    rooms.set(roomId, room);
    socketToRoom.set(socket.id, roomId);
    scheduleTurnTimer(room, roomId);

    io.to(socket.id).emit("match_found", room.toClientState(socket.id));
    console.log(`[stage] ${roomId} started (stage ${stage.id})`);
  });

  socket.on("start_random_ai_match", async () => {
    if (socketToRoom.has(socket.id)) {
      socket.emit("stage_error", "이미 진행중인 게임이 있습니다.");
      return;
    }

    const currentCards = await listCards();
    const cardsById = new Map(currentCards.map((card) => [card.id, card]));

    const cardIds = await getDeckByUserId(socket.data.userId);
    if (!cardIds) {
      socket.emit("stage_error", "덱이 설정되어 있지 않습니다. 덱 편집에서 먼저 덱을 구성해주세요.");
      return;
    }
    const validation = validateDeck(cardIds, cardsById);
    if (!validation.ok) {
      socket.emit("stage_error", validation.reason);
      return;
    }

    // 관리자 패널의 "랜덤 AI 매치 카드 풀" 체크리스트(스타터 카드 지정과 동일한 방식)에서
    // 지정한 캐릭터 카드만 후보로 사용. AI 봇 로직(aiPlayer.js)이 스펠/장비를 제대로 다루지
    // 못하므로 캐릭터 카드로만 제한한다.
    const poolCardIds = await listRandomAiPoolCardIds();
    const randomPoolCards = poolCardIds.map((id) => cardsById.get(id)).filter((card) => card && card.type === "character");
    if (randomPoolCards.length === 0) {
      socket.emit("stage_error", "관리자가 랜덤 AI 매치 카드 풀을 아직 설정하지 않았습니다.");
      return;
    }

    // 카드 한 종류당 최대 2장까지 섞어 30장을 채우되, 풀이 작아 30장을 못 채우면 있는 만큼만 사용한다.
    const expandedPool = shuffle(randomPoolCards.flatMap((card) => [card, card]));
    const aiDeckCards = expandedPool.slice(0, 30);

    const aiId = `ai_${socket.id}`;
    const roomId = `random_ai_room_${socket.id}`;
    const players = [
      { id: socket.id, username: socket.data.username, userId: socket.data.userId },
      { id: aiId, username: "AI (랜덤)", userId: aiId },
    ];
    const deckByPlayerId = {
      [socket.id]: cardIds.map((cardId) => ({ ...cardsById.get(cardId) })),
      [aiId]: aiDeckCards.map((card) => ({ ...card })),
    };

    const room = new GameRoom(roomId, players, deckByPlayerId);
    room.isAiMatch = true;
    room.aiPlayerId = aiId;

    rooms.set(roomId, room);
    socketToRoom.set(socket.id, roomId);
    scheduleTurnTimer(room, roomId);

    io.to(socket.id).emit("match_found", room.toClientState(socket.id));
    console.log(`[random-ai] ${roomId} started (pool size ${randomPoolCards.length}, deck size ${aiDeckCards.length})`);
  });

  socket.on("view_deck", ({ target }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const targetPlayerId = target === "opponent" ? room.getOpponentId(socket.id) : socket.id;
    const cards = room.getOriginalDeck(targetPlayerId);
    if (!cards) return;

    socket.emit("deck_view_result", { target, cards });
  });

  socket.on("play_card", ({ cardId, target }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.playCard(socket.id, cardId, target?.cardId);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    broadcastEffect(room, "card_played", {
      playerId: socket.id,
      card: result.card,
      effectResults: result.effectResults,
      transformedCards: result.transformedCards,
    });
    broadcastGameState(room);
    handleGameOver(room, roomId);
  });

  socket.on("equip_card", ({ equipmentCardId, targetCharacterId }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.equipCard(socket.id, equipmentCardId, targetCharacterId);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    broadcastEffect(room, "card_played", {
      playerId: socket.id,
      card: result.card,
      targetCharacterId,
      effectResults: result.effectResults,
      transformedCards: result.transformedCards,
    });
    broadcastGameState(room);
    handleGameOver(room, roomId);
  });

  socket.on("attack_card", ({ attackerCardId, target }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.attack(socket.id, attackerCardId, target);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    broadcastEffect(room, "attack_occurred", {
      attackerId: socket.id,
      attackerCardId,
      target,
      attackerCard: result.attackerCard,
      defenderDeathSkillName: result.defenderDeathSkillName,
      attackerDeathSkillName: result.attackerDeathSkillName,
      defenderDeathSkillEffect: result.defenderDeathSkillEffect,
      attackerDeathSkillEffect: result.attackerDeathSkillEffect,
      defenderRevived: result.defenderRevived,
      attackerRevived: result.attackerRevived,
      heroDamage: result.heroDamage,
      defenderDamage: result.defenderDamage,
      counterDamage: result.counterDamage,
      effectResults: result.effectResults,
    });
    broadcastGameState(room);
    handleGameOver(room, roomId);
  });

  socket.on("end_turn", () => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.endTurn(socket.id);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    scheduleTurnTimer(room, roomId);
    broadcastGameState(room);
    if (room.isAiMatch && !room.isGameOver() && room.isPlayersTurn(room.aiPlayerId)) {
      setTimeout(() => stepAiTurn(room, roomId), aiThinkDelay());
    }
  });

  socket.on("surrender", () => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.surrender(socket.id);
    if (!result.ok) return;

    broadcastGameState(room);
    handleGameOver(room, roomId);
  });

  socket.on("disconnect", async () => {
    console.log(`[disconnect] ${socket.id}`);

    const tierId = socket.data.currentTier;
    if (tierId) {
      const tier = getArenaTier(tierId);
      const matchmaker = getMatchmaker(tierId);
      const wasQueued = matchmaker.waitingQueue.includes(socket.id);
      matchmaker.removeFromQueue(socket.id);
      socket.data.currentTier = null;
      if (wasQueued && tier && tier.entryCost > 0) {
        await addCoins(socket.data.userId, tier.entryCost);
      }
    }

    const roomId = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    // 재연결 유예: 바로 방을 없애지 않고, 같은 유저가 다시 접속하면 복귀시킴
    const timeoutHandle = setTimeout(() => {
      pendingDisconnects.delete(socket.data.userId);
      // 기권과 동일한 경로(handleGameOver)를 태워서 투기장 판돈 정산이 똑같이 적용되게 함
      room.surrender(socket.id);
      handleGameOver(room, roomId, { reason: "opponent_disconnected" });
    }, RECONNECT_GRACE_MS);

    pendingDisconnects.set(socket.data.userId, {
      roomId,
      oldSocketId: socket.id,
      timeoutHandle,
    });
  });
});

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Enif Psycongroo server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to Turso:", err.message);
    process.exit(1);
  });
