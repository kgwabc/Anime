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

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
io.use(socketAuthMiddleware);

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 30000;

const matchmaker = new Matchmaker();
/** @type {Map<string, GameRoom>} roomId -> GameRoom */
const rooms = new Map();
/** @type {Map<string, string>} socketId -> roomId, 소켓이 어느 방에 있는지 조회용 */
const socketToRoom = new Map();
/** @type {Map<string, {roomId: string, oldSocketId: string, timeoutHandle: NodeJS.Timeout}>} userId -> 재연결 유예 정보 */
const pendingDisconnects = new Map();

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

async function handleGameOver(room, roomId) {
  if (!room.isGameOver()) return;

  const loserId = room.playerOrder.find((id) => room.players[id].hp <= 0);
  const winnerId = room.getOpponentId(loserId);
  io.to(winnerId).emit("game_over", { result: "win", stageId: room.stageId });
  io.to(loserId).emit("game_over", { result: "lose", stageId: room.stageId });

  if (room.isAiMatch && winnerId !== room.aiPlayerId) {
    const winnerUserId = room.players[winnerId].userId;
    await setHighestCleared(winnerUserId, room.stageId);
  }

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
    room.endTurn(aiId);
    broadcastGameState(room);
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

  socket.on("join_queue", async () => {
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

    matchmaker.addToQueue(socket.id);
    console.log(`[queue] ${socket.id} joined. queue size=${matchmaker.waitingQueue.length}`);

    const pair = matchmaker.tryMatch();
    if (!pair) return;

    const [playerA, playerB] = pair;
    const roomId = `room_${playerA}_${playerB}`;
    const players = [playerA, playerB].map((id) => ({
      id,
      username: io.sockets.sockets.get(id)?.data.username || "Unknown",
      userId: io.sockets.sockets.get(id)?.data.userId,
    }));

    const deckByPlayerId = {};
    for (const player of players) {
      const playerCardIds = await getDeckByUserId(player.userId);
      deckByPlayerId[player.id] = playerCardIds.map((cardId) => ({ ...cardsById.get(cardId) }));
    }

    const room = new GameRoom(roomId, players, deckByPlayerId);
    rooms.set(roomId, room);
    socketToRoom.set(playerA, roomId);
    socketToRoom.set(playerB, roomId);

    for (const playerId of [playerA, playerB]) {
      io.to(playerId).emit("match_found", room.toClientState(playerId));
    }
    console.log(`[match] ${roomId} started`);
  });

  socket.on("leave_queue", () => {
    matchmaker.removeFromQueue(socket.id);
    console.log(`[queue] ${socket.id} left. queue size=${matchmaker.waitingQueue.length}`);
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

    io.to(socket.id).emit("match_found", room.toClientState(socket.id));
    console.log(`[stage] ${roomId} started (stage ${stage.id})`);
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

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    matchmaker.removeFromQueue(socket.id);

    const roomId = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    // 재연결 유예: 바로 방을 없애지 않고, 같은 유저가 다시 접속하면 복귀시킴
    const timeoutHandle = setTimeout(() => {
      pendingDisconnects.delete(socket.data.userId);
      const opponentId = room.getOpponentId(socket.id);
      io.to(opponentId).emit("opponent_disconnected");
      rooms.delete(roomId);
      socketToRoom.delete(opponentId);
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
