const { getClient } = require("../db");

async function getHighestCleared(userId) {
  const result = await getClient().execute({
    sql: "SELECT highest_cleared FROM stage_progress WHERE user_id = ? LIMIT 1",
    args: [userId],
  });
  return result.rows[0] ? Number(result.rows[0].highest_cleared) : 0;
}

async function setHighestCleared(userId, stageId) {
  await getClient().execute({
    sql: `INSERT INTO stage_progress (user_id, highest_cleared, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            highest_cleared = MAX(highest_cleared, excluded.highest_cleared),
            updated_at = CURRENT_TIMESTAMP`,
    args: [userId, stageId],
  });
}

module.exports = { getHighestCleared, setHighestCleared };
