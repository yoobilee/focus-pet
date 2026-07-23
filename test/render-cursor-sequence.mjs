// Single animal instance, cursor hint changed over time (left -> center ->
// right), rendered at checkpoints - more representative of real continuous
// tracking than comparing independently-created instances (which can land
// in different idle behaviors with their own unrelated bodyBob/headDY,
// muddying the comparison). This isolates the actual thing being verified:
// does the SAME pet's head/eyes visibly follow the cursor as it moves.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 6;

const MARGIN = 16, WRAP_WIDTH = 96, STAGE_H = 210;
const CURSOR_DIRECTION_RANGE = 130, CURSOR_CLOSE_RADIUS = 55;
function hintFromClientPos(clientX, clientY) {
  const centerX = MARGIN + WRAP_WIDTH / 2;
  const centerY = STAGE_H - 14 - WRAP_WIDTH / 2;
  const dx = clientX - centerX, dy = clientY - centerY;
  const dist = Math.hypot(dx, dy);
  return {
    dx: Math.max(-1, Math.min(1, dx / CURSOR_DIRECTION_RANGE)),
    dy: Math.max(-1, Math.min(1, dy / CURSOR_DIRECTION_RANGE)),
    close: dist <= CURSOR_CLOSE_RADIUS,
  };
}

function render(animal, filename) {
  const size = 96 * SCALE;
  const canvas = new MiniCanvas(size, size);
  canvas.fillBackground('#dfe9e2');
  canvas.scale(SCALE, SCALE);
  animal.draw(canvas);
  fs.writeFileSync(path.join(__dirname, filename), canvas.toPNG());
}

const animal = createAnimal('cat_a');
let t = 0;

// Force-suppress natural idle drama for a clean comparison: hold at a far
// clientY (way below) so `close` never fires, and use a species/duration
// budget short enough that we mostly stay in whichever idle behavior we
// started in - not required for correctness (lookDX is preserved across
// transitions regardless now), just keeps the demo visually cleaner.
function step(clientX, frames) {
  const hint = hintFromClientPos(clientX, 148);
  for (let i = 0; i < frames; i++) {
    animal.setCursorHint(hint);
    animal.update(DT, true, t);
    t += DT;
  }
}

step(-50, 90); // sweep to the left, let it converge (~1.5s)
render(animal, 'sequence-1-left.png');
console.log('after left:', animal.inspect().pose.lookDX.toFixed(3), animal.inspect().currentIdleName);

step(64, 60); // move to dead-center-ish but avoid the close trigger by using clientY offset instead - actually center IS close-radius eligible if dy=0; nudge dy
// recompute with an offset that keeps it out of the close radius but dx~0
{
  const hint = hintFromClientPos(64, 40); // dy = 40-148 = -108, dist=108 > 55, so no alert trigger, dx~0
  for (let i = 0; i < 60; i++) { animal.setCursorHint(hint); animal.update(DT, true, t); t += DT; }
}
render(animal, 'sequence-2-center.png');
console.log('after center:', animal.inspect().pose.lookDX.toFixed(3), animal.inspect().currentIdleName);

step(180, 90); // sweep to the right
render(animal, 'sequence-3-right.png');
console.log('after right:', animal.inspect().pose.lookDX.toFixed(3), animal.inspect().currentIdleName);
