const express = require("express");

const { listCards, getCardById, createCard, updateCard, deleteCard } = require("../models/Card");
const { requireAuth, requireAdmin } = require("../auth/middleware");

const router = express.Router();

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateCardFields(body, { partial } = {}) {
  const { name, series, type, cost, atk, hp, synergyTags } = body;

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
    if (typeof type !== "string" || type.trim().length === 0) {
      return "type은 비어있지 않은 문자열이어야 합니다.";
    }
  }
  if (!partial || cost !== undefined) {
    if (!isNonNegativeInt(cost)) return "cost는 0 이상의 정수여야 합니다.";
  }
  if (!partial || atk !== undefined) {
    if (!isNonNegativeInt(atk)) return "atk는 0 이상의 정수여야 합니다.";
  }
  if (!partial || hp !== undefined) {
    if (!isNonNegativeInt(hp)) return "hp는 0 이상의 정수여야 합니다.";
  }
  if (synergyTags !== undefined) {
    if (!Array.isArray(synergyTags) || !synergyTags.every((tag) => typeof tag === "string")) {
      return "synergyTags는 문자열 배열이어야 합니다.";
    }
  }
  return null;
}

router.get("/", requireAuth, requireAdmin, async (req, res) => {
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
  const error = validateCardFields(body, { partial: true });
  if (error) return res.status(400).json({ ok: false, message: error });

  try {
    const existing = await getCardById(id);
    if (!existing) {
      return res.status(404).json({ ok: false, message: "카드를 찾을 수 없습니다." });
    }

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
