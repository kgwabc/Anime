const jwt = require("jsonwebtoken");

const ADMIN_USERNAME = "kgwabc";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, message: "인증이 필요합니다." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: payload.userId, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "유효하지 않은 토큰입니다." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.username !== ADMIN_USERNAME) {
    return res.status(403).json({ ok: false, message: "관리자만 접근할 수 있습니다." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, ADMIN_USERNAME };
