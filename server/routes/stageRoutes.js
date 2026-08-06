const express = require("express");

const { listStages, getStageById, createStage, renameStage } = require("../models/Stage");
const { getHighestCleared } = require("../models/StageProgress");
const { getStageDeckCardIds, setStageDeckCardIds } = require("../models/StageDecks");
const { requireAuth, requireAdmin } = require("../auth/middleware");

const router = express.Router();

function validateStageFields(body) {
  const { name, aiName } = body;
  if (typeof name !== "string" || name.trim().length === 0) {
    return "name은 비어있지 않은 문자열이어야 합니다.";
  }
  if (typeof aiName !== "string" || aiName.trim().length === 0) {
    return "aiName은 비어있지 않은 문자열이어야 합니다.";
  }
  return null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const highestCleared = await getHighestCleared(req.user.userId);
    const allStages = await listStages();
    const stages = allStages.map((stage) => ({
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

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const error = validateStageFields(body);
  if (error) return res.status(400).json({ ok: false, message: error });

  try {
    const stage = await createStage(body);
    return res.json({ ok: true, stage });
  } catch (err) {
    console.error("[create stage] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 생성 중 오류가 발생했습니다." });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const stageId = Number(req.params.id);
  const body = req.body || {};
  const error = validateStageFields(body);
  if (error) return res.status(400).json({ ok: false, message: error });

  try {
    const existing = await getStageById(stageId);
    if (!existing) {
      return res.status(404).json({ ok: false, message: "존재하지 않는 스테이지입니다." });
    }

    const stage = await renameStage(stageId, body);
    return res.json({ ok: true, stage });
  } catch (err) {
    console.error("[rename stage] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 이름 변경 중 오류가 발생했습니다." });
  }
});

router.get("/:id/deck", requireAuth, requireAdmin, async (req, res) => {
  const stageId = Number(req.params.id);
  const stage = await getStageById(stageId);
  if (!stage) {
    return res.status(404).json({ ok: false, message: "존재하지 않는 스테이지입니다." });
  }

  try {
    const cardIds = (await getStageDeckCardIds(stageId)) ?? [];
    return res.json({ ok: true, cardIds });
  } catch (err) {
    console.error("[get stage deck] error:", err.message);
    return res.status(500).json({ ok: false, message: "스테이지 덱 조회 중 오류가 발생했습니다." });
  }
});

router.put("/:id/deck", requireAuth, requireAdmin, async (req, res) => {
  const stageId = Number(req.params.id);
  const stage = await getStageById(stageId);
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
