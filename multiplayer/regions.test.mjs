import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import test from 'node:test';
import WebSocket from 'ws';

async function getPort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('both regions use one queue and the selected server owns the room and reconnect', { timeout: 35_000 }, async t => {
  let sin = process.env.DUEL_TEST_SINGAPORE;
  let fra = process.env.DUEL_TEST_FRANKFURT;
  if (!sin || !fra) {
    const [sinPort, fraPort] = await Promise.all([getPort(), getPort()]);
    sin = 'http://127.0.0.1:' + sinPort;
    fra = 'http://127.0.0.1:' + fraPort;
    const config = JSON.stringify({
      sin: { name: 'Singapore', origin: sin },
      fra: { name: 'Frankfurt', origin: fra },
    });
    await Promise.all([['sin', sinPort], ['fra', fraPort]].map(async ([region, port]) => {
      const child = spawn(process.execPath, ['multiplayer/server.mjs'], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DUEL_REGION: region,
          DUEL_COORDINATOR: 'sin', DUEL_REGIONS: config, DUEL_REGION_SECRET: 'local-test-reservation-token' },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      t.after(() => child.kill());
      await once(createInterface({ input: child.stdout }), 'line', { signal: AbortSignal.timeout(8000) });
    }));
  }

  const configResponse = await fetch(sin + '/duel-regions', { signal: AbortSignal.timeout(8000) });
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.coordinator, 'sin');
  assert.deepEqual(config.regions.map(r => r.origin).sort(), [sin, fra].sort());
  const pong = await fetch(fra + '/duel-ping', { headers: { Origin: sin }, signal: AbortSignal.timeout(8000) });
  assert.equal(pong.headers.get('access-control-allow-origin'), sin);
  assert.deepEqual(await pong.json(), { region: 'fra' });
  assert.equal((await fetch(fra + '/duel-reservation', { method: 'POST' })).status, 403);

  async function connect(host, origin, path) {
    const socket = new WebSocket(host.replace(/^http/, 'ws') + path, { origin, handshakeTimeout: 8000 });
    t.after(() => socket.terminate());
    await once(socket, 'open', { signal: AbortSignal.timeout(8000) });
    return socket;
  }
  async function message(socket, predicate) {
    for await (const [raw] of on(socket, 'message', { signal: AbortSignal.timeout(8000) })) {
      const value = JSON.parse(raw);
      if (predicate(value)) return value;
    }
  }
  const send = (socket, data) => socket.send(JSON.stringify(data));
  async function match(pings, preferred = '') {
    const [a, b] = await Promise.all([connect(sin, sin, '/duel-queue'), connect(sin, fra, '/duel-queue')]);
    const assigned = Promise.all([a, b].map(socket => message(socket, m => m.type === 'match')));
    send(a, { type: 'search', pings: pings[0], preferred });
    send(b, { type: 'search', pings: pings[1] });
    return assigned;
  }

  // Although each player individually favors a different region, both get the fairer one.
  const tickets = await match([{ sin: 25, fra: 80 }, { sin: 150, fra: 60 }]);
  assert.deepEqual(tickets.map(m => m.region), ['fra', 'fra']);
  const [a, b] = await Promise.all([connect(fra, sin, '/duel'), connect(fra, fra, '/duel')]);
  const joined = [a, b].map(socket => message(socket, m => m.type === 'joined'));
  const started = message(a, m => m.type === 'start');
  send(b, { type: 'match_join', ticket: tickets[1].ticket });
  send(a, { type: 'match_join', ticket: tickets[0].ticket });
  const [host, guest] = await Promise.all(joined);
  assert.equal(host.code, guest.code);
  assert.equal(host.slot, 0);
  assert.equal(guest.slot, 1);
  await started;
  const paused = message(a, m => m.type === 'paused');
  b.terminate();
  await paused;
  const replacement = await connect(fra, sin, '/duel');
  const resumed = message(a, m => m.type === 'resumed');
  send(replacement, { type: 'resume', code: guest.code, resumeToken: guest.resumeToken });
  await resumed;
  send(a, { type: 'leave' });

  const manual = await match([{ sin: 100, fra: 20 }, { sin: 100, fra: 20 }], 'sin');
  assert.deepEqual(manual.map(m => m.region), ['sin', 'sin']);

  const privateHost = await connect(fra, sin, '/duel');
  const invite = message(privateHost, m => m.type === 'joined');
  send(privateHost, { type: 'create' });
  const { code } = await invite;
  const privateGuest = await connect(fra, fra, '/duel');
  const privateStart = message(privateGuest, m => m.type === 'start');
  send(privateGuest, { type: 'join', code });
  await privateStart;
  send(privateHost, { type: 'leave' });
});
