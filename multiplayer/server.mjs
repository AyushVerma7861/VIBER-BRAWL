import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createDuel, HEAVY, NONE, QUICK, ROOM_CODE, STEP, TICK_RATE, stepDuel } from '../public/online-sim.mjs';
import { packFighter, SNAPSHOT_EVERY } from '../public/online-net.mjs';
import { rewindForView } from './lag-compensation.mjs';
import { installMatchmaking, matchTicket, regionId } from './matchmaking.mjs';

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const maxRooms = 8;
const waitingMs = 10 * 60_000;
const reconnectMs = 2 * 60_000;
const matchReconnectMs = 20_000;
const resumeTokenPattern = /^[A-Za-z0-9_-]{24}$/;
const rooms = new Map();
const ticketRooms = new Map();
const localRegion = process.env.DUEL_REGION || 'local';
const coordinator = process.env.DUEL_COORDINATOR || localRegion;
const regionSecret = process.env.DUEL_REGION_SECRET || '';
const regions = new Map(Object.entries(JSON.parse(process.env.DUEL_REGIONS || '{}')).map(([id, region]) => {
  const url = new URL(region.origin);
  if (!regionId.test(id) || typeof region.name !== 'string' ||
      !['http:', 'https:'].includes(url.protocol) || url.href !== url.origin + '/') {
    throw new Error('Invalid duel region ' + id);
  }
  return [id, { id, name: region.name, origin: url.origin }];
}));
if (regions.size && (!regions.has(localRegion) || !regions.has(coordinator) || regionSecret.length < 24)) {
  throw new Error('Regional matchmaking requires both configured region IDs and DUEL_REGION_SECRET');
}

function allowed(request) {
  try {
    const origin = new URL(request.headers.origin);
    return origin.host === request.headers.host || [...regions.values()].some(region => region.origin === origin.origin);
  } catch { return false; }
}

const assets = new Map([
  ['/online', ['index.html', 'text/html; charset=utf-8']],
  ['/three.min.js', ['three.min.js', 'text/javascript; charset=utf-8']],
  ['/online-client.mjs', ['online-client.mjs', 'text/javascript; charset=utf-8']],
  ['/online-sim.mjs', ['online-sim.mjs', 'text/javascript; charset=utf-8']],
  ['/online-net.mjs', ['online-net.mjs', 'text/javascript; charset=utf-8']],
  ['/online-lobby.mjs', ['online-lobby.mjs', 'text/javascript; charset=utf-8']],
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
  if (path === '/duel-reservation') { matchmaking.reserve(request, response); return; }
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
  if (path === '/duel-regions') {
    const list = regions.size ? [...regions.values()] : [{ id: localRegion, name: 'Local', origin: '' }];
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ local: localRegion, coordinator, regions: list }));
    return;
  }
  if (path === '/duel-ping') {
    const origin = request.headers.origin;
    if (origin && !allowed(request)) { response.writeHead(403).end(); return; }
    response.writeHead(200, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    }).end(JSON.stringify({ region: localRegion }));
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
const matchmaking = installMatchmaking(server, {
  regions: regions.size ? regions : new Map([[localRegion, null]]),
  local: localRegion, coordinator, secret: regionSecret, allowed, reserve: reserveMatch,
});
server.on('upgrade', (request, socket, head) => {
  if (matchmaking.upgrade(request, socket, head)) return;
  if (request.url !== '/duel' || !allowed(request) || sockets.clients.size >= 24) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
});

function send(client, message) {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > 32_768) { drop(client, 'send backlog'); return; }
  client.send(JSON.stringify(message));
}

function drop(client, reason) {
  client.disconnectReason = reason;
  client.terminate();
}

function expireRoom(room, reason) {
  if (!rooms.delete(room.code)) return;
  for (const ticket of room.tickets || []) ticketRooms.delete(ticket);
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
    resumeToken: room.tokens[slot], inMatch: Boolean(room.duel && !room.duel.ended), matchmaking: Boolean(room.tickets),
  });
}

function newRoom(expires = Date.now() + waitingMs) {
  if (rooms.size >= maxRooms) return null;
  let code;
  do { code = randomBytes(9).toString('base64url'); } while (rooms.has(code));
  const room = {
    code, tokens: Array.from({ length: 2 }, () => randomBytes(18).toString('base64url')), players: [],
    duel: null, events: [], round: 0, epoch: 0, expires, resumeUntil: 0,
  };
  rooms.set(code, room);
  return room;
}

function createRoom(client) {
  const room = newRoom();
  if (room) attachPlayer(client, room, 0);
  else send(client, { type: 'error', reason: 'All duel rooms are in use. Try again shortly.' });
}

function reserveMatch() {
  const room = newRoom(Date.now() + 25_000);
  if (!room) return null;
  room.players = [null, null];
  room.tickets = Array.from({ length: 2 }, () => randomBytes(18).toString('base64url'));
  for (const ticket of room.tickets) ticketRooms.set(ticket, room);
  return { tickets: room.tickets };
}

function joinMatch(client, ticket) {
  const room = ticketRooms.get(ticket);
  if (!room || roomIsExpired(room, Date.now())) {
    send(client, { type: 'error', reason: 'This match is no longer available. Select Quick Match again.' });
    return;
  }
  ticketRooms.delete(ticket);
  attachPlayer(client, room, room.tickets.indexOf(ticket));
  if (room.players.every(player => player?.readyState === WebSocket.OPEN)) startRound(room);
}

function roomIsExpired(room, now) {
  return (room.resumeUntil > 0 && room.resumeUntil <= now) ||
    ((!room.duel || room.duel.ended) && room.expires <= now);
}

function detachHost(room, client) {
  room.players[0] = null;
  room.resumeUntil = Date.now() + reconnectMs;
  client.room = null;
}

function pauseForDisconnect(room, client) {
  room.players[client.slot] = null;
  client.room = null;
  room.resumeUntil ||= Date.now() + matchReconnectMs;
  broadcast(room, 'paused');
}

function resetInputs(client) {
  client.queue = [];
  client.ack = 0;
  client.lastSeq = 0;
  client.lastInput = NONE;
  client.lastInputTick = -Infinity;
}

function resumePlayer(client, room, slot) {
  const previous = room.players[slot];
  if (previous) {
    previous.room = null;
    send(previous, { type: 'left', reason: 'Your seat resumed in another tab.' });
    previous.close();
  }
  resetInputs(client);
  attachPlayer(client, room, slot);
  if (!room.duel) {
    room.resumeUntil = 0;
  } else if (room.players.every(player => player?.readyState === WebSocket.OPEN)) {
    room.resumeUntil = 0;
    room.epoch++;
    room.duel.countdown = Math.max(room.duel.countdown, 2 * TICK_RATE);
    room.players.forEach(resetInputs);
    broadcast(room, 'resumed');
  } else {
    room.resumeUntil ||= Date.now() + matchReconnectMs;
    broadcast(room, 'paused');
  }
}

function enterRoom(client, code, resumeToken) {
  const room = rooms.get(code);
  if (room && roomIsExpired(room, Date.now())) {
    expireRoom(room, 'This room expired. Create a new invite to play again.');
  }
  if (resumeToken) {
    const slot = room?.tokens.indexOf(resumeToken) ?? -1;
    if (!rooms.has(code) || room.duel?.ended || slot < 0 || (!room.duel && (slot === 1 || room.tickets))) {
      send(client, { type: 'error', code: 'resume_unavailable', reason: 'This duel can no longer be resumed. Create a fresh invite.' });
    } else {
      resumePlayer(client, room, slot);
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
    startRound(room);
  }
}

function startRound(room) {
  room.duel = createDuel();
  room.round++;
  room.epoch = 0;
  room.events = [];
  for (const client of room.players) {
    resetInputs(client);
    client.ready = false;
  }
  broadcast(room, 'start');
}

function broadcast(room, type) {
  const { history, ...snapshot } = room.duel;
  let compactFighters;
  for (const client of room.players) {
    if (!client) continue;
    if (type === 'state' && !snapshot.ended && !room.events.length &&
        client.bufferedAmount > 4096 && client.bufferedAmount <= 32_768) continue;
    if (client.compactSnapshots) compactFighters ??= snapshot.fighters.map(packFighter);
    send(client, {
      type, round: room.round, epoch: room.epoch, ...snapshot,
      ...(client.compactSnapshots ? { compact: true, fighters: compactFighters } : {}),
      ack: client.ack, events: room.events,
    });
  }
  room.events = [];
}

function acceptInput(client, message) {
  const duel = client.room.duel;
  if (!duel || duel.countdown > 0 || duel.ended || client.room.resumeUntil ||
      message.round !== client.room.round || (message.epoch ?? 0) !== client.room.epoch ||
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
      input.rewind = rewindForView(input.viewTick, tick + 1, client.rttMs);
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

function probeLatency(client, now) {
  client.latencyProbeAt = now;
  const nonce = randomBytes(6).toString('base64url');
  client.latencyChallenge = { nonce, sent: performance.now() };
  send(client, { type: 'latency_probe', nonce });
}

function recordLatency(client, nonce, now) {
  const challenge = client.latencyChallenge;
  if (!challenge || nonce !== challenge.nonce) return;
  client.latencyChallenge = null;
  client.latencySamples.push(now - challenge.sent);
  if (client.latencySamples.length > 5) client.latencySamples.shift();
  const sorted = [...client.latencySamples].sort((a, b) => a - b);
  client.rttMs = sorted[Math.floor(sorted.length / 2)];
}

sockets.on('connection', client => {
  client.room = null;
  client.pongAt = Date.now();
  client.lastSeenAt = client.pongAt;
  client.rttMs = 0;
  client.latencyProbeAt = 0;
  client.latencySamples = [];
  let allowance = 80;
  let allowanceAt = performance.now();
  let joinTimeout = setTimeout(() => client.close(), 15_000);
  client.on('pong', payload => {
    client.pongAt = Date.now();
    if (!client.latencySamples.length && payload.equals(client.pingPayload)) {
      client.rttMs = performance.now() - client.pingStarted;
    }
  });
  client.on('error', error => drop(client, error.code || 'socket error'));
  client.on('close', code => {
    clearTimeout(joinTimeout);
    const room = client.room;
    if (!room) return;
    console.log(JSON.stringify({ event: 'duel_socket_closed', slot: client.slot, code,
      reason: client.disconnectReason || 'peer closed', active: Boolean(room.duel && !room.duel.ended) }));
    if (!room.duel && room.tickets) expireRoom(room, 'Your opponent left before the duel started. Select Quick Match again.');
    else if (!room.duel) detachHost(room, client);
    else if (room.duel.ended) expireRoom(room, 'Your opponent left the room.');
    else pauseForDisconnect(room, client);
  });
  client.on('message', (raw, binary) => {
    const now = performance.now();
    allowance = Math.min(80, allowance + (now - allowanceAt) * .055) - 1;
    allowanceAt = now;
    if (allowance < 0 || binary) {
      client.disconnectReason = allowance < 0 ? 'message rate' : 'unexpected binary input';
      client.close(1008);
      return;
    }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object') return;
    client.lastSeenAt = Date.now();
    if (message.type === 'ping' && Number.isFinite(message.sent)) {
      send(client, { type: 'pong', sent: message.sent });
      return;
    }
    if (message.type === 'latency_ack') {
      recordLatency(client, message.nonce, now);
      return;
    }
    const room = client.room;
    if (!room) {
      client.compactSnapshots = message.compactSnapshots === true;
      client.latencyProbes = message.latencyProbes === true;
      if (message.type === 'create') createRoom(client);
      if (message.type === 'match_join' && typeof message.ticket === 'string' && matchTicket.test(message.ticket)) {
        joinMatch(client, message.ticket);
      }
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
    if (message.type === 'suspend' && !room.duel?.ended) {
      if (room.duel) pauseForDisconnect(room, client);
      else if (room.tickets) expireRoom(room, 'Your opponent left before the duel started. Select Quick Match again.');
      else detachHost(room, client);
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
  const ready = new Set();
  let ticks = 0;
  while (now >= nextTick && ticks++ < 4) {
    nextTick += STEP * 1000;
    for (const room of rooms.values()) {
      const duel = room.duel;
      if (!duel || duel.ended || room.resumeUntil) continue;
      const inputs = duel.countdown ? [NONE, NONE] : room.players.map(player => nextInput(player, duel.tick));
      room.events.push(...stepDuel(duel, inputs));
      if (duel.ended) room.expires = Date.now() + waitingMs;
      if (duel.ended || duel.tick % SNAPSHOT_EVERY === 0) ready.add(room);
    }
  }
  for (const room of ready) broadcast(room, 'state');
  if (now - nextTick > 100) nextTick = now + STEP * 1000;
}, 8).unref();

let nextHeartbeat = 0;
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (roomIsExpired(room, now)) expireRoom(room, room.duel && !room.duel.ended
      ? 'The connection could not be restored. Create a new duel to play again.'
      : 'This room expired. Create a new invite to play again.');
  }
  for (const client of sockets.clients) {
    if (client.room?.duel && !client.room.duel.ended && now - client.lastSeenAt > 8000) {
      drop(client, 'no game traffic');
    } else if (now - client.pongAt > 30_000) {
      drop(client, 'heartbeat timeout');
    } else if (client.readyState === WebSocket.OPEN) {
      if (now >= nextHeartbeat) ping(client);
      if (client.room?.duel && client.latencyProbes && now - client.latencyProbeAt >= 3000) probeLatency(client, now);
    }
  }
  if (now >= nextHeartbeat) nextHeartbeat = now + 10_000;
}, 1000).unref();

server.listen(port, host, () => console.log('VIBER BRAWL Online is listening on ' + host + ':' + server.address().port));
