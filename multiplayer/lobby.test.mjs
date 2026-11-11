import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import WebSocket from 'ws';

test('the invite survives a host refresh and both seats can resume a paused duel', { timeout: 20_000 }, async t => {
  const server = spawn(process.execPath, ['multiplayer/server.mjs'], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill());
  const output = createInterface({ input: server.stdout });
  const [line] = await once(output, 'line', { signal: AbortSignal.timeout(8000) });
  const address = line.match(/listening on (127\.0\.0\.1:\d+)/)?.[1];
  assert.ok(address);

  async function connect() {
    const socket = new WebSocket('ws://' + address + '/duel', { origin: 'http://' + address, handshakeTimeout: 3000 });
    t.after(() => socket.terminate());
    await once(socket, 'open');
    return socket;
  }
  async function request(socket, data) {
    const response = once(socket, 'message', { signal: AbortSignal.timeout(3000) });
    socket.send(JSON.stringify(data));
    return JSON.parse((await response)[0]);
  }
  async function waitFor(socket, condition) {
    for await (const [raw] of on(socket, 'message', { signal: AbortSignal.timeout(5000) })) {
      const message = JSON.parse(raw);
      if (condition(message)) return message;
    }
  }

  const host = await connect();
  const { type, code, resumeToken } = await request(host, { type: 'create' });
  assert.equal(type, 'joined');
  assert.ok(resumeToken);
  const guest = await connect();
  const join = { type: 'join', code };
  const closed = once(host, 'close');
  host.send(JSON.stringify({ type: 'suspend' }));
  await closed;
  assert.equal((await request(guest, join)).code, 'host_away');

  const restored = await connect();
  const resume = { type: 'resume', code, resumeToken };
  const reply = await request(restored, resume);
  assert.equal(reply.type, 'joined');
  assert.equal(reply.code, code);
  assert.equal(reply.slot, 0);
  // A proxy may leave the original socket open after a refresh.
  const refreshed = await connect();
  const replaced = once(restored, 'close', { signal: AbortSignal.timeout(3000) });
  assert.equal((await request(refreshed, resume)).type, 'joined');
  await replaced;
  const start = once(refreshed, 'message', { signal: AbortSignal.timeout(3000) });
  const guestReply = await request(guest, join);
  assert.equal(guestReply.type, 'joined');
  assert.equal(guestReply.slot, 1);
  assert.ok(guestReply.resumeToken);
  assert.notEqual(guestReply.resumeToken, resumeToken);
  assert.equal(JSON.parse((await start)[0]).type, 'start');

  const third = await connect();
  assert.equal((await request(third, join)).code, 'room_full');
  const live = await waitFor(refreshed, m => m.type === 'state' && m.countdown === 0);
  const paused = waitFor(refreshed, m => m.type === 'paused');
  guest.terminate();
  const frozen = await paused;
  assert.equal(frozen.round, live.round);

  const replacement = await connect();
  const bothResumed = waitFor(refreshed, m => m.type === 'resumed');
  const joined = await request(replacement, { type: 'resume', code, resumeToken: guestReply.resumeToken });
  assert.equal(joined.slot, 1);
  assert.equal(joined.inMatch, true);
  const resumed = await bothResumed;
  assert.equal(resumed.round, frozen.round);
  assert.equal(resumed.tick, frozen.tick);
  assert.equal(resumed.remaining, frozen.remaining);
  assert.deepEqual(resumed.fighters, frozen.fighters);
  assert.equal(resumed.epoch, frozen.epoch + 1);
  assert.ok(resumed.countdown > 0);

  const ready = await waitFor(replacement, m => m.type === 'state' && m.countdown === 0);
  const jump = waitFor(refreshed, m => m.type === 'state' && m.fighters[1].y > 0.2);
  replacement.send(JSON.stringify({ type: 'input', round: ready.round, epoch: ready.epoch, frames: [[1, 0, 0, 1], [2, 0, 0, 0]] }));
  await jump;
  const hostPaused = waitFor(replacement, m => m.type === 'paused');
  refreshed.terminate();
  await hostPaused;
  const hostBack = await connect();
  assert.equal((await request(hostBack, resume)).slot, 0);
  const left = once(replacement, 'close', { signal: AbortSignal.timeout(3000) });
  hostBack.send(JSON.stringify({ type: 'leave' }));
  await left;
  assert.equal((await request(third, join)).code, 'invite_expired');
});
