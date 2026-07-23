// High-zoom crop renderer for visually inspecting a specific region (e.g.
// the ear/head seam) at pixel-level detail - regular test/render-poses.mjs
// renders the whole 96x96 sprite, too small to see a 1-2px seam clearly.
// Usage: node test/render-zoom.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal, PX } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 10; // on top of the PX=4 already baked into every px()/pxJoint() call inside animal-engine.js itself (see below) - effective zoom is PX*SCALE = 40x

function renderCropped(animal, filename, cropX, cropY, cropW, cropH) {
  // Render the full 96x96 logical canvas at SCALE, then crop to the region
  // of interest (in logical grid units, same space SPECIES coords use).
  //
  // IMPORTANT: animal-engine.js's own px()/pxJoint()/pxTriangle() already
  // multiply every coordinate by PX(4) before calling ctx.fillRect - that's
  // how a 24x24 grid becomes a 96x96 canvas with NO ctx.scale() involved in
  // the real app (pet.js's canvas is just 96x96, 1:1 with what these
  // functions already produce). Any additional canvas.scale(SCALE,SCALE)
  // called here therefore compounds on top of that existing PX factor - the
  // true device-pixel position of a grid-unit coordinate v is v*PX*SCALE,
  // not v*SCALE. Forgetting this the first time around produced an entirely
  // background-colored crop (the actual content was 4x further out / 4x
  // larger than the crop math assumed).
  const full = new MiniCanvas(96 * PX * SCALE, 96 * PX * SCALE);
  full.fillBackground('#2a6b3a'); // saturated green background - anything NOT drawn (a gap/seam) reads unmistakably against fur colors, unlike the dark gray used elsewhere which could visually blend with dark fur
  full.scale(SCALE, SCALE);
  animal.draw(full);

  const px = (v) => Math.round(v * PX * SCALE);
  const x0 = px(cropX), y0 = px(cropY), w = px(cropW), h = px(cropH);
  const crop = new MiniCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((y0 + y) * full.width + (x0 + x)) * 4;
      const dstIdx = (y * w + x) * 4;
      crop.data[dstIdx] = full.data[srcIdx];
      crop.data[dstIdx + 1] = full.data[srcIdx + 1];
      crop.data[dstIdx + 2] = full.data[srcIdx + 2];
      crop.data[dstIdx + 3] = 255;
    }
  }
  const outPath = path.join(__dirname, filename);
  fs.writeFileSync(outPath, crop.toPNG());
  console.log(`wrote ${filename}`);
}

function freshIdle(speciesKey) {
  // Default/idle pose, not sitting - baseline check for whether the seam
  // is pose-independent (present even at rest) or only shows up mid-sit.
  return createAnimal(speciesKey);
}

function settledSit(speciesKey, maxFrames = 300000) {
  const animal = createAnimal(speciesKey);
  let t = 0;
  for (let i = 0; i < maxFrames; i++) {
    animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();
    if (snap.behaviorState === 'idle' && snap.currentIdleName === 'sit' && snap.behaviorTimer > 0.8) return animal;
  }
  throw new Error(`never reached sit for ${speciesKey}`);
}

// Head/ear region for cat_tuxedo: headX:15,headY:9,headW:7,headH:7, ears extend up to ~headY-e.h+1.
// Give generous padding since bodyBob shifts everything vertically during sit.
console.log('--- cat_tuxedo: ear/head seam, fresh idle (pose-independent baseline) ---');
renderCropped(freshIdle('cat_tuxedo'), 'zoom-tuxedo-idle-head.png', 12, 0, 14, 14);

console.log('--- cat_tuxedo: ear/head seam, settled sit (loaf) ---');
renderCropped(settledSit('cat_tuxedo'), 'zoom-tuxedo-sit-head.png', 12, 0, 14, 14);

console.log('--- cat_a: same check ---');
renderCropped(settledSit('cat_a'), 'zoom-cat-a-sit-head.png', 12, 0, 14, 14);

console.log('--- dog_husky (pointy ears too): fresh idle + sit ---');
renderCropped(freshIdle('dog_husky'), 'zoom-husky-idle-head.png', 12, 0, 14, 16);
renderCropped(settledSit('dog_husky'), 'zoom-husky-sit-head.png', 12, 0, 14, 16);

console.log('--- dog_dachshund (floppy ears - different drawer, comparison) ---');
renderCropped(settledSit('dog_dachshund'), 'zoom-dachshund-sit-head.png', 14, 8, 12, 12);

console.log('--- TIGHT crop on the exact ear-base/head-corner seam (cat_tuxedo, idle) ---');
renderCropped(freshIdle('cat_tuxedo'), 'zoom-seam-tight-tuxedo.png', 14.5, 8.5, 4, 3);

console.log('--- corgi/husky/pomeranian: same tight seam crop (all pointy-eared) ---');
renderCropped(freshIdle('dog_corgi'), 'zoom-seam-tight-corgi.png', 14.5, 9.5, 5, 3);
renderCropped(freshIdle('dog_husky'), 'zoom-seam-tight-husky.png', 14.5, 6.5, 5, 3);
renderCropped(freshIdle('dog_pomeranian'), 'zoom-seam-tight-pomeranian.png', 13.5, 6.5, 5, 3);

console.log('--- rabbit (long ears, rectangular not tapered) + hamster (round ears) - control check ---');
renderCropped(freshIdle('rabbit_b'), 'zoom-seam-tight-rabbit.png', 12.5, 8.5, 5, 3);
renderCropped(freshIdle('hamster'), 'zoom-seam-tight-hamster.png', 12.5, 8.5, 5, 3);
