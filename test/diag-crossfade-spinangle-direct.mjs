// Round 10 issue 4 verification, part 2 (direct/deterministic version) -
// the RNG-driven diag-crossfade-spinangle.js couldn't reliably land a
// same-idle restart (each species has only ONE circular idle, so the only
// way spinOverride stays true across a transition boundary is that exact
// idle getting picked twice in a row - low-probability enough that even
// 900 simulated seconds produced zero). Testing applyPoseCrossfade
// directly, deterministically, is both faster and more rigorous - matches
// this codebase's own stated preference (CLAUDE.md) for reading exact
// computed values over waiting on RNG timing.
import { applyPoseCrossfade } from '../windows/shared/animal-engine.js';

function makeAnim(fromSpinAngle) {
  return {
    pose: {}, // unused by applyPoseCrossfade itself
    transitionFrom: { spinAngle: fromSpinAngle, spinOverride: true, bodyBob: 0 },
    transitionElapsed: 0,
    spinAngleLapOffset: 0,
  };
}

// Scenario: a chasetail activation accumulated ~3.75 laps (23.6 rad, well
// within spinAngle's POSE_FIELD_BOUNDS ceiling of 40) before a fresh
// chasetail restart began - raw.spinAngle for the NEW activation is
// recomputed every frame the real way (circleStep's own formula,
// angularSpeed=3.4 matching chasetail's own apply()), not frozen, since
// that's what actually happens in the app and matters for the early-return
// boundary specifically (see applyPoseCrossfade's comment on why an
// earlier version of this fix only worked during the blend window and
// still snapped the instant it ended).
const FROM = 23.6;
const ANGULAR_SPEED = 3.4;
const DT = 0.03; // ~33fps step, matches the RNG-driven test's cadence

const anim = makeAnim(FROM);
const trace = [];
// Fixed iteration count well past the 0.25s blend window, NOT a while-loop
// keyed on transitionElapsed - applyPoseCrossfade's early-return path
// (elapsed >= POSE_TRANSITION_DURATION) deliberately stops incrementing
// transitionElapsed once the crossfade is done (see its own comment:
// "stops touching the field at all"), so a naive `while (anim.
// transitionElapsed < X)` loop would spin forever the instant elapsed
// crosses 0.25 but stays under X - this bit an earlier version of this
// script (JS heap OOM after ~50s of real time).
const STEPS = Math.ceil(0.25 / DT) + 10;
for (let i = 0; i < STEPS; i++) {
  const tNew = i * DT; // the NEW activation's own elapsed time, from its t=0
  const rawSpinAngle = -(tNew * ANGULAR_SPEED) - Math.PI / 2; // circleStep's own formula
  const raw = { spinAngle: rawSpinAngle, spinOverride: true, bodyBob: 0 };
  applyPoseCrossfade(anim, raw, DT);
  trace.push({ t: +tNew.toFixed(3), rawSpinAngle: +rawSpinAngle.toFixed(4), displayedSpinAngle: anim.pose.spinAngle });
}

let maxDelta = 0;
for (let i = 1; i < trace.length; i++) {
  maxDelta = Math.max(maxDelta, Math.abs(trace[i].displayedSpinAngle - trace[i - 1].displayedSpinAngle));
}
// Expected per-frame motion once things have settled: circleStep advances
// spinAngle by exactly ANGULAR_SPEED*DT per frame (~0.102 rad here) - the
// bound below (0.5) is a comfortable margin above that single-frame rate,
// same "sanity margin, not a tight bound" spirit as this file's own
// POSE_FIELD_BOUNDS.
const BOUND = 0.5;

console.log('trace:', JSON.stringify(trace, null, 1));
console.log('raw numeric distance FROM -> first raw.spinAngle:', Math.abs(FROM - trace[0].rawSpinAngle).toFixed(3), 'rad (what an unaligned plain lerp/snap would sweep through)');
console.log('max per-step |delta| in the DISPLAYED (crossfade-blended) spinAngle:', maxDelta.toFixed(4), '(bound:', BOUND, ', expected steady-state rate:', (ANGULAR_SPEED * DT).toFixed(4), ')');
console.log(maxDelta < BOUND ? 'PASS - no multi-radian jump anywhere, including at the early-return boundary' : 'FAIL - a jump exceeded the per-frame motion bound');
