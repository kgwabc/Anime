const { getClient } = require("../db");

async function listStarterCardIds() {
  const result = await getClient().execute("SELECT card_id FROM starter_cards");
  return result.rows.map((row) => row.card_id);
}

async function setStarterCardIds(cardIds) {
  const db = getClient();
  await db.execute("DELETE FROM starter_cards");
  for (const cardId of cardIds) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO starter_cards (card_id) VALUES (?)",
      args: [cardId],
    });
  }
}

module.exports = { listStarterCardIds, setStarterCardIds };
