// Standalone interactive viewer for the 3D voxel prototype (feature/3d-space
// branch) - reuses the real windows/shared/voxel-engine.js and
// windows/shared/animal-engine.js modules directly (no copy/paste, so this
// can never silently drift from what the actual prototype does). Drives the
// REAL createAnimal() state machine (idle-behavior pool, cursor tracking,
// pose crossfade - all unchanged from the 2D engine, see
// animal-engine.js's getPose() comment) and renders its output via
// voxel-engine.js's applyPose(), so this is the same code path stage 4 (the
// real pet window) will use, just with extra UI on top (species picker,
// spin/poke/sleep/hold controls, drag-to-rotate) for interactive
// inspection. Must be served over http(s) (see
// test/serve-voxel-viewer.js) rather than opened as a bare file:// page -
// Chromium blocks a module's relative import of a sibling file when the
// page itself was loaded via file://, a browser restriction, not
// something specific to this code.
import * as THREE from 'three';
import { buildVoxelCreature } from '../windows/shared/voxel-engine.js';
import { SPECIES, createAnimal } from '../windows/shared/animal-engine.js';

const canvas = document.getElementById('stage');
const RENDER_SIZE = 96;
canvas.width = RENDER_SIZE;
canvas.height = RENDER_SIZE;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a6b3a');

const FRUSTUM = 26;
const CENTER_Y = 11;
const camera = new THREE.OrthographicCamera(-FRUSTUM / 2, FRUSTUM / 2, FRUSTUM / 2, -FRUSTUM / 2, 0.1, 200);
camera.position.set(0, CENTER_Y, 60);
camera.lookAt(0, CENTER_Y, 0);

let group = null;
let animal = null;
let held = false;

function loadSpecies(key) {
  if (group) scene.remove(group);
  group = buildVoxelCreature(key);
  scene.add(group);
  animal = createAnimal(key);
  held = false;
}

const speciesSelect = document.getElementById('species');
for (const key of Object.keys(SPECIES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = `${SPECIES[key].label} (${key})`;
  speciesSelect.appendChild(opt);
}
speciesSelect.value = 'cat_a';
speciesSelect.addEventListener('change', () => loadSpecies(speciesSelect.value));
loadSpecies('cat_a');

// Drag-to-rotate (mouse) - lets you pause the auto-spin and manually check
// a specific angle up close. Distinct from the pet's own drag-to-move (not
// relevant in this standalone viewer, which has no window to move) - here
// dragging always orbits the view, and cursor-hint tracking (below) is
// computed independently of drag state so both can be tested at once.
let manualAngle = 0;
let dragging = false;
let lastX = 0;
canvas.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  manualAngle += (e.clientX - lastX) * 0.01;
  lastX = e.clientX;
});

// Cursor hint - lets cursor-look (head/eye tracking) and the alert-idle
// trigger (see updateCursorAlertTrigger in animal-engine.js) be exercised
// interactively, same signal shape pet.js's updateCursorHint() computes
// from real screen coordinates (dx/dy roughly -1..1 from center, close a
// bool for the tighter "trigger alert" radius) - here derived from mouse
// position over the canvas itself since there's no pet window to be
// offset from.
let cursorHint = null;
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
  const ny = (e.clientY - rect.top) / rect.height - 0.5;
  cursorHint = { dx: nx * 2, dy: ny * 2, close: Math.hypot(nx, ny) < 0.2 };
});
canvas.addEventListener('mouseleave', () => { cursorHint = null; });

const spinCheckbox = document.getElementById('spin');
const speedSlider = document.getElementById('speed');
const pokeButton = document.getElementById('poke');
const sleepButton = document.getElementById('sleep');
const holdButton = document.getElementById('hold');
pokeButton.addEventListener('click', () => animal.poke());
sleepButton.addEventListener('click', () => {
  const sleeping = sleepButton.dataset.sleeping === '1';
  if (sleeping) { animal.wakeUp(); sleepButton.dataset.sleeping = '0'; sleepButton.textContent = '재우기(sleep)'; }
  else { animal.forceSleep(); sleepButton.dataset.sleeping = '1'; sleepButton.textContent = '깨우기(wake)'; }
});
holdButton.addEventListener('click', () => {
  held = !held;
  animal.setHeld(held);
  holdButton.textContent = held ? '놓기(release)' : '잡기(hold)';
});

let autoAngle = 0;
let elapsed = 0;
let last = null;

function frame(now) {
  if (last === null) last = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const speed = parseFloat(speedSlider.value);
  elapsed += dt * speed;

  if (spinCheckbox.checked) autoAngle += dt * speed * 0.8;
  group.rotation.y = autoAngle + manualAngle;

  animal.setCursorHint(cursorHint);
  animal.update(dt * speed, true, elapsed);
  group.userData.applyPose(animal.getPose());

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
