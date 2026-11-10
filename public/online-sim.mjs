export const TICK_RATE = 60;
export const STEP = 1 / TICK_RATE;
export const LIVES = 3;
export const HEALTH = 100;
export const MATCH_TICKS = 180 * TICK_RATE;
export const COUNTDOWN = 3 * TICK_RATE;
export const NONE = Object.freeze({ x: 0, z: 0, buttons: 0 });
export const JUMP = 1, DASH = 2, QUICK = 4, HEAVY = 8;
export const ATTACK = {
  quick: { startup: 5, active: 6, recovery: 10, damage: 8, range: 3.35, arc: 1.15, force: 10.5, lift: .38, stun: 14 },
  heavy: { startup: 13, active: 8, recovery: 22, damage: 16, range: 3.95, arc: .95, force: 20, lift: .52, stun: 24 },
};
export const ROOM_CODE = /^[A-Za-z0-9_-]{12}$/;
const TAU = 2 * Math.PI;
const SPAWNS = [[-5, 0], [5, 0]];
// Collision surfaces from the original Dungeon's buildArena().
export const PLATFORMS = [
  [0, 0, 34, 34, 0],
  [-14, -14, 11, 11, 3.5],
  [14, -14, 10, 10, 3.6],
  [-14, 14, 10.5, 10.5, 3.5],
  [14, 14, 9.5, 9.5, 4.5],
  [0, -19, 7, 7, 3.5],
  [0, 19, 7, 7, 3.5],
].map(([x, z, width, depth, top]) => ({
  minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, top,
}));

export function lerpAngle(a, b, fraction) {
  const delta = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return Math.atan2(Math.sin(a + delta * fraction), Math.cos(a + delta * fraction));
}

function groundAt(x, z, y) {
  let top = -Infinity;
  for (const platform of PLATFORMS) {
    if (x > platform.minX && x < platform.maxX && z > platform.minZ && z < platform.maxZ &&
        platform.top <= y + .61) top = Math.max(top, platform.top);
  }
  return top;
}

export function createFighter(slot, lives = LIVES, life = 0, spawn = slot) {
  const [x, z] = SPAWNS[spawn];
  return {
    x, y: 0, z, vx: 0, vy: 0, vz: 0, facing: Math.atan2(-x, -z),
    grounded: true, coyote: 7, jumps: 2, health: HEALTH, lives, life,
    invulnerable: life === 0 ? 0 : 72, stun: 0, dashCooldown: 0, dashTicks: 0,
    lock: 0, attack: null, attackAge: 0, hit: false, out: 0,
    queuedAttack: null, attackBuffer: 0, jumpBuffer: 0, dashBuffer: 0,
  };
}

export function createDuel() {
  return { tick: 0, countdown: COUNTDOWN, remaining: MATCH_TICKS, fighters: [createFighter(0), createFighter(1)], winner: null, ended: false };
}

// Runs on both the server and the controlling browser. Effects play separately.
export function stepFighter(fighter, input, rival) {
  const f = fighter;
  if (f.out || !f.lives) return 0;
  f.invulnerable = Math.max(0, f.invulnerable - 1);
  f.stun = Math.max(0, f.stun - 1);
  f.lock = Math.max(0, f.lock - 1);
  f.dashCooldown = Math.max(0, f.dashCooldown - 1);
  f.dashTicks = Math.max(0, f.dashTicks - 1);
  f.jumpBuffer = input.buttons & JUMP ? 6 : Math.max(0, f.jumpBuffer - 1);
  f.dashBuffer = input.buttons & DASH ? 6 : Math.max(0, f.dashBuffer - 1);
  const requestedAttack = input.buttons & QUICK ? 'quick' : input.buttons & HEAVY ? 'heavy' : null;
  if (requestedAttack) f.queuedAttack = requestedAttack;
  f.attackBuffer = requestedAttack ? 6 : Math.max(0, f.attackBuffer - 1);
  if (f.attack) {
    const move = ATTACK[f.attack];
    if (++f.attackAge >= move.startup + move.active + move.recovery) f.attack = null;
  }

  const canAct = !f.stun && !f.attack;
  const length = Math.hypot(input.x, input.z);
  const x = length > .01 ? input.x / length : 0;
  const z = length > .01 ? input.z / length : 0;
  if (length > .01 && canAct && !f.lock && !f.dashTicks) {
    f.facing = lerpAngle(f.facing, Math.atan2(x, z), 1 - Math.exp(-18 * STEP));
  }
  const damping = f.grounded ? (f.lock ? 5 : 16) : (f.lock ? .7 : 2.4);
  const drag = Math.exp(-damping * STEP);
  f.vx = f.vx * drag + (canAct ? x * 13 : 0) * (1 - drag);
  f.vz = f.vz * drag + (canAct ? z * 13 : 0) * (1 - drag);

  let actions = 0;
  if (canAct && !f.lock) {
    if (f.dashBuffer && !f.dashCooldown) {
      if (length > .01) f.facing = Math.atan2(x, z);
      f.vx = Math.sin(f.facing) * 24;
      f.vz = Math.cos(f.facing) * 24;
      if (!f.grounded) f.vy = Math.max(f.vy, 1.5);
      f.dashTicks = 13;
      f.dashCooldown = 63;
      f.lock = 10;
      f.dashBuffer = 0;
      actions |= DASH;
    } else {
      if (f.jumpBuffer && (f.grounded || f.coyote || f.jumps > 0)) {
        const firstJump = f.grounded || f.coyote;
        f.vy = firstJump ? 17.6 : 17.6 * .92;
        f.jumps = firstJump ? 1 : f.jumps - 1;
        f.grounded = false;
        f.coyote = 0;
        if (!firstJump) { f.vx *= .75; f.vz *= .75; }
        f.jumpBuffer = 0;
        actions |= JUMP;
      }
      if (f.attackBuffer) {
        if (length > .01) f.facing = Math.atan2(x, z);
        if (rival && !rival.out && Math.abs(rival.y - f.y) <= 2.1) {
          const dx = rival.x - f.x, dz = rival.z - f.z;
          const distance = Math.hypot(dx, dz);
          const forward = dx * Math.sin(f.facing) + dz * Math.cos(f.facing);
          if (distance > .01 && distance <= 4.6 && forward / distance >= .4) {
            f.facing = Math.atan2(dx, dz);
          }
        }
        f.attack = f.queuedAttack;
        f.attackAge = 0;
        f.invulnerable = 0;
        f.attackBuffer = 0;
        f.hit = false;
        actions |= f.attack === 'quick' ? QUICK : HEAVY;
      }
    }
  }

  const before = f.y;
  f.vy = Math.max(-60, f.vy - 44 * STEP);
  f.x += f.vx * STEP;
  f.y += f.vy * STEP;
  f.z += f.vz * STEP;
  const ground = groundAt(f.x, f.z, Math.max(f.y, before) + 1);
  if (f.vy <= 0 && before >= ground - .35 && f.y <= ground) {
    f.y = ground;
    f.vy = 0;
    f.grounded = true;
    f.jumps = 2;
    f.coyote = 7;
  } else {
    if (f.grounded) f.jumps = 1;
    f.grounded = false;
    f.coyote = Math.max(0, f.coyote - 1);
  }
  return actions;
}

function contact(a, b) {
  if (!a.attack || a.hit || a.out || b.out || b.invulnerable || a.y < -38 || b.y < -38) return null;
  const move = ATTACK[a.attack];
  if (a.attackAge < move.startup || a.attackAge >= move.startup + move.active) return null;
  const dx = b.x - a.x, dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  if (distance > move.range || Math.abs(b.y - a.y) > 2.1) return null;
  const x = distance > .01 ? dx / distance : Math.sin(a.facing);
  const z = distance > .01 ? dz / distance : Math.cos(a.facing);
  if (x * Math.sin(a.facing) + z * Math.cos(a.facing) < Math.cos(move.arc)) return null;
  return { attack: a.attack, move, x, z };
}

export function stepDuel(duel, inputs) {
  if (duel.ended) return [];
  duel.tick++;
  if (duel.countdown > 0) {
    duel.countdown--;
    return [];
  }

  const events = [];
  const before = duel.fighters.map(({ x, y, z, out }) => ({ x, y, z, out }));
  for (const [slot, f] of duel.fighters.entries()) {
    const rival = duel.fighters[1 - slot];
    if (f.out > 0) {
      if (--f.out === 0 && f.lives > 0) {
        const distance = SPAWNS.map(([x, z]) => Math.hypot(x - rival.x, z - rival.z));
        const spawn = distance[0] === distance[1] ? slot : Number(distance[1] > distance[0]);
        Object.assign(f, createFighter(slot, f.lives, f.life + 1, spawn));
      }
    } else stepFighter(f, inputs[slot], before[1 - slot]);
  }

  // Determine both contacts from the same positions before mutating either fighter.
  const [first, second] = duel.fighters;
  const contacts = [contact(first, second), contact(second, first)];
  for (const [slot, hit] of contacts.entries()) {
    if (!hit) continue;
    const a = duel.fighters[slot], b = duel.fighters[1 - slot];
    const { move, x, z } = hit;
    a.hit = true;
    b.health = Math.max(0, b.health - move.damage);
    const force = move.force * (1 + (1 - b.health / HEALTH) * 1.7);
    b.vx += x * force;
    b.vz += z * force;
    b.vy = Math.max(b.vy, force * move.lift * 1.05);
    b.stun = move.stun;
    b.lock = Math.ceil(move.stun * .85);
    b.attack = null;
    events.push({ type: 'hit', slot: 1 - slot, attack: hit.attack, x: b.x, y: b.y, z: b.z });
  }
  for (const [slot, f] of duel.fighters.entries()) {
    if (f.out || !f.lives || (f.health > 0 && f.y >= -38)) continue;
    f.lives--;
    f.out = 48;
    f.attack = null;
    events.push({ type: f.health === 0 ? 'ko' : 'fall', slot, x: f.x, y: f.y, z: f.z });
  }
  if (--duel.remaining === 0 || !first.lives || !second.lives) {
    const difference = first.lives - second.lives || (first.lives ? first.health - second.health : 0);
    duel.winner = difference === 0 ? null : Number(difference < 0);
    duel.ended = true;
  }
  return events;
}
