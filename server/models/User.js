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

module.exports = { findUserByUsername, createUser, listUsers, deleteUserByUsername, addCoins, getCoins };
