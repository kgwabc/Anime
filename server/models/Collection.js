const { getClient } = require("../db");

async function listOwnedCardIds(userId) {
  const result = await getClient().execute({
    sql: "SELECT card_id FROM owned_cards WHERE user_id = ?",
    args: [userId],
  });
  return result.rows.map((row) => row.card_id);
}

async function addOwnedCard(userId, cardId) {
  await getClient().execute({
    sql: "INSERT OR IGNORE INTO owned_cards (user_id, card_id) VALUES (?, ?)",
    args: [userId, cardId],
  });
}

module.exports = { listOwnedCardIds, addOwnedCard };
