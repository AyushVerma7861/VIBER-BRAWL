import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_EXTRAPOLATION_TICKS, OpponentClock, packFighter, unpackFighter } from '../public/online-net.mjs';
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
