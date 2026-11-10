import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK, DASH, HEAVY, JUMP, MAX_REWIND_TICKS, QUICK, NONE, createDuel, createFighter, stepDuel, stepFighter } from '../public/online-sim.mjs';

const forward = { x: 1, z: 0, buttons: 0 };

test('prediction reproduces server movement through a jump and dash', () => {
  const match = createDuel();
  match.countdown = 0;
  const local = createFighter(0);
  for (let tick = 0; tick < 110; tick++) {
    const input = { ...forward, x: tick < 45 ? 1 : 0, buttons: tick === 10 || tick === 23 ? JUMP : tick === 33 ? DASH : 0 };
    stepFighter(local, input);
    stepDuel(match, [input, NONE]);
    assert.deepEqual(local, match.fighters[0]);
  }
  assert.ok(local.x > 3);
  assert.equal(local.y, 0);
});

test('quick and heavy hits apply once in the active window', () => {
  for (const [type, button] of [['quick', QUICK], ['heavy', HEAVY]]) {
    const match = createDuel();
    const [a, b] = match.fighters;
    match.countdown = 0;
    a.x = -1;
    b.x = 1;
    assert.deepEqual(stepDuel(match, [{ ...forward, buttons: button }, NONE]), []);
    for (let tick = 1; tick < ATTACK[type].startup; tick++) {
      assert.deepEqual(stepDuel(match, [NONE, NONE]), []);
      assert.equal(b.health, 100);
    }
    assert.equal(stepDuel(match, [NONE, NONE])[0].type, 'hit');
    assert.equal(b.health, 100 - ATTACK[type].damage);
    assert.ok(b.vx > 0);
    for (let tick = 0; tick < 30; tick++) assert.deepEqual(stepDuel(match, [NONE, NONE]), []);
    assert.equal(b.health, 100 - ATTACK[type].damage);
  }
});

test('rewind saves a close late dodge but respects earlier escapes and protection', () => {
  for (const [type, button] of [['quick', QUICK], ['heavy', HEAVY]]) {
    const move = ATTACK[type];
    const start = 16, active = start + move.startup;
    for (const { dashLead, rewind, protectedAtView, expected } of [
      { dashLead: 2, rewind: 0, expected: 0 },
      { dashLead: 2, rewind: MAX_REWIND_TICKS, expected: 1 },
      { dashLead: 7, rewind: MAX_REWIND_TICKS, expected: 0 },
      { dashLead: 2, rewind: MAX_REWIND_TICKS + 1, expected: 0 },
      { dashLead: 2, rewind: MAX_REWIND_TICKS, protectedAtView: true, expected: 0 },
    ]) {
      const match = createDuel();
      match.countdown = 0;
      const [a, b] = match.fighters;
      a.x = 0;
      b.x = move.range - .45;
      if (protectedAtView) b.invulnerable = active - 1;
      const hits = [];
      for (let tick = 1; tick < active + move.active; tick++) {
        const attack = tick === start ? { ...NONE, buttons: button, rewind } : NONE;
        const dodge = tick === active - dashLead ? { ...forward, buttons: DASH } : NONE;
        hits.push(...stepDuel(match, [attack, dodge]).filter(event => event.type === 'hit'));
      }
      assert.equal(hits.length, expected, JSON.stringify({ type, dashLead, rewind, protectedAtView }));
      assert.equal(b.health, 100 - expected * move.damage);
      if (expected) assert.equal(hits[0].rewind, rewind);
    }
  }
});

test('two same-tick contacts trade regardless of slot order', () => {
  const match = createDuel();
  const [a, b] = match.fighters;
  match.countdown = 0;
  a.x = -1;
  b.x = 1;
  stepDuel(match, [{ ...forward, buttons: QUICK }, { x: -1, z: 0, buttons: QUICK }]);
  for (let tick = 0; tick < ATTACK.quick.startup; tick++) stepDuel(match, [NONE, NONE]);
  assert.equal(a.health, 92);
  assert.equal(b.health, 92);
  assert.equal(a.attack, null);
  assert.equal(b.attack, null);
});

test('leaving the arena consumes exactly one stock, then respawns away from the opponent', () => {
  const match = createDuel();
  const [a, b] = match.fighters;
  match.countdown = 0;
  Object.assign(a, { x: 28, y: -39 });
  assert.equal(stepDuel(match, [NONE, NONE])[0].type, 'fall');
  assert.equal(a.lives, 2);
  for (let tick = 0; tick < 48; tick++) stepDuel(match, [NONE, NONE]);
  assert.equal(a.lives, 2);
  assert.equal(a.life, 1);
  assert.equal(a.health, 100);
  assert.ok(a.invulnerable > 0);
  assert.ok(Math.abs(a.x - b.x) >= 10);
  Object.assign(a, { lives: 1, x: 28, y: -39 });
  stepDuel(match, [NONE, NONE]);
  assert.equal(match.winner, 1);
  assert.equal(match.ended, true);
  const finalTick = match.tick;
  stepDuel(match, [NONE, NONE]);
  assert.equal(match.tick, finalTick);
});
