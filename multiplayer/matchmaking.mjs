import { timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

export const regionId = /^[a-z][a-z0-9-]{1,19}$/;
export const matchTicket = /^[A-Za-z0-9_-]{24}$/;

export function selectRegion(first, second, regions) {
  return regions
    .filter(id => [first, second].every(player => id in player.pings && (!player.preferred || player.preferred === id)))
    .sort((a, b) => Math.max(first.pings[a], second.pings[a]) - Math.max(first.pings[b], second.pings[b]) ||
      first.pings[a] + second.pings[a] - first.pings[b] - second.pings[b])[0];
}

export function installMatchmaking(server, { regions, local, coordinator, secret, allowed, reserve }) {
  const waiting = new Map();
  const queue = new WebSocketServer({
    noServer: true, maxPayload: 512, maxFragments: 32, maxBufferedChunks: 32, perMessageDeflate: false,
  });
  const cooling = new Map();
  let matching = false;
  const send = (socket, value) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };

  async function assign() {
    if (matching) return;
    const now = Date.now();
    const available = [...regions.keys()].filter(id => (cooling.get(id) || 0) <= now);
    const players = [...waiting.values()];
    let pair;
    // Keep the oldest compatible player first. Allow wider latency after a wait.
    for (const [index, first] of players.entries()) {
      for (const second of players.slice(index + 1)) {
        const id = selectRegion(first, second, available);
        if (!id) continue;
        const limit = now - Math.min(first.since, second.since) >= 20_000 ? 350 : 160;
        const ping = Math.max(first.pings[id], second.pings[id]);
        if (ping <= limit && (!pair || ping < pair.ping)) pair = { id, first, second, ping };
      }
      if (pair) break;
    }
    if (!pair) return;
    matching = true;
    const { id, first, second } = pair;
    try {
      let match;
      if (id === local) {
        match = reserve();
      } else {
        const response = await fetch(new URL('/duel-reservation', regions.get(id).origin), {
          method: 'POST', headers: { Authorization: 'Bearer ' + secret },
          signal: AbortSignal.timeout(3500), redirect: 'error',
        });
        if (response.ok) match = await response.json();
      }
      if (!match || !Array.isArray(match.tickets) || match.tickets.length !== 2 ||
          !match.tickets.every(ticket => matchTicket.test(ticket))) throw new Error('Reservation failed');
      if ([first, second].some(player => waiting.get(player.socket) !== player ||
          player.socket.readyState !== WebSocket.OPEN)) return;
      for (const [slot, player] of [first, second].entries()) {
        waiting.delete(player.socket);
        send(player.socket, { type: 'match', region: id, ticket: match.tickets[slot] });
        player.socket.close();
      }
    } catch {
      cooling.set(id, Date.now() + 5000);
    } finally {
      matching = false;
    }
  }

  if (local === coordinator) {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const socket of queue.clients) {
        if (now - socket.lastSeen > 25_000) socket.terminate();
        else if (now - (waiting.get(socket)?.since ?? now) > 120_000) {
          waiting.delete(socket);
          send(socket, { type: 'error', reason: 'No opponent with a compatible connection yet. Try Auto or create a private room.' });
          socket.close();
        }
      }
      void assign();
    }, 800);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }

  queue.on('connection', socket => {
    socket.lastSeen = Date.now();
    socket.on('error', () => socket.terminate());
    socket.on('close', () => waiting.delete(socket));
    socket.on('message', (raw, binary) => {
      if (binary) return socket.close(1008);
      let message;
      try { message = JSON.parse(raw); } catch { return socket.close(1008); }
      socket.lastSeen = Date.now();
      if (message?.type === 'keepalive') return;
      if (message?.type !== 'search' || waiting.has(socket)) return;
      const preferred = regions.has(message.preferred) ? message.preferred : '';
      const pings = Object.create(null);
      for (const id of regions.keys()) {
        const num = message.pings?.[id];
        if (Number.isInteger(num) && num >= 0 && num <= 1000) pings[id] = num;
      }
      if (!(preferred ? preferred in pings : Object.keys(pings).length)) {
        send(socket, { type: 'error', reason: 'No reachable server. Check the server list and try again.' });
        socket.close();
        return;
      }
      waiting.set(socket, { socket, pings, preferred, since: Date.now() });
      send(socket, { type: 'searching' });
      void assign();
    });
  });

  return {
    upgrade(request, socket, head) {
      if (request.url !== '/duel-queue') return false;
      if (local !== coordinator || !allowed(request) || queue.clients.size >= 48) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return true;
      }
      queue.handleUpgrade(request, socket, head, client => queue.emit('connection', client));
      return true;
    },
    reserve(request, response) {
      const supplied = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + secret);
      if (request.method !== 'POST' || !secret || supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)) {
        response.writeHead(403).end();
        return;
      }
      const match = reserve();
      if (!match) { response.writeHead(503).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(match));
    },
  };
}
