const { getClient } = require("../db");

async function findUserByUsername(username) {
  const result = await getClient().execute({
    sql: "SELECT * FROM users WHERE username = ? LIMIT 1",
    args: [username],
  });
  return result.rows[0] || null;
}

async function createUser({ username, passwordHash }) {
  const result = await getClient().execute({
    sql: "INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username, coins",
    args: [username, passwordHash],
  });
  return result.rows[0];
}

async function listUsers() {
  const result = await getClient().execute(
    "SELECT id, username, coins, created_at FROM users ORDER BY created_at DESC"
  );
  return result.rows;
}

async function deleteUserByUsername(username) {
  await getClient().execute({
    sql: "DELETE FROM users WHERE username = ?",
    args: [username],
  });
}

async function getCoins(userId) {
  const result = await getClient().execute({
    sql: "SELECT coins FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  return result.rows[0] ? Number(result.rows[0].coins) : null;
}

async function addCoins(userId, delta) {
  const result = await getClient().execute({
    sql: "UPDATE users SET coins = coins + ? WHERE id = ? RETURNING coins",
    args: [delta, userId],
  });
  return result.rows[0] ? Number(result.rows[0].coins) : null;
}

/** 잔액이 amount 이상일 때만 원자적으로 차감. 잔액 부족시 아무것도 하지 않고 null 반환. */
async function deductCoins(userId, amount) {
  const result = await getClient().execute({
    sql: "UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ? RETURNING coins",
    args: [amount, userId, amount],
  });
  return result.rows[0] ? Number(result.rows[0].coins) : null;
}

async function addRankScore(userId, delta) {
  const result = await getClient().execute({
    sql: "UPDATE users SET rank_score = MAX(0, rank_score + ?) WHERE id = ? RETURNING rank_score",
    args: [delta, userId],
  });
  return result.rows[0] ? Number(result.rows[0].rank_score) : null;
}

async function getLeaderboard(limit = 100) {
  const result = await getClient().execute({
    sql: "SELECT username, rank_score FROM users ORDER BY rank_score DESC, username ASC LIMIT ?",
    args: [limit],
  });
  return result.rows;
}

async function getRankScore(userId) {
  const result = await getClient().execute({
    sql: "SELECT rank_score FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  if (!result.rows[0]) return null;
  const score = Number(result.rows[0].rank_score);

  const rankResult = await getClient().execute({
    sql: "SELECT COUNT(*) AS higher FROM users WHERE rank_score > ?",
    args: [score],
  });
  const rank = Number(rankResult.rows[0].higher) + 1;

  return { score, rank };
}

module.exports = {
  findUserByUsername,
  createUser,
  listUsers,
  deleteUserByUsername,
  addCoins,
  deductCoins,
  getCoins,
  addRankScore,
  getLeaderboard,
  getRankScore,
};
