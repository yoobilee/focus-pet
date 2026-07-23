// Quantifies the "constant patrol" -> "mostly parked, occasional short
// move" change (see CLAUDE.md / animal-engine.js's movement-policy
// comment) instead of just eyeballing it. Runs the CURRENT engine for a
// simulated 20 minutes per species (dt fixed at 1/60, allowedToMove always
// true - no pauses/drag/sleep, so this isolates pure movement cadence) and
// reports:
//   - NEW walk-time fraction, bursts/minute, avg burst distance (measured
//     directly from the simulation)
//   - an OLD-equivalent walk-time fraction, estimated from the same run's
//     measured average single-idle-behavior duration (that part of the
//     code is unchanged) combined with the OLD (pre-MOVE_BURST_SCALE)
//     walk-duration formula - i.e. "what the old code would have done if
//     every idle behavior were immediately followed by a walk phase,
//     which is exactly what it did."
//
// Usage: node test/sim-movement-stats.mjs
import { createAnimal, CHARACTERS } from '../windows/shared/animal-engine.js';

const SIM_SECONDS = 20 * 60; // 20 simulated minutes per species
const DT = 1 / 60;

console.log(`Simulating ${SIM_SECONDS / 60} minutes per species (dt=${DT.toFixed(4)}s, allowedToMove=true throughout)...\n`);
console.log(
  'species'.padEnd(20),
  'NEW walk%'.padStart(10),
  'bursts/min'.padStart(11),
  'avgBurst(s)'.padStart(12),
  'avgDist/burst(px)'.padStart(18),
  'OLD walk% (est.)'.padStart(18),
);

for (const { key, label } of CHARACTERS) {
  const animal = createAnimal(key);
  let t = 0;
  let walkTime = 0;
  let idleTime = 0;
  let burstCount = 0;
  let burstTimeAccum = 0;
  let totalDistance = 0;
  const idleSegmentDurations = [];
  let curIdleName = null;
  let curIdleStart = 0;
  let inBurst = false;
  let burstStart = 0;

  while (t < SIM_SECONDS) {
    const { advance, moveStarted } = animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();

    if (snap.behaviorState === 'walk') {
      walkTime += DT;
      totalDistance += advance;
      if (moveStarted) { burstCount++; inBurst = true; burstStart = t; }
    } else {
      idleTime += DT;
      if (inBurst) { burstTimeAccum += t - burstStart; inBurst = false; }
      if (snap.currentIdleName !== curIdleName) {
        if (curIdleName !== null) idleSegmentDurations.push(t - curIdleStart);
        curIdleName = snap.currentIdleName;
        curIdleStart = t;
      }
    }
  }
  if (inBurst) burstTimeAccum += t - burstStart;

  const avgIdleSeg = idleSegmentDurations.reduce((a, b) => a + b, 0) / idleSegmentDurations.length;
  const oldWalkAvg = (animal.spec.walkMin + animal.spec.walkMax) / 2; // pre-MOVE_BURST_SCALE semantics
  const oldWalkFraction = oldWalkAvg / (oldWalkAvg + avgIdleSeg);
  const newWalkFraction = walkTime / (walkTime + idleTime);
  const avgBurstDur = burstCount ? burstTimeAccum / burstCount : 0;
  const avgDistPerBurst = burstCount ? totalDistance / burstCount : 0;
  const burstsPerMin = burstCount / (SIM_SECONDS / 60);

  console.log(
    `${label} (${key})`.padEnd(20),
    `${(newWalkFraction * 100).toFixed(1)}%`.padStart(10),
    burstsPerMin.toFixed(2).padStart(11),
    avgBurstDur.toFixed(2).padStart(12),
    avgDistPerBurst.toFixed(1).padStart(18),
    `${(oldWalkFraction * 100).toFixed(1)}%`.padStart(18),
  );
}
