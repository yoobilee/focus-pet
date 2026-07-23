// Uses the temporary setRotationDebug() hook (see animal-engine.js) to
// hunt for the reported "dog looks like it's doing a handstand sometimes"
// bug during actual live execution (state-machine transitions included),
// since static rendering of fixed poses couldn't reproduce it. Runs WAY
// more simulated frames/transitions than a few real-time minutes of the
// actual app could cover in the same wall-clock time - same dt-jitter +
// randomized external-trigger approach as test/sim-invariants.mjs (poke/
// forceSleep/wakeUp/setHeld/pause, all allowed to overlap), but this time
// watching combinedAngle = pose.rollAngle+pose.waddleTilt instead of
// coordinate invariants.
//
// Usage: node test/sim-rotation-debug.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal, CHARACTERS, setRotationDebug } from '../windows/shared/animal-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Every species that has 'rollover' and/or the sit 'haunches'/waddleTilt
// style in its idlePool - the only two things that ever touch rollAngle/
// waddleTilt - plus a couple of cats as a control (should never trigger,
// since cats never set either field).
const TARGET_SPECIES = ['dog_dachshund', 'dog_husky', 'dog_pomeranian', 'dog_corgi', 'cat_a', 'cat_siamese'];
const FRAMES_PER_RUN = 300000; // ~83 minutes of simulated time per run at ~60fps-equivalent - far more than "a few real minutes"
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const THRESHOLD_DEG = 25;

const violations = [];
setRotationDebug((v) => violations.push(v), THRESHOLD_DEG);

function runOne(key, seed) {
  const animal = createAnimal(key);
  let t = 0;
  let paused = false, isHeld = false, isAsleep = false, cursorClose = false;

  for (let frame = 0; frame < FRAMES_PER_RUN; frame++) {
    let dt = 0.016 + (Math.random() - 0.5) * 0.006;
    if (Math.random() < 0.01) dt = 0.05;
    dt = Math.max(0, Math.min(0.05, dt));
    t += dt;

    if (!paused && Math.random() < 0.0008) paused = true;
    else if (paused && Math.random() < 0.01) paused = false;
    if (!isHeld && Math.random() < 0.0004) { isHeld = true; animal.setHeld(true); }
    else if (isHeld && Math.random() < 0.02) { isHeld = false; animal.setHeld(false); }
    if (!isAsleep && Math.random() < 0.0003) { isAsleep = true; animal.forceSleep(); }
    else if (isAsleep && Math.random() < 0.004) { isAsleep = false; animal.wakeUp(); }
    if (Math.random() < 0.0015) animal.poke();
    // Cursor hint - can also interrupt whatever idle (e.g. mid-rollover)
    // is playing via the alert-trigger's enterIdle(), a transition path
    // the earlier version of this script didn't exercise at all.
    if (!cursorClose && Math.random() < 0.0006) cursorClose = true;
    else if (cursorClose && Math.random() < 0.03) cursorClose = false;
    animal.setCursorHint(Math.random() < 0.7 ? { dx: Math.random() * 2 - 1, dy: Math.random() * 2 - 1, close: cursorClose } : null);

    animal.update(dt, !paused, t);
  }
}

const startTime = Date.now();
let totalFrames = 0;
for (const key of TARGET_SPECIES) {
  for (const seed of SEEDS) {
    const original = Math.random;
    Math.random = mulberry32((seed * 1000003 + hashKey(key)) >>> 0);
    try {
      runOne(key, seed);
      totalFrames += FRAMES_PER_RUN;
    } finally {
      Math.random = original;
    }
  }
}
const elapsedMs = Date.now() - startTime;

console.log(`Simulated ${totalFrames.toLocaleString()} frames (~${Math.round(totalFrames / 60 / 60)} min of simulated real-time-equivalent) across ${TARGET_SPECIES.length} species x ${SEEDS.length} seeds in ${elapsedMs}ms.`);
console.log(`Threshold: |rollAngle+waddleTilt| > ${THRESHOLD_DEG} deg`);
console.log(`Violations logged: ${violations.length}`);

if (violations.length) {
  // Group by (species not tracked per-violation currently - add it) and summarize source (which idle produced it)
  const bySource = new Map();
  for (const v of violations) {
    const key = v.currentIdleName || '(walk/none)';
    bySource.set(key, (bySource.get(key) || 0) + 1);
  }
  console.log('\nBy source idle behavior:');
  for (const [k, count] of bySource) console.log(`  ${k}: ${count}`);

  const anomalous = violations.filter((v) => {
    // A "normal" rollover peak for husky (42) or pomeranian (58) legitimately
    // exceeds 25 - that's expected, tuned behavior, not the bug. Flag
    // anything that looks like more than a plain single-behavior peak:
    // combinedAngle magnitude beyond what any single species' rolloverMaxAngle
    // could produce alone (max configured is 58, pomeranian), or occurring
    // outside 'rollover'/'sit' entirely (nothing else should ever touch these
    // fields), or the two fields BOTH being simultaneously non-trivial
    // (should never happen - only one behavior owns either field at a time).
    const bothNonTrivial = Math.abs(v.pose.rollAngle) > 2 && Math.abs(v.pose.waddleTilt) > 2;
    const unexpectedSource = v.currentIdleName !== 'rollover' && v.currentIdleName !== 'sit';
    const tooLarge = Math.abs(v.combinedAngle) > 60; // beyond the largest configured rolloverMaxAngle (58, pomeranian)
    return bothNonTrivial || unexpectedSource || tooLarge;
  });
  console.log(`\nAnomalous (not explained by a single species' own configured peak): ${anomalous.length}`);

  const logLines = [];
  logLines.push(`Rotation-debug run: ${violations.length} violations (${anomalous.length} anomalous) out of ${totalFrames} frames`);
  logLines.push(`Generated ${new Date().toISOString()}`);
  logLines.push('');
  const toShow = anomalous.length ? anomalous : violations;
  for (const v of toShow.slice(0, 20)) {
    logLines.push('='.repeat(78));
    logLines.push(`t=${v.t}s combinedAngle=${v.combinedAngle.toFixed(2)} state=${v.behaviorState}/${v.currentIdleName} pinnedSleep=${v.pinnedSleep} pinnedHeld=${v.pinnedHeld}`);
    logLines.push(`pose: ${JSON.stringify(v.pose)}`);
    logLines.push('history:');
    for (const h of v.history) logLines.push(`  t=${h.t}s ${h.behaviorState}/${h.currentIdleName}`);
    logLines.push('');
  }
  fs.writeFileSync(path.join(__dirname, 'rotation-debug.log'), logLines.join('\n'), 'utf8');
  console.log(`\nFull detail written to test/rotation-debug.log`);
} else {
  console.log('\nNo frames exceeded the threshold at all.');
}
