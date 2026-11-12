import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, "chat_history.json"); // legacy file, deleted on start

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*"
    },
    maxHttpBufferSize: 1e6
});

const PORT = Number(process.env.PORT) || 3001;

const users = new Map();
const rateLimits = new Map();
const history = [];
const MAX_HISTORY = 100;

// Chat history is kept in memory only. Each server start is a fresh session,
// and it is also wiped whenever the last person leaves (see disconnect handler).
// Remove any old file left over from previous versions.
if (fs.existsSync(HISTORY_FILE)) {
    try { fs.unlinkSync(HISTORY_FILE); } catch {}
}

function saveHistory() {
    // no-op: history is intentionally not persisted
}

function cleanName(value) {
    const name = String(value || "")
        .trim()
        .replace(/[<>]/g, "")
        .slice(0, 18);

    return name || "Guest";
}

function publicUsers() {
    return [...users.values()].map(user => ({
        id: user.id,
        name: user.name,
        status: user.status || "online",
        joinedAt: user.joinedAt
    }));
}

function pushToHistory(message) {
    history.push(message);
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
    saveHistory();
}

function addSystemMessage(text) {
    const message = {
        id: `sys-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: "system",
        text,
        time: new Date().toISOString()
    };

    pushToHistory(message);
    console.log(`[${stamp()}] [SYSTEM]  ${text}`);
    io.emit("system:message", message);
}

// ---- Terminal logger: prints EVERY message (public, private, bot, edits, deletes) ----
// Set LOG_PRIVATE=false in the environment to hide private message content.
const LOG_PRIVATE = process.env.LOG_PRIVATE !== "false";

function stamp() {
    return new Date().toLocaleTimeString();
}

function logPublic(m) {
    console.log(`[${stamp()}] [PUBLIC]  ${m.sender}: ${m.text}`);
}

function logPrivate(dm) {
    const body = LOG_PRIVATE ? dm.text : "(content hidden)";
    console.log(`[${stamp()}] [PRIVATE] ${dm.sender} -> ${dm.targetName}: ${body}`);
}

// Anti-spam check: Max 6 messages per 4 seconds per socket
function isRateLimited(socketId) {
    const now = Date.now();
    const windowMs = 4000;
    const maxMsgs = 6;

    const timestamps = (rateLimits.get(socketId) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxMsgs) {
        rateLimits.set(socketId, timestamps);
        return true;
    }
    timestamps.push(now);
    rateLimits.set(socketId, timestamps);
    return false;
}

// Warning shown only to the sender (not stored in history)
function sendRateLimitWarning(socket) {
    socket.emit("system:message", {
        id: `warn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        type: "system",
        text: "⚠️ You are sending messages too fast. Please wait a moment.",
        time: new Date().toISOString()
    });
}

// Built-in Bot & Slash Command Responder
function handleBotAndCommands(text, senderName) {
    const lower = text.toLowerCase();
    let botReply = null;

    if (lower === "/help") {
        botReply = "Commands: `/roll` (dice), `/flip` (coin), `/users` (online count), `/shrug`, or mention `@bot`!";
    } else if (lower === "/flip") {
        botReply = `🪙 ${senderName} flipped a coin and got **${Math.random() < 0.5 ? "Heads" : "Tails"}**!`;
    } else if (lower === "/roll") {
        botReply = `🎲 ${senderName} rolled a **${Math.floor(Math.random() * 6) + 1}** (1-6)!`;
    } else if (lower === "/users") {
        botReply = `👥 Currently online (${users.size}): ${[...users.values()].map(u => u.name).join(", ")}`;
    } else if (lower.startsWith("@bot")) {
        const query = text.slice(4).trim().toLowerCase();
        if (!query || query.includes("hi") || query.includes("hello")) {
            botReply = `Hey ${senderName}! 👋 I'm ChatBot. Type \`/help\` to see what I can do.`;
        } else if (query.includes("time")) {
            botReply = `🕒 Current server time is ${new Date().toLocaleTimeString()}.`;
        } else if (query.includes("joke")) {
            botReply = `Why do programmers prefer dark mode? Because light attracts bugs! 🐛`;
        } else {
            botReply = `🤖 I heard you say: "${text.slice(4).trim()}". Try \`/help\`, \`/roll\`, or \`/flip\`!`;
        }
    }

    if (botReply) {
        setTimeout(() => {
            const botMsg = {
                id: `bot-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
                type: "user",
                senderId: "chatconnect-bot",
                sender: "🤖 ChatBot",
                text: botReply,
                replyTo: null,
                reactions: {},
                edited: false,
                time: new Date().toISOString()
            };
            pushToHistory(botMsg);
            logPublic(botMsg);
            io.emit("chat:message", botMsg);
        }, 350);
    }
}

io.on("connection", (socket) => {

    console.log(`[CONNECT] Socket connected: ${socket.id}`);
    console.log(`[CONNECT] IP: ${socket.handshake.address}`);

    // Current users (for the sidebar). Chat history is sent only after joining.
    socket.emit("users:update", publicUsers());

    // User joins
    socket.on("user:join", (rawName) => {

        if (users.has(socket.id)) return;

        let name = cleanName(rawName);

        // Prevent duplicate display names
        const takenNames = new Set([...users.values()].map(u => u.name.toLowerCase()));
        if (takenNames.has(name.toLowerCase())) {
            name = `${name.slice(0, 14)}_${Math.floor(10 + Math.random() * 90)}`;
        }

        users.set(socket.id, {
            id: socket.id,
            name,
            status: "online",
            joinedAt: Date.now()
        });

        socket.data.name = name;

        console.log("----------------------------------");
        console.log(`[JOIN] ${name} joined the chat`);
        console.log(`[ONLINE] Total users: ${users.size}`);
        console.log("----------------------------------");

        io.emit("users:update", publicUsers());

        // Give the new user the current conversation (empty if they're first in)
        socket.emit("chat:history", history);

        addSystemMessage(`${name} joined the chat`);
    });

    // Receive and broadcast messages
    socket.on("chat:message", (payload) => {

        if (!users.has(socket.id)) return;

        if (isRateLimited(socket.id)) {
            sendRateLimitWarning(socket);
            return;
        }

        const rawText = typeof payload === "object" && payload !== null ? payload.text : payload;
        const replyToId = typeof payload === "object" && payload !== null ? payload.replyToId : null;

        let text = String(rawText || "").trim().slice(0, 2000);
        if (!text) return;

        if (text.toLowerCase() === "/shrug") {
            text = "¯\\_(ツ)_/¯";
        }

        let replyTo = null;
        if (replyToId) {
            const parent = history.find((m) => m.id === replyToId);
            if (parent) {
                replyTo = {
                    id: parent.id,
                    sender: parent.sender || "System",
                    text: parent.text.slice(0, 100)
                };
            }
        }

        const senderName = users.get(socket.id).name;

        const message = {
            id: `${socket.id}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
            type: "user",
            senderId: socket.id,
            sender: senderName,
            text,
            replyTo,
            reactions: {},
            edited: false,
            time: new Date().toISOString()
        };

        pushToHistory(message);

        logPublic(message);

        // Broadcast to all connected users
        io.emit("chat:message", message);

        handleBotAndCommands(text, senderName);
    });

    // Emoji reactions on messages
    socket.on("message:react", ({ messageId, emoji } = {}) => {
        if (!users.has(socket.id)) return;

        const allowed = ["❤️", "😂", "👍", "🔥", "😮", "👏"];
        if (!allowed.includes(emoji)) return;

        // reactions only on real chat messages (not system messages)
        const message = history.find((m) => m.id === messageId);
        if (!message || message.type !== "user") return;

        if (!message.reactions) message.reactions = {};

        if (!message.reactions[emoji]) {
            message.reactions[emoji] = [];
        }

        const reactors = message.reactions[emoji];
        const index = reactors.indexOf(socket.id);

        if (index >= 0) {
            reactors.splice(index, 1);
        } else {
            reactors.push(socket.id);
        }

        if (reactors.length === 0) {
            delete message.reactions[emoji];
        }

        console.log(`[${stamp()}] [REACT]   ${users.get(socket.id).name} ${index >= 0 ? "removed" : "added"} ${emoji} on ${message.sender}: ${message.text.slice(0, 40)}`);

        saveHistory();

        io.emit("message:reaction", {
            messageId,
            reactions: message.reactions
        });
    });

    // Edit own message
    socket.on("message:edit", ({ messageId, newText } = {}) => {
        if (!users.has(socket.id)) return;

        const cleanText = String(newText || "").trim().slice(0, 2000);
        if (!cleanText) return;

        const message = history.find((m) => m.id === messageId);
        if (!message || message.senderId !== socket.id) return;

        console.log(`[${stamp()}] [EDIT]    ${message.sender}: "${message.text}" -> "${cleanText}"`);

        message.text = cleanText;
        message.edited = true;
        message.editedAt = new Date().toISOString();

        saveHistory();

        io.emit("message:updated", {
            messageId: message.id,
            text: message.text,
            edited: true,
            editedAt: message.editedAt
        });
    });

    // Delete / unsend own message
    socket.on("message:delete", (messageId) => {
        if (!users.has(socket.id)) return;

        const index = history.findIndex((m) => m.id === messageId && m.senderId === socket.id);
        if (index === -1) return;

        const removed = history[index];
        console.log(`[${stamp()}] [DELETE]  ${removed.sender}: ${removed.text}`);

        history.splice(index, 1);
        saveHistory();

        io.emit("message:deleted", { messageId });
    });

    // Direct Private Message (Whisper) - delivered only to sender + target, never stored
    socket.on("message:private", ({ targetId, text } = {}) => {
        if (!users.has(socket.id) || !users.has(targetId)) return;
        if (targetId === socket.id) return; // can't whisper to yourself

        if (isRateLimited(socket.id)) {
            sendRateLimitWarning(socket);
            return;
        }

        const cleanText = String(text || "").trim().slice(0, 2000);
        if (!cleanText) return;

        const dm = {
            id: `dm-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
            type: "private",
            senderId: socket.id,
            sender: users.get(socket.id).name,
            targetId,
            targetName: users.get(targetId).name,
            text: cleanText,
            time: new Date().toISOString()
        };

        logPrivate(dm);

        socket.to(targetId).emit("message:private", dm);
        socket.emit("message:private", dm);
    });

    // User status toggle (online | away | busy)
    socket.on("user:status", (status) => {
        if (!users.has(socket.id)) return;
        const allowedStatus = ["online", "away", "busy"];
        if (!allowedStatus.includes(status)) return;

        users.get(socket.id).status = status;
        io.emit("users:update", publicUsers());
    });

    // Typing indicator
    socket.on("typing:update", (isTyping) => {
        if (!users.has(socket.id)) return;

        socket.broadcast.emit("typing:update", {
            id: socket.id,
            name: users.get(socket.id).name,
            isTyping: Boolean(isTyping)
        });
    });

    // User disconnects
    socket.on("disconnect", (reason) => {
        const user = users.get(socket.id);
        rateLimits.delete(socket.id);

        if (user) {
            users.delete(socket.id);

            console.log("----------------------------------");
            console.log(`[LEAVE] ${user.name} left the chat`);
            console.log(`[REASON] ${reason}`);
            console.log(`[ONLINE] Total users: ${users.size}`);
            console.log("----------------------------------");

            io.emit("users:update", publicUsers());

            // make sure nobody is left seeing "X is typing…" for a user who left
            socket.broadcast.emit("typing:update", {
                id: socket.id,
                name: user.name,
                isTyping: false
            });

            if (users.size === 0) {
                // Room is empty -> next person starts with a clean chat
                history.length = 0;
                console.log("[CLEAN] Room empty, chat history cleared");
            } else {
                addSystemMessage(`${user.name} left the chat`);
            }
        } else {
            console.log(`[DISCONNECT] ${socket.id} (${reason})`);
        }
    });
});

// Backend health check
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "ChatConnect",
        online: users.size,
        messages: history.length,
        uptimeSeconds: Math.floor(process.uptime())
    });
});

// Serve React production build
const distPath = path.join(__dirname, "dist");

if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));

    app.get(/.*/, (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
    });
}

// Start server
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("======================================");
    console.log("       CHATCONNECT BACKEND");
    console.log("======================================");
    console.log(`Server running on port: ${PORT}`);
    console.log("Listening on: 0.0.0.0");
    console.log(`Live message monitoring: ENABLED (private content: ${LOG_PRIVATE ? "SHOWN" : "HIDDEN"})`);
    console.log("History: in-memory, cleared when room is empty");
    console.log("======================================");
    console.log("");
});