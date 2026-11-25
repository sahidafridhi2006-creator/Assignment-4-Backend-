require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const EventEmitter = require("events");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const events = new EventEmitter();

const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@secureconnect.local";

const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const notesFile = path.join(dataDir, "notes.json");

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "[]");
  if (!fs.existsSync(notesFile)) fs.writeFileSync(notesFile, "[]");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function makeId() {
  return crypto.randomUUID();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "No token provided. Use Authorization: Bearer <token>." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied. Insufficient role." });
    }
    next();
  };
}

function findUserByEmail(email) {
  return readJson(usersFile).find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
}

function findUserById(id) {
  return readJson(usersFile).find((u) => u.id === id);
}

function emitAudit(action, details = {}) {
  events.emit("audit", {
    action,
    timestamp: new Date().toISOString(),
    ...details
  });
}

events.on("audit", (entry) => {
  console.log(`[EVENT] ${entry.action}`, entry);
});

events.on("userRegistered", (user) => {
  console.log(`[EVENT] New user registered: ${user.username} (${user.email})`);
});

events.on("noteCreated", (note) => {
  console.log(`[EVENT] Note created: ${note.id} by ${note.owner}`);
});

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.json({
    message: "Secure Connect and Communication Platform API",
    status: "running",
    endpoints: {
      signup: "POST /api/auth/signup",
      login: "POST /api/auth/login",
      profile: "GET /api/protected/profile",
      notes: "GET|POST /api/notes",
      noteById: "GET|PUT|DELETE /api/notes/:id",
      adminUsers: "GET /api/admin/users",
      health: "GET /api/health",
      socket: "Socket.IO namespace /"
    }
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ---------------- AUTH ----------------

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email and password are required." });
    }
    if (username.length < 3) {
      return res.status(400).json({ message: "Username must contain at least 3 characters." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must contain at least 6 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Please provide a valid email." });
    }
    if (findUserByEmail(email)) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const users = readJson(usersFile);
    const passwordHash = await bcrypt.hash(password, 12);

    const user = {
      id: makeId(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "user",
      createdAt: new Date().toISOString()
    };

    users.push(user);
    writeJson(usersFile, users);

    events.emit("userRegistered", user);
    emitAudit("SIGNUP", { userId: user.id, email: user.email });

    res.status(201).json({
      message: "User registered successfully.",
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during signup." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required." });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = signToken(user);
    emitAudit("LOGIN", { userId: user.id, email: user.email });

    res.json({
      message: "Login successful.",
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during login." });
  }
});

// ---------------- PROTECTED + RBAC ----------------

app.get("/api/protected/profile", authRequired, (req, res) => {
  const user = findUserById(req.user.sub);
  if (!user) return res.status(404).json({ message: "User not found." });

  res.json({ message: "Protected resource accessed.", user: publicUser(user) });
});

app.get("/api/admin/users", authRequired, roleRequired("admin"), (req, res) => {
  const users = readJson(usersFile).map(publicUser);
  res.json({ count: users.length, users });
});

// ---------------- NOTES CRUD ----------------

app.get("/api/notes", authRequired, (req, res) => {
  const notes = readJson(notesFile).filter((note) => note.owner === req.user.sub);
  res.json(notes);
});

app.get("/api/notes/:id", authRequired, (req, res) => {
  const note = readJson(notesFile).find(
    (item) => item.id === req.params.id && item.owner === req.user.sub
  );

  if (!note) return res.status(404).json({ message: "Note not found." });
  res.json(note);
});

app.post("/api/notes", authRequired, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ message: "title and content are required." });
  }

  const notes = readJson(notesFile);
  const now = new Date().toISOString();

  const note = {
    id: makeId(),
    title: title.trim(),
    content: content.trim(),
    owner: req.user.sub,
    createdAt: now,
    updatedAt: now
  };

  notes.push(note);
  writeJson(notesFile, notes);

  events.emit("noteCreated", note);
  emitAudit("NOTE_CREATE", { userId: req.user.sub, noteId: note.id });

  res.status(201).json(note);
});

app.put("/api/notes/:id", authRequired, (req, res) => {
  const notes = readJson(notesFile);
  const index = notes.findIndex(
    (item) => item.id === req.params.id && item.owner === req.user.sub
  );

  if (index === -1) return res.status(404).json({ message: "Note not found." });

  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: "title and content are required." });
  }

  notes[index] = {
    ...notes[index],
    title: title.trim(),
    content: content.trim(),
    updatedAt: new Date().toISOString()
  };

  writeJson(notesFile, notes);
  emitAudit("NOTE_UPDATE", { userId: req.user.sub, noteId: req.params.id });

  res.json(notes[index]);
});

app.delete("/api/notes/:id", authRequired, (req, res) => {
  const notes = readJson(notesFile);
  const index = notes.findIndex(
    (item) => item.id === req.params.id && item.owner === req.user.sub
  );

  if (index === -1) return res.status(404).json({ message: "Note not found." });

  const [deleted] = notes.splice(index, 1);
  writeJson(notesFile, notes);

  emitAudit("NOTE_DELETE", { userId: req.user.sub, noteId: deleted.id });

  res.json({ message: "Note deleted successfully.", id: deleted.id });
});

// ---------------- SOCKET.IO REAL-TIME CHAT ----------------

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("joinRoom", (room = "general") => {
    socket.join(room);
    socket.emit("systemMessage", {
      room,
      message: `Joined room "${room}".`,
      timestamp: new Date().toISOString()
    });
    emitAudit("SOCKET_JOIN", { socketId: socket.id, room });
  });

  socket.on("chatMessage", (payload = {}) => {
    const room = payload.room || "general";
    const username = payload.username || "Anonymous";
    const message = String(payload.message || "").trim();

    if (!message) return;

    const chat = {
      username,
      message,
      room,
      timestamp: new Date().toISOString()
    };

    io.to(room).emit("chatMessage", chat);
    events.emit("chatMessage", chat);
  });

  socket.on("disconnect", (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason})`);
    emitAudit("SOCKET_DISCONNECT", { socketId: socket.id, reason });
  });
});

events.on("chatMessage", (chat) => {
  console.log(`[CHAT][${chat.room}] ${chat.username}: ${chat.message}`);
});

ensureDataFiles();

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] Admin email: ${ADMIN_EMAIL}`);
});
