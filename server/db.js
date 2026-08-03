const fs = require("fs");
const path = require("path");
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

async function migrateCardsTable(db) {
  const info = await db.execute("PRAGMA table_info(cards)");
  const existingCols = new Set(info.rows.map((col) => col.name));

  if (!existingCols.has("effects")) {
    await db.execute("ALTER TABLE cards ADD COLUMN effects TEXT NOT NULL DEFAULT '[]'");
  }
  if (!existingCols.has("equip_atk_bonus")) {
    await db.execute("ALTER TABLE cards ADD COLUMN equip_atk_bonus INTEGER");
  }
  if (!existingCols.has("equip_hp_bonus")) {
    await db.execute("ALTER TABLE cards ADD COLUMN equip_hp_bonus INTEGER");
  }
  if (!existingCols.has("description")) {
    await db.execute("ALTER TABLE cards ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!existingCols.has("matchup_vs_tag")) {
    await db.execute("ALTER TABLE cards ADD COLUMN matchup_vs_tag TEXT");
  }
  if (!existingCols.has("matchup_atk_bonus")) {
    await db.execute("ALTER TABLE cards ADD COLUMN matchup_atk_bonus INTEGER");
  }
  if (!existingCols.has("required_target_tag")) {
    await db.execute("ALTER TABLE cards ADD COLUMN required_target_tag TEXT");
  }
  if (!existingCols.has("rarity")) {
    await db.execute("ALTER TABLE cards ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common'");
  }
}

async function seedCardsIfEmpty(db) {
  const { rows } = await db.execute("SELECT COUNT(*) AS count FROM cards");
  if (Number(rows[0].count) > 0) return;

  const seedPath = path.join(__dirname, "data", "cards.json");
  const seedCards = JSON.parse(fs.readFileSync(seedPath, "utf-8"));

  for (const card of seedCards) {
    await db.execute({
      sql: `INSERT INTO cards (id, name, series, type, cost, atk, hp, synergy_tags, effects, equip_atk_bonus, equip_hp_bonus, description, matchup_vs_tag, matchup_atk_bonus, required_target_tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        card.id,
        card.name,
        card.series,
        card.type,
        card.cost,
        card.atk,
        card.hp,
        JSON.stringify(card.synergyTags || []),
        JSON.stringify(card.effects || []),
        card.equipAtkBonus ?? null,
        card.equipHpBonus ?? null,
        card.description || "",
        card.matchupVsTag ?? null,
        card.matchupAtkBonus ?? null,
        card.requiredTargetTag ?? null,
      ],
    });
  }
  console.log(`Seeded ${seedCards.length} cards from cards.json`);
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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      series TEXT NOT NULL,
      type TEXT NOT NULL,
      cost INTEGER NOT NULL,
      atk INTEGER NOT NULL,
      hp INTEGER NOT NULL,
      synergy_tags TEXT NOT NULL DEFAULT '[]',
      effects TEXT NOT NULL DEFAULT '[]',
      equip_atk_bonus INTEGER,
      equip_hp_bonus INTEGER,
      description TEXT NOT NULL DEFAULT '',
      matchup_vs_tag TEXT,
      matchup_atk_bonus INTEGER,
      required_target_tag TEXT,
      rarity TEXT NOT NULL DEFAULT 'common'
    )
  `);
  await migrateCardsTable(db);
  await seedCardsIfEmpty(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS decks (
      user_id INTEGER PRIMARY KEY,
      card_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Turso connected");
}

module.exports = { connectDB, getClient };
