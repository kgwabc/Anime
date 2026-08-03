const DECK_SIZE = 30;
const MAX_COPIES_COMMON = 2;
const MAX_COPIES_LEGENDARY = 1;
const MAX_LEGENDARY_TOTAL = 2;

/**
 * @param {string[]} cardIds 중복 포함 카드 id 배열(정확히 30개여야 함)
 * @param {Map<string, object>} cardsById 현재 존재하는 카드 정의(id -> card)
 * @returns {{ok: boolean, reason?: string}}
 */
function validateDeck(cardIds, cardsById) {
  if (!Array.isArray(cardIds) || cardIds.length !== DECK_SIZE) {
    return { ok: false, reason: `덱은 정확히 ${DECK_SIZE}장이어야 합니다.` };
  }

  const counts = new Map();
  for (const cardId of cardIds) {
    if (!cardsById.has(cardId)) {
      return { ok: false, reason: `존재하지 않는 카드가 포함되어 있습니다: ${cardId}` };
    }
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  }

  let legendaryTotal = 0;
  for (const [cardId, count] of counts) {
    const card = cardsById.get(cardId);
    const isLegendary = card.rarity === "legendary";
    const maxCopies = isLegendary ? MAX_COPIES_LEGENDARY : MAX_COPIES_COMMON;
    if (count > maxCopies) {
      return {
        ok: false,
        reason: `"${card.name}"은 최대 ${maxCopies}장까지만 넣을 수 있습니다.`,
      };
    }
    if (isLegendary) legendaryTotal += count;
  }

  if (legendaryTotal > MAX_LEGENDARY_TOTAL) {
    return { ok: false, reason: `전설 카드는 덱에 최대 ${MAX_LEGENDARY_TOTAL}장까지만 넣을 수 있습니다.` };
  }

  return { ok: true };
}

module.exports = { validateDeck, DECK_SIZE, MAX_COPIES_COMMON, MAX_COPIES_LEGENDARY, MAX_LEGENDARY_TOTAL };
