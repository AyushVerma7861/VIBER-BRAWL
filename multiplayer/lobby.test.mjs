import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import WebSocket from 'ws';

test('a waiting host can disconnect and resume on the original invite', { timeout: 15_000 }, async t => {
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

  const host = await connect();
  const { type, code, resumeToken } = await request(host, { type: 'create' });
  assert.equal(type, 'joined');
  assert.ok(resumeToken);
  const closed = once(host, 'close');
  host.close();
  await closed;

  const guest = await connect();
  const join = { type: 'join', code };
  assert.equal((await request(guest, join)).code, 'host_away');

  const restored = await connect();
  const resume = { type: 'resume', code, resumeToken };
  const reply = await request(restored, resume);
  assert.equal(reply.type, 'joined');
  assert.equal(reply.code, code);
  assert.equal(reply.slot, 0);
  const start = once(restored, 'message', { signal: AbortSignal.timeout(3000) });
  const guestReply = await request(guest, join);
  assert.equal(guestReply.type, 'joined');
  assert.equal(guestReply.slot, 1);
  assert.equal(guestReply.resumeToken, undefined);
  assert.equal(JSON.parse((await start)[0]).type, 'start');

  const third = await connect();
  assert.equal((await request(third, join)).code, 'room_full');
  const left = once(guest, 'close', { signal: AbortSignal.timeout(3000) });
  restored.send(JSON.stringify({ type: 'leave' }));
  await left;
  assert.equal((await request(third, join)).code, 'invite_expired');
});
