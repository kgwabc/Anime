const MAX_MANA = 10;
const STARTING_HAND_SIZE = 3;
const STARTING_HP = 30;

/**
 * 카드 효과 실행 자리표시자.
 * 실제 효과 로직(피해량 계산, 버프, 드로우 등)은 다음 단계에서 구현한다.
 * 지금은 어떤 효과 키가 어떤 시점에 호출되는지 구조만 잡아둔다.
 */
function resolveEffect(effectKey, context) {
  if (!effectKey) return;
  // TODO: 효과 키(placeholder_draw_card 등)별 실제 로직 구현
  console.log(`[effect] resolveEffect("${effectKey}") for player ${context.playerId}`);
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildDeck(allCards) {
  // MVP: 전체 카드 풀을 그대로 셔플해서 덱으로 사용 (덱 빌딩은 다음 단계)
  return shuffle(allCards).map((card) => ({ ...card }));
}

class GameRoom {
  /** @param {{id: string, username: string}[]} players */
  constructor(roomId, players, allCards) {
    this.roomId = roomId;
    this.turnNumber = 1;
    this.currentPlayerIndex = 0;
    this.playerOrder = players.map((p) => p.id);

    this.players = {};
    for (const { id: playerId, username } of players) {
      const deck = buildDeck(allCards);
      const hand = deck.splice(0, STARTING_HAND_SIZE);
      this.players[playerId] = {
        id: playerId,
        username,
        hp: STARTING_HP,
        mana: 1,
        maxMana: 1,
        hand,
        deck,
        board: [],
      };
    }
  }

  getOpponentId(playerId) {
    return this.playerOrder.find((id) => id !== playerId);
  }

  isPlayersTurn(playerId) {
    return this.playerOrder[this.currentPlayerIndex] === playerId;
  }

  playCard(playerId, cardId) {
    if (!this.isPlayersTurn(playerId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    const player = this.players[playerId];
    const cardIndex = player.hand.findIndex((card) => card.id === cardId);
    if (cardIndex === -1) {
      return { ok: false, reason: "card_not_in_hand" };
    }

    const card = player.hand[cardIndex];
    if (card.cost > player.mana) {
      return { ok: false, reason: "not_enough_mana" };
    }

    player.hand.splice(cardIndex, 1);
    player.mana -= card.cost;

    if (card.type === "character") {
      player.board.push(card);
      resolveEffect(card.effects?.battlecry, { playerId, card });
    } else if (card.type === "spell") {
      resolveEffect(card.effects?.onCast, { playerId, card });
    } else if (card.type === "equipment") {
      // TODO: 다음 단계에서 대상 캐릭터에 장착하는 로직 구현
      resolveEffect(card.effects?.onEquip, { playerId, card });
    }

    return { ok: true };
  }

  endTurn(playerId) {
    if (!this.isPlayersTurn(playerId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
    this.turnNumber += 1;

    const nextPlayerId = this.playerOrder[this.currentPlayerIndex];
    const nextPlayer = this.players[nextPlayerId];
    nextPlayer.maxMana = Math.min(nextPlayer.maxMana + 1, MAX_MANA);
    nextPlayer.mana = nextPlayer.maxMana;

    if (nextPlayer.deck.length > 0) {
      nextPlayer.hand.push(nextPlayer.deck.shift());
    }
    // TODO: 덱이 비었을 때 피로 데미지(fatigue) 등 페널티 로직

    return { ok: true };
  }

  isGameOver() {
    return this.playerOrder.some((id) => this.players[id].hp <= 0);
  }

  /** 각 플레이어 관점의 상태만 노출하는 직렬화 (상대 손패/덱은 개수만 공개) */
  toClientState(forPlayerId) {
    const opponentId = this.getOpponentId(forPlayerId);
    const me = this.players[forPlayerId];
    const opponent = this.players[opponentId];

    return {
      roomId: this.roomId,
      turnNumber: this.turnNumber,
      currentPlayerId: this.playerOrder[this.currentPlayerIndex],
      me: {
        id: me.id,
        username: me.username,
        hp: me.hp,
        mana: me.mana,
        maxMana: me.maxMana,
        hand: me.hand,
        deckCount: me.deck.length,
        board: me.board,
      },
      opponent: {
        id: opponent.id,
        username: opponent.username,
        hp: opponent.hp,
        mana: opponent.mana,
        maxMana: opponent.maxMana,
        handCount: opponent.hand.length,
        deckCount: opponent.deck.length,
        board: opponent.board,
      },
    };
  }
}

module.exports = { GameRoom };
