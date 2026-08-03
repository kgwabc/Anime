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
  /** @param {{id: string, username: string, userId: string}[]} players */
  constructor(roomId, players, allCards) {
    this.roomId = roomId;
    this.turnNumber = 1;
    this.currentPlayerIndex = 0;
    this.playerOrder = players.map((p) => p.id);

    this.players = {};
    players.forEach(({ id: playerId, username, userId }, index) => {
      const deck = buildDeck(allCards);
      const hand = deck.splice(0, STARTING_HAND_SIZE);
      this.players[playerId] = {
        id: playerId,
        userId,
        username,
        hp: STARTING_HP,
        mana: 1,
        maxMana: 1,
        turnsPlayed: index === 0 ? 1 : 0,
        hand,
        deck,
        board: [],
      };
    });
  }

  getOpponentId(playerId) {
    return this.playerOrder.find((id) => id !== playerId);
  }

  findPlayerIdByUserId(userId) {
    return this.playerOrder.find((id) => this.players[id].userId === userId);
  }

  /** 소켓 재연결시 예전 socket.id로 등록된 플레이어를 새 socket.id로 교체 */
  rebindPlayer(oldId, newId) {
    const player = this.players[oldId];
    if (!player) return false;

    player.id = newId;
    this.players[newId] = player;
    delete this.players[oldId];
    this.playerOrder = this.playerOrder.map((id) => (id === oldId ? newId : id));
    return true;
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
    card.canAttack = false;
    card.hasAttacked = false;
    player.board.push(card);

    return { ok: true };
  }

  attack(playerId, attackerCardId, target) {
    if (!this.isPlayersTurn(playerId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    const player = this.players[playerId];
    const opponent = this.players[this.getOpponentId(playerId)];
    const attacker = player.board.find((card) => card.id === attackerCardId);
    if (!attacker) {
      return { ok: false, reason: "attacker_not_on_board" };
    }
    if (!attacker.canAttack || attacker.hasAttacked) {
      return { ok: false, reason: "cannot_attack" };
    }

    if (target?.type === "hero") {
      if (opponent.board.length > 0) {
        return { ok: false, reason: "must_attack_character_first" };
      }
      opponent.hp = Math.max(0, opponent.hp - attacker.atk);
    } else if (target?.type === "character") {
      const defenderIndex = opponent.board.findIndex((card) => card.id === target.cardId);
      if (defenderIndex === -1) {
        return { ok: false, reason: "target_not_on_board" };
      }
      const defender = opponent.board[defenderIndex];
      defender.hp -= attacker.atk;
      attacker.hp -= defender.atk;

      if (defender.hp <= 0) {
        opponent.board.splice(defenderIndex, 1);
      }
      if (attacker.hp <= 0) {
        player.board = player.board.filter((card) => card.id !== attacker.id);
      }
    } else {
      return { ok: false, reason: "invalid_target" };
    }

    attacker.hasAttacked = true;
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
    nextPlayer.turnsPlayed += 1;

    if (nextPlayer.turnsPlayed === 1) {
      nextPlayer.maxMana = 1;
      nextPlayer.mana = 1;
    } else {
      nextPlayer.maxMana = Math.min(nextPlayer.turnsPlayed, MAX_MANA);
      nextPlayer.mana = nextPlayer.maxMana;
      if (nextPlayer.deck.length > 0) {
        nextPlayer.hand.push(nextPlayer.deck.shift());
      }
      // TODO: 덱이 비었을 때 피로 데미지(fatigue) 등 페널티 로직
    }

    for (const card of nextPlayer.board) {
      card.canAttack = true;
      card.hasAttacked = false;
    }

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
