// Verifies the new "always-on, screen-wide" cursor tracking (task 3):
// simulates a cursor sweeping from far off-screen left to far off-screen
// right, computing the exact same dx/dy/close values pet.js's
// updateCursorHint() now computes (including points OUTSIDE the local
// 340x210 window, which is the whole point of the main.js 'cursor-track'
// global poll added for this) and feeding them through the real engine to
// render a screenshot sequence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimal } from '../windows/shared/animal-engine.js';
import { MiniCanvas } from './mini-canvas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1 / 60;
const SCALE = 6;

// Mirrors pet.js's updateCursorHint() exactly: x=MARGIN (16, autonomous
// movement is off so this never changes - see CLAUDE.md), WRAP_WIDTH=96,
// stageHeight=210, CURSOR_DIRECTION_RANGE=130, CURSOR_CLOSE_RADIUS=55.
const MARGIN = 16, WRAP_WIDTH = 96, STAGE_H = 210;
const CURSOR_DIRECTION_RANGE = 130, CURSOR_CLOSE_RADIUS = 55;
function hintFromClientPos(clientX, clientY) {
  const centerX = MARGIN + WRAP_WIDTH / 2; // 64
  const centerY = STAGE_H - 14 - WRAP_WIDTH / 2; // 148
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

// clientX sweep: -600 (way off-screen left, only reachable via the global
// 'cursor-track' poll, never via a plain in-window mousemove) -> +600 (way
// off-screen right), passing through the window-local range in between.
const SWEEP = [
  { label: 'far-left-offscreen', clientX: -600, clientY: 148 },
  { label: 'left-onscreen', clientX: -50, clientY: 148 },
  { label: 'center', clientX: 64, clientY: 148 },
  { label: 'right-onscreen', clientX: 180, clientY: 148 },
  { label: 'far-right-offscreen', clientX: 900, clientY: 148 },
];

console.log('--- cursor sweep: cat_a head/eye tracking, left -> center -> right (incl. off-window points) ---');
for (const { label, clientX, clientY } of SWEEP) {
  const animal = createAnimal('cat_a');
  const hint = hintFromClientPos(clientX, clientY);
  console.log(`${label}: clientX=${clientX} -> hint.dx=${hint.dx.toFixed(3)} close=${hint.close}`);
  for (let i = 0; i < 120; i++) { animal.setCursorHint(hint); animal.update(DT, true, i * DT); }
  render(animal, `sweep-cat-${label}.png`);
}

console.log('--- same sweep, dog_husky (different head geometry, cross-check) ---');
for (const { label, clientX, clientY } of SWEEP) {
  const animal = createAnimal('dog_husky');
  const hint = hintFromClientPos(clientX, clientY);
  for (let i = 0; i < 120; i++) { animal.setCursorHint(hint); animal.update(DT, true, i * DT); }
  render(animal, `sweep-husky-${label}.png`);
}

console.log('--- lookDX/lookDY convergence values across the full sweep (numeric confirmation) ---');
for (const { label, clientX, clientY } of SWEEP) {
  const animal = createAnimal('cat_a');
  const hint = hintFromClientPos(clientX, clientY);
  for (let i = 0; i < 180; i++) { animal.setCursorHint(hint); animal.update(DT, true, i * DT); }
  const pose = animal.inspect().pose;
  console.log(`${label}: lookDX=${pose.lookDX.toFixed(3)} lookDY=${pose.lookDY.toFixed(3)}`);
}
