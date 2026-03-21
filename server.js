import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/api/ducks", async (req, res) => {
    try {
        const response = await fetch("https://api.ducks.ects-cmp.com/ducks");
        const ducks = await response.json();
        res.json(ducks);
    } catch (err) {
        console.error("Failed to load ducks:", err);
        res.status(500).json({ error: "Failed to load ducks" });
    }
});

const rooms = new Map();

const COURT = {
    width: 20,
    height: 8,
    depth: 40,
    playerZ1: -18,
    playerZ2: 18,
    playerXLimit: 8.5,
};

const BALL_RADIUS = 0.45;
const WIN_SCORE = 5;
const TICK_RATE = 1000 / 60; //1000 / 30;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function makePlayer(name, side, z) {
    return {
        id: null,
        name,
        side,
        ready: false,
        duckId: null,
        duck: null,
        x: 0,
        z,
        moveDir: 0,
        score: 0,
        statusMessage: "",
        chaseTimer: 0,
        stats: {
            speed: 6,
            hitSpeed: 10,
            staminaMax: 100,
            stamina: 100,
            tireRate: 8,
            recoverRate: 10,
            kindness: 5,
        },
    };
}

function makeBall() {
    return {
        x: 0,
        y: 2,
        z: 0,
        vx: rand(-3, 3),
        vy: 0, //keep it parallel //rand(-1, 1),
        vz: Math.random() < 0.5 ? 8 : -8,
        radius: BALL_RADIUS,
        lastHitBy: null,
    };
}

function createRoom(roomId) {
    return {
        roomId,
        phase: "lobby", // lobby | waiting_serve | playing | gameover
        winner: null,
        lastTick: Date.now(),
        lastEventMessage: "",
        serveWaitingFor: null, // "p1" or "p2"
        serveToward: null, // "p1" or "p2"
        lastScorer: null, // "p1" or "p2"
        players: {
            p1: makePlayer("Player 1", "p1", COURT.playerZ1),
            p2: makePlayer("Player 2", "p2", COURT.playerZ2),
        },
        ball: makeBall(),
    };
}

function getPlayerBySocket(room, socketId) {
    if (room.players.p1.id === socketId) return room.players.p1;
    if (room.players.p2.id === socketId) return room.players.p2;
    return null;
}

function getPlayerKeyBySocket(room, socketId) {
    if (room.players.p1.id === socketId) return "p1";
    if (room.players.p2.id === socketId) return "p2";
    return null;
}

function getOpponent(room, player) {
    return player.side === "p1" ? room.players.p2 : room.players.p1;
}

function buildDuckStats(duck) {
    const attrs = duck?.stats ?? {};

    const focus = Number(attrs.focus ?? 5);
    const strength = Number(attrs.strength ?? 5);
    const health = Number(attrs.health ?? 5);
    const kindness = Number(attrs.kindness ?? 5);
    const intelligence = Number(attrs.intelligence ?? 5);

    return {
        speed: 4 + kindness * 0.45,
        hitSpeed: 7 + strength * 0.7,
        staminaMax: intelligence * 20,
        stamina: intelligence * 20,
        tireRate: Math.max(3.5, 13 - health),
        recoverRate: 5 + health * 0.6,
        kindness,
        shieldRadius: 0.6 + focus * 0.15,
    };
}

function getEffectiveSpeed(player) {
    const ratio = player.stats.stamina / player.stats.staminaMax;

    if (ratio > 0.5) return player.stats.speed;
    if (ratio > 0.2) return player.stats.speed * 0.8;
    return player.stats.speed * 0.6;
}

function resetPlayersForPoint(room) {
    room.players.p1.x = 0;
    room.players.p2.x = 0;
    room.players.p1.moveDir = 0;
    room.players.p2.moveDir = 0;
    room.players.p1.chaseTimer = 0;
    room.players.p2.chaseTimer = 0;
}

function resetBall(room, towardSide = "p1") {
    room.ball.x = 0;
    room.ball.y = 2;
    room.ball.z = 0;
    room.ball.vx = rand(-3, 3);
    room.ball.vy = 0; // if you made the ball stay parallel
    room.ball.vz = towardSide === "p1" ? -8 : 8;
    room.ball.lastHitBy = null;
}
function startMatch(room) {
    room.phase = "waiting_serve";
    room.winner = null;
    room.lastScorer = Math.random() < 0.5 ? "p1" : "p2";

    // losing side on opening serve doesn't really exist,
    // so let the opposite player press space to start
    room.serveToward = room.lastScorer;
    room.serveWaitingFor = room.lastScorer === "p1" ? "p2" : "p1";

    room.lastEventMessage = `${
        room.serveWaitingFor === "p1" ? "Player 1" : "Player 2"
    } press Space to serve.`;

    room.players.p1.score = 0;
    room.players.p2.score = 0;
    room.players.p1.stats.stamina = room.players.p1.stats.staminaMax;
    room.players.p2.stats.stamina = room.players.p2.stats.staminaMax;

    resetPlayersForPoint(room);
    resetBall(room, room.serveToward);
}

function ballHitsPlayer(ball, player) {
    const shieldRadius = player.stats.shieldRadius;
    const shieldOffsetZ = player.side === "p1" ? 1.2 : -1.2;
    const shieldCenterY = 1.8;

    const shieldX = player.x;
    const shieldY = shieldCenterY;
    const shieldZ = player.z + shieldOffsetZ;

    const dx = ball.x - shieldX;
    const dy = ball.y - shieldY;
    const dz = ball.z - shieldZ;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return distance <= shieldRadius + ball.radius;
}

function reflectBall(ball, player) {
    const shieldOffsetZ = player.side === "p1" ? 1.2 : -1.2;
    const shieldCenterY = 1.8;

    const shieldX = player.x;
    const shieldY = shieldCenterY;
    const shieldZ = player.z + shieldOffsetZ;

    const dx = ball.x - shieldX;
    const dy = ball.y - shieldY;
    const dz = ball.z - shieldZ;

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    const nx = dx / len;
    const nz = dz / len;

    const speed = player.stats.hitSpeed;
    const forwardZ = player.side === "p1" ? 1 : -1;

    ball.vx = clamp(nx * speed * 0.9, -12, 12);
    ball.vz = Math.abs(speed * Math.max(0.65, Math.abs(nz))) * forwardZ;

    // Keep the ball parallel to the field
    ball.y = 2;
    ball.vy = 0;

    ball.lastHitBy = player.side;
}

function maybeTriggerUnkindChase(room, loser, scorer) {
    if (loser.stats.kindness >= 3) return null;
    if (Math.random() > 0.3) return null;

    // Victim gets a bonus point.
    scorer.score += 1;
    loser.chaseTimer = 1.5;

    const message = `${loser.duck?.name ?? loser.name} got mad and chased the opponent. Penalty point awarded!`;
    room.lastEventMessage = message;

    return {
        type: "penalty",
        offender: loser.side,
        victim: scorer.side,
        message,
    };
}

function scorePoint(room, scorerSide) {
    const scorer = room.players[scorerSide];
    const loser = scorerSide === "p1" ? room.players.p2 : room.players.p1;
    const loserSide = scorerSide === "p1" ? "p2" : "p1";

    scorer.score += 1;
    room.lastScorer = scorerSide;
    room.lastEventMessage = `${scorer.duck?.name ?? scorer.name} scored!`;

    const events = [
        {
            type: "point",
            scorer: scorer.side,
            p1: room.players.p1.score,
            p2: room.players.p2.score,
            message: room.lastEventMessage,
        },
    ];

    const penaltyEvent = maybeTriggerUnkindChase(room, loser, scorer);
    if (penaltyEvent) events.push(penaltyEvent);

    if (
        room.players.p1.score >= WIN_SCORE ||
        room.players.p2.score >= WIN_SCORE
    ) {
        room.phase = "gameover";
        room.winner = room.players.p1.score >= WIN_SCORE ? "p1" : "p2";
        room.lastEventMessage = `${
            room.winner === "p1"
                ? (room.players.p1.duck?.name ?? "Player 1")
                : (room.players.p2.duck?.name ?? "Player 2")
        } wins!`;
        return events;
    }

    // Pause after score
    room.phase = "waiting_serve";
    room.serveToward = scorerSide; // send the ball toward the player who scored
    room.serveWaitingFor = loserSide; // loser must press space to resume

    resetPlayersForPoint(room);
    resetBall(room, room.serveToward);

    room.lastEventMessage = `${
        loser.duck?.name ?? loser.name
    } press Space to serve.`;

    events.push({
        type: "waiting_serve",
        serveWaitingFor: room.serveWaitingFor,
        serveToward: room.serveToward,
        message: room.lastEventMessage,
    });

    return events;
}

function updatePlayer(player, dt) {
    if (!player.id) return;

    if (player.chaseTimer > 0) {
        player.chaseTimer = Math.max(0, player.chaseTimer - dt);
    }

    const speed = getEffectiveSpeed(player);
    player.x += player.moveDir * speed * dt;
    player.x = clamp(player.x, -COURT.playerXLimit, COURT.playerXLimit);

    if (player.moveDir !== 0) {
        player.stats.stamina = Math.max(
            0,
            player.stats.stamina - player.stats.tireRate * dt,
        );
    } else {
        player.stats.stamina = Math.min(
            player.stats.staminaMax,
            player.stats.stamina + player.stats.recoverRate * dt,
        );
    }
}

function updateBall(room, dt) {
    const ball = room.ball;
    const events = [];

    ball.x += ball.vx * dt;
    //ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;

    if (ball.x - ball.radius <= -COURT.width / 2) {
        ball.x = -COURT.width / 2 + ball.radius;
        ball.vx *= -1;
    }

    if (ball.x + ball.radius >= COURT.width / 2) {
        ball.x = COURT.width / 2 - ball.radius;
        ball.vx *= -1;
    }
    ball.y = 2;
    // if (ball.y - ball.radius <= 0.4) {
    //     ball.y = 0.4 + ball.radius;
    //     ball.vy *= -1;
    // }

    // if (ball.y + ball.radius >= COURT.height) {
    //     ball.y = COURT.height - ball.radius;
    //     ball.vy *= -1;
    // }

    if (ball.vz < 0 && ballHitsPlayer(ball, room.players.p1)) {
        reflectBall(ball, room.players.p1);
        ball.z = room.players.p1.z + 2.2;
    }

    if (ball.vz > 0 && ballHitsPlayer(ball, room.players.p2)) {
        reflectBall(ball, room.players.p2);
        ball.z = room.players.p2.z - 2.2;
    }

    if (ball.z < -COURT.depth / 2) {
        events.push(...scorePoint(room, "p2"));
    } else if (ball.z > COURT.depth / 2) {
        events.push(...scorePoint(room, "p1"));
    }

    return events;
}

function updateRoom(room, dt) {
    updatePlayer(room.players.p1, dt);
    updatePlayer(room.players.p2, dt);

    if (room.phase !== "playing") return [];

    return updateBall(room, dt);
}

function publicRoomState(room) {
    return {
        roomId: room.roomId,
        phase: room.phase,
        winner: room.winner,
        lastEventMessage: room.lastEventMessage,
        serveWaitingFor: room.serveWaitingFor,
        serveToward: room.serveToward,
        lastScorer: room.lastScorer,
        players: {
            p1: {
                id: room.players.p1.id,
                name: room.players.p1.name,
                ready: room.players.p1.ready,
                duckId: room.players.p1.duckId,
                duck: room.players.p1.duck,
                x: room.players.p1.x,
                z: room.players.p1.z,
                score: room.players.p1.score,
                stamina: room.players.p1.stats.stamina,
                staminaMax: room.players.p1.stats.staminaMax,
                chaseTimer: room.players.p1.chaseTimer,
                shieldRadius: room.players.p1.stats.shieldRadius,
            },
            p2: {
                id: room.players.p2.id,
                name: room.players.p2.name,
                ready: room.players.p2.ready,
                duckId: room.players.p2.duckId,
                duck: room.players.p2.duck,
                x: room.players.p2.x,
                z: room.players.p2.z,
                score: room.players.p2.score,
                stamina: room.players.p2.stats.stamina,
                staminaMax: room.players.p2.stats.staminaMax,
                chaseTimer: room.players.p2.chaseTimer,
                shieldRadius: room.players.p2.stats.shieldRadius,
            },
        },
        ball: {
            x: room.ball.x,
            y: room.ball.y,
            z: room.ball.z,
            radius: room.ball.radius,
        },
    };
}
function findRoomBySocket(socketId) {
    for (const room of rooms.values()) {
        if (
            room.players.p1.id === socketId ||
            room.players.p2.id === socketId
        ) {
            return room;
        }
    }
    return null;
}
io.on("connection", (socket) => {
    socket.on("createRoom", ({ roomId }, callback) => {
        const existingRoom = findRoomBySocket(socket.id);
        if (existingRoom) {
            callback?.({
                ok: false,
                message: `You are already in room ${existingRoom.roomId}.`,
            });
            return;
        }
        if (!roomId || typeof roomId !== "string") {
            callback?.({ ok: false, message: "Invalid room id." });
            return;
        }

        const normalized = roomId.trim().toUpperCase();

        if (rooms.has(normalized)) {
            const existingRoom = rooms.get(normalized);

            if (
                existingRoom.players.p1.id === socket.id ||
                existingRoom.players.p2.id === socket.id
            ) {
                callback?.({
                    ok: false,
                    message: "You are already in this room.",
                });
                return;
            }

            callback?.({ ok: false, message: "Room already exists." });
            return;
        }

        const room = createRoom(normalized);
        room.players.p1.id = socket.id;
        rooms.set(normalized, room);

        socket.join(normalized);

        callback?.({ ok: true, roomId: normalized, side: "p1" });
        io.to(normalized).emit("roomState", publicRoomState(room));
    });
    socket.on("joinRoom", ({ roomId }, callback) => {
        const existingRoom = findRoomBySocket(socket.id);
        if (existingRoom) {
            callback?.({
                ok: false,
                message: `You are already in room ${existingRoom.roomId}.`,
            });
            return;
        }
        const normalized = String(roomId ?? "")
            .trim()
            .toUpperCase();
        const room = rooms.get(normalized);

        if (!room) {
            callback?.({ ok: false, message: "Room not found." });
            return;
        }

        // Prevent the same browser/socket from joining twice
        if (room.players.p1.id === socket.id) {
            callback?.({
                ok: false,
                message: "You already created or joined this room as Player 1.",
            });
            return;
        }

        if (room.players.p2.id === socket.id) {
            callback?.({
                ok: false,
                message: "You already joined this room as Player 2.",
            });
            return;
        }

        if (room.players.p2.id) {
            callback?.({ ok: false, message: "Room is full." });
            return;
        }

        room.players.p2.id = socket.id;
        socket.join(normalized);

        callback?.({ ok: true, roomId: normalized, side: "p2" });
        io.to(normalized).emit("roomState", publicRoomState(room));
    });

    socket.on("selectDuck", async ({ roomId, duckId }, callback) => {
        const room = rooms.get(
            String(roomId ?? "")
                .trim()
                .toUpperCase(),
        );

        if (!room) {
            callback?.({ ok: false, message: "Room not found." });
            return;
        }

        const player = getPlayerBySocket(room, socket.id);
        if (!player) {
            callback?.({ ok: false, message: "You are not in this room." });
            return;
        }

        try {
            const response = await fetch(
                "https://api.ducks.ects-cmp.com/ducks",
            );
            const ducks = await response.json();

            const duck = ducks.find((d) => String(d._id) === String(duckId));

            if (!duck) {
                callback?.({ ok: false, message: "Duck not found." });
                return;
            }

            player.duckId = duck._id;
            player.duck = duck;
            player.stats = buildDuckStats(duck);
            player.ready = false;
            io.to(room.roomId).emit("roomState", publicRoomState(room));
            callback?.({ ok: true, message: `${duck.name} selected.` });
        } catch (err) {
            console.error(err);
            callback?.({ ok: false, message: "Failed to load duck." });
        }
    });

    socket.on("readyUp", ({ roomId }, callback) => {
        const room = rooms.get(
            String(roomId ?? "")
                .trim()
                .toUpperCase(),
        );
        if (!room) {
            callback?.({ ok: false, message: "Room not found." });
            return;
        }

        const player = getPlayerBySocket(room, socket.id);
        if (!player) {
            callback?.({ ok: false, message: "You are not in this room." });
            return;
        }

        if (!player.duck) {
            callback?.({ ok: false, message: "Select a duck first." });
            return;
        }

        player.ready = true;

        const bothReady =
            room.players.p1.id &&
            room.players.p2.id &&
            room.players.p1.duck &&
            room.players.p2.duck &&
            room.players.p1.ready &&
            room.players.p2.ready;

        if (bothReady) {
            startMatch(room);
        }

        io.to(room.roomId).emit("roomState", publicRoomState(room));
        callback?.({ ok: true });
    });

    socket.on("playerInput", ({ roomId, moveDir }) => {
        const room = rooms.get(
            String(roomId ?? "")
                .trim()
                .toUpperCase(),
        );
        if (!room /*|| room.phase !== "playing"*/) return;

        const player = getPlayerBySocket(room, socket.id);
        if (!player) return;

        player.moveDir = clamp(Number(moveDir) || 0, -1, 1);
    });

    socket.on("restartGame", ({ roomId }, callback) => {
        const room = rooms.get(
            String(roomId ?? "")
                .trim()
                .toUpperCase(),
        );
        if (!room) {
            callback?.({ ok: false, message: "Room not found." });
            return;
        }

        const playerKey = getPlayerKeyBySocket(room, socket.id);
        if (!playerKey) {
            callback?.({ ok: false, message: "You are not in this room." });
            return;
        }

        room.phase = "lobby";
        room.winner = null;
        room.lastEventMessage = "Back in lobby. Select ducks and ready up.";
        room.players.p1.ready = false;
        room.players.p2.ready = false;
        room.players.p1.score = 0;
        room.players.p2.score = 0;
        room.players.p1.x = 0;
        room.players.p2.x = 0;
        room.players.p1.stats.stamina = room.players.p1.stats.staminaMax;
        room.players.p2.stats.stamina = room.players.p2.stats.staminaMax;
        resetBall(room);

        io.to(room.roomId).emit("roomState", publicRoomState(room));
        callback?.({ ok: true });
    });

    socket.on("disconnect", () => {
        for (const [roomId, room] of rooms.entries()) {
            if (
                room.players.p1.id === socket.id ||
                room.players.p2.id === socket.id
            ) {
                io.to(roomId).emit("message", {
                    text: "A player disconnected. Room closed.",
                });
                rooms.delete(roomId);
            }
        }
    });
    socket.on("serveBall", ({ roomId }, callback) => {
        const room = rooms.get(
            String(roomId ?? "")
                .trim()
                .toUpperCase(),
        );

        if (!room) {
            callback?.({ ok: false, message: "Room not found." });
            return;
        }

        if (room.phase !== "waiting_serve") {
            callback?.({
                ok: false,
                message: "Game is not waiting for serve.",
            });
            return;
        }

        const player = getPlayerBySocket(room, socket.id);
        if (!player) {
            callback?.({ ok: false, message: "You are not in this room." });
            return;
        }

        if (player.side !== room.serveWaitingFor) {
            callback?.({
                ok: false,
                message: "You are not the player who can serve.",
            });
            return;
        }

        room.phase = "playing";
        room.lastEventMessage = "Play!";

        io.to(room.roomId).emit("roomState", publicRoomState(room));
        callback?.({ ok: true });
    });
});

setInterval(() => {
    for (const room of rooms.values()) {
        //if (room.phase !== "playing") continue;

        const now = Date.now();
        const dt = Math.min((now - room.lastTick) / 1000, 0.05);
        room.lastTick = now;

        const events = updateRoom(room, dt);

        io.to(room.roomId).emit("gameState", publicRoomState(room));

        for (const evt of events) {
            io.to(room.roomId).emit("gameEvent", evt);
        }

        if (room.phase === "gameover") {
            io.to(room.roomId).emit("roomState", publicRoomState(room));
        }
    }
}, TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Duck Tennis running at http://localhost:${PORT}`);
});
