// Full-body renders at a moderate zoom for visually checking pattern/belly
// boundary containment and overall silhouette cleanliness in sit poses,
// after the ear/head corner-cut fix.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 8;

function render(animal, filename, bg = '#2a6b3a') {
  const size = 96 * SCALE;
  const canvas = new MiniCanvas(size, size);
  canvas.fillBackground(bg);
  canvas.scale(SCALE, SCALE);
  animal.draw(canvas);
  fs.writeFileSync(path.join(__dirname, filename), canvas.toPNG());
  console.log(`wrote ${filename}`);
}

function settled(speciesKey, idleName, maxFrames = 300000) {
  const animal = createAnimal(speciesKey);
  let t = 0;
  for (let i = 0; i < maxFrames; i++) {
    animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();
    if (snap.behaviorState === 'idle' && snap.currentIdleName === idleName && snap.behaviorTimer > 0.8) return animal;
  }
  throw new Error(`never reached ${idleName} for ${speciesKey}`);
}

console.log('--- full-body sit renders, post-fix, green bg to catch any silhouette gap ---');
render(settled('cat_tuxedo', 'sit'), 'full-tuxedo-sit-postfix.png');
render(settled('cat_a', 'sit'), 'full-cat-a-sit-postfix.png');
render(settled('dog_husky', 'sit'), 'full-husky-sit-postfix.png');
render(settled('dog_pomeranian', 'sit'), 'full-pomeranian-sit-postfix.png');
render(settled('dog_corgi', 'sit'), 'full-corgi-sit-postfix.png');
render(settled('dog_dachshund', 'sit'), 'full-dachshund-sit-postfix.png');
render(settled('rabbit_b', 'sit'), 'full-rabbit-sit-postfix.png');
render(settled('hamster', 'sit'), 'full-hamster-sit-postfix.png');
render(settled('cat_calico', 'sleep'), 'full-calico-sleep-postfix.png'); // sleep = full bodySquash, the case pattern/belly fix targeted
