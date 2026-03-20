import { DuckTennisGameClient } from "./game.js";

const socket = io();

const roomInput = document.getElementById("roomInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomStatus = document.getElementById("roomStatus");

const duckSelect = document.getElementById("duckSelect");
const selectDuckBtn = document.getElementById("selectDuckBtn");
const readyBtn = document.getElementById("readyBtn");
const selectionStatus = document.getElementById("selectionStatus");

const p1Name = document.getElementById("p1Name");
const p2Name = document.getElementById("p2Name");
const scoreDisplay = document.getElementById("scoreDisplay");
const messageBox = document.getElementById("messageBox");

const p1StaminaBar = document.getElementById("p1StaminaBar");
const p2StaminaBar = document.getElementById("p2StaminaBar");
const p1StaminaText = document.getElementById("p1StaminaText");
const p2StaminaText = document.getElementById("p2StaminaText");
const restartBtn = document.getElementById("restartBtn");

const gameContainer = document.getElementById("gameContainer");
let gameClient = null;

let ducks = [];
let currentRoomId = null;
let mySide = null;
let currentState = null;
let currentMoveDir = 0;

let gameClientSide = null;

function ensureGameClient() {
    if (!mySide) return;

    if (gameClient && gameClientSide === mySide) return;

    gameContainer.innerHTML = "";
    gameClient = new DuckTennisGameClient(gameContainer, mySide);
    gameClientSide = mySide;

    if (currentState) {
        gameClient.syncRoomState(currentState);
    }
}
function setMessage(text) {
    messageBox.textContent = text;
}

function normalizePercent(current, max) {
    if (!max) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
}

function updateUI(state) {
    currentState = state;

    const leftName = state.players.p1.duck?.name || "Player 1";
    const rightName = state.players.p2.duck?.name || "Player 2";

    p1Name.textContent = leftName;
    p2Name.textContent = rightName;
    scoreDisplay.textContent = `${state.players.p1.score} - ${state.players.p2.score}`;

    const p1Current = Math.round(state.players.p1.stamina);
    const p1Max = Math.round(state.players.p1.staminaMax);
    const p2Current = Math.round(state.players.p2.stamina);
    const p2Max = Math.round(state.players.p2.staminaMax);

    p1StaminaText.textContent = `${p1Current} / ${p1Max}`;
    p2StaminaText.textContent = `${p2Current} / ${p2Max}`;
    p1StaminaBar.style.width = `${normalizePercent(p1Current, p1Max)}%`;
    p2StaminaBar.style.width = `${normalizePercent(p2Current, p2Max)}%`;

    let statusText = `Room: ${state.roomId} | Phase: ${state.phase}`;
    if (mySide) statusText += ` | You are ${mySide.toUpperCase()}`;
    roomStatus.textContent = statusText;

    const readyP1 = state.players.p1.ready ? "ready" : "not ready";
    const readyP2 = state.players.p2.ready ? "ready" : "not ready";

    selectionStatus.textContent = `P1 is ${readyP1}. P2 is ${readyP2}.`;

    if (state.phase === "gameover") {
        const winnerDuck =
            state.winner === "p1"
                ? state.players.p1.duck?.name || "Player 1"
                : state.players.p2.duck?.name || "Player 2";
        setMessage(`${winnerDuck} wins the match!`);
    } else if (state.phase === "waiting_serve") {
        const serverName =
            state.serveWaitingFor === "p1"
                ? state.players.p1.duck?.name || "Player 1"
                : state.players.p2.duck?.name || "Player 2";

        setMessage(`${serverName}: press Space to serve.`);
    } else if (state.lastEventMessage) {
        setMessage(state.lastEventMessage);
    }
    if (gameClient) {
        gameClient.syncRoomState(state);
    }
}

async function loadDucks() {
    duckSelect.innerHTML = `<option value="">Loading ducks...</option>`;

    const resp = await fetch("https://api.ducks.ects-cmp.com/ducks");
    ducks = await resp.json();

    duckSelect.innerHTML = `<option value="">Choose a duck</option>`;
    for (const duck of ducks) {
        const option = document.createElement("option");
        option.value = duck._id;
        option.textContent = `${duck.name} (#${duck._id})`;
        duckSelect.appendChild(option);
    }
}

function getSelectedDuckId() {
    return duckSelect.value;
}

function requireRoom() {
    if (!currentRoomId) {
        setMessage("Create or join a room first.");
        return false;
    }
    return true;
}

createRoomBtn.addEventListener("click", () => {
    const roomId = (roomInput.value || "ROOM1").trim().toUpperCase();

    socket.emit("createRoom", { roomId }, (resp) => {
        if (!resp?.ok) {
            setMessage(resp?.message || "Could not create room.");
            return;
        }

        currentRoomId = resp.roomId;
        mySide = resp.side;
        ensureGameClient();
        setMessage(`Created room ${currentRoomId}. Waiting for second player.`);
    });
});

joinRoomBtn.addEventListener("click", () => {
    const roomId = (roomInput.value || "").trim().toUpperCase();
    if (!roomId) {
        setMessage("Enter a room id.");
        return;
    }

    socket.emit("joinRoom", { roomId }, (resp) => {
        if (!resp?.ok) {
            setMessage(resp?.message || "Could not join room.");
            return;
        }

        currentRoomId = resp.roomId;
        mySide = resp.side;
        ensureGameClient();
        setMessage(`Joined room ${currentRoomId}. Select a duck and ready up.`);
    });
});

selectDuckBtn.addEventListener("click", () => {
    if (!requireRoom()) return;

    const duckId = getSelectedDuckId();
    if (!duckId) {
        setMessage("Choose a duck first.");
        return;
    }

    socket.emit("selectDuck", { roomId: currentRoomId, duckId }, (resp) => {
        if (!resp?.ok) {
            setMessage(resp?.message || "Failed to select duck.");
            return;
        }

        const duck = ducks.find((d) => String(d._id) === String(duckId));
        setMessage(`Selected ${duck?.name || "duck"}.`);
    });
});

readyBtn.addEventListener("click", () => {
    if (!requireRoom()) return;

    socket.emit("readyUp", { roomId: currentRoomId }, (resp) => {
        if (!resp?.ok) {
            setMessage(resp?.message || "Could not ready up.");
            return;
        }
    });
});

restartBtn.addEventListener("click", () => {
    if (!requireRoom()) return;

    socket.emit("restartGame", { roomId: currentRoomId }, (resp) => {
        if (!resp?.ok) {
            setMessage(resp?.message || "Could not reset game.");
        }
    });
});

socket.on("roomState", (state) => {
    currentRoomId = state.roomId;
    updateUI(state);
});

socket.on("gameState", (state) => {
    updateUI(state);
});

socket.on("gameEvent", (evt) => {
    if (evt?.message) {
        setMessage(evt.message);
    }
});

socket.on("message", (payload) => {
    setMessage(payload?.text || "Server message received.");
});

function sendMove(dir) {
    if (!currentRoomId || !currentState || currentState.phase !== "playing") {
        return;
    }

    let adjustedDir = dir;

    // p1 camera is behind the duck on the negative-z side,
    // so world x feels mirrored on screen unless flipped
    if (mySide === "p1") {
        adjustedDir *= -1;
    }

    if (adjustedDir === currentMoveDir) return;

    currentMoveDir = adjustedDir;

    socket.emit("playerInput", {
        roomId: currentRoomId,
        moveDir: adjustedDir,
    });
}
window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (e.code === "Space") {
        if (
            currentRoomId &&
            currentState &&
            currentState.phase === "waiting_serve" &&
            currentState.serveWaitingFor === mySide
        ) {
            e.preventDefault();

            socket.emit("serveBall", { roomId: currentRoomId }, (resp) => {
                if (!resp?.ok) {
                    setMessage(resp?.message || "Could not serve.");
                }
            });
        }
        return;
    }

    if (key === "a" || e.key === "ArrowLeft") {
        sendMove(-1);
    }

    if (key === "d" || e.key === "ArrowRight") {
        sendMove(1);
    }
});

window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();

    if (
        key === "a" ||
        key === "d" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
    ) {
        sendMove(0);
    }
});

await loadDucks();
setMessage("Load complete. Create or join a room.");
