// SELF 타겟 해석 규칙 (가장 모호한 부분이라 명시적으로 문서화):
// - action이 DRAW/HEAL이면 SELF는 항상 발동 주체(카드 컨트롤러) 플레이어(영웅)를 가리킨다.
// - action이 BUFF/DAMAGE이고 trigger가 ON_PLAY/ON_DEATH(캐릭터 스킬)면 SELF는 카드 자기 자신.
// - trigger가 IMMEDIATE(스펠)이면 스펠은 보드 위에 "자기 자신"이 없으므로 SELF는 시전자 영웅.
//
// 참고: DAMAGE 효과로 캐릭터가 죽는 경우(스킬/스펠) ON_DEATH는 발동하지 않는다 — 무한 연쇄를
// 막기 위한 MVP 범위 제한. 전투(GameRoom.attack)로 인한 죽음만 ON_DEATH를 발동시킨다.

function findCharacterOnEitherBoard(room, cardId) {
  for (const playerId of room.playerOrder) {
    const player = room.players[playerId];
    const card = player.board.find((c) => c.id === cardId);
    if (card) return { player, card };
  }
  return null;
}

function resolveTargets(room, playerId, effect, context) {
  const opponentId = room.getOpponentId(playerId);
  const player = room.players[playerId];
  const opponent = room.players[opponentId];

  switch (effect.target) {
    case "ENEMY_HERO":
      return [{ kind: "player", ref: opponent }];
    case "ALL_ENEMIES":
      return opponent.board.map((card) => ({ kind: "card", ref: card, owner: opponent }));
    case "ALL_ALLIES":
      return player.board
        .filter((card) => card.id !== context.sourceCardId)
        .map((card) => ({ kind: "card", ref: card, owner: player }));
    case "TARGET_CHARACTER": {
      const found = findCharacterOnEitherBoard(room, context.chosenTargetCardId);
      if (!found) return null;
      return [{ kind: "card", ref: found.card, owner: found.player }];
    }
    case "KILLER": {
      if (!context.killerCardId) return null;
      const found = findCharacterOnEitherBoard(room, context.killerCardId);
      if (!found) return null; // 상호 사망 등으로 이미 보드에서 사라졌으면 그냥 불발
      return [{ kind: "card", ref: found.card, owner: found.player }];
    }
    case "SELF": {
      if (effect.action === "DRAW" || effect.action === "HEAL") {
        return [{ kind: "player", ref: player }];
      }
      if (effect.trigger === "IMMEDIATE") {
        return [{ kind: "player", ref: player }];
      }
      const sourceCard = player.board.find((c) => c.id === context.sourceCardId);
      if (!sourceCard) return [{ kind: "player", ref: player }];
      return [{ kind: "card", ref: sourceCard, owner: player }];
    }
    default:
      return null;
  }
}

function applyAction(effect, targets) {
  const results = [];

  for (const t of targets) {
    if (effect.action === "DAMAGE") {
      t.ref.hp = t.kind === "player" ? Math.max(0, t.ref.hp - effect.value) : t.ref.hp - effect.value;
      results.push({ kind: t.kind, id: t.ref.id, action: "DAMAGE", amount: effect.value });
    } else if (effect.action === "HEAL") {
      t.ref.hp += effect.value;
      results.push({ kind: t.kind, id: t.ref.id, action: "HEAL", amount: effect.value });
    } else if (effect.action === "DRAW" && t.kind === "player") {
      for (let i = 0; i < effect.value; i += 1) {
        if (t.ref.deck.length > 0) t.ref.hand.push(t.ref.deck.shift());
      }
    } else if (effect.action === "BUFF") {
      t.ref.atk += effect.value;
      t.ref.hp += effect.value;
      results.push({ kind: t.kind, id: t.ref.id, action: "BUFF", atk: effect.value, hp: effect.value });
    }
  }

  for (const t of targets) {
    if (t.kind === "card" && t.ref.hp <= 0) {
      t.owner.board = t.owner.board.filter((card) => card.id !== t.ref.id);
    }
  }

  return results;
}

/** 특정 trigger의 효과 목록에 TARGET_CHARACTER가 있는데 해석 불가능한 타겟이 있으면 true.
 * 상태 변경(마나 차감/손패 제거) 전에 미리 검증하는 용도. requiredTargetTag가 있으면
 * 대상 캐릭터의 synergyTags에 그 태그가 없는 경우도 해석 불가능으로 취급한다. */
function hasUnresolvableTarget(room, playerId, effects, trigger, context = {}, requiredTargetTag) {
  return (effects || [])
    .filter((effect) => effect.trigger === trigger)
    .some((effect) => {
      if (effect.target !== "TARGET_CHARACTER") return false;
      const found = findCharacterOnEitherBoard(room, context.chosenTargetCardId);
      if (!found) return true;
      if (requiredTargetTag && !(found.card.synergyTags || []).includes(requiredTargetTag)) return true;
      return false;
    });
}

function applyEffectList(room, playerId, effects, trigger, context = {}) {
  const matching = (effects || []).filter((effect) => effect.trigger === trigger);
  const allResults = [];
  for (const effect of matching) {
    const targets = resolveTargets(room, playerId, effect, context);
    if (!targets) continue;
    allResults.push(...applyAction(effect, targets));
  }
  return allResults;
}

module.exports = { applyEffectList, hasUnresolvableTarget };
