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

async function createCard({ name, series, type, cost, atk, hp, synergyTags }) {
  const id = await generateCardId(name);
  await getClient().execute({
    sql: `INSERT INTO cards (id, name, series, type, cost, atk, hp, synergy_tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, series, type, cost, atk, hp, JSON.stringify(synergyTags || [])],
  });
  return getCardById(id);
}

async function updateCard(id, fields) {
  const existing = await getCardById(id);
  if (!existing) return null;

  const merged = { ...existing, ...fields };
  await getClient().execute({
    sql: `UPDATE cards SET name = ?, series = ?, type = ?, cost = ?, atk = ?, hp = ?, synergy_tags = ?
          WHERE id = ?`,
    args: [
      merged.name,
      merged.series,
      merged.type,
      merged.cost,
      merged.atk,
      merged.hp,
      JSON.stringify(merged.synergyTags || []),
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
