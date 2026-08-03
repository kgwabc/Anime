const MAX_MANA = 10;
const STARTING_HAND_SIZE = 3;
const STARTING_HP = 30;

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
      this.resolveEffect(card.effects?.battlecry, { playerId, card });
    } else if (card.type === "spell") {
      this.resolveEffect(card.effects?.onCast, { playerId, card });
    } else if (card.type === "equipment") {
      this.resolveEffect(card.effects?.onEquip, { playerId, card });
    }

    return { ok: true };
  }

  /** 카드 효과 실행. effect는 { type, ...params } 형태의 구조화된 객체. */
  resolveEffect(effect, { playerId }) {
    if (!effect) return;

    const player = this.players[playerId];

    switch (effect.type) {
      case "damage_enemy_hero": {
        const opponent = this.players[this.getOpponentId(playerId)];
        opponent.hp = Math.max(0, opponent.hp - effect.amount);
        if (effect.healSelf) {
          player.hp = Math.min(STARTING_HP, player.hp + effect.healSelf);
        }
        break;
      }
      case "heal_self": {
        player.hp = Math.min(STARTING_HP, player.hp + effect.amount);
        break;
      }
      case "draw_card": {
        for (let i = 0; i < effect.amount && player.deck.length > 0; i++) {
          player.hand.push(player.deck.shift());
        }
        break;
      }
      case "buff_last_character": {
        const lastCard = player.board[player.board.length - 1];
        if (lastCard) {
          lastCard.atk += effect.atk || 0;
          lastCard.hp += effect.hp || 0;
        }
        break;
      }
      default:
        console.warn(`[effect] Unknown effect type: ${effect.type}`);
    }
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
