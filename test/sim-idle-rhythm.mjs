// npm run test:idle-rhythm - simulates 20 minutes per species and measures
// the fraction of time spent in the calm 'breathe' idle vs everything
// else, plus transitions/minute - a permanent regression check that the
// "too busy/distracting" idle rhythm (see CLAUDE.md) doesn't creep back
// if idlePool weights/durations get retuned later. Before 'breathe' was
// added, every idle behavior was an active flourish (1-4s durations), so
// transitions/min was roughly 20-40; after, it should sit in the
// single-digit range with breathe dominating time-share (~75-90%).
import { createAnimal, CHARACTERS } from '../windows/shared/animal-engine.js';

const DT = 1 / 60;
const SIM_SECONDS = 20 * 60;

for (const { key, label } of CHARACTERS) {
  const animal = createAnimal(key);
  let t = 0;
  const timeByIdle = {};
  let transitions = 0;
  let lastIdleName = null;
  for (let i = 0; i < SIM_SECONDS / DT; i++) {
    animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();
    const name = snap.currentIdleName || 'none';
    timeByIdle[name] = (timeByIdle[name] || 0) + DT;
    if (name !== lastIdleName) { transitions++; lastIdleName = name; }
  }
  const breathePct = ((timeByIdle['breathe'] || 0) / SIM_SECONDS * 100).toFixed(1);
  const transitionsPerMin = (transitions / (SIM_SECONDS / 60)).toFixed(2);
  console.log(`${label.padEnd(20)} breathe=${breathePct}%  transitions/min=${transitionsPerMin}`);
}
