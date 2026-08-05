const { getClient } = require("../db");

async function getStageDeckCardIds(stageId) {
  const result = await getClient().execute({
    sql: "SELECT deck_card_ids FROM stage_decks WHERE stage_id = ? LIMIT 1",
    args: [stageId],
  });
  if (!result.rows[0]) return null;
  return JSON.parse(result.rows[0].deck_card_ids || "[]");
}

async function setStageDeckCardIds(stageId, cardIds) {
  await getClient().execute({
    sql: `INSERT INTO stage_decks (stage_id, deck_card_ids, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(stage_id) DO UPDATE SET deck_card_ids = excluded.deck_card_ids, updated_at = CURRENT_TIMESTAMP`,
    args: [stageId, JSON.stringify(cardIds)],
  });
}

module.exports = { getStageDeckCardIds, setStageDeckCardIds };
