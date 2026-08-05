const express = require("express");

const { listCards } = require("../models/Card");
const { listOwnedCardIds, addOwnedCard } = require("../models/Collection");
const { listStarterCardIds } = require("../models/StarterCards");
const { getCoins, addCoins } = require("../models/User");
const { requireAuth } = require("../auth/middleware");
const { PACKS, DUPLICATE_REFUND, rollCard } = require("../game/packs");

const router = express.Router();

router.get("/packs", requireAuth, (req, res) => {
  return res.json({ ok: true, packs: Object.values(PACKS) });
});

router.get("/collection/mine", requireAuth, async (req, res) => {
  try {
    const [coins, ownedCardIds, starterCardIds] = await Promise.all([
      getCoins(req.user.userId),
      listOwnedCardIds(req.user.userId),
      listStarterCardIds(),
    ]);
    return res.json({ ok: true, coins, ownedCardIds, starterCardIds });
  } catch (err) {
    console.error("[get collection] error:", err.message);
    return res.status(500).json({ ok: false, message: "컬렉션 조회 중 오류가 발생했습니다." });
  }
});

router.post("/packs/:packId/open", requireAuth, async (req, res) => {
  const pack = PACKS[req.params.packId];
  if (!pack) {
    return res.status(400).json({ ok: false, message: "존재하지 않는 카드팩입니다." });
  }

  try {
    const coins = await getCoins(req.user.userId);
    if (coins === null) {
      return res.status(404).json({ ok: false, message: "유저를 찾을 수 없습니다." });
    }
    if (coins < pack.cost) {
      return res.status(400).json({ ok: false, message: "코인이 부족합니다." });
    }

    const [cards, ownedCardIds, starterCardIds] = await Promise.all([
      listCards(),
      listOwnedCardIds(req.user.userId),
      listStarterCardIds(),
    ]);
    if (cards.length === 0) {
      return res.status(400).json({ ok: false, message: "뽑을 수 있는 카드가 없습니다." });
    }

    const card = rollCard(pack, cards);
    const alreadyOwned = ownedCardIds.includes(card.id) || starterCardIds.includes(card.id);

    let balance = await addCoins(req.user.userId, -pack.cost);
    let refund = 0;
    if (alreadyOwned) {
      refund = DUPLICATE_REFUND[card.rarity] ?? DUPLICATE_REFUND.common;
      balance = await addCoins(req.user.userId, refund);
    } else {
      await addOwnedCard(req.user.userId, card.id);
    }

    return res.json({ ok: true, card, isDuplicate: alreadyOwned, refund, coins: balance });
  } catch (err) {
    console.error("[open pack] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드팩 오픈 중 오류가 발생했습니다." });
  }
});

module.exports = router;
