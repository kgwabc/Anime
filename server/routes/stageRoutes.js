const express = require("express");

const { STAGES } = require("../data/stages");
const { getHighestCleared } = require("../models/StageProgress");
const { requireAuth } = require("../auth/middleware");

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

module.exports = router;
