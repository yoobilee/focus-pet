// npm-runnable (via `node test/render-bellyup.mjs`) renderer for the new
// static 'bellyUp' idle (rollover's replacement, see CLAUDE.md) - renders
// several independent instances per species (fresh createAnimal() each
// time, so each lands on a different random duration/RNG state) at a
// settled frame, to visually confirm the pose looks the same/stable every
// time rather than occasionally landing in some ambiguous half-state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 6;

function driveIntoBellyUp(speciesKey, maxFrames = 300000) {
  const animal = createAnimal(speciesKey);
  let t = 0;
  for (let i = 0; i < maxFrames; i++) {
    animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();
    // Settled: well past both the 0.6s ramp-in and the 0.25s crossfade.
    if (snap.behaviorState === 'idle' && snap.currentIdleName === 'bellyUp' && snap.behaviorTimer > 1.2) {
      return animal;
    }
  }
  throw new Error(`never reached settled bellyUp for ${speciesKey}`);
}

function render(animal, filename) {
  const size = 96 * SCALE;
  const canvas = new MiniCanvas(size, size);
  canvas.fillBackground('#2a6b3a');
  canvas.scale(SCALE, SCALE);
  animal.draw(canvas);
  fs.writeFileSync(path.join(__dirname, filename), canvas.toPNG());
}

for (const key of ['dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian']) {
  for (let variant = 0; variant < 3; variant++) {
    const animal = driveIntoBellyUp(key);
    const snap = animal.inspect();
    render(animal, `bellyup-${key}-v${variant}.png`);
    console.log(`${key} v${variant}: eyesClosed=${snap.pose.eyesClosed} bodySquash=${snap.pose.bodySquash.toFixed(2)} bellyUp=${snap.pose.bellyUp.toFixed(2)}`);
  }
}
