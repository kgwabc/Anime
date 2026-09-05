const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");
const { STAGES } = require("./data/stages");

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

async function migrateUsersCoinsColumn(db) {
  const info = await db.execute("PRAGMA table_info(users)");
  const existingCols = new Set(info.rows.map((col) => col.name));
  if (!existingCols.has("coins")) {
    await db.execute("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 5000");
  }
}

async function migrateUsersRankColumn(db) {
  const info = await db.execute("PRAGMA table_info(users)");
  const existingCols = new Set(info.rows.map((col) => col.name));
  if (!existingCols.has("rank_score")) {
    await db.execute("ALTER TABLE users ADD COLUMN rank_score INTEGER NOT NULL DEFAULT 1000");
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
  if (!existingCols.has("image")) {
    await db.execute("ALTER TABLE cards ADD COLUMN image TEXT");
  }
  if (!existingCols.has("attack_name")) {
    await db.execute("ALTER TABLE cards ADD COLUMN attack_name TEXT");
  }
  if (!existingCols.has("skill_name")) {
    await db.execute("ALTER TABLE cards ADD COLUMN skill_name TEXT");
  }
  if (!existingCols.has("overrides_appearance")) {
    await db.execute("ALTER TABLE cards ADD COLUMN overrides_appearance INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingCols.has("attack_name_override")) {
    await db.execute("ALTER TABLE cards ADD COLUMN attack_name_override TEXT");
  }
  if (!existingCols.has("attack_effect")) {
    await db.execute("ALTER TABLE cards ADD COLUMN attack_effect TEXT");
  }
  if (!existingCols.has("skill_effect")) {
    await db.execute("ALTER TABLE cards ADD COLUMN skill_effect TEXT");
  }
  if (!existingCols.has("equip_effect")) {
    await db.execute("ALTER TABLE cards ADD COLUMN equip_effect TEXT");
  }
  if (!existingCols.has("attack_effect_override")) {
    await db.execute("ALTER TABLE cards ADD COLUMN attack_effect_override TEXT");
  }
  if (!existingCols.has("allow_duplicate_equip")) {
    await db.execute("ALTER TABLE cards ADD COLUMN allow_duplicate_equip INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingCols.has("transform_trigger_equip_id")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_trigger_equip_id TEXT");
  }
  if (!existingCols.has("transform_required_count")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_required_count INTEGER");
  }
  if (!existingCols.has("transform_atk")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_atk INTEGER");
  }
  if (!existingCols.has("transform_hp")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_hp INTEGER");
  }
  if (!existingCols.has("transform_name")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_name TEXT");
  }
  if (!existingCols.has("transform_image")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_image TEXT");
  }
  if (!existingCols.has("transform_attack_name")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_attack_name TEXT");
  }
  if (!existingCols.has("transform_attack_effect")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_attack_effect TEXT");
  }
  if (!existingCols.has("transform_effect")) {
    await db.execute("ALTER TABLE cards ADD COLUMN transform_effect TEXT");
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

async function seedStagesIfEmpty(db) {
  const { rows } = await db.execute("SELECT COUNT(*) AS count FROM stages");
  if (Number(rows[0].count) > 0) return;

  for (const stage of STAGES) {
    await db.execute({
      sql: "INSERT INTO stages (id, name, ai_name) VALUES (?, ?, ?)",
      args: [stage.id, stage.name, stage.aiName],
    });
  }
  console.log(`Seeded ${STAGES.length} stages from stages.js`);
}

async function seedStageDecksIfEmpty(db) {
  for (const stage of STAGES) {
    const { rows } = await db.execute({
      sql: "SELECT 1 FROM stage_decks WHERE stage_id = ? LIMIT 1",
      args: [stage.id],
    });
    if (rows.length > 0) continue;

    await db.execute({
      sql: `INSERT INTO stage_decks (stage_id, deck_card_ids, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      args: [stage.id, JSON.stringify(stage.deckCardIds)],
    });
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
      coins INTEGER NOT NULL DEFAULT 5000,
      rank_score INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await migrateUsersCoinsColumn(db);
  await migrateUsersRankColumn(db);
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
      rarity TEXT NOT NULL DEFAULT 'common',
      image TEXT,
      attack_name TEXT,
      skill_name TEXT,
      overrides_appearance INTEGER NOT NULL DEFAULT 0,
      attack_name_override TEXT,
      attack_effect TEXT,
      skill_effect TEXT,
      equip_effect TEXT,
      attack_effect_override TEXT,
      allow_duplicate_equip INTEGER NOT NULL DEFAULT 0,
      transform_trigger_equip_id TEXT,
      transform_required_count INTEGER,
      transform_atk INTEGER,
      transform_hp INTEGER,
      transform_name TEXT,
      transform_image TEXT,
      transform_attack_name TEXT,
      transform_attack_effect TEXT,
      transform_effect TEXT
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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS owned_cards (
      user_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, card_id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS starter_cards (
      card_id TEXT PRIMARY KEY
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS random_ai_pool_cards (
      card_id TEXT PRIMARY KEY
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stage_progress (
      user_id INTEGER PRIMARY KEY,
      highest_cleared INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quest_progress (
      user_id INTEGER PRIMARY KEY,
      daily_wins INTEGER NOT NULL DEFAULT 0,
      daily_date TEXT NOT NULL DEFAULT '',
      daily_claimed INTEGER NOT NULL DEFAULT 0,
      standing_wins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stage_decks (
      stage_id INTEGER PRIMARY KEY,
      deck_card_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stages (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      ai_name TEXT NOT NULL
    )
  `);
  await seedStagesIfEmpty(db);
  await seedStageDecksIfEmpty(db);
  console.log("Turso connected");
}

module.exports = { connectDB, getClient };
