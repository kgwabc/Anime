const { getClient } = require("../db");

async function getDeckByUserId(userId) {
  const result = await getClient().execute({
    sql: "SELECT card_ids FROM decks WHERE user_id = ? LIMIT 1",
    args: [userId],
  });
  if (!result.rows[0]) return null;
  return JSON.parse(result.rows[0].card_ids || "[]");
}

async function saveDeck(userId, cardIds) {
  await getClient().execute({
    sql: `INSERT INTO decks (user_id, card_ids, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET card_ids = excluded.card_ids, updated_at = CURRENT_TIMESTAMP`,
    args: [userId, JSON.stringify(cardIds)],
  });
}

async function resetAllDecks() {
  await getClient().execute("DELETE FROM decks");
}

module.exports = { getDeckByUserId, saveDeck, resetAllDecks };
