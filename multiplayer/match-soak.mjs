import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { unpackFighter } from '../public/online-net.mjs';
import { ATTACK, HEALTH, LIVES, MATCH_TICKS, QUICK, TICK_RATE } from '../public/online-sim.mjs';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:8788').origin;
const endpoint = new URL('/duel', origin);
endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
const compactSnapshots = true;
const profiles = ['baseline', 'spikes', 'reconnect'];

function log(profile, message) {
  console.log(`[${profile}] ${message}`);
}

async function waitFor(check, description, timeout = 12_000) {
  const deadline = performance.now() + timeout;
  do {
    const result = check();
    if (result) return result;
    await sleep(45);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

// Preserve ordering so a delayed message holds up the packets behind it,
// like a burst of jitter on a WebSocket connection.
function orderedDelivery(delayFor) {
  let due = 0;
  const timers = new Set();
  return {
    send(deliver, message) {
      const now = performance.now();
      due = Math.max(due, now + delayFor(message, now));
      if (due <= now && timers.size === 0) {
        deliver();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        deliver();
      }, Math.ceil(due - now));
      timers.add(timer);
    },
    clear() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      due = 0;
    },
  };
}

function spikes(profile, startedAt, direction) {
  if (profile !== 'spikes') return () => 0;
  let index = 0;
  return (message, now) => {
    const elapsed = now - startedAt;
    if (elapsed < 6000) return 0;
    if (direction === 'up') return 95;
    const phase = (elapsed - 6000) % 27_000;
    if (phase >= 13_000 && phase < 13_550) return 650 - (phase - 13_000);
    const jitter = message.type === 'state' ? [0, 15, 90, 3, 70, 0, 8][index++ % 7] : 0;
    return 95 + jitter;
  };
}

class Seat {
  constructor(profile, slot, startedAt) {
    this.slot = slot;
    this.incoming = orderedDelivery(spikes(profile, startedAt, 'down'));
    this.outgoing = orderedDelivery(spikes(profile, startedAt, 'up'));
    this.pings = [];
    this.gaps = [];
    this.hits = [];
    this.unexpectedCloses = [];
    this.recoveries = 0;
    this.pauseCount = 0;
    this.seq = 0;
    this.plan = [];
  }

  async connect(request, timeout = 12_000) {
    this.joined = null;
    this.snapshot = null;
    this.serverNotice = null;
    const ws = this.ws = new WebSocket(endpoint, { origin, handshakeTimeout: Math.min(8000, timeout) });
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      this.incoming.send(() => {
        if (ws !== this.ws || ws.readyState !== WebSocket.OPEN) return;
        this.receive(message);
      }, message);
    });
    ws.on('error', error => { this.socketError = error.message; });
    ws.on('close', code => {
      if (ws !== this.ws) return;
      this.incoming.clear();
      this.outgoing.clear();
      if (this.expectedClose || !this.snapshot || this.snapshot.ended || this.recovery) return;
      this.unexpectedCloses.push(code);
      this.recovery = this.recover()
        .catch(error => { this.recoveryError = error; })
        .finally(() => { this.recovery = null; });
    });
    await once(ws, 'open');
    this.send({ ...request, compactSnapshots });
    const reply = await waitFor(() => {
      if (this.serverNotice) throw new Error(this.serverNotice);
      return this.joined;
    }, `seat ${this.slot} to join`, timeout);
    assert.equal(reply.slot, this.slot);
    this.ticket = { code: reply.code, resumeToken: reply.resumeToken };
  }

  async recover() {
    const deadline = performance.now() + 20_000;
    let backoff = 500;
    let lastError;
    while (!this.expectedClose && performance.now() + backoff < deadline) {
      await sleep(backoff);
      if (this.expectedClose) return;
      try {
        await this.connect({ type: 'resume', ...this.ticket }, Math.min(8000, deadline - performance.now()));
        assert.ok(this.joined.inMatch, 'seat did not return to the active match');
        this.recoveries++;
        return;
      } catch (error) {
        lastError = error;
        this.ws?.terminate();
        if (this.serverNotice) break;
      }
      backoff = Math.min(4000, backoff * 2);
    }
    throw new Error(`Seat ${this.slot} did not recover: ${lastError?.message ?? 'retry window elapsed'}`);
  }

  receive(message) {
    this.lastServerAt = performance.now();
    if (message.type === 'joined') this.joined = message;
    if (message.type === 'pong') this.pings.push(performance.now() - message.sent);
    if (message.type === 'error' || message.type === 'left') this.serverNotice = message.reason;
    if (message.type === 'paused') {
      this.frozen = message;
      this.pauseCount++;
    }
    if (!['start', 'paused', 'resumed', 'state'].includes(message.type)) return;
    if (message.compact) message.fighters = message.fighters.map(unpackFighter);
    if (message.type === 'start' || message.type === 'resumed') {
      this.seq = 0;
      this.plan.length = 0;
      this.lastUpdateAt = undefined;
    }
    if (message.type === 'resumed') this.resumed = message;
    if (message.type === 'state' && !message.countdown) {
      const now = performance.now();
      if (this.lastUpdateAt !== undefined) this.gaps.push(now - this.lastUpdateAt);
      this.lastUpdateAt = now;
    }
    for (const event of message.events) {
      if (event.type === 'hit') this.hits.push({ ...event, round: message.round });
    }
    this.snapshot = message;
  }

  send(message) {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    this.outgoing.send(() => {
      if (ws === this.ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }, message);
  }

  input() {
    const state = this.snapshot;
    if (state && !state.ended && this.ws?.readyState === WebSocket.OPEN && performance.now() - this.lastServerAt > 5000) {
      this.ws.terminate();
      return;
    }
    if (!state || state.type === 'paused' || state.countdown || state.ended || this.ws?.readyState !== WebSocket.OPEN) return;
    const frames = Array.from({ length: 2 }, () => {
      const [x, buttons] = this.plan.shift() ?? [0, 0];
      return [++this.seq, x, 0, buttons];
    });
    this.send({ type: 'input', round: state.round, epoch: state.epoch, frames });
  }

  async playFrames(frames) {
    const lastSeq = this.seq + frames.length;
    this.plan.push(...frames);
    await waitFor(() => this.snapshot?.ack >= lastSeq, `seat ${this.slot} input acknowledgement`, 8000);
  }

  async disconnect() {
    this.expectedClose = true;
    const closed = once(this.ws, 'close');
    this.ws.terminate();
    await closed;
    this.expectedClose = false;
  }

  close() {
    this.expectedClose = true;
    this.incoming.clear();
    this.outgoing.clear();
    this.ws?.terminate();
  }
}

function current(seats, round, condition) {
  for (const seat of seats) {
    if (seat.recoveryError) throw seat.recoveryError;
    if (seat.serverNotice && !seat.joined?.inMatch) throw new Error(seat.serverNotice);
  }
  const states = seats.map(seat => seat.snapshot);
  return states.every(s => s?.round === round && condition(s)) && states;
}

async function approach(host) {
  await host.playFrames(Array.from({ length: 36 }, () => [1, 0]));
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitFor(() => Math.abs(host.snapshot.fighters[0].vx) < .6, 'host to stop moving');
    const x = host.snapshot.fighters[0].x;
    if (x >= 2.4 && x <= 4) return;
    const direction = Math.sign(3.1 - x);
    const count = Math.min(18, Math.max(4, Math.ceil(Math.abs(3.1 - x) * TICK_RATE / 13)));
    await host.playFrames(Array.from({ length: count }, () => [direction, 0]));
  }
  throw new Error('Could not reach melee range');
}

async function singleHit(seats, round) {
  const [host] = seats;
  await approach(host);
  await host.playFrames([[1, QUICK], [0, 0]]);
  const health = HEALTH - ATTACK.quick.damage;
  const hit = await waitFor(() => current(seats, round, state => state.fighters[1].health === health), 'both views to confirm one hit');
  const after = hit[0].tick + 30;
  await waitFor(() => current(seats, round, state => state.tick >= after), 'combat to settle');
  for (const seat of seats) {
    assert.equal(seat.snapshot.fighters[1].health, health);
    const events = seat.hits.filter(event => event.round === round);
    assert.equal(events.length, 1, 'one swing must produce one hit event per seat');
    assert.equal(events[0].slot, 1);
  }
}

async function reconnect(seats, profile) {
  const [host, guest] = seats;
  await waitFor(() => host.snapshot?.remaining <= MATCH_TICKS - 60 * TICK_RATE, 'one minute of active play', 82_000);
  await guest.disconnect();
  const epoch = host.snapshot.epoch;
  const frozen = await waitFor(() => host.frozen?.epoch >= epoch && host.frozen, 'server pause after link loss', 13_000);
  await sleep(2000);
  assert.equal(host.snapshot.tick, frozen.tick);
  assert.equal(host.snapshot.remaining, frozen.remaining);
  await guest.connect({ type: 'resume', ...guest.ticket });
  await waitFor(() => seats.every(seat => seat.resumed?.epoch > frozen.epoch), 'both views to receive resume');
  for (const seat of seats) {
    assert.equal(seat.resumed.round, frozen.round);
    assert.equal(seat.resumed.epoch, frozen.epoch + 1);
    assert.equal(seat.resumed.tick, frozen.tick);
    assert.equal(seat.resumed.remaining, frozen.remaining);
    assert.deepEqual(seat.resumed.fighters, frozen.fighters);
  }
  log(profile, `resumed round ${frozen.round} with both fighters and the clock intact`);

  const [before] = await waitFor(() => current(seats, frozen.round, state =>
    state.type === 'state' && !state.countdown), 'the resumed countdown');
  await Promise.all(seats.map(seat => seat.disconnect()));
  await sleep(2200);
  await Promise.all(seats.map(seat => seat.connect({ type: 'resume', ...seat.ticket })));
  await waitFor(() => seats.every(seat => seat.resumed?.epoch > before.epoch), 'both disconnected seats to return');
  assert.equal(host.resumed.tick, guest.resumed.tick);
  assert.equal(host.resumed.remaining, guest.resumed.remaining);
  assert.deepEqual(host.resumed.fighters, guest.resumed.fighters);
  assert.deepEqual(host.resumed.fighters.map(f => [f.health, f.lives]), before.fighters.map(f => [f.health, f.lives]));
  log(profile, 'both seats returned after a simultaneous disconnect');
}

async function result(seats, round, expectedWinner, timeout) {
  const [a, b] = await waitFor(() => current(seats, round, s => s.ended), `round ${round} results`, timeout);
  assert.equal(a.winner, expectedWinner);
  assert.equal(b.winner, expectedWinner);
  assert.equal(a.tick, b.tick);
  assert.equal(a.remaining, b.remaining);
  assert.deepEqual(a.fighters, b.fighters);
  return a;
}

async function rematch(seats, round) {
  const [host, guest] = seats;
  host.send({ type: 'rematch' });
  await sleep(650);
  assert.equal(host.snapshot.round, round - 1, 'one ready player cannot start a rematch');
  guest.send({ type: 'rematch' });
  const states = await waitFor(() => current(seats, round, s => s.countdown > 0), `round ${round} countdown`);
  for (const state of states) {
    assert.equal(state.epoch, 0);
    assert.equal(state.remaining, MATCH_TICKS);
    assert.equal(state.ack, 0);
    assert.ok(state.fighters.every(fighter => fighter.health === HEALTH && fighter.lives === LIVES));
  }
  await waitFor(() => current(seats, round, s => !s.countdown), `round ${round} to start`);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * p) - 1]);
}

async function run(profile) {
  const startedAt = performance.now();
  const host = new Seat('baseline', 0, startedAt);
  const guest = new Seat(profile, 1, startedAt);
  const seats = [host, guest];
  let inputs, pings, progress;
  try {
    await host.connect({ type: 'create' });
    await guest.connect({ type: 'join', code: host.ticket.code });
    await waitFor(() => current(seats, 1, s => s.compact && !s.countdown), 'the first countdown');
    inputs = setInterval(() => seats.forEach(seat => seat.input()), 1000 / 30);
    pings = setInterval(() => seats.forEach(seat => seat.send({ type: 'ping', sent: performance.now() })), 2000);
    progress = setInterval(() => {
      const state = host.snapshot;
      if (state) log(profile, `round ${state.round}, ${Math.ceil(state.remaining / TICK_RATE)}s remaining`);
    }, 30_000);
    await singleHit(seats, 1);
    log(profile, 'both players confirmed one quick hit');
    if (profile === 'reconnect') await reconnect(seats, profile);

    const timed = await result(seats, 1, 0, 215_000);
    assert.equal(timed.remaining, 0, 'first round must play out the full clock');
    assert.ok(timed.fighters.every(f => f.lives === LIVES));
    log(profile, 'completed the full three-minute duel and agreed on the winner');

    await rematch(seats, 2);
    // Walk the guest off the arena until the server records a stock win.
    const forceOut = setInterval(() => {
      if (guest.plan.length < 2) guest.plan.push([1, 0], [1, 0]);
    }, 12);
    try {
      const decisive = await result(seats, 2, 0, 32_000);
      assert.equal(decisive.fighters[1].lives, 0);
      assert.ok(decisive.remaining > 0);
    } finally {
      clearInterval(forceOut);
      guest.plan.length = 0;
    }
    await rematch(seats, 3);
    for (const seat of seats) assert.equal(seat.unexpectedCloses.length, seat.recoveries);
    const stats = {
      profile, fullMatches: 1, rematchesStarted: 2, rematchesCompleted: 1,
      forcedDropScenarios: profile === 'reconnect' ? 2 : 0,
      automaticSeatRecoveries: seats.reduce((total, seat) => total + seat.recoveries, 0),
      unrecoveredDrops: 0,
      guestPingP50Ms: percentile(guest.pings, .5), guestPingP95Ms: percentile(guest.pings, .95),
      guestUpdateGapP95Ms: percentile(guest.gaps, .95), guestMaxUpdateGapMs: percentile(guest.gaps, 1),
      guestGapsAbove450Ms: guest.gaps.filter(gap => gap > 450).length,
    };
    log(profile, JSON.stringify(stats));
  } finally {
    clearInterval(inputs);
    clearInterval(pings);
    clearInterval(progress);
    seats.forEach(seat => { seat.expectedClose = true; });
    host.send({ type: 'leave' });
    await sleep(400);
    seats.forEach(seat => seat.close());
  }
}

const health = await fetch(origin + '/health', { signal: AbortSignal.timeout(70_000) });
assert.equal(health.status, 200);
assert.equal(await health.text(), 'ok');
console.log(`Testing three private rooms at ${origin}`);
const results = await Promise.allSettled(profiles.map(run));
for (const [index, result] of results.entries()) {
  if (result.status === 'rejected') {
    process.exitCode = 1;
    console.error(`[${profiles[index]}] FAILED: ${result.reason.message}`);
  }
}
