// Headless visual verification for: (1) per-species sit poses (cats loaf,
// dogs sit on their haunches, rabbit/hamster their own variants) and (2)
// cursor-reactive head/eye tracking + the one-shot alert reaction. Renders
// real frames through the actual animal-engine.js drawCreature/drawShadow
// code (via MiniCanvas, not an approximation) to PNG files under test/ for
// visual inspection - not a pass/fail check, a screenshot generator.
//
// Usage: node test/render-poses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 6;

function render(animal, filename) {
  const size = 96 * SCALE;
  const canvas = new MiniCanvas(size, size);
  canvas.fillBackground('#3a3a44'); // opaque mid-gray so shadows/dark parts are visible against a non-white, non-transparent backdrop
  canvas.scale(SCALE, SCALE);
  animal.draw(canvas);
  const outPath = path.join(__dirname, filename);
  fs.writeFileSync(outPath, canvas.toPNG());
  console.log(`wrote ${filename}`);
}

// Steps a fresh animal until it's settled well into the named idle
// behavior (behaviorTimer > 0.8s past the entry transition), driving
// update() with allowedToMove=true and no cursor hint throughout.
function captureIdle(speciesKey, idleName, maxFrames = 300000) {
  const animal = createAnimal(speciesKey);
  let t = 0;
  for (let i = 0; i < maxFrames; i++) {
    animal.update(DT, true, t);
    t += DT;
    const snap = animal.inspect();
    if (snap.behaviorState === 'idle' && snap.currentIdleName === idleName && snap.behaviorTimer > 0.8) {
      return animal;
    }
  }
  throw new Error(`never reached idle '${idleName}' for ${speciesKey} within ${maxFrames} frames`);
}

console.log('--- 1) Dog sit (haunches: back legs folded, front legs standing) ---');
render(captureIdle('dog_corgi', 'sit'), 'out-dog-sit-corgi.png');
render(captureIdle('dog_dachshund', 'sit'), 'out-dog-sit-dachshund.png');
render(captureIdle('dog_husky', 'sit'), 'out-dog-sit-husky.png');
render(captureIdle('dog_pomeranian', 'sit'), 'out-dog-sit-pomeranian.png');

console.log('--- 2) Cat sit (loaf: all 4 legs tucked, rounded) - unchanged from before ---');
render(captureIdle('cat_a', 'sit'), 'out-cat-sit.png');
render(captureIdle('cat_siamese', 'sit'), 'out-cat-siamese-sit.png');

console.log('--- 3) Rabbit / hamster sit (own variants) ---');
render(captureIdle('rabbit_b', 'sit'), 'out-rabbit-sit.png');
render(captureIdle('hamster', 'sit'), 'out-hamster-sit.png');

console.log('--- 4) Cursor-reactive head/eye tracking (no sit involved - plain idle standing) ---');
{
  const noLook = createAnimal('cat_a');
  for (let i = 0; i < 90; i++) noLook.update(DT, true, i * DT); // no cursor hint at all - baseline
  render(noLook, 'out-cat-look-none.png');
}
{
  const lookRight = createAnimal('cat_a');
  for (let i = 0; i < 90; i++) { lookRight.setCursorHint({ dx: 1, dy: -0.3, close: false }); lookRight.update(DT, true, i * DT); }
  render(lookRight, 'out-cat-look-right.png');
}
{
  const lookLeft = createAnimal('cat_a');
  for (let i = 0; i < 90; i++) { lookLeft.setCursorHint({ dx: -1, dy: 0.6, close: false }); lookLeft.update(DT, true, i * DT); }
  render(lookLeft, 'out-cat-look-left-down.png');
}

console.log('--- 5) Cursor-close alert reaction (species-specific via pickAlertBehaviorName) ---');
{
  // Rabbit: idlePool has 'earalert' (priority 1) - expect that specifically, not the generic earflick.
  const rabbitAlert = createAnimal('rabbit_b');
  for (let i = 0; i < 20; i++) rabbitAlert.update(DT, true, i * DT); // let it settle into an ordinary idle first
  rabbitAlert.setCursorHint({ dx: 0.6, dy: 0, close: true }); // cursor just arrived close
  let triggeredAs = null;
  for (let i = 0; i < 40; i++) {
    rabbitAlert.update(DT, true, i * DT);
    if (triggeredAs === null) triggeredAs = rabbitAlert.inspect().currentIdleName;
  }
  console.log(`rabbit_b reaction to close cursor: '${triggeredAs}' (expect 'earalert')`);
  render(rabbitAlert, 'out-rabbit-alert.png');
}
{
  // Cat: idlePool has 'tailtwitch' (priority 2, no earalert) - expect that.
  const catAlert = createAnimal('cat_a');
  for (let i = 0; i < 20; i++) catAlert.update(DT, true, i * DT);
  catAlert.setCursorHint({ dx: -0.4, dy: -0.2, close: true });
  let triggeredAs = null;
  for (let i = 0; i < 40; i++) {
    catAlert.update(DT, true, i * DT);
    if (triggeredAs === null) triggeredAs = catAlert.inspect().currentIdleName;
  }
  console.log(`cat_a reaction to close cursor: '${triggeredAs}' (expect 'tailtwitch')`);
  render(catAlert, 'out-cat-alert.png');
}
{
  // Corgi: idlePool is [sit, stretch, earflick, sleep] - none of earalert/
  // tailtwitch/nosetwitch, so this should fall back to the guaranteed 'earflick'.
  const corgiAlert = createAnimal('dog_corgi');
  for (let i = 0; i < 20; i++) corgiAlert.update(DT, true, i * DT);
  corgiAlert.setCursorHint({ dx: 0.3, dy: -0.5, close: true });
  let triggeredAs = null;
  for (let i = 0; i < 40; i++) {
    corgiAlert.update(DT, true, i * DT);
    if (triggeredAs === null) triggeredAs = corgiAlert.inspect().currentIdleName;
  }
  console.log(`dog_corgi reaction to close cursor: '${triggeredAs}' (expect 'earflick', its idlePool has no earalert/tailtwitch/nosetwitch)`);
  render(corgiAlert, 'out-corgi-alert.png');
}

console.log('--- 6) Return-to-idle after cursor leaves (state-machine check, no screenshot needed) ---');
{
  const anim = createAnimal('cat_a');
  for (let i = 0; i < 20; i++) anim.update(DT, true, i * DT);
  anim.setCursorHint({ dx: 0.5, dy: 0, close: true });
  anim.update(DT, true, 0);
  console.log('right after close-cursor trigger:', anim.inspect().currentIdleName);
  anim.setCursorHint(null); // cursor leaves immediately
  for (let i = 0; i < 300; i++) anim.update(DT, true, i * DT); // run well past the alert behavior's own duration
  console.log('~5s later, cursor long gone:', anim.inspect().currentIdleName, '(expect back to ordinary idle cycling, not stuck)');
}
