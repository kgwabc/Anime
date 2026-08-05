const { applyEffectList, hasUnresolvableTarget } = require("./effects");

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

function buildDeck(deckCards) {
  // 플레이어가 덱 빌더에서 직접 구성한 30장(중복 포함)을 셔플해서 사용
  return shuffle(deckCards).map((card) => ({ ...card }));
}

class GameRoom {
  /**
   * @param {{id: string, username: string, userId: string}[]} players
   * @param {Record<string, object[]>} deckByPlayerId 플레이어 id -> 30장 카드 객체 배열
   */
  constructor(roomId, players, deckByPlayerId) {
    this.roomId = roomId;
    this.turnNumber = 1;
    this.currentPlayerIndex = 0;
    this.playerOrder = players.map((p) => p.id);

    this.players = {};
    players.forEach(({ id: playerId, username, userId }, index) => {
      const deck = buildDeck(deckByPlayerId[playerId]);
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
        // graveyard 의도적으로 생략 — 죽은 카드 기록을 나중에 참조하는 효과가 없음
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

  /** 기권: 턴 여부와 무관하게 언제든 가능. HP를 0으로 만들어 기존 승패 판정 로직을 재사용 */
  surrender(playerId) {
    const player = this.players[playerId];
    if (!player) {
      return { ok: false, reason: "player_not_found" };
    }
    player.hp = 0;
    return { ok: true };
  }

  playCard(playerId, cardId, chosenTargetCardId) {
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
    if (card.type === "equipment") {
      return { ok: false, reason: "use_equip_card" };
    }

    const trigger = card.type === "spell" ? "IMMEDIATE" : "ON_PLAY";
    const context = { sourceCardId: card.id, chosenTargetCardId };
    if (hasUnresolvableTarget(this, playerId, card.effects, trigger, context, card.requiredTargetTag)) {
      return { ok: false, reason: "target_required" };
    }

    player.hand.splice(cardIndex, 1);
    player.mana -= card.cost;

    let onPlaySkillName = null;
    let onPlayEffectResults = [];
    if (card.type === "spell") {
      applyEffectList(this, playerId, card.effects, "IMMEDIATE", context);
    } else {
      card.canAttack = false;
      card.hasAttacked = false;
      player.board.push(card);
      onPlayEffectResults = applyEffectList(this, playerId, card.effects, "ON_PLAY", context);
      if (card.effects?.[0]?.trigger === "ON_PLAY") {
        onPlaySkillName = card.skillName || null;
      }
    }

    return {
      ok: true,
      card: { id: card.id, type: card.type, name: card.name, image: card.image, skillName: onPlaySkillName },
      effectResults: onPlayEffectResults,
    };
  }

  equipCard(playerId, equipmentCardId, targetCharacterId) {
    if (!this.isPlayersTurn(playerId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    const player = this.players[playerId];
    const cardIndex = player.hand.findIndex((card) => card.id === equipmentCardId);
    if (cardIndex === -1) {
      return { ok: false, reason: "card_not_in_hand" };
    }

    const card = player.hand[cardIndex];
    if (card.type !== "equipment") {
      return { ok: false, reason: "not_equipment" };
    }
    if (card.cost > player.mana) {
      return { ok: false, reason: "not_enough_mana" };
    }

    const target = player.board.find((c) => c.id === targetCharacterId);
    if (!target) {
      return { ok: false, reason: "target_not_on_board" };
    }
    if (card.requiredTargetTag && !(target.synergyTags || []).includes(card.requiredTargetTag)) {
      return { ok: false, reason: "target_synergy_mismatch" };
    }

    player.hand.splice(cardIndex, 1);
    player.mana -= card.cost;

    target.atk += card.equipAtkBonus || 0;
    target.hp += card.equipHpBonus || 0;
    applyEffectList(this, playerId, card.effects, "ON_EQUIP", {
      sourceCardId: card.id,
      chosenTargetCardId: target.id,
    });

    return { ok: true, card: { id: card.id, type: card.type, name: card.name, image: card.image } };
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

    let defenderDeathSkillName = null;
    let attackerDeathSkillName = null;
    let heroDamage = null;
    let defenderDamage = null;
    let counterDamage = null;
    const deathEffectResults = [];

    if (target?.type === "hero") {
      if (opponent.board.length > 0) {
        return { ok: false, reason: "must_attack_character_first" };
      }
      heroDamage = attacker.atk;
      opponent.hp = Math.max(0, opponent.hp - attacker.atk);
    } else if (target?.type === "character") {
      const defenderIndex = opponent.board.findIndex((card) => card.id === target.cardId);
      if (defenderIndex === -1) {
        return { ok: false, reason: "target_not_on_board" };
      }
      const defender = opponent.board[defenderIndex];
      const matchupBonus =
        attacker.matchupVsTag && (defender.synergyTags || []).includes(attacker.matchupVsTag)
          ? attacker.matchupAtkBonus || 0
          : 0;
      defenderDamage = attacker.atk + matchupBonus;
      counterDamage = defender.atk;
      defender.hp -= defenderDamage;
      attacker.hp -= counterDamage;

      if (defender.hp <= 0) {
        opponent.board.splice(defenderIndex, 1);
        deathEffectResults.push(
          ...applyEffectList(this, this.getOpponentId(playerId), defender.effects, "ON_DEATH", {
            sourceCardId: defender.id,
            killerCardId: attacker.id,
          })
        );
        if (defender.effects?.[0]?.trigger === "ON_DEATH") {
          defenderDeathSkillName = defender.skillName || null;
        }
      }
      if (attacker.hp <= 0) {
        player.board = player.board.filter((card) => card.id !== attacker.id);
        deathEffectResults.push(
          ...applyEffectList(this, playerId, attacker.effects, "ON_DEATH", {
            sourceCardId: attacker.id,
            killerCardId: defender.id,
          })
        );
        if (attacker.effects?.[0]?.trigger === "ON_DEATH") {
          attackerDeathSkillName = attacker.skillName || null;
        }
      }
    } else {
      return { ok: false, reason: "invalid_target" };
    }

    attacker.hasAttacked = true;
    return {
      ok: true,
      attackerCard: { id: attacker.id, name: attacker.name, attackName: attacker.attackName || null },
      defenderDeathSkillName,
      attackerDeathSkillName,
      heroDamage,
      defenderDamage,
      counterDamage,
      effectResults: deathEffectResults,
    };
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
