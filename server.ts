import express from "express";
import { createServer as createHttpServer } from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";

interface User {
  id: string;
  nickname: string;
  inVoice: boolean;
  isTyping: boolean;
}

interface Message {
  id: string;
  senderId: string;
  senderNickname: string;
  text: string;
  timestamp: string;
}

const PORT = Number(process.env.PORT || 3000);
const ROOM_KEY = process.env.ROOM_KEY?.trim() || "";
const MAX_USERS = Number(process.env.MAX_USERS || 10);
const MAX_MESSAGES_HISTORY = Number(process.env.MAX_MESSAGES_HISTORY || 100);
const MESSAGE_RATE_LIMIT_MS = Number(process.env.MESSAGE_RATE_LIMIT_MS || 650);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const normalizeNickname = (nickname?: string) => {
  const cleanNickname = nickname?.trim().replace(/\s+/g, " ").substring(0, 25);
  return cleanNickname || "Misafir";
};

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  const users: Map<string, User> = new Map();
  const messages: Message[] = [];
  const lastMessageAt: Map<string, number> = new Map();

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      usersCount: users.size,
      messagesCount: messages.length,
      roomKeyRequired: Boolean(ROOM_KEY),
    });
  });

  app.get("/api/config", (req, res) => {
    res.json({
      roomKeyRequired: Boolean(ROOM_KEY),
      maxUsers: MAX_USERS,
      maxMessagesHistory: MAX_MESSAGES_HISTORY,
    });
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("user:join", ({ nickname, roomKey }: { nickname: string; roomKey?: string }) => {
      if (ROOM_KEY && roomKey !== ROOM_KEY) {
        socket.emit("join:error", { message: "Oda anahtarı hatalı." });
        return;
      }

      if (!users.has(socket.id) && users.size >= MAX_USERS) {
        socket.emit("join:error", { message: "Oda şu an dolu." });
        return;
      }

      const cleanNickname = normalizeNickname(nickname);
      
      const newUser: User = {
        id: socket.id,
        nickname: cleanNickname,
        inVoice: false,
        isTyping: false
      };

      users.set(socket.id, newUser);

      socket.broadcast.emit("user:connected", newUser);

      socket.emit("room:state", {
        users: Array.from(users.values()),
        messages: messages
      });

      console.log(`User joined: ${cleanNickname} (${socket.id})`);
    });

    socket.on("chat:message", ({ text }: { text: string }) => {
      const user = users.get(socket.id);
      if (!user) return;

      const now = Date.now();
      const previousMessageAt = lastMessageAt.get(socket.id) || 0;
      if (now - previousMessageAt < MESSAGE_RATE_LIMIT_MS) {
        return;
      }
      lastMessageAt.set(socket.id, now);

      const cleanText = text ? text.substring(0, 1000) : "";
      if (!cleanText.trim()) return;

      const newMessage: Message = {
        id: `msg_${now}_${Math.random().toString(36).slice(2, 11)}`,
        senderId: socket.id,
        senderNickname: user.nickname,
        text: cleanText,
        timestamp: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      };

      messages.push(newMessage);
      if (messages.length > MAX_MESSAGES_HISTORY) {
        messages.shift();
      }

      if (user.isTyping) {
        user.isTyping = false;
        io.emit("chat:typing", { id: socket.id, nickname: user.nickname, isTyping: false });
      }

      io.emit("chat:message", newMessage);
    });

    socket.on("chat:typing", ({ isTyping }: { isTyping: boolean }) => {
      const user = users.get(socket.id);
      if (!user) return;

      user.isTyping = !!isTyping;
      socket.broadcast.emit("chat:typing", {
        id: socket.id,
        nickname: user.nickname,
        isTyping: !!isTyping
      });
    });

    socket.on("voice:join", () => {
      const user = users.get(socket.id);
      if (!user) return;

      if (!user.inVoice) {
        user.inVoice = true;
        console.log(`User connected to voice: ${user.nickname} (${socket.id})`);
        
        // Notify others in voice
        socket.broadcast.emit("voice:user-joined", {
          id: socket.id,
          nickname: user.nickname
        });

        // Broadcast updated user status to all users
        io.emit("user:updated", user);
      }
    });

    socket.on("voice:leave", () => {
      const user = users.get(socket.id);
      if (!user) return;

      if (user.inVoice) {
        user.inVoice = false;
        console.log(`User left voice: ${user.nickname} (${socket.id})`);
        
        // Notify others in voice
        socket.broadcast.emit("voice:user-left", {
          id: socket.id,
          nickname: user.nickname
        });

        // Broadcast updated user status to all users
        io.emit("user:updated", user);
      }
    });

    socket.on("webrtc:signal", ({ target, signal }: { target: string; signal: any }) => {
      const sender = users.get(socket.id);
      if (!sender || typeof target !== "string" || !users.has(target)) return;

      io.to(target).emit("webrtc:signal", {
        sender: socket.id,
        signal: signal
      });
    });

    socket.on("disconnect", () => {
      const user = users.get(socket.id);
      if (user) {
        console.log(`User disconnected: ${user.nickname} (${socket.id})`);

        if (user.inVoice) {
          socket.broadcast.emit("voice:user-left", {
            id: socket.id,
            nickname: user.nickname
          });
        }

        // Notify all clients of disconnection
        io.emit("user:disconnected", {
          id: socket.id,
          nickname: user.nickname
        });

        users.delete(socket.id);
        lastMessageAt.delete(socket.id);
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP and WebSocket server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical error starting server:", err);
});
