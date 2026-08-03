const express = require("express");

const { listCards, getCardById, createCard, updateCard, deleteCard } = require("../models/Card");
const { requireAuth, requireAdmin } = require("../auth/middleware");

const router = express.Router();

const CARD_TYPES = ["character", "spell", "equipment"];
const RARITIES = ["common", "legendary"];
const TRIGGERS = ["ON_PLAY", "ON_DEATH", "IMMEDIATE", "ON_EQUIP"];
const ACTIONS = ["DAMAGE", "HEAL", "DRAW", "BUFF"];
const TARGETS = ["ENEMY_HERO", "ALL_ENEMIES", "ALL_ALLIES", "TARGET_CHARACTER", "SELF"];

const ALLOWED_TRIGGERS_BY_TYPE = {
  character: ["ON_PLAY", "ON_DEATH"],
  spell: ["IMMEDIATE"],
  equipment: ["ON_EQUIP"],
};

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateEffects(effects, effectiveType) {
  if (effects === undefined) return null;
  if (!Array.isArray(effects) || effects.length > 1) {
    return "effects는 최대 1개의 효과를 담은 배열이어야 합니다.";
  }

  const allowedTriggers = ALLOWED_TRIGGERS_BY_TYPE[effectiveType] || [];
  for (const effect of effects) {
    if (typeof effect !== "object" || effect === null) {
      return "effects의 각 항목은 객체여야 합니다.";
    }
    const { trigger, action, value, target } = effect;
    if (!TRIGGERS.includes(trigger)) {
      return `trigger는 ${TRIGGERS.join("/")} 중 하나여야 합니다.`;
    }
    if (!allowedTriggers.includes(trigger)) {
      return `${effectiveType} 타입은 trigger로 ${allowedTriggers.join("/")}만 사용할 수 있습니다.`;
    }
    if (!ACTIONS.includes(action)) {
      return `action은 ${ACTIONS.join("/")} 중 하나여야 합니다.`;
    }
    if (!TARGETS.includes(target)) {
      return `target은 ${TARGETS.join("/")} 중 하나여야 합니다.`;
    }
    if (!Number.isInteger(value)) {
      return "value는 정수여야 합니다.";
    }
  }
  return null;
}

function validateCardFields(body, { partial, existingType } = {}) {
  const {
    name,
    series,
    type,
    cost,
    atk,
    hp,
    synergyTags,
    effects,
    equipAtkBonus,
    equipHpBonus,
    description,
    matchupVsTag,
    matchupAtkBonus,
    requiredTargetTag,
    rarity,
  } = body;
  const effectiveType = type !== undefined ? type : existingType;

  if (!partial || name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return "name은 비어있지 않은 문자열이어야 합니다.";
    }
  }
  if (!partial || series !== undefined) {
    if (typeof series !== "string" || series.trim().length === 0) {
      return "series는 비어있지 않은 문자열이어야 합니다.";
    }
  }
  if (!partial || type !== undefined) {
    if (!CARD_TYPES.includes(type)) {
      return `type은 ${CARD_TYPES.join("/")} 중 하나여야 합니다.`;
    }
  }
  if (!partial || cost !== undefined) {
    if (!isNonNegativeInt(cost)) return "cost는 0 이상의 정수여야 합니다.";
  }
  if (effectiveType === "character") {
    if (!partial || atk !== undefined) {
      if (!isNonNegativeInt(atk)) return "atk는 0 이상의 정수여야 합니다.";
    }
    if (!partial || hp !== undefined) {
      if (!isNonNegativeInt(hp)) return "hp는 0 이상의 정수여야 합니다.";
    }
  }
  if (effectiveType === "equipment") {
    if (equipAtkBonus !== undefined && !isNonNegativeInt(equipAtkBonus)) {
      return "equipAtkBonus는 0 이상의 정수여야 합니다.";
    }
    if (equipHpBonus !== undefined && !isNonNegativeInt(equipHpBonus)) {
      return "equipHpBonus는 0 이상의 정수여야 합니다.";
    }
  }
  if (synergyTags !== undefined) {
    if (!Array.isArray(synergyTags) || !synergyTags.every((tag) => typeof tag === "string")) {
      return "synergyTags는 문자열 배열이어야 합니다.";
    }
  }
  if (description !== undefined && typeof description !== "string") {
    return "description은 문자열이어야 합니다.";
  }
  if (matchupVsTag !== undefined && matchupVsTag !== null) {
    if (typeof matchupVsTag !== "string" || matchupVsTag.trim().length === 0) {
      return "matchupVsTag는 비어있지 않은 문자열이어야 합니다.";
    }
  }
  if (matchupAtkBonus !== undefined && matchupAtkBonus !== null) {
    if (!isNonNegativeInt(matchupAtkBonus)) {
      return "matchupAtkBonus는 0 이상의 정수여야 합니다.";
    }
  }
  if (requiredTargetTag !== undefined && requiredTargetTag !== null) {
    if (typeof requiredTargetTag !== "string" || requiredTargetTag.trim().length === 0) {
      return "requiredTargetTag는 비어있지 않은 문자열이어야 합니다.";
    }
  }
  if (rarity !== undefined && !RARITIES.includes(rarity)) {
    return `rarity는 ${RARITIES.join("/")} 중 하나여야 합니다.`;
  }

  const effectsError = validateEffects(effects, effectiveType);
  if (effectsError) return effectsError;

  return null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const cards = await listCards();
    return res.json({ ok: true, cards });
  } catch (err) {
    console.error("[list cards] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드 목록 조회 중 오류가 발생했습니다." });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const error = validateCardFields(body);
  if (error) return res.status(400).json({ ok: false, message: error });

  try {
    const card = await createCard(body);
    return res.json({ ok: true, card });
  } catch (err) {
    console.error("[create card] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드 생성 중 오류가 발생했습니다." });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  try {
    const existing = await getCardById(id);
    if (!existing) {
      return res.status(404).json({ ok: false, message: "카드를 찾을 수 없습니다." });
    }

    const error = validateCardFields(body, { partial: true, existingType: existing.type });
    if (error) return res.status(400).json({ ok: false, message: error });

    const card = await updateCard(id, body);
    return res.json({ ok: true, card });
  } catch (err) {
    console.error("[update card] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드 수정 중 오류가 발생했습니다." });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await deleteCard(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[delete card] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드 삭제 중 오류가 발생했습니다." });
  }
});

module.exports = router;
