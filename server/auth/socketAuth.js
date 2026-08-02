const jwt = require("jsonwebtoken");

function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("authentication_required"));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.userId = payload.userId;
    socket.data.username = payload.username;
    next();
  } catch (err) {
    next(new Error("invalid_token"));
  }
}

module.exports = { socketAuthMiddleware };
