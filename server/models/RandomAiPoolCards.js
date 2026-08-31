const { getClient } = require("../db");

async function listRandomAiPoolCardIds() {
  const result = await getClient().execute("SELECT card_id FROM random_ai_pool_cards");
  return result.rows.map((row) => row.card_id);
}

async function setRandomAiPoolCardIds(cardIds) {
  const db = getClient();
  await db.execute("DELETE FROM random_ai_pool_cards");
  for (const cardId of cardIds) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO random_ai_pool_cards (card_id) VALUES (?)",
      args: [cardId],
    });
  }
}

module.exports = { listRandomAiPoolCardIds, setRandomAiPoolCardIds };
