import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_EXTRAPOLATION_TICKS, MAX_INTERPOLATION_TICKS, OpponentClock, opponentCorrection, opponentPoseAt,
  packFighter, unpackFighter,
} from '../public/online-net.mjs';
import { createFighter, STEP, stepFighter } from '../public/online-sim.mjs';

test('bursts of late snapshots do not keep stopping the opponent render clock', () => {
  const tickMs = STEP * 1000;
  const jitter = [0, 15, 2, 0, 90, 16, 8, 0, 4, 63, 7, 26, 1, 0, 10, 2];
  const arrivals = [];
  for (let tick = 0; tick < 360; tick += 3) {
    const arrival = 120 + tick * tickMs + jitter[tick / 3 % jitter.length];
    arrivals.push({ tick, at: Math.max(arrival, arrivals.at(-1)?.at ?? 0) });
  }
  const clock = new OpponentClock();
  let index = 0;
  let latest;
  let previous = 0;
  for (let now = 120; now < 6100; now += tickMs) {
    while (arrivals[index]?.at <= now) {
      latest = arrivals[index++];
      clock.sample(latest.tick, latest.at);
    }
    if (!latest) continue;
    const shown = clock.advance(now);
    assert.ok(shown <= latest.tick + MAX_EXTRAPOLATION_TICKS);
    if (now > 900) assert.ok(shown - previous > .05, 'opponent presentation stopped between ordinary bursts');
    previous = shown;
  }
  // When updates really stop, hold at the prediction limit.
  for (let now = 6100; now <= 6600; now += tickMs) clock.advance(now);
  assert.equal(clock.tick, latest.tick + MAX_EXTRAPOLATION_TICKS);
});

test('compact snapshots preserve every fighter field for input replay', () => {
  const fighter = createFighter(0);
  const rival = createFighter(1);
  for (let tick = 0; tick < 15; tick++) {
    stepFighter(fighter, { x: .69, z: -.2, buttons: tick === 2 ? 1 : 0 }, rival);
  }
  const verbose = JSON.stringify(fighter);
  const compact = JSON.stringify(packFighter(fighter));
  assert.deepEqual(unpackFighter(JSON.parse(compact)), fighter);
  assert.ok(compact.length < verbose.length * .5);
});

test('the opponent clock catches up after a long burst without skipping ahead', () => {
  const clock = new OpponentClock();
  const tickMs = STEP * 1000;
  const releasedAt = 180 * tickMs + 800;
  let shown = 0;
  let nextTick = 0;
  let recoveredAt;
  for (let step = 0; step <= 300; step++) {
    const now = step * tickMs;
    while (nextTick * tickMs <= now && (nextTick < 180 || now >= releasedAt)) {
      clock.sample(nextTick, Math.max(nextTick * tickMs, nextTick >= 180 ? releasedAt : 0));
      nextTick += 3;
    }
    const next = clock.advance(now);
    assert.ok(next >= shown && next - shown <= 2.01, 'presentation must advance smoothly');
    assert.ok(next <= clock.latestTick + MAX_EXTRAPOLATION_TICKS);
    shown = next;
    const target = step - clock.anchor - clock.delay;
    if (now >= releasedAt && recoveredAt === undefined && target - shown <= 3) recoveredAt = now;
  }
  assert.ok(recoveredAt - releasedAt < 1000, 'opponent stayed behind after the burst');
});

test('a late direction change is blended even when both frames extrapolate', () => {
  const fighter = createFighter(0);
  const snapshot = (tick, x, vx, life = 0) => ({ tick, fighters: [{ ...fighter, x, vx, life }] });
  const before = [snapshot(97, .35, 13), snapshot(100, 1, 13)];
  const previous = { tick: 104, latestTick: 100, pose: opponentPoseAt(before, 104, 0) };
  const after = [...before, snapshot(103, 1.65, -13)];
  const current = opponentPoseAt(after, 105, 0);
  const correction = opponentCorrection(previous, after, 0, current);
  const shownAtPreviousTick = opponentPoseAt(after, 104, 0).x + correction[0];
  assert.ok(Math.abs(shownAtPreviousTick - previous.pose.x) < 1e-9);
  assert.ok(Math.abs(current.x - previous.pose.x) > .4);
  assert.ok(Math.abs(current.x + correction[0] - previous.pose.x + 13 * STEP) < 1e-9);
  assert.equal(opponentCorrection(previous, before, 0, current), null);
  const respawn = [...before, snapshot(103, -5, 0, 1)];
  assert.equal(opponentCorrection(previous, respawn, 0, opponentPoseAt(respawn, 105, 0)), null);
});

test('the opponent clock skips obsolete replay after a multi-second backlog', () => {
  const clock = new OpponentClock();
  const tickMs = STEP * 1000;
  for (let tick = 0; tick <= 60; tick += 3) {
    clock.sample(tick, tick * tickMs);
    clock.advance(tick * tickMs);
  }
  const recoveredAt = 240 * tickMs;
  clock.advance(recoveredAt);
  for (let tick = 63; tick <= 240; tick += 3) clock.sample(tick, recoveredAt);
  const displayed = clock.advance(recoveredAt + tickMs);
  assert.equal(clock.resynced, true);
  assert.ok(displayed >= 240 - MAX_INTERPOLATION_TICKS && displayed <= 240,
    'the display should return to the current buffer immediately');
});
