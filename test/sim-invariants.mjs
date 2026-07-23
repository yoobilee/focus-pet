// Long-running, multi-seed simulation that drives every species through the
// full behavior state machine (walk bursts, every idle behavior, poke,
// forceSleep/wakeUp, drag-hold start/end, reminder-bubble pause - all
// allowed to overlap/interrupt each other, same as real usage) and checks
// checkPoseInvariants() against the exact geometry animal-engine.js is
// about to draw, every single frame.
//
// Why this exists (see CLAUDE.md): eyeballing screenshots already missed
// one real bug (the sit-pose neckLen bug) and, per the user, is still
// missing an intermittent "body looks squished/deformed" glitch that isn't
// tied to any one species or state. Screenshots only ever sample a handful
// of instants; this instead recomputes the real per-frame geometry for
// tens of thousands of frames per species and flags anything that drifts
// outside a sane range - no human judgment call about "does this look
// off" required.
//
// Usage: node test/sim-invariants.mjs
// Exits 0 if every frame across every species/seed passed, 1 otherwise.
// On any violation, writes full repro context (species, seed, frame,
// elapsed time, the exact list of invariant problems, the full pose at
// that frame, and a rolling ~40-frame history of state transitions/
// external actions leading up to it) to test/invariant-violations.log.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAnimal,
  CHARACTERS,
  setGeometrySink,
  checkPoseInvariants,
} from '../windows/shared/animal-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------
// Deterministic PRNG (mulberry32) swapped in for Math.random for the
// duration of each run, so a violation is exactly reproducible from its
// (species, seed, elapsedOffset) triple alone - the engine itself only
// ever calls the global Math.random(), never anything passed in.
// ---------------------------------------------------------------------
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

// Minimal no-op Canvas 2D mock - drawCreature/drawShadow only ever call
// these methods and assign .fillStyle; none of their return values or
// side effects matter here since the actual invariant data comes from
// animal-engine.js's own geometry instrumentation (setGeometrySink),
// which reports pre-scale, pre-rotation logical-grid coordinates - the
// same space every SPECIES entry is authored in - so this mock never
// needs to simulate ctx transforms at all.
function makeMockCtx() {
  return {
    fillStyle: '#000',
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    ellipse() {},
  };
}

const FRAMES_PER_RUN = 20000;
// elapsedOffset simulates how long the app has already been running when
// the window under test starts - covers the "left running for days"
// long-uptime case (accumulating oscillator phases/clocks that never
// reset) in addition to fresh-start sessions.
const SEED_CONFIGS = [
  { seed: 1, elapsedOffset: 0 },
  { seed: 2, elapsedOffset: 0 },
  { seed: 3, elapsedOffset: 0 },
  { seed: 4, elapsedOffset: 0 },
  { seed: 5, elapsedOffset: 100000 }, // ~27.8h simulated uptime
  { seed: 6, elapsedOffset: 5_000_000 }, // ~57.9 days simulated uptime
];

const HISTORY_LEN = 40;
const mockCtx = makeMockCtx();
let geometryBuffer = [];
setGeometrySink((tag, data) => { geometryBuffer.push({ tag, ...data }); });

const allViolations = [];
let totalFrames = 0;

function runOneSimulation(key, seedCfg) {
  const animal = createAnimal(key);
  const history = [];
  let elapsed = seedCfg.elapsedOffset;
  let paused = false; // reminder-bubble showing (allowedToMove=false)
  let isHeld = false; // drag in progress
  let isAsleep = false; // system-idle tie-in (pinnedSleep)
  let prev = animal.inspect();

  for (let frame = 0; frame < FRAMES_PER_RUN; frame++) {
    // --- dt fuzz: mostly ~16ms with jitter, occasional stalls (up to the
    // 0.05s clamp pet.js itself applies) and occasional zero-dt frames
    // (two rAF callbacks landing in the same tick) - real-world jitter,
    // not just a clean fixed step.
    let dt = 0.016 + (Math.random() - 0.5) * 0.006;
    if (Math.random() < 0.01) dt = 0.05;
    if (Math.random() < 0.002) dt = 0;
    dt = Math.max(0, Math.min(0.05, dt));
    elapsed += dt;

    const actions = [];

    // --- external triggers, all allowed to overlap/interrupt each other
    // (e.g. dragging a sleeping pet, a bubble showing while asleep, a poke
    // landing mid-drag) - exactly the "state transitions overlapping"
    // coverage the bug hunt asked for.
    if (!paused && Math.random() < 0.0008) { paused = true; actions.push('pause-start(bubble)'); }
    else if (paused && Math.random() < 0.01) { paused = false; actions.push('pause-end(bubble)'); }

    if (!isHeld && Math.random() < 0.0004) { isHeld = true; animal.setHeld(true); actions.push('setHeld(true)'); }
    else if (isHeld && Math.random() < 0.02) { isHeld = false; animal.setHeld(false); actions.push('setHeld(false)'); }

    if (!isAsleep && Math.random() < 0.0003) { isAsleep = true; animal.forceSleep(); actions.push('forceSleep()'); }
    else if (isAsleep && Math.random() < 0.004) { isAsleep = false; animal.wakeUp(); actions.push('wakeUp()'); }

    if (Math.random() < 0.0015) { animal.poke(); actions.push('poke()'); }

    const allowedToMove = !paused;
    const { moveStarted } = animal.update(dt, allowedToMove, elapsed);
    if (moveStarted) actions.push('walk-burst-started');

    geometryBuffer = [];
    animal.draw(mockCtx);

    const snap = animal.inspect();
    if (snap.behaviorState !== prev.behaviorState || snap.currentIdleName !== prev.currentIdleName) {
      actions.push(`state:${prev.behaviorState}(${prev.currentIdleName})->${snap.behaviorState}(${snap.currentIdleName})`);
    }

    history.push({
      frame, dt: +dt.toFixed(4), elapsed: +elapsed.toFixed(2), actions: actions.slice(),
      allowedToMove, isHeld, isAsleep, state: snap.behaviorState, idle: snap.currentIdleName,
    });
    if (history.length > HISTORY_LEN) history.shift();

    const problems = checkPoseInvariants(animal.spec, snap.pose, geometryBuffer);
    totalFrames++;
    if (problems.length) {
      allViolations.push({
        species: key, seed: seedCfg.seed, elapsedOffset: seedCfg.elapsedOffset,
        frame, elapsed, problems, pose: snap.pose, history: history.slice(),
      });
    }

    prev = snap;
  }
}

const startTime = Date.now();
for (const { key } of CHARACTERS) {
  for (const seedCfg of SEED_CONFIGS) {
    const original = Math.random;
    Math.random = mulberry32((seedCfg.seed * 1000003 + hashKey(key)) >>> 0);
    try {
      runOneSimulation(key, seedCfg);
    } finally {
      Math.random = original;
    }
  }
}
const elapsedMs = Date.now() - startTime;

console.log(`Simulated ${totalFrames.toLocaleString()} frames across ${CHARACTERS.length} species x ${SEED_CONFIGS.length} seed-configs in ${elapsedMs}ms.`);
console.log(`Violations: ${allViolations.length}`);

if (allViolations.length) {
  // Group by a normalized signature (numbers stripped) so repeated
  // instances of "the same kind of bug" collapse into one bucket instead
  // of drowning the summary in near-duplicate lines.
  const groups = new Map();
  for (const v of allViolations) {
    const sig = v.problems.map((p) => p.replace(/-?\d+(\.\d+)?/g, '#')).sort().join(' | ');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(v);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log(`\n${sorted.length} distinct problem signature(s):`);
  for (const [sig, vs] of sorted) {
    const speciesHit = [...new Set(vs.map((v) => v.species))];
    console.log(`  x${vs.length}  species=[${speciesHit.join(',')}]  ${sig}`);
  }

  const logLines = [];
  logLines.push(`Invariant violations: ${allViolations.length} (${sorted.length} distinct signatures)`);
  logLines.push(`Generated ${new Date().toISOString()}`);
  logLines.push('');
  for (const [sig, vs] of sorted) {
    logLines.push('='.repeat(78));
    logLines.push(`SIGNATURE (x${vs.length}): ${sig}`);
    logLines.push('='.repeat(78));
    // Full repro context for up to 3 examples per signature - enough to
    // diagnose without the file exploding if one bug fires thousands of
    // times.
    for (const v of vs.slice(0, 3)) {
      logLines.push(`-- species=${v.species} seed=${v.seed} elapsedOffset=${v.elapsedOffset} frame=${v.frame} elapsed=${v.elapsed.toFixed(2)}s`);
      logLines.push(`   problems:`);
      for (const p of v.problems) logLines.push(`     - ${p}`);
      logLines.push(`   pose at violation: ${JSON.stringify(v.pose)}`);
      logLines.push(`   last ${v.history.length} frames leading up to it:`);
      for (const h of v.history) {
        const tag = h.frame === v.frame ? '>>> ' : '    ';
        logLines.push(`   ${tag}f${h.frame} dt=${h.dt} t=${h.elapsed}s state=${h.state}/${h.idle} allowedToMove=${h.allowedToMove} held=${h.isHeld} asleep=${h.isAsleep}${h.actions.length ? '  [' + h.actions.join(', ') + ']' : ''}`);
      }
      logLines.push('');
    }
  }
  const logPath = path.join(__dirname, 'invariant-violations.log');
  fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
  console.log(`\nFull repro context (${allViolations.length} violations) written to ${logPath}`);
}

process.exitCode = allViolations.length ? 1 : 0;
