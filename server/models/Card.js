const { getClient } = require("../db");

function rowToCard(row) {
  return {
    id: row.id,
    name: row.name,
    series: row.series,
    type: row.type,
    cost: row.cost,
    atk: row.atk,
    hp: row.hp,
    synergyTags: JSON.parse(row.synergy_tags || "[]"),
    effects: JSON.parse(row.effects || "[]"),
    equipAtkBonus: row.equip_atk_bonus ?? null,
    equipHpBonus: row.equip_hp_bonus ?? null,
    description: row.description || "",
    matchupVsTag: row.matchup_vs_tag ?? null,
    matchupAtkBonus: row.matchup_atk_bonus ?? null,
    requiredTargetTag: row.required_target_tag ?? null,
    rarity: row.rarity || "common",
  };
}

function slugify(name) {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "card";
}

async function generateCardId(name) {
  const db = getClient();
  const base = `card_${slugify(name)}`;

  let candidate = base;
  let suffix = 2;
  while (true) {
    const result = await db.execute({
      sql: "SELECT 1 FROM cards WHERE id = ? LIMIT 1",
      args: [candidate],
    });
    if (result.rows.length === 0) return candidate;
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
}

async function listCards() {
  const result = await getClient().execute("SELECT * FROM cards ORDER BY series, cost");
  return result.rows.map(rowToCard);
}

async function getCardById(id) {
  const result = await getClient().execute({
    sql: "SELECT * FROM cards WHERE id = ? LIMIT 1",
    args: [id],
  });
  return result.rows[0] ? rowToCard(result.rows[0]) : null;
}

async function createCard({
  name,
  series,
  type,
  cost,
  atk,
  hp,
  synergyTags,
  effects,
  equipAtkBonus,
  equipHpBonus,
  description,
  matchupVsTag,
  matchupAtkBonus,
  requiredTargetTag,
  rarity,
}) {
  const id = await generateCardId(name);
  const isCharacter = type === "character";
  await getClient().execute({
    sql: `INSERT INTO cards (id, name, series, type, cost, atk, hp, synergy_tags, effects, equip_atk_bonus, equip_hp_bonus, description, matchup_vs_tag, matchup_atk_bonus, required_target_tag, rarity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      name,
      series,
      type,
      cost,
      isCharacter ? atk : 0,
      isCharacter ? hp : 0,
      JSON.stringify(synergyTags || []),
      JSON.stringify(effects || []),
      equipAtkBonus ?? null,
      equipHpBonus ?? null,
      description || "",
      isCharacter ? matchupVsTag ?? null : null,
      isCharacter ? matchupAtkBonus ?? null : null,
      isCharacter ? null : requiredTargetTag ?? null,
      rarity || "common",
    ],
  });
  return getCardById(id);
}

async function updateCard(id, fields) {
  const existing = await getCardById(id);
  if (!existing) return null;

  const merged = { ...existing, ...fields };
  const isCharacter = merged.type === "character";
  await getClient().execute({
    sql: `UPDATE cards SET name = ?, series = ?, type = ?, cost = ?, atk = ?, hp = ?, synergy_tags = ?,
          effects = ?, equip_atk_bonus = ?, equip_hp_bonus = ?, description = ?,
          matchup_vs_tag = ?, matchup_atk_bonus = ?, required_target_tag = ?, rarity = ?
          WHERE id = ?`,
    args: [
      merged.name,
      merged.series,
      merged.type,
      merged.cost,
      isCharacter ? merged.atk : 0,
      isCharacter ? merged.hp : 0,
      JSON.stringify(merged.synergyTags || []),
      JSON.stringify(merged.effects || []),
      merged.equipAtkBonus ?? null,
      merged.equipHpBonus ?? null,
      merged.description || "",
      isCharacter ? merged.matchupVsTag ?? null : null,
      isCharacter ? merged.matchupAtkBonus ?? null : null,
      isCharacter ? null : merged.requiredTargetTag ?? null,
      merged.rarity || "common",
      id,
    ],
  });
  return getCardById(id);
}

async function deleteCard(id) {
  await getClient().execute({
    sql: "DELETE FROM cards WHERE id = ?",
    args: [id],
  });
}

module.exports = { listCards, getCardById, createCard, updateCard, deleteCard };
