const { getClient } = require("../db");

function rowToStage(row) {
  return { id: row.id, name: row.name, aiName: row.ai_name };
}

async function listStages() {
  const result = await getClient().execute("SELECT * FROM stages ORDER BY id");
  return result.rows.map(rowToStage);
}

async function getStageById(id) {
  const result = await getClient().execute({
    sql: "SELECT * FROM stages WHERE id = ? LIMIT 1",
    args: [id],
  });
  return result.rows[0] ? rowToStage(result.rows[0]) : null;
}

async function createStage({ name, aiName }) {
  const { rows } = await getClient().execute("SELECT COALESCE(MAX(id), 0) AS maxId FROM stages");
  const id = Number(rows[0].maxId) + 1;
  await getClient().execute({
    sql: "INSERT INTO stages (id, name, ai_name) VALUES (?, ?, ?)",
    args: [id, name, aiName],
  });
  return getStageById(id);
}

async function renameStage(id, { name, aiName }) {
  await getClient().execute({
    sql: "UPDATE stages SET name = ?, ai_name = ? WHERE id = ?",
    args: [name, aiName, id],
  });
  return getStageById(id);
}

module.exports = { listStages, getStageById, createStage, renameStage };
