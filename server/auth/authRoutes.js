const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { findUserByUsername, createUser, listUsers, deleteUserByUsername, addCoins } = require("../models/User");
const { listOwnedCardIds, setOwnedCardIds } = require("../models/Collection");
const { requireAuth, requireAdmin, ADMIN_USERNAME } = require("./middleware");

const router = express.Router();

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "7d";

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

router.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "모든 필드를 입력해주세요." });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ ok: false, message: "닉네임은 2~20자여야 합니다." });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, message: "비밀번호는 최소 6자 이상이어야 합니다." });
  }

  try {
    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ ok: false, message: "이미 사용중인 닉네임입니다." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser({ username, passwordHash });

    return res.json({ ok: true, token: signToken(user), username: user.username, coins: user.coins });
  } catch (err) {
    console.error("[signup] error:", err.message);
    return res.status(500).json({ ok: false, message: "회원가입 중 오류가 발생했습니다." });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "닉네임과 비밀번호를 입력해주세요." });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ ok: false, message: "닉네임 또는 비밀번호가 올바르지 않습니다." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ ok: false, message: "닉네임 또는 비밀번호가 올바르지 않습니다." });
    }

    return res.json({ ok: true, token: signToken(user), username: user.username, coins: user.coins });
  } catch (err) {
    console.error("[login] error:", err.message);
    return res.status(500).json({ ok: false, message: "로그인 중 오류가 발생했습니다." });
  }
});

router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await listUsers();
    return res.json({ ok: true, users });
  } catch (err) {
    console.error("[list users] error:", err.message);
    return res.status(500).json({ ok: false, message: "유저 목록 조회 중 오류가 발생했습니다." });
  }
});

router.delete("/users/:username", requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.params;

  if (username === ADMIN_USERNAME) {
    return res.status(400).json({ ok: false, message: "관리자 계정은 삭제할 수 없습니다." });
  }

  try {
    await deleteUserByUsername(username);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[delete user] error:", err.message);
    return res.status(500).json({ ok: false, message: "계정 삭제 중 오류가 발생했습니다." });
  }
});

router.put("/users/:username/coins", requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { amount } = req.body || {};

  if (!Number.isInteger(amount)) {
    return res.status(400).json({ ok: false, message: "amount는 정수여야 합니다." });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ ok: false, message: "유저를 찾을 수 없습니다." });
    }

    const coins = await addCoins(user.id, amount);
    return res.json({ ok: true, coins });
  } catch (err) {
    console.error("[adjust coins] error:", err.message);
    return res.status(500).json({ ok: false, message: "코인 조정 중 오류가 발생했습니다." });
  }
});

router.get("/users/:username/cards", requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.params;

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ ok: false, message: "유저를 찾을 수 없습니다." });
    }

    const cardIds = await listOwnedCardIds(user.id);
    return res.json({ ok: true, cardIds });
  } catch (err) {
    console.error("[list owned cards] error:", err.message);
    return res.status(500).json({ ok: false, message: "보유 카드 조회 중 오류가 발생했습니다." });
  }
});

router.put("/users/:username/cards", requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { cardIds } = req.body || {};

  if (!Array.isArray(cardIds) || !cardIds.every((id) => typeof id === "string")) {
    return res.status(400).json({ ok: false, message: "cardIds는 문자열 배열이어야 합니다." });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ ok: false, message: "유저를 찾을 수 없습니다." });
    }

    await setOwnedCardIds(user.id, cardIds);
    return res.json({ ok: true, cardIds });
  } catch (err) {
    console.error("[set owned cards] error:", err.message);
    return res.status(500).json({ ok: false, message: "카드 저장 중 오류가 발생했습니다." });
  }
});

module.exports = router;
