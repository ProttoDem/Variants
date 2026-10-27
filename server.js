import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const makeId = () => crypto.randomBytes(9).toString("hex");
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    questionNumber: room.questionNumber,
    totalQuestions: room.questions.length,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, connected: p.connected
    })),
    current: room.current ? {
      prompt: room.current.prompt,
      phase: room.phase,
      submissionsCount: room.current.submissions.size,
      votesCount: room.current.votes.size,
      playerCount: room.players.size,
      options: room.phase === "voting" || room.phase === "results"
        ? room.current.options.map(o => ({ id: o.id, text: o.text }))
        : [],
      results: room.phase === "results" ? {
        correctId: room.current.correctId,
        trapId: room.current.trapId,
        optionAuthors: room.current.options.map(o => ({
          id: o.id, authorName: o.authorName, kind: o.kind, text: o.text,
          voteCount: [...room.current.votes.values()].filter(v => v === o.id).length
        })),
        votes: [...room.current.votes.entries()].map(([playerId, optionId]) => ({
          playerName: room.players.get(playerId)?.name || "Гравець",
          optionId
        }))
      } : null
    } : null,
    questions: room.questions.map(q => ({ prompt: q.prompt }))
  };
}
function emitRoom(room) {
  io.to(room.code).emit("state", publicRoom(room));
}
function getRoom(code) { return rooms.get(String(code || "")); }
function isHost(socket, room) {
  return Boolean(room && socket.data.hostToken && socket.data.hostToken === room.hostToken);
}
function sendError(socket, message) { socket.emit("toast", { message }); }

io.on("connection", socket => {
  socket.on("create-room", ({ hostName, questions } = {}) => {
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const cleanQuestions = (Array.isArray(questions) ? questions : [])
      .slice(0, 30).map(q => ({
        prompt: clean(q.prompt, 500),
        correct: clean(q.correct, 500),
        trap: clean(q.trap, 500)
      })).filter(q => q.prompt && q.correct && q.trap);
    const room = {
      code, hostToken: makeId(), hostName: clean(hostName, 40) || "Ведуча",
      hostSocket: socket.id, players: new Map(), questions: cleanQuestions,
      phase: "lobby", questionNumber: 0, current: null
    };
    rooms.set(code, room);
    socket.data.hostToken = room.hostToken;
    socket.data.roomCode = code;
    socket.join(code);
    socket.emit("room-created", { code, hostToken: room.hostToken });
    emitRoom(room);
  });

  socket.on("rejoin-host", ({ code, hostToken } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostToken !== hostToken) return sendError(socket, "Не вдалося відновити сесію ведучої.");
    socket.data.hostToken = hostToken;
    socket.data.roomCode = room.code;
    room.hostSocket = socket.id;
    socket.join(room.code);
    socket.emit("host-rejoined", { code: room.code });
    emitRoom(room);
  });

  socket.on("join-room", ({ code, name, playerToken } = {}) => {
    const room = getRoom(code);
    if (!room) return sendError(socket, "Кімнату не знайдено. Перевір код або попроси ведучу створити нову.");
    const safeName = clean(name, 24);
    if (!safeName) return sendError(socket, "Введи ім'я.");
    let player = playerToken ? [...room.players.values()].find(p => p.token === playerToken) : null;
    if (player) {
      player.name = safeName;
      player.connected = true;
      player.socketId = socket.id;
    } else {
      if (room.phase !== "lobby") return sendError(socket, "Гра вже почалася. Нові гравці можуть приєднатися лише до старту.");
      if (room.players.size >= 30) return sendError(socket, "У кімнаті вже максимальна кількість гравців.");
      player = { id: makeId(), token: makeId(), name: safeName, score: 0, connected: true, socketId: socket.id };
      room.players.set(player.id, player);
    }
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.data.playerToken = player.token;
    socket.join(room.code);
    socket.emit("joined-room", { code: room.code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  socket.on("rejoin-player", ({ code, playerToken } = {}) => {
    const room = getRoom(code);
    const player = room && [...room.players.values()].find(p => p.token === playerToken);
    if (!room || !player) return sendError(socket, "Не вдалося повернутися в кімнату. Попроси ведучу перевірити гру.");
    player.connected = true;
    player.socketId = socket.id;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.data.playerToken = player.token;
    socket.join(room.code);
    socket.emit("player-rejoined", { code: room.code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  socket.on("start-round", ({ prompt, correct, trap } = {}) => {
    const room = getRoom(socket.data.roomCode);
    if (!isHost(socket, room)) return sendError(socket, "Лише ведуча може керувати грою.");
    if (room.phase !== "lobby" && room.phase !== "results") return sendError(socket, "Спочатку заверши поточний раунд.");
    const q = {
      prompt: clean(prompt, 500), correct: clean(correct, 500), trap: clean(trap, 500)
    };
    if (!q.prompt || !q.correct || !q.trap) return sendError(socket, "Заповни питання, правильну відповідь і пастку ведучої.");
    if (q.correct.toLowerCase() === q.trap.toLowerCase()) return sendError(socket, "Правильна відповідь і пастка мають відрізнятися.");
    room.questionNumber += 1;
    room.phase = "writing";
    room.current = {
      prompt: q.prompt, correct: q.correct, trap: q.trap,
      submissions: new Map(), votes: new Map(), options: [], correctId: null, trapId: null
    };
    emitRoom(room);
  });

  socket.on("submit-lie", ({ text } = {}) => {
    const room = getRoom(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.phase !== "writing") return sendError(socket, "Зараз не можна надсилати відповідь.");
    const lie = clean(text, 300);
    if (!lie) return sendError(socket, "Напиши свою вигадану відповідь.");
    room.current.submissions.set(player.id, lie);
    socket.emit("submission-saved");
    emitRoom(room);
  });

  socket.on("start-voting", () => {
    const room = getRoom(socket.data.roomCode);
    if (!isHost(socket, room) || room.phase !== "writing") return sendError(socket, "Не вдалося почати голосування.");
    const c = room.current;
    c.options = [];
    for (const [playerId, text] of c.submissions.entries()) {
      c.options.push({ id: makeId(), text, kind: "lie", authorId: playerId, authorName: room.players.get(playerId)?.name || "Гравець" });
    }
    c.options.push({ id: makeId(), text: c.correct, kind: "correct", authorId: null, authorName: null });
    c.options.push({ id: makeId(), text: c.trap, kind: "trap", authorId: null, authorName: null });
    for (let i = c.options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [c.options[i], c.options[j]] = [c.options[j], c.options[i]];
    }
    c.correctId = c.options.find(o => o.kind === "correct").id;
    c.trapId = c.options.find(o => o.kind === "trap").id;
    room.phase = "voting";
    emitRoom(room);
  });

  socket.on("vote", ({ optionId } = {}) => {
    const room = getRoom(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.phase !== "voting") return sendError(socket, "Голосування вже закрите.");
    const option = room.current.options.find(o => o.id === optionId);
    if (!option) return sendError(socket, "Такого варіанта немає.");
    if (option.authorId === player.id) return sendError(socket, "Не можна голосувати за власну брехню.");
    room.current.votes.set(player.id, optionId);
    socket.emit("vote-saved");
    emitRoom(room);
  });

  socket.on("reveal-results", () => {
    const room = getRoom(socket.data.roomCode);
    if (!isHost(socket, room) || room.phase !== "voting") return sendError(socket, "Не вдалося завершити голосування.");
    const c = room.current;
    for (const player of room.players.values()) {
      const chosen = c.votes.get(player.id);
      if (chosen === c.correctId) player.score += 1;
      if (chosen === c.trapId) player.score -= 1;
    }
    for (const option of c.options) {
      if (option.kind === "lie") {
        const voters = [...c.votes.entries()].filter(([voterId, optionId]) => voterId !== option.authorId && optionId === option.id);
        const author = room.players.get(option.authorId);
        if (author) author.score += voters.length;
      }
    }
    room.phase = "results";
    emitRoom(room);
  });

  socket.on("next-round", () => {
    const room = getRoom(socket.data.roomCode);
    if (!isHost(socket, room) || room.phase !== "results") return sendError(socket, "Спочатку відкрий результати.");
    room.phase = "lobby";
    room.current = null;
    emitRoom(room);
  });

  socket.on("end-game", () => {
    const room = getRoom(socket.data.roomCode);
    if (!isHost(socket, room)) return sendError(socket, "Лише ведуча може завершити гру.");
    io.to(room.code).emit("game-ended", {
      leaderboard: [...room.players.values()].map(p => ({ name: p.name, score: p.score })).sort((a,b) => b.score-a.score)
    });
    rooms.delete(room.code);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.data.playerId);
    if (player && player.socketId === socket.id) player.connected = false;
    emitRoom(room);
  });
});

server.listen(PORT, () => console.log(`Варіанти запущено: http://localhost:${PORT}`));
