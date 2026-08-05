const express = require("express");

const { getDeckByUserId, saveDeck, resetAllDecks } = require("../models/Deck");
const { listCards } = require("../models/Card");
const { listOwnedCardIds } = require("../models/Collection");
const { listStarterCardIds } = require("../models/StarterCards");
const { requireAuth, requireAdmin } = require("../auth/middleware");
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
    const [cards, ownedCardIds, starterCardIds] = await Promise.all([
      listCards(),
      listOwnedCardIds(req.user.userId),
      listStarterCardIds(),
    ]);
    const allowedIds = new Set([...ownedCardIds, ...starterCardIds]);
    const cardsById = new Map(cards.filter((card) => allowedIds.has(card.id)).map((card) => [card.id, card]));

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

router.delete("/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    await resetAllDecks();
    return res.json({ ok: true });
  } catch (err) {
    console.error("[reset all decks] error:", err.message);
    return res.status(500).json({ ok: false, message: "덱 초기화 중 오류가 발생했습니다." });
  }
});

module.exports = router;
