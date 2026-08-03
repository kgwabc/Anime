const express = require("express");

const { getDeckByUserId, saveDeck } = require("../models/Deck");
const { listCards } = require("../models/Card");
const { requireAuth } = require("../auth/middleware");
const { validateDeck } = require("../game/deckValidation");

const router = express.Router();

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const cardIds = await getDeckByUserId(req.user.userId);
    return res.json({ ok: true, cardIds: cardIds || [] });
  } catch (err) {
    console.error("[get deck] error:", err.message);
    return res.status(500).json({ ok: false, message: "덱 조회 중 오류가 발생했습니다." });
  }
});

router.put("/mine", requireAuth, async (req, res) => {
  const { cardIds } = req.body || {};

  if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === "string")) {
    return res.status(400).json({ ok: false, message: "cardIds는 문자열 배열이어야 합니다." });
  }

  try {
    const cards = await listCards();
    const cardsById = new Map(cards.map((card) => [card.id, card]));

    const result = validateDeck(cardIds, cardsById);
    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.reason });
    }

    await saveDeck(req.user.userId, cardIds);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[save deck] error:", err.message);
    return res.status(500).json({ ok: false, message: "덱 저장 중 오류가 발생했습니다." });
  }
});

module.exports = router;
