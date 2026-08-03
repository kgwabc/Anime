const { createClient } = require("@libsql/client");

let client;

function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not set");
    }
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

async function migrateUsersTable(db) {
  const info = await db.execute("PRAGMA table_info(users)");
  const hasOldSchema = info.rows.some((col) => col.name === "email");
  if (hasOldSchema) {
    console.log("Old users table schema detected (email column) — dropping and recreating");
    await db.execute("DROP TABLE users");
  }
}

async function connectDB() {
  const db = getClient();
  await migrateUsersTable(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Turso connected");
}

module.exports = { connectDB, getClient };
