const express = require("express");

const { requireAuth } = require("../auth/middleware");
const { getLeaderboard, getRankScore } = require("../models/User");

const router = express.Router();

router.get("/top", requireAuth, async (req, res) => {
  try {
    const top = await getLeaderboard(100);
    return res.json({ ok: true, top });
  } catch (err) {
    console.error("[get rankings] error:", err.message);
    return res.status(500).json({ ok: false, message: "랭킹 조회 중 오류가 발생했습니다." });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const mine = await getRankScore(req.user.userId);
    return res.json({ ok: true, myScore: mine?.score ?? 0, myRank: mine?.rank ?? null });
  } catch (err) {
    console.error("[get my rank] error:", err.message);
    return res.status(500).json({ ok: false, message: "랭킹 조회 중 오류가 발생했습니다." });
  }
});

module.exports = router;
