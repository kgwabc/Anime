const { getClient } = require("../db");

const DAILY_GOAL = 1;
const STANDING_GOAL = 3;

function todayKst() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function getRow(userId) {
  const result = await getClient().execute({
    sql: "SELECT * FROM quest_progress WHERE user_id = ? LIMIT 1",
    args: [userId],
  });
  return result.rows[0] || null;
}

function toProgress(row) {
  const today = todayKst();
  const isStaleDaily = !row || row.daily_date !== today;
  return {
    dailyWins: isStaleDaily ? 0 : Number(row.daily_wins),
    dailyClaimed: isStaleDaily ? false : Boolean(Number(row.daily_claimed)),
    standingWins: row ? Number(row.standing_wins) : 0,
  };
}

/** 유저의 현재 퀘스트 진행도를 반환한다. daily_date가 오늘과 다르면 조회 시점에 리셋한다. */
async function getProgress(userId) {
  const row = await getRow(userId);
  const today = todayKst();
  if (!row || row.daily_date !== today) {
    await getClient().execute({
      sql: `INSERT INTO quest_progress (user_id, daily_wins, daily_date, daily_claimed, standing_wins, updated_at)
            VALUES (?, 0, ?, 0, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              daily_wins = 0, daily_date = excluded.daily_date, daily_claimed = 0, updated_at = CURRENT_TIMESTAMP`,
      args: [userId, today, row ? row.standing_wins : 0],
    });
  }
  return toProgress(row);
}

/** 승리 1회를 일일/상시 퀘스트 진행도에 반영한다. */
async function recordWin(userId) {
  const row = await getRow(userId);
  const today = todayKst();
  const isStaleDaily = !row || row.daily_date !== today;
  const nextDailyWins = Math.min((isStaleDaily ? 0 : Number(row.daily_wins)) + 1, DAILY_GOAL);
  const nextStandingWins = (row ? Number(row.standing_wins) : 0) + 1;

  await getClient().execute({
    sql: `INSERT INTO quest_progress (user_id, daily_wins, daily_date, daily_claimed, standing_wins, updated_at)
          VALUES (?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            daily_wins = excluded.daily_wins,
            daily_date = excluded.daily_date,
            daily_claimed = CASE WHEN quest_progress.daily_date = excluded.daily_date THEN quest_progress.daily_claimed ELSE 0 END,
            standing_wins = excluded.standing_wins,
            updated_at = CURRENT_TIMESTAMP`,
    args: [userId, nextDailyWins, today, nextStandingWins],
  });
}

/** 일일 퀘스트 보상 수령 조건을 확인하고 충족 시 claimed 처리한다. 성공 여부를 반환. */
async function claimDaily(userId) {
  const today = todayKst();
  const result = await getClient().execute({
    sql: `UPDATE quest_progress SET daily_claimed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND daily_date = ? AND daily_wins >= ? AND daily_claimed = 0
          RETURNING user_id`,
    args: [userId, today, DAILY_GOAL],
  });
  return result.rows.length > 0;
}

/** 상시 퀘스트 보상 수령 조건을 확인하고 충족 시 진행도를 리셋한다. 성공 여부를 반환. */
async function claimStanding(userId) {
  const result = await getClient().execute({
    sql: `UPDATE quest_progress SET standing_wins = standing_wins - ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND standing_wins >= ?
          RETURNING user_id`,
    args: [STANDING_GOAL, userId, STANDING_GOAL],
  });
  return result.rows.length > 0;
}

module.exports = {
  DAILY_GOAL,
  STANDING_GOAL,
  getProgress,
  recordWin,
  claimDaily,
  claimStanding,
};
