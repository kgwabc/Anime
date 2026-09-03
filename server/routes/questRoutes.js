const express = require("express");

const { requireAuth } = require("../auth/middleware");
const { addCoins } = require("../models/User");
const { getProgress, claimDaily, claimStanding } = require("../models/Quest");

const QUEST_REWARD = 5000;

const router = express.Router();

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const progress = await getProgress(req.user.userId);
    return res.json({ ok: true, ...progress });
  } catch (err) {
    console.error("[get quests] error:", err.message);
    return res.status(500).json({ ok: false, message: "퀘스트 조회 중 오류가 발생했습니다." });
  }
});

router.post("/claim", requireAuth, async (req, res) => {
  const { type } = req.body;
  if (type !== "daily" && type !== "standing") {
    return res.status(400).json({ ok: false, message: "존재하지 않는 퀘스트입니다." });
  }

  try {
    const claimed = type === "daily" ? await claimDaily(req.user.userId) : await claimStanding(req.user.userId);
    if (!claimed) {
      return res.status(400).json({ ok: false, message: "아직 퀘스트 조건을 달성하지 못했습니다." });
    }

    const coins = await addCoins(req.user.userId, QUEST_REWARD);
    const progress = await getProgress(req.user.userId);
    return res.json({ ok: true, coins, ...progress });
  } catch (err) {
    console.error("[claim quest] error:", err.message);
    return res.status(500).json({ ok: false, message: "퀘스트 보상 수령 중 오류가 발생했습니다." });
  }
});

module.exports = router;
