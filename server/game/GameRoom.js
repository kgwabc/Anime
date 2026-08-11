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

function buildDeck(deckCards, playerId) {
  // 플레이어가 덱 빌더에서 직접 구성한 30장(중복 포함)을 셔플해서 사용.
  // 같은 카드를 여러 장 넣을 수 있으므로, 원래 카드 종류 id를 그대로 두면 사본끼리
  // 구분이 안 되어 공격/효과 타겟팅이 엉뚱한 사본에 적용되는 버그가 생김 — 그래서
  // 여기서 사본마다(플레이어+순번 조합으로) 고유한 인스턴스 id를 새로 부여한다.
  return shuffle(deckCards).map((card, index) => ({ ...card, id: `${playerId}_${card.id}_${index}` }));
}

class GameRoom {
  /**
   * @param {{id: string, username: string, userId: string}[]} players
   * @param {Record<string, object[]>} deckByPlayerId 플레이어 id -> 30장 카드 객체 배열
   * @param {{id: string, label: string, entryCost: number, winReward: number}|null} tier 투기장 정보(없으면 null)
   */
  constructor(roomId, players, deckByPlayerId, tier = null) {
    this.roomId = roomId;
    this.turnNumber = 1;
    this.currentPlayerIndex = 0;
    this.playerOrder = players.map((p) => p.id);
    this.tier = tier;

    this.players = {};
    players.forEach(({ id: playerId, username, userId }, index) => {
      const deck = buildDeck(deckByPlayerId[playerId], playerId);
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
        originalDeck: deckByPlayerId[playerId],
      };
    });
  }

  getOpponentId(playerId) {
    return this.playerOrder.find((id) => id !== playerId);
  }

  /** 매치 시작 시 구성된 30장 원본 덱(뽑았는지 여부와 무관) — 덱 열람 UI용 */
  getOriginalDeck(playerId) {
    return this.players[playerId]?.originalDeck;
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
    let onPlaySkillEffect = null;
    let onPlayEffectResults = [];
    if (card.type === "spell") {
      applyEffectList(this, playerId, card.effects, "IMMEDIATE", context, card.requiredTargetTag);
    } else {
      card.canAttack = false;
      card.hasAttacked = false;
      player.board.push(card);
      onPlayEffectResults = applyEffectList(
        this,
        playerId,
        card.effects,
        "ON_PLAY",
        context,
        card.requiredTargetTag
      );
      if (card.effects?.[0]?.trigger === "ON_PLAY") {
        onPlaySkillName = card.skillName || null;
        onPlaySkillEffect = card.skillEffect || null;
      }
    }

    return {
      ok: true,
      card: {
        id: card.id,
        type: card.type,
        name: card.name,
        image: card.image,
        skillName: onPlaySkillName,
        skillEffect: onPlaySkillEffect,
      },
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
    if (target.equippedItems?.length) {
      return { ok: false, reason: "already_equipped" };
    }
    if (card.requiredTargetTag && !(target.synergyTags || []).includes(card.requiredTargetTag)) {
      return { ok: false, reason: "target_synergy_mismatch" };
    }

    player.hand.splice(cardIndex, 1);
    player.mana -= card.cost;

    target.atk += card.equipAtkBonus || 0;
    target.hp += card.equipHpBonus || 0;
    target.buffAtk = (target.buffAtk || 0) + (card.equipAtkBonus || 0);
    target.buffHp = (target.buffHp || 0) + (card.equipHpBonus || 0);
    const equipEffectResults = applyEffectList(
      this,
      playerId,
      card.effects,
      "ON_EQUIP",
      { sourceCardId: card.id, chosenTargetCardId: target.id },
      card.requiredTargetTag
    );

    target.equippedItems = target.equippedItems || [];
    target.equippedItems.push({ id: card.id, name: card.name, image: card.image });
    if (card.overridesAppearance && card.image) {
      target.image = card.image;
    }
    if (card.attackNameOverride) {
      target.attackName = card.attackNameOverride;
    }
    if (card.attackEffectOverride) {
      target.attackEffect = card.attackEffectOverride;
    }

    const statBonusResult =
      card.equipAtkBonus || card.equipHpBonus
        ? [{ kind: "card", id: target.id, action: "BUFF", atk: card.equipAtkBonus || 0, hp: card.equipHpBonus || 0 }]
        : [];

    return {
      ok: true,
      card: { id: card.id, type: card.type, name: card.name, image: card.image, equipEffect: card.equipEffect || null },
      effectResults: [...statBonusResult, ...equipEffectResults],
    };
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
    let defenderDeathSkillEffect = null;
    let attackerDeathSkillEffect = null;
    let defenderRevived = false;
    let attackerRevived = false;
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
        defender.hp = 0; // 오버킬 데미지를 버려서 ON_DEATH 회복이 데미지 양과 무관하게 항상 동일하게 부활 판정되도록 함
        if (!defender.deathEffectUsed) {
          defender.deathEffectUsed = true; // ON_DEATH 스킬은 카드 인스턴스당 한 번만 발동(무한 부활 방지)
          deathEffectResults.push(
            ...applyEffectList(
              this,
              this.getOpponentId(playerId),
              defender.effects,
              "ON_DEATH",
              { sourceCardId: defender.id, killerCardId: attacker.id },
              defender.requiredTargetTag
            )
          );
          if (defender.effects?.[0]?.trigger === "ON_DEATH") {
            defenderDeathSkillName = defender.skillName || null;
            defenderDeathSkillEffect = defender.skillEffect || null;
          }
        }
        if (defender.hp <= 0) {
          const stillIndex = opponent.board.findIndex((card) => card.id === defender.id);
          if (stillIndex !== -1) opponent.board.splice(stillIndex, 1);
        } else {
          defenderRevived = true;
        }
      }
      if (attacker.hp <= 0) {
        attacker.hp = 0;
        if (!attacker.deathEffectUsed) {
          attacker.deathEffectUsed = true; // ON_DEATH 스킬은 카드 인스턴스당 한 번만 발동(무한 부활 방지)
          deathEffectResults.push(
            ...applyEffectList(
              this,
              playerId,
              attacker.effects,
              "ON_DEATH",
              { sourceCardId: attacker.id, killerCardId: defender.id },
              attacker.requiredTargetTag
            )
          );
          if (attacker.effects?.[0]?.trigger === "ON_DEATH") {
            attackerDeathSkillName = attacker.skillName || null;
            attackerDeathSkillEffect = attacker.skillEffect || null;
          }
        }
        if (attacker.hp <= 0) {
          player.board = player.board.filter((card) => card.id !== attacker.id);
        } else {
          attackerRevived = true;
        }
      }
    } else {
      return { ok: false, reason: "invalid_target" };
    }

    attacker.hasAttacked = true;
    return {
      ok: true,
      attackerCard: {
        id: attacker.id,
        name: attacker.name,
        attackName: attacker.attackName || null,
        attackEffect: attacker.attackEffect || null,
      },
      defenderDeathSkillName,
      attackerDeathSkillName,
      defenderDeathSkillEffect,
      attackerDeathSkillEffect,
      defenderRevived,
      attackerRevived,
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
      const drawCount = nextPlayer.maxMana >= MAX_MANA ? 2 : 1;
      for (let i = 0; i < drawCount; i += 1) {
        if (nextPlayer.deck.length > 0) {
          nextPlayer.hand.push(nextPlayer.deck.shift());
        }
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
      tier: this.tier,
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
