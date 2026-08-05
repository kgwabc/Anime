const express = require("express");

const { STAGES } = require("../data/stages");
const { getHighestCleared } = require("../models/StageProgress");
const { getStageDeckCardIds, setStageDeckCardIds } = require("../models/StageDecks");
const { requireAuth, requireAdmin } = require("../auth/middleware");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const highestCleared = await getHighestCleared(req.user.userId);
    const stages = STAGES.map((stage) => ({
      id: stage.id,
      name: stage.name,
      aiName: stage.aiName,
      cleared: stage.id <= highestCleared,
      locked: stage.id > highestCleared + 1,
    }));
    return res.json({ ok: true, stages, highestCleared });
  } catch (err) {
    console.error("[list stages] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 목록 조회 중 오류가 발생했습니다." });
  }
});

router.get("/:id/deck", requireAuth, requireAdmin, async (req, res) => {
  const stageId = Number(req.params.id);
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) {
    return res.status(404).json({ ok: false, message: "존재하지 않는 스테이지입니다." });
  }

  try {
    const cardIds = (await getStageDeckCardIds(stageId)) ?? stage.deckCardIds;
    return res.json({ ok: true, cardIds });
  } catch (err) {
    console.error("[get stage deck] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 덱 조회 중 오류가 발생했습니다." });
  }
});

router.put("/:id/deck", requireAuth, requireAdmin, async (req, res) => {
  const stageId = Number(req.params.id);
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) {
    return res.status(404).json({ ok: false, message: "존재하지 않는 스테이지입니다." });
  }

  const { cardIds } = req.body || {};
  if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === "string")) {
    return res.status(400).json({ ok: false, message: "cardIds는 문자열 배열이어야 합니다." });
  }

  try {
    await setStageDeckCardIds(stageId, cardIds);
    return res.json({ ok: true, cardIds });
  } catch (err) {
    console.error("[save stage deck] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 덱 저장 중 오류가 발생했습니다." });
  }
});

module.exports = router;
