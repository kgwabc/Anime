const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { findUserByEmailOrUsername, findUserByEmail, createUser } = require("../models/User");

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
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ ok: false, message: "모든 필드를 입력해주세요." });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ ok: false, message: "닉네임은 2~20자여야 합니다." });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, message: "비밀번호는 최소 6자 이상이어야 합니다." });
  }

  try {
    const existing = await findUserByEmailOrUsername(email, username);
    if (existing) {
      return res.status(409).json({ ok: false, message: "이미 사용중인 이메일 또는 닉네임입니다." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser({ username, email, passwordHash });

    return res.json({ ok: true, token: signToken(user), username: user.username });
  } catch (err) {
    console.error("[signup] error:", err.message);
    return res.status(500).json({ ok: false, message: "회원가입 중 오류가 발생했습니다." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: "이메일과 비밀번호를 입력해주세요." });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    return res.json({ ok: true, token: signToken(user), username: user.username });
  } catch (err) {
    console.error("[login] error:", err.message);
    return res.status(500).json({ ok: false, message: "로그인 중 오류가 발생했습니다." });
  }
});

module.exports = router;
