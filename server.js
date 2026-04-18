const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

/* ===========================
   SERVER
=========================== */
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Snakio websocket server running");
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

/* ===========================
   DATA
=========================== */
const clients = new Map(); // ws -> {id, room}
const rooms = {};         // code -> room

function id() {
  return crypto.randomBytes(4).toString("hex");
}

function roomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function createSnake() {
  const x = rand(150, 850);
  const y = rand(150, 550);

  const body = [];
  for (let i = 0; i < 25; i++) {
    body.push({ x, y });
  }

  return {
    body,
    dir: { x: 1, y: 0 },
    score: 0,
    color: "#ffffff"
  };
}

/* ===========================
   ROOM HELPERS
=========================== */
function publicRooms() {
  return Object.values(rooms)
    .filter(r => !r.private)
    .map(r => ({
      code: r.code,
      name: r.name,
      players: Object.keys(r.players).length,
      max: r.max
    }));
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoom(room, data) {
  for (const pid in room.players) {
    send(room.players[pid].ws, data);
  }
}

function removePlayer(ws) {
  const info = clients.get(ws);
  if (!info) return;

  if (info.room && rooms[info.room]) {
    const room = rooms[info.room];
    delete room.players[info.id];

    if (Object.keys(room.players).length === 0) {
      delete rooms[info.room];
    }
  }

  clients.delete(ws);
}

/* ===========================
   ROOM CREATE
=========================== */
function createRoom(name, max, isPrivate) {
  let code = roomCode();

  while (rooms[code]) code = roomCode();

  rooms[code] = {
    code,
    name: name || "Room",
    max: max || 8,
    private: isPrivate || false,
    apples: [],
    players: {}
  };

  for (let i = 0; i < 30; i++) {
    rooms[code].apples.push({
      x: rand(40, 1160),
      y: rand(40, 760)
    });
  }

  return rooms[code];
}

/* ===========================
   GAME LOGIC
=========================== */
function resetPlayer(p) {
  const fresh = createSnake();
  p.body = fresh.body;
  p.dir = fresh.dir;
  p.score = 0;
}

function updateRoom(room) {
  for (const pid in room.players) {
    const p = room.players[pid];
    const head = p.body[0];

    const nx = head.x + p.dir.x * 3;
    const ny = head.y + p.dir.y * 3;

    p.body.unshift({ x: nx, y: ny });

    let grew = false;

    /* apple eat */
    for (let i = 0; i < room.apples.length; i++) {
      const a = room.apples[i];
      const dx = nx - a.x;
      const dy = ny - a.y;

      if (Math.sqrt(dx * dx + dy * dy) < 18) {
        room.apples[i] = {
          x: rand(40, 1160),
          y: rand(40, 760)
        };
        p.score++;
        grew = true;
        break;
      }
    }

    if (!grew) p.body.pop();
  }

  /* collisions */
  for (const pid in room.players) {
    const p = room.players[pid];
    const head = p.body[0];

    /* wall wrap */
    if (head.x < 0) head.x = 1200;
    if (head.x > 1200) head.x = 0;
    if (head.y < 0) head.y = 800;
    if (head.y > 800) head.y = 0;

    /* self collision */
    for (let i = 8; i < p.body.length; i++) {
      const s = p.body[i];
      if (Math.hypot(head.x - s.x, head.y - s.y) < 10) {
        resetPlayer(p);
        break;
      }
    }

    /* other players */
    for (const oid in room.players) {
      if (oid === pid) continue;

      const other = room.players[oid];

      for (let i = 0; i < other.body.length; i++) {
        const s = other.body[i];
        if (Math.hypot(head.x - s.x, head.y - s.y) < 10) {
          resetPlayer(p);
          break;
        }
      }
    }
  }

  /* send state */
  const packet = {
    type: "state",
    apples: room.apples,
    players: {}
  };

  for (const pid in room.players) {
    packet.players[pid] = {
      body: room.players[pid].body,
      score: room.players[pid].score
    };
  }

  broadcastRoom(room, packet);
}

/* ===========================
   LOOP
=========================== */
setInterval(() => {
  for (const code in rooms) {
    updateRoom(rooms[code]);
  }
}, 1000 / 60);

/* ===========================
   SOCKETS
=========================== */
wss.on("connection", ws => {
  const uid = id();

  clients.set(ws, {
    id: uid,
    room: null
  });

  send(ws, {
    type: "welcome",
    id: uid
  });

  ws.on("message", msg => {
    let data;

    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    const info = clients.get(ws);
    if (!info) return;

    /* room list */
    if (data.type === "getRooms") {
      send(ws, {
        type: "rooms",
        rooms: publicRooms()
      });
    }

    /* create room */
    if (data.type === "createRoom") {
      const room = createRoom(
        data.name,
        Number(data.max || 8),
        !!data.private
      );

      room.players[info.id] = {
        ws,
        ...createSnake()
      };

      info.room = room.code;

      send(ws, {
        type: "roomCreated",
        code: room.code
      });
    }

    /* join room */
    if (data.type === "joinRoom") {
      const room = rooms[data.code];
      if (!room) return;

      if (Object.keys(room.players).length >= room.max) return;

      room.players[info.id] = {
        ws,
        ...createSnake()
      };

      info.room = room.code;

      send(ws, {
        type: "joined",
        room: room.code
      });
    }

    /* movement */
    if (data.type === "input") {
      const room = rooms[info.room];
      if (!room) return;

      const p = room.players[info.id];
      if (!p) return;

      p.dir = data.dir;
    }
  });

  ws.on("close", () => {
    removePlayer(ws);
  });
});

/* ===========================
   START
=========================== */
server.listen(PORT, () => {
  console.log("Snakio server running on port " + PORT);
});
