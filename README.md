# Duck Pong

A real-time multiplayer browser game where players select custom ducks and compete in a fast-paced pong-style arena. Each duck’s stats directly impact gameplay, including movement, stamina, hit strength, and shield size.

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

---

### 2. Run the server (development)

```bash
npm run dev
```

---

### 3. Open the app

Go to:

```
http://localhost:3000
```

Open **two tabs** to simulate multiplayer.

---

## File Structure & Responsibilities

### Server

#### `server.js`

Main backend game server.

Handles:

- Express static hosting
- Socket.io connections
- Room creation / joining
- Game loop (30 ticks/sec)
- Physics (ball movement, collisions)
- Scoring + match flow
- Duck stat processing

Key areas:

- `buildDuckStats()` → converts duck data into gameplay stats
- `updateRoom()` → runs game simulation
- `updateBall()` → ball physics + scoring
- `socket.on(...)` → all multiplayer events

---

### Client

#### `public/index.html`

- Main UI layout
- Lobby controls (create/join room, select duck, ready up)
- Game container

---

#### `public/js/lobby.js`

Handles:

- UI updates
- Socket communication
- Duck selection + ready system
- Sending player input (movement + serve)
- Updating score, stamina bars, messages

If something looks wrong in UI → start here.

---

#### `public/js/game.js`

- Thin bridge between lobby and rendering
- Syncs server state to the scene
- Avoids reloading models unnecessarily

---

#### `public/js/scene.js`

Handles:

- Three.js rendering
- Camera positioning (player-relative)
- Duck model loading (OBJ/MTL)
- Applying duck colors
- Shield rendering + scaling
- Ball rendering

If something looks wrong visually → this is the file.

---

#### `public/models/`

- `duck.obj` / `duck.mtl`
- Base 3D model used for all ducks

---

## How Duck Stats Work

Duck data comes from:

```text
https://api.ducks.ects-cmp.com/ducks
```

Each duck includes:

```js
duck.stats = {
    focus,
    strength,
    health,
    kindness,
    intelligence,
};
```

---

### Stat Conversion (IMPORTANT)

All gameplay stats are derived here:

```js
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
```

---

## What Each Stat Does

| Stat             | Affects                     |
| ---------------- | --------------------------- |
| **Focus**        | Shield size (hitbox radius) |
| **Strength**     | Ball hit speed              |
| **Health**       | Stamina drain + recovery    |
| **Kindness**     | Movement speed              |
| **Intelligence** | Total stamina capacity      |

---

## Shield System

- Each player has a **circular shield** in front of their duck
- This is the **only collision hitbox**
- Size is determined by:

```js
shieldRadius = 0.6 + focus * 0.15;
```

- Higher focus → larger shield → easier returns

---

## Game Flow

1. Player creates or joins a room
2. Each player selects a duck
3. Both players ready up
4. Match starts
5. After each point:
    - Game pauses
    - Ball resets toward last scorer
    - Losing player presses **Space** to serve

6. First to 5 points wins

---

## Multiplayer Events

Key socket events:

- `createRoom`
- `joinRoom`
- `selectDuck`
- `readyUp`
- `playerInput`
- `serveBall`
- `restartGame`

---

## Game Loop

Runs at:

```js
30 FPS (setInterval)
```

Handles:

- Player movement
- Ball physics
- Collision detection
- Scoring

---

## How to Modify / Extend

### Change gameplay feel

Edit:

```js
buildDuckStats();
```

---

### Change hitbox behavior

Edit:

```js
ballHitsPlayer();
```

---

### Change visuals

Edit:

```js
scene.js;
```

---

### Change UI / controls

Edit:

```js
lobby.js;
```

---

### Notes

- Server controls physics
- Client is visual only

Always update server first.

---

## Future Ideas

- Power-ups (temporary stat boosts)
- AI opponent
- Tournament brackets
- Duck leveling system
- Visual stat bars in UI
- Shield glow based on stamina

---

## Testing Tips

- Open two tabs for multiplayer
- Use different ducks to compare stats
- Try extreme values (focus 1 vs 10)

---
