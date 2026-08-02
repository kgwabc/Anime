require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { connectDB } = require("./db");
const authRoutes = require("./auth/authRoutes");
const { socketAuthMiddleware } = require("./auth/socketAuth");
const { Matchmaker } = require("./game/matchmaking");
const { GameRoom } = require("./game/GameRoom");

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "crossover-tcg-server" });
});
app.use("/auth", authRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
io.use(socketAuthMiddleware);

const allCards = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "cards.json"), "utf-8")
);

const matchmaker = new Matchmaker();
/** @type {Map<string, GameRoom>} roomId -> GameRoom */
const rooms = new Map();
/** @type {Map<string, string>} socketId -> roomId, 소켓이 어느 방에 있는지 조회용 */
const socketToRoom = new Map();

function broadcastGameState(room) {
  for (const playerId of room.playerOrder) {
    io.to(playerId).emit("game_state_update", room.toClientState(playerId));
  }
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("join_queue", () => {
    matchmaker.addToQueue(socket.id);
    console.log(`[queue] ${socket.id} joined. queue size=${matchmaker.waitingQueue.length}`);

    const pair = matchmaker.tryMatch();
    if (!pair) return;

    const [playerA, playerB] = pair;
    const roomId = `room_${playerA}_${playerB}`;
    const players = [playerA, playerB].map((id) => ({
      id,
      username: io.sockets.sockets.get(id)?.data.username || "Unknown",
    }));
    const room = new GameRoom(roomId, players, allCards);
    rooms.set(roomId, room);
    socketToRoom.set(playerA, roomId);
    socketToRoom.set(playerB, roomId);

    for (const playerId of [playerA, playerB]) {
      io.to(playerId).emit("match_found", room.toClientState(playerId));
    }
    console.log(`[match] ${roomId} started`);
  });

  socket.on("play_card", ({ cardId }) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.playCard(socket.id, cardId);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    broadcastGameState(room);

    if (room.isGameOver()) {
      const loserId = room.playerOrder.find((id) => room.players[id].hp <= 0);
      const winnerId = room.getOpponentId(loserId);
      io.to(winnerId).emit("game_over", { result: "win" });
      io.to(loserId).emit("game_over", { result: "lose" });
      rooms.delete(roomId);
      socketToRoom.delete(loserId);
      socketToRoom.delete(winnerId);
    }
  });

  socket.on("end_turn", () => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = room.endTurn(socket.id);
    if (!result.ok) {
      socket.emit("action_error", result.reason);
      return;
    }

    broadcastGameState(room);
  });

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    matchmaker.removeFromQueue(socket.id);

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const opponentId = room.getOpponentId(socket.id);
    io.to(opponentId).emit("opponent_disconnected");
    rooms.delete(roomId);
    socketToRoom.delete(socket.id);
    socketToRoom.delete(opponentId);
  });
});

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Crossover TCG server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
