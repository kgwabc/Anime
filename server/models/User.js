const { getClient } = require("../db");

async function findUserByEmailOrUsername(email, username) {
  const result = await getClient().execute({
    sql: "SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1",
    args: [email.toLowerCase(), username],
  });
  return result.rows[0] || null;
}

async function findUserByEmail(email) {
  const result = await getClient().execute({
    sql: "SELECT * FROM users WHERE email = ? LIMIT 1",
    args: [email.toLowerCase()],
  });
  return result.rows[0] || null;
}

async function createUser({ username, email, passwordHash }) {
  const result = await getClient().execute({
    sql: "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?) RETURNING id, username, email",
    args: [username, email.toLowerCase(), passwordHash],
  });
  return result.rows[0];
}

module.exports = { findUserByEmailOrUsername, findUserByEmail, createUser };
