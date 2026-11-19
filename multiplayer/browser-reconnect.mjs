import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { unpackFighter } from '../public/online-net.mjs';

const origin = new URL(process.argv[2]).origin;
const chromePath = process.env.DUEL_CHROME || 'google-chrome';
const checkoutClient = process.argv.includes('--client-from-checkout') ?
  await readFile(new URL('../public/online-client.mjs', import.meta.url)) : null;
const target = new URL('/duel', origin);
target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
const seats = ['host', 'guest'].map(name => ({
  name, blocked: false, attempts: 0, resumes: 0, active: new Set(),
}));
const open = WebSocket.OPEN;
const transitions = [];
let finish;

async function until(check, label, timeout = 14_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error('Timed out waiting for ' + label);
}

const proxy = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, origin);
    if (path.origin !== origin) { res.writeHead(400).end(); return; }
    if (checkoutClient && path.pathname === '/online-client.mjs') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(checkoutClient);
      return;
    }
    if (path.pathname === '/duel-regions') {
      // Keep private room creation and invite links on this test relay.
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        local: 'test', coordinator: 'test', regions: [{ id: 'test', name: 'Test relay', origin: '' }],
      }));
      return;
    }
    const upstream = await fetch(path, { signal: AbortSignal.timeout(65_000) });
    const headers = {};
    for (const name of ['content-type', 'cache-control']) {
      if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name);
    }
    res.writeHead(upstream.status, headers);
    if (upstream.body) Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    else res.end();
  } catch {
    res.writeHead(502).end();
  }
});

const socketServer = new WebSocketServer({ noServer: true });
proxy.on('upgrade', (request, socket, head) => {
  const name = request.headers.cookie?.match(/(?:^|; *)duel-test-seat=(host|guest)(?:;|$)/)?.[1];
  const seat = seats.find(item => item.name === name);
  if (request.url !== '/duel' || !seat) { socket.destroy(); return; }
  seat.attempts++;
  if (seat.blocked) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }

  const upstream = new WebSocket(target, { origin, handshakeTimeout: 12_000 });
  seat.active.add(upstream);
  upstream.once('close', () => seat.active.delete(upstream));
  upstream.once('error', () => socket.destroy());
  upstream.once('open', () => {
    if (socket.destroyed) { upstream.terminate(); return; }
    socketServer.handleUpgrade(request, socket, head, browser => {
      browser.on('error', () => browser.terminate());
      browser.on('close', () => {
        // Leave the original server connection silent until its own timeout.
        if (!seat.blocked) upstream.terminate();
      });
      upstream.on('close', () => browser.terminate());
      browser.on('message', (data, binary) => {
        if (seat.blocked || upstream.readyState !== open) return;
        const message = JSON.parse(data);
        if (message.type === 'resume') seat.resumes++;
        if (message.type === 'input') seat.inputEpoch = message.epoch;
        upstream.send(data, { binary });
      });
      upstream.on('message', (data, binary) => {
        const message = JSON.parse(data);
        if (message.type === 'joined') seat.room = message.code;
        if (message.type === 'paused' || message.type === 'resumed') transitions.push(message);
        if (message.type === 'state' && !seat.blocked) {
          seat.state = message;
          if (message.ended) finish = message;
        }
        if (!seat.blocked && browser.readyState === open) browser.send(data, { binary });
      });
    });
  });
});

async function launchBrowser(seat, url) {
  const profile = await mkdtemp(join(tmpdir(), 'duel-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--window-size=900,510',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let launchError, debugEndpoint;
  chrome.on('error', error => { launchError = error; });
  chrome.stderr.setEncoding('utf8');
  let stderr = '';
  chrome.stderr.on('data', data => {
    stderr = (stderr + data).slice(-4000);
    debugEndpoint ??= stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
  });
  seat.cleanup = async () => {
    seat.debug?.terminate();
    chrome.kill();
    if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) await once(chrome, 'exit');
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  };
  await until(() => {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null) throw new Error(stderr);
    return debugEndpoint;
  }, seat.name + ' Chrome startup');
  const cdp = new URL(debugEndpoint);
  const tabs = await (await fetch('http://' + cdp.host + '/json/list')).json();
  const debug = seat.debug = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await once(debug, 'open', { signal: AbortSignal.timeout(5000) });
  let id = 0;
  const pending = new Map();
  debug.on('message', data => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const call = async (method, params) => {
    const requestId = ++id;
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Chrome timed out on ' + method)), 12_000);
        pending.set(requestId, { resolve, reject });
        debug.send(JSON.stringify({ id: requestId, method, params }));
      });
    } finally {
      clearTimeout(timeout);
      pending.delete(requestId);
    }
  };
  seat.evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.navigate', { url });
  await until(async () => {
    const ready = await seat.evaluate('Boolean(document.querySelector("[data-ui=create]"))').catch(() => false);
    return ready;
  }, seat.name + ' lobby', 75_000);
  await seat.evaluate('document.cookie = "duel-test-seat=' + seat.name + '; Path=/"');
}

const fighters = state => state.compact ? state.fighters.map(unpackFighter) : state.fighters;
const stats = state => fighters(state).map(({ health, lives }) => [health, lives]);
const active = state => state?.type === 'state' && state.countdown === 0 && !state.ended;
const key = (seat, code, held) => seat.evaluate('keys[' + JSON.stringify(code) + '] = ' + held);

async function interrupt(affected, ms) {
  const before = seats[0].state;
  const attempts = affected.map(seat => seat.attempts);
  const resumeCounts = affected.map(seat => seat.resumes);
  transitions.length = 0;
  for (const seat of affected) seat.blocked = true;
  const restoreAt = performance.now() + ms;
  try {
    await until(() => affected.every((seat, index) => seat.attempts > attempts[index]),
      'automatic reconnect attempts while traffic is interrupted', ms);
  } finally {
    await sleep(Math.max(0, restoreAt - performance.now()));
    for (const seat of affected) seat.blocked = false;
  }
  const resumed = await until(() => transitions.find(message => message.type === 'resumed'),
    'same round to resume');
  const paused = transitions.find(message => message.type === 'paused' && message.epoch === before.epoch);
  assert.ok(paused, 'the server must pause before resuming');
  assert.equal(resumed.epoch, before.epoch + 1);
  assert.equal(resumed.round, before.round);
  assert.equal(resumed.tick, paused.tick);
  assert.equal(resumed.remaining, paused.remaining);
  assert.deepEqual(stats(resumed), stats(paused));
  assert.deepEqual(stats(resumed), stats(before));
  for (const [index, seat] of affected.entries()) assert.ok(seat.resumes > resumeCounts[index]);
  await until(() => seats.every(seat => active(seat.state) && seat.state.epoch === resumed.epoch &&
    seat.inputEpoch === resumed.epoch && seat.state.remaining < resumed.remaining), 'both browsers to continue playing');
  for (const seat of seats) {
    assert.equal(await seat.evaluate('document.body.classList.contains("duel-playing")'), true);
  }
  assert.ok(!transitions.some(message => message.type === 'paused' && message.epoch >= resumed.epoch),
    'a reconnected browser dropped the match again');
  console.log(JSON.stringify({ interrupted: affected.map(seat => seat.name), outageMs: ms,
    round: resumed.round, tick: resumed.tick, remainingTicks: resumed.remaining, healthAndStocks: stats(resumed) }));
}

try {
  console.log('Testing ' + origin + (checkoutClient ? ' with the checkout client' : ' with the deployed client'));
  const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(70_000) });
  assert.equal(await health.text(), 'ok');
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const [host, guest] = seats;
  const url = 'http://127.0.0.1:' + proxy.address().port + '/online';
  await launchBrowser(host, url);
  await host.evaluate('document.querySelector("[data-ui=create]").click()');
  const invite = await until(() => host.evaluate('document.querySelector("#duel-link").value'), 'private invite');
  await launchBrowser(guest, invite);
  await guest.evaluate('document.querySelector("[data-ui=join-form]").requestSubmit()');
  await until(() => seats.every(seat => active(seat.state)), 'the duel countdown');
  const room = host.room;
  await key(host, 'KeyA', true);
  try {
    await until(() => fighters(host.state)[0].lives === 2, 'the first stock loss', 16_000);
  } finally {
    await key(host, 'KeyA', false);
  }
  await until(() => seats.every(seat => active(seat.state) && !fighters(seat.state)[0].out),
    'the host to respawn after losing a stock');
  console.log('Both browsers joined the private duel and saw the first stock loss.');
  await interrupt([guest], 9500);
  await interrupt(seats, 10_000);
  assert.ok(seats.every(seat => seat.room === room));
  await key(host, 'KeyA', true);
  try {
    await until(() => finish && seats.every(seat => seat.state.ended), 'both browsers to see the final ring-out', 30_000);
  } finally {
    await key(host, 'KeyA', false);
  }
  assert.equal(fighters(finish)[0].lives, 0);
  assert.equal(finish.winner, 1);
  for (const seat of seats) {
    assert.deepEqual(stats(seat.state), stats(finish));
    await until(() => seat.evaluate('!document.querySelector("[data-ui=rematch]").hidden'), seat.name + ' results');
  }
  await host.evaluate('document.querySelector("[data-ui=leave]").click()');
  console.log('Both browsers reached the same result after resuming the duel.');
} finally {
  for (const seat of seats) for (const socket of seat.active) socket.terminate();
  for (const socket of socketServer.clients) socket.terminate();
  socketServer.close();
  proxy.close();
  await Promise.all(seats.map(seat => seat.cleanup?.()));
}
