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

async function removeOwnedCard(userId, cardId) {
  await getClient().execute({
    sql: "DELETE FROM owned_cards WHERE user_id = ? AND card_id = ?",
    args: [userId, cardId],
  });
}

async function setOwnedCardIds(userId, cardIds) {
  const db = getClient();
  await db.execute({ sql: "DELETE FROM owned_cards WHERE user_id = ?", args: [userId] });
  for (const cardId of cardIds) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO owned_cards (user_id, card_id) VALUES (?, ?)",
      args: [userId, cardId],
    });
  }
}

module.exports = { listOwnedCardIds, addOwnedCard, removeOwnedCard, setOwnedCardIds };
