import { STEP, lerpAngle } from './online-sim.mjs';

export const SNAPSHOT_EVERY = 3;
export const MAX_EXTRAPOLATION_TICKS = 4;
export const MAX_INTERPOLATION_TICKS = 11;
const tickMs = STEP * 1000;
const minDelay = SNAPSHOT_EVERY * 2;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const positionKeys = ['x', 'y', 'z'];
const motionKeys = [...positionKeys, 'vx', 'vy', 'vz'];

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

export function opponentPoseAt(snapshots, tick, slot) {
  const nextIndex = snapshots.findIndex(snapshot => snapshot.tick >= tick);
  if (snapshots.length === 1 || nextIndex === 0) return snapshots[0].fighters[slot];
  const next = snapshots[nextIndex < 0 ? snapshots.length - 1 : nextIndex];
  const following = next.fighters[slot];
  if (nextIndex < 0) {
    if (following.out || next.countdown) return following;
    const dt = Math.min(MAX_EXTRAPOLATION_TICKS, tick - next.tick) * STEP;
    return { ...following, x: following.x + following.vx * dt, z: following.z + following.vz * dt,
      y: following.grounded ? following.y : following.y + following.vy * dt };
  }
  const old = snapshots[nextIndex - 1];
  const previous = old.fighters[slot];
  if (tick === next.tick) return following;
  if (previous.life !== following.life || Boolean(previous.out) !== Boolean(following.out)) return previous;
  const alpha = (tick - old.tick) / (next.tick - old.tick);
  const mixed = { ...previous };
  for (const key of motionKeys) {
    mixed[key] = previous[key] + (following[key] - previous[key]) * alpha;
  }
  if (previous.attack && previous.attack === following.attack && following.attackAge >= previous.attackAge) {
    mixed.attackAge = previous.attackAge + (following.attackAge - previous.attackAge) * alpha;
  }
  mixed.facing = lerpAngle(previous.facing, following.facing, alpha);
  return mixed;
}

// A new snapshot can revise the path even if the clock is still extrapolating.
// Compare both paths at the same displayed tick so ordinary movement is preserved.
export function opponentCorrection(previous, snapshots, slot, current) {
  const latestTick = snapshots.at(-1).tick;
  if (previous.tick <= previous.latestTick || latestTick <= previous.latestTick) return null;
  const revised = opponentPoseAt(snapshots, previous.tick, slot);
  if (previous.pose.life !== current.life || revised.life !== current.life ||
      Boolean(previous.pose.out) !== Boolean(current.out) || Boolean(revised.out) !== Boolean(current.out)) return null;
  return positionKeys.map(key => clamp(previous.pose[key] - revised[key], -1.5, 1.5));
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
