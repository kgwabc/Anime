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
    sql: "INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username",
    args: [username, passwordHash],
  });
  return result.rows[0];
}

module.exports = { findUserByUsername, createUser };
