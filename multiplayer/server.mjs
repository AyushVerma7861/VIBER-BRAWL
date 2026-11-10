import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createDuel, HEAVY, MAX_REWIND_TICKS, NONE, QUICK, ROOM_CODE, STEP, stepDuel } from '../public/online-sim.mjs';

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const maxRooms = 8;
const snapshotEvery = 3;
const baseViewTicks = 6;
const maxViewAge = 18;
const waitingMs = 10 * 60_000;
const reconnectMs = 2 * 60_000;
const resumeTokenPattern = /^[A-Za-z0-9_-]{24}$/;
const rooms = new Map();

const assets = new Map([
  ['/online', ['index.html', 'text/html; charset=utf-8']],
  ['/three.min.js', ['three.min.js', 'text/javascript; charset=utf-8']],
  ['/online-client.mjs', ['online-client.mjs', 'text/javascript; charset=utf-8']],
  ['/online-sim.mjs', ['online-sim.mjs', 'text/javascript; charset=utf-8']],
  ['/online.css', ['online.css', 'text/css; charset=utf-8']],
  ['/halloween-menu.css', ['halloween-menu.css', 'text/css; charset=utf-8']],
  ['/guide-poster.jpg', ['guide-poster.jpg', 'image/jpeg']],
  ['/td.mp4', ['td.mp4', 'video/mp4']],
  ...['client-gate.js', 'patch-art.js', 'pumpkin-patch.js', 'halloween-menu.js', 'arena-accessibility.js']
    .map(name => ['/' + name, [name, 'text/javascript; charset=utf-8']]),
]);
const files = new Map(await Promise.all([...assets].map(async ([path, [file, type]]) => {
  const source = await readFile(new URL('../public/' + file, import.meta.url));
  return [path, { source, type }];
})));

const server = createServer((request, response) => {
  const path = request.url.split('?')[0];
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (path === '/' || path === '/online/') {
    const query = request.url.slice(path.length);
    response.writeHead(302, { Location: '/online' + query }).end();
    return;
  }
  if (path === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  const file = files.get(path);
  if (!file) { response.writeHead(404).end(); return; }
  response.writeHead(200, {
    'Content-Type': file.type,
    'Content-Length': file.source.length,
    'Cache-Control': path === '/three.min.js' ? 'public, max-age=86400' : 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }).end(request.method === 'HEAD' ? undefined : file.source);
});

const sockets = new WebSocketServer({
  noServer: true, maxPayload: 512, maxFragments: 32, maxBufferedChunks: 32, perMessageDeflate: false,
});
server.on('upgrade', (request, socket, head) => {
  let sameOrigin = false;
  try { sameOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
  if (request.url !== '/duel' || !sameOrigin || sockets.clients.size >= 24) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
});

function send(client, message) {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > 32_768) { client.terminate(); return; }
  client.send(JSON.stringify(message));
}

function expireRoom(room, reason) {
  if (!rooms.delete(room.code)) return;
  for (const client of room.players) {
    if (!client) continue;
    client.room = null;
    send(client, { type: 'left', reason });
    client.close();
  }
}

function attachPlayer(client, room, slot) {
  client.slot = slot;
  client.room = room;
  client.ready = false;
  room.players[slot] = client;
  send(client, {
    type: 'joined', code: room.code, slot,
    ...(slot === 0 ? { resumeToken: room.resumeToken } : {}),
  });
  if (slot === 1) startRound(room);
}

function createRoom(client) {
  if (rooms.size >= maxRooms) { send(client, { type: 'error', reason: 'All duel rooms are in use. Try again shortly.' }); return; }
  let code;
  do { code = randomBytes(9).toString('base64url'); } while (rooms.has(code));
  const room = {
    code, resumeToken: randomBytes(18).toString('base64url'), players: [],
    duel: null, events: [], round: 0, expires: Date.now() + waitingMs, resumeUntil: 0,
  };
  rooms.set(code, room);
  attachPlayer(client, room, 0);
}

function roomIsExpired(room, now) {
  return (!room.duel || room.duel.ended) &&
    (room.expires <= now || (room.resumeUntil > 0 && room.resumeUntil <= now));
}

function detachHost(room, client) {
  room.players[0] = null;
  room.resumeUntil = Date.now() + reconnectMs;
  client.room = null;
}

function enterRoom(client, code, resumeToken) {
  const room = rooms.get(code);
  if (room && roomIsExpired(room, Date.now())) {
    expireRoom(room, 'This room expired. Create a new invite to play again.');
  }
  if (resumeToken) {
    if (!rooms.has(code) || room.duel || room.resumeToken !== resumeToken) {
      send(client, { type: 'error', code: 'resume_unavailable', reason: 'This duel can no longer be resumed. Create a fresh invite.' });
    } else {
      const previous = room.players[0];
      if (previous) {
        previous.room = null;
        send(previous, { type: 'left', reason: 'Hosting resumed in another tab.' });
        previous.close();
      }
      room.resumeUntil = 0;
      attachPlayer(client, room, 0);
    }
    return;
  }
  if (!rooms.has(code)) {
    send(client, { type: 'error', code: 'invite_expired', reason: 'This invite is no longer active. Ask the host to create and send a new one.' });
  } else if (room.players.length === 2) {
    send(client, { type: 'error', code: 'room_full', reason: 'This duel already has two players. Ask the host for a new duel.' });
  } else if (room.players[0]?.readyState !== WebSocket.OPEN) {
    send(client, { type: 'error', code: 'host_away', reason: 'The host disconnected. Ask them to return to their host tab, then select Join again.' });
  } else {
    attachPlayer(client, room, 1);
  }
}

function startRound(room) {
  room.duel = createDuel();
  room.round++;
  room.events = [];
  for (const client of room.players) {
    client.queue = [];
    client.ack = 0;
    client.lastSeq = 0;
    client.lastInput = NONE;
    client.lastInputTick = 0;
    client.ready = false;
  }
  broadcast(room, 'start');
}

function broadcast(room, type) {
  const { history, ...snapshot } = room.duel;
  for (const client of room.players) {
    send(client, {
      type, round: room.round, ...snapshot,
      ack: client.ack, events: room.events,
    });
  }
  room.events = [];
}

function acceptInput(client, message) {
  const duel = client.room.duel;
  if (!duel || duel.countdown > 0 || duel.ended || message.round !== client.room.round ||
      !Array.isArray(message.frames) || message.frames.length > 2) return;
  for (const frame of message.frames) {
    if (!Array.isArray(frame) || (frame.length !== 4 && frame.length !== 5)) continue;
    const [seq, x, z, buttons, viewTick] = frame;
    if (!Number.isSafeInteger(seq) || seq <= client.lastSeq || seq - client.lastSeq > 600 ||
        !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1 || Math.abs(z) > 1 ||
        !Number.isInteger(buttons) || buttons < 0 || buttons > 15) continue;
    client.lastSeq = seq;
    client.queue.push({
      seq, x, z, buttons,
      viewTick: (buttons & (QUICK | HEAVY)) && Number.isSafeInteger(viewTick) &&
        viewTick > 0 && viewTick <= duel.tick ? viewTick : null,
    });
  }
  // Drop stale movement during long stalls. Never fast-forward a fighter.
  if (client.queue.length > 10) client.queue.splice(0, client.queue.length - 10);
}

function nextInput(client, tick) {
  const input = client.queue.shift();
  if (input) {
    client.ack = input.seq;
    client.lastInputTick = tick;
    client.lastInput = { x: input.x, z: input.z, buttons: 0 };
    if (input.viewTick !== null) {
      const age = tick + 1 - input.viewTick;
      const allowed = Math.min(MAX_REWIND_TICKS, baseViewTicks + Math.round(client.rttMs / (2000 * STEP)));
      if (age <= maxViewAge) input.rewind = Math.min(age, allowed);
    }
    return input;
  }
  return tick - client.lastInputTick <= 8 ? client.lastInput : NONE;
}

function ping(client) {
  client.pingStarted = performance.now();
  client.pingPayload = Buffer.from(String(client.pingStarted));
  client.ping(client.pingPayload);
}

sockets.on('connection', client => {
  client.room = null;
  client.pongAt = Date.now();
  client.rttMs = 0;
  let allowance = 80;
  let allowanceAt = performance.now();
  let joinTimeout = setTimeout(() => client.close(), 15_000);
  client.on('pong', payload => {
    client.pongAt = Date.now();
    if (payload.equals(client.pingPayload)) client.rttMs = performance.now() - client.pingStarted;
  });
  client.on('error', () => client.terminate());
  client.on('close', () => {
    clearTimeout(joinTimeout);
    const room = client.room;
    if (!room) return;
    if (room.duel) expireRoom(room, 'Your opponent left the room.');
    else detachHost(room, client);
  });
  client.on('message', (raw, binary) => {
    const now = performance.now();
    allowance = Math.min(80, allowance + (now - allowanceAt) * .055) - 1;
    allowanceAt = now;
    if (allowance < 0 || binary) { client.close(1008); return; }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ping' && Number.isFinite(message.sent)) {
      send(client, { type: 'pong', sent: message.sent });
      return;
    }
    const room = client.room;
    if (!room) {
      if (message.type === 'create') createRoom(client);
      if (typeof message.code === 'string' && ROOM_CODE.test(message.code)) {
        if (message.type === 'join') enterRoom(client, message.code);
        if (message.type === 'resume' && typeof message.resumeToken === 'string' && resumeTokenPattern.test(message.resumeToken)) {
          enterRoom(client, message.code, message.resumeToken);
        }
      }
      if (client.room) { clearTimeout(joinTimeout); joinTimeout = null; }
      return;
    }
    if (message.type === 'leave') { expireRoom(room, 'Your opponent left the room.'); return; }
    if (message.type === 'suspend' && !room.duel && client.slot === 0) {
      detachHost(room, client);
      client.close();
      return;
    }
    if (message.type === 'input') acceptInput(client, message);
    if (message.type === 'rematch' && room.duel?.ended) {
      client.ready = true;
      if (room.players.every(player => player.ready)) startRound(room);
      else send(client, { type: 'ready' });
    }
  });
  ping(client);
});

let nextTick = performance.now();
setInterval(() => {
  const now = performance.now();
  let ticks = 0;
  while (now >= nextTick && ticks++ < 4) {
    nextTick += STEP * 1000;
    for (const room of rooms.values()) {
      const duel = room.duel;
      if (!duel || duel.ended) continue;
      const inputs = duel.countdown ? [NONE, NONE] : room.players.map(player => nextInput(player, duel.tick));
      room.events.push(...stepDuel(duel, inputs));
      if (duel.ended) room.expires = Date.now() + waitingMs;
      if (duel.ended || duel.tick % snapshotEvery === 0) broadcast(room, 'state');
    }
  }
  if (now - nextTick > 100) nextTick = now + STEP * 1000;
}, 8).unref();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (roomIsExpired(room, now)) expireRoom(room, 'This room expired. Create a new invite to play again.');
  }
  for (const client of sockets.clients) {
    if (now - client.pongAt > 30_000) client.terminate();
    else if (client.readyState === WebSocket.OPEN) ping(client);
  }
}, 10_000).unref();

server.listen(port, host, () => console.log('VIBER BRAWL Online is listening on ' + host + ':' + server.address().port));
