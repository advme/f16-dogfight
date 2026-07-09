/* F-35 Dogfight — multiplayer relay server
   Serves the game (index.html) and relays room-scoped WebSocket messages. */
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(__dirname, { index: 'index.html' }));

/* if index.html isn't deployed alongside the server (game hosted elsewhere),
   show a status page so the deploy is easy to verify */
app.get('/', (req, res) => {
  res.type('text/plain').send('F-35 Dogfight multiplayer server is running. Rooms open: ' + rooms.size);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* rooms: code -> { players: Map<id, ws>, hostId } */
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const [id, p] of room.players) {
    if (id !== exceptId && p.readyState === 1) p.send(s);
  }
}

function leaveRoom(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  room.players.delete(ws.id);
  ws.room = null;
  if (room.players.size === 0) {
    rooms.delete(ws.roomCode);
    for (const [code, r] of rooms) if (r === room) rooms.delete(code);
    return;
  }
  broadcast(room, { t: 'playerLeft', id: ws.id });
  if (room.hostId === ws.id) {
    room.hostId = room.players.keys().next().value;
    const newHost = room.players.get(room.hostId);
    if (newHost && newHost.readyState === 1) newHost.send(JSON.stringify({ t: 'host' }));
  }
}

wss.on('connection', ws => {
  ws.id = String(nextId++);
  ws.room = null;
  ws.name = 'PILOT';
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'create') {
      if (ws.room) return;
      const code = makeCode();
      ws.name = String(msg.name || 'PILOT').slice(0, 12);
      ws.room = code;
      rooms.set(code, { players: new Map([[ws.id, ws]]), hostId: ws.id });
      ws.send(JSON.stringify({ t: 'created', code, id: ws.id, host: true }));
      return;
    }

    if (msg.t === 'join') {
      if (ws.room) return;
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { ws.send(JSON.stringify({ t: 'error', msg: 'ROOM NOT FOUND' })); return; }
      ws.name = String(msg.name || 'PILOT').slice(0, 12);
      const others = [...room.players.values()].map(p => ({ id: p.id, name: p.name }));
      room.players.set(ws.id, ws);
      ws.room = code;
      ws.send(JSON.stringify({ t: 'joined', code, id: ws.id, host: false, players: others }));
      broadcast(room, { t: 'playerJoined', id: ws.id, name: ws.name }, ws.id);
      return;
    }

    /* everything else is relayed to the rest of the room, tagged with sender id */
    const room = rooms.get(ws.room);
    if (!room) return;
    msg.from = ws.id;
    broadcast(room, msg, ws.id);
  });

  ws.on('close', () => leaveRoom(ws));
});

/* heartbeat: drop dead connections so rooms free up */
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { leaveRoom(ws); return ws.terminate(); }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`F-35 Dogfight server listening on :${PORT}`));
