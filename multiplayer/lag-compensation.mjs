import { MAX_REWIND_TICKS, STEP } from '../public/online-sim.mjs';
import { MAX_INTERPOLATION_TICKS, SNAPSHOT_EVERY } from '../public/online-net.mjs';

const tickMs = STEP * 1000;
const baseViewTicks = 6;
const minViewAgeLimit = 18;
const maxViewAgeLimit = 30;

export function rewindForView(viewTick, applyTick, rttMs) {
  const age = applyTick - viewTick;
  // The reported view includes the render buffer, snapshot spacing, and
  // both network legs. A valid old view still cannot increase hit rewind.
  const viewBudget = MAX_INTERPOLATION_TICKS + SNAPSHOT_EVERY + Math.ceil(rttMs / tickMs);
  const ageLimit = Math.min(maxViewAgeLimit, Math.max(minViewAgeLimit, viewBudget));
  if (age <= 0 || age > ageLimit) return 0;
  const allowed = Math.min(MAX_REWIND_TICKS, baseViewTicks + Math.round(rttMs / (2 * tickMs)));
  return Math.min(age, allowed);
}
