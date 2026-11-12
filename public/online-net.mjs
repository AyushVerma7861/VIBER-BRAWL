import { STEP } from './online-sim.mjs';

export const SNAPSHOT_EVERY = 3;
export const MAX_EXTRAPOLATION_TICKS = 4;
export const MAX_INTERPOLATION_TICKS = 11;
const tickMs = STEP * 1000;
const minDelay = SNAPSHOT_EVERY * 2;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Move at a steady rate between snapshots. Late packets change the target
// delay, without resetting the displayed tick to each packet's arrival time.
export class OpponentClock {
  constructor() {
    this.arrivals = [];
    this.delay = minDelay;
  }

  sample(tick, now) {
    const arrival = now / tickMs - tick;
    this.arrivals.push(arrival);
    if (this.arrivals.length > 36) this.arrivals.shift();
    const sorted = [...this.arrivals].sort((a, b) => a - b);
    this.anchor = sorted[Math.floor((sorted.length - 1) * .1)];
    const late = sorted[Math.ceil(sorted.length * .9) - 1] - this.anchor;
    const targetDelay = clamp(minDelay + late, minDelay, MAX_INTERPOLATION_TICKS);
    this.delay += (targetDelay - this.delay) * (targetDelay > this.delay ? .35 : .04);
    this.latestTick = tick;
    if (this.tick === undefined) {
      this.tick = tick;
      this.frameAt = now;
    }
  }

  advance(now) {
    const elapsed = clamp((now - this.frameAt) / tickMs, 0, 3);
    this.frameAt = now;
    const target = now / tickMs - this.anchor - this.delay;
    const drift = target - (this.tick + elapsed);
    const speed = 1 + clamp(drift / 14, -.24, .4);
    this.tick = Math.min(this.latestTick + MAX_EXTRAPOLATION_TICKS, this.tick + elapsed * speed);
    return this.tick;
  }
}

const fighterFields = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'facing', 'grounded', 'coyote', 'jumps',
  'health', 'lives', 'life', 'invulnerable', 'stun', 'dashCooldown', 'dashTicks',
  'lock', 'attack', 'attackAge', 'hit', 'out', 'queuedAttack', 'attackBuffer',
  'jumpBuffer', 'dashBuffer', 'queuedRewind', 'attackRewind',
];

export function packFighter(fighter) {
  return fighterFields.map(field => fighter[field]);
}

export function unpackFighter(values) {
  const fighter = {};
  for (const [index, field] of fighterFields.entries()) fighter[field] = values[index];
  return fighter;
}
