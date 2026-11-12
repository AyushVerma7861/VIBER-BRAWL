import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACK, DASH, HEALTH, HEAVY, MAX_REWIND_TICKS, NONE, QUICK, STEP, createDuel, stepDuel } from '../public/online-sim.mjs';
import { rewindForView } from './lag-compensation.mjs';

const tickMs = STEP * 1000;
const oneWay = rttMs => Math.ceil(rttMs / (2 * tickMs));

function playSwing({ type, button, attackerSlot, attackRtt, defenderRtt, lead, staleView }) {
  const match = createDuel();
  match.countdown = 0;
  const move = ATTACK[type];
  const defenderSlot = 1 - attackerSlot;
  const direction = attackerSlot === 0 ? 1 : -1;
  const attacker = match.fighters[attackerSlot];
  const defender = match.fighters[defenderSlot];
  Object.assign(attacker, { x: 0, facing: direction * Math.PI / 2 });
  defender.x = direction * (move.range - .45);
  const attackAt = 35;
  const contactAt = attackAt + move.startup;
  const attackPress = attackAt - oneWay(attackRtt);
  const defenderPress = contactAt - lead - oneWay(defenderRtt);
  const renderDelay = attackRtt >= 220 ? 9 : 6;
  const viewTick = staleView ? attackAt - 31 : attackPress - oneWay(attackRtt) - renderDelay;
  const hits = [];
  for (let tick = 1; tick <= contactAt + move.active + move.recovery; tick++) {
    const inputs = [NONE, NONE];
    if (tick === attackPress + oneWay(attackRtt)) {
      inputs[attackerSlot] = { ...NONE, buttons: button, rewind: rewindForView(viewTick, tick, attackRtt) };
    }
    if (lead && tick === defenderPress + oneWay(defenderRtt)) {
      inputs[defenderSlot] = { x: direction, z: 0, buttons: DASH };
    }
    hits.push(...stepDuel(match, inputs).filter(event => event.type === 'hit'));
  }
  return { hits, damage: HEALTH - defender.health };
}

test('both seats get the same melee rules when 60 ms plays against 180–250 ms', () => {
  for (const [type, button] of [['quick', QUICK], ['heavy', HEAVY]]) {
    for (const slow of [180, 220, 250]) {
      for (const [attackRtt, defenderRtt] of [[60, slow], [slow, 60]]) {
        for (const attackerSlot of [0, 1]) {
          for (const [lead, staleView, count] of [[0, false, 1], [2, false, 1], [7, false, 0], [2, true, 0]]) {
            const scenario = { type, button, attackerSlot, attackRtt, defenderRtt, lead, staleView };
            const { hits, damage } = playSwing(scenario);
            assert.equal(hits.length, count, JSON.stringify(scenario));
            assert.equal(damage, count * ATTACK[type].damage);
            if (hits.length) assert.ok(hits[0].rewind <= MAX_REWIND_TICKS);
            if (lead === 2 && count) assert.ok(hits[0].rewind > 0);
          }
        }
      }
    }
  }
});
