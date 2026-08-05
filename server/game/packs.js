const PACKS = {
  normal: { id: "normal", name: "일반 카드팩", cost: 5000, legendaryChance: 0.01 },
  gold: { id: "gold", name: "골드 카드팩", cost: 20000, legendaryChance: 0.05 },
  premium: { id: "premium", name: "프리미엄 카드팩", cost: 100000, legendaryChance: 0.15 },
};

const DUPLICATE_REFUND = { common: 3000, legendary: 20000 };

function rollCard(pack, allCards) {
  const wantLegendary = Math.random() < pack.legendaryChance;
  const pool = allCards.filter((card) => card.rarity === (wantLegendary ? "legendary" : "common"));
  const fallbackPool = pool.length > 0 ? pool : allCards;
  return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
}

module.exports = { PACKS, DUPLICATE_REFUND, rollCard };
