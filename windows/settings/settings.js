import * as THREE from 'three';
import { createAnimal, CHARACTERS } from '../shared/animal-engine.js';
import { buildVoxelCreature } from '../shared/voxel-engine.js';

const charGrid = document.getElementById('char-grid');
const intervalSection = document.getElementById('interval-section');
const idleSection = document.getElementById('idle-section');
const intervalInput = document.getElementById('intervalMinutes');
const idleInput = document.getElementById('idleThresholdMinutes'); // element/field is minutes now - settingsStore.js's idleThresholdSeconds is still stored in seconds, converted at the fillForm/save boundary below
const soundCheckbox = document.getElementById('soundEnabled');
const soundVolumeInput = document.getElementById('soundVolume');
const soundVolumeLabel = document.getElementById('soundVolumeLabel');
const messagesTextarea = document.getElementById('messages');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');

let currentCharacter = 'cat_a';
// Populated once from getDefaults() in init() before fillForm() ever runs -
// see isDefaultMessages()/fillForm() below for why this is needed.
let cachedDefaultMessages = null;

// Character grid thumbnails - real 3D voxel snapshots, not the old 2D
// pixel-art canvas draw. This used to call createAnimal(key).draw(ctx),
// which renders through drawCreature() (windows/shared/animal-engine.js's
// Canvas2D pixel-art path) - a leftover from before the pet window itself
// switched to the THREE.js voxel renderer (windows/shared/voxel-engine.js,
// see CLAUDE.md's "실제 pet 창에 연결" note). That left the settings grid
// showing flat orange-tabby-style sprites for every character while the
// actual live pet (and the live preview this same grid already triggers
// via previewCharacter() below) is a rotated, extruded voxel model with
// its own distinct color/shading (seam collars, face-shade gradients,
// whisker/nose details, etc.) - the thumbnail and the thing it's supposed
// to preview had drifted onto two different renderers entirely.
//
// Fix: reuse buildVoxelCreature (the exact same function pet.js calls) to
// build each species once, render it with ONE shared offscreen
// WebGLRenderer (not 10 simultaneous live contexts - a settings window can
// be closed/reopened many times over a session, and Chromium's per-page
// WebGL context budget is a scarce, evictable resource), and blit the
// result into each grid button's own small 2D <canvas> via drawImage -
// genuinely a "static snapshot", exactly what was asked for (no live
// per-thumbnail rotation/animation needed).
const THUMB_RENDER_SIZE = 96; // matches the live pet window's true render resolution (pet.js) - same geometry, same camera, so what you see here is what you'll actually get
const THUMB_ANGLE = -0.62; // ~-35.5 degrees - a three-quarter view (nose leads into the turn per pet.js's FACING_LEFT_Y convention) so the grid reads as an actual 3D model with visible depth, rather than the flat side profile the old 2D sprites always showed
const THUMB_FRUSTUM = 26; // same as pet.js/pet3d.js - already-validated framing, no new tuning needed
const THUMB_CENTER_Y = 11;

const thumbCanvasEl = document.createElement('canvas');
thumbCanvasEl.width = THUMB_RENDER_SIZE;
thumbCanvasEl.height = THUMB_RENDER_SIZE;
const thumbRenderer = new THREE.WebGLRenderer({ canvas: thumbCanvasEl, antialias: false, alpha: true, preserveDrawingBuffer: true });
thumbRenderer.setPixelRatio(1);
thumbRenderer.setSize(THUMB_RENDER_SIZE, THUMB_RENDER_SIZE, false);
thumbRenderer.setClearColor(0x000000, 0); // transparent, same as pet.js - lets the card background show through around the silhouette

const thumbScene = new THREE.Scene();
const thumbCamera = new THREE.OrthographicCamera(-THUMB_FRUSTUM / 2, THUMB_FRUSTUM / 2, THUMB_FRUSTUM / 2, -THUMB_FRUSTUM / 2, 0.1, 200);
thumbCamera.position.set(0, THUMB_CENTER_Y, 60);
thumbCamera.lookAt(0, THUMB_CENTER_Y, 0);

function disposeGroup(group) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => {
      if (m.map) m.map.dispose(); // CanvasTexture (cat_siamese's face-shade gradient) - not freed by material.dispose() alone
      m.dispose();
    });
  });
}

function renderCharThumb(canvas, key) {
  const group = buildVoxelCreature(key);
  group.rotation.y = THUMB_ANGLE;
  // createAnimal(key).getPose() returns anim.pose fresh off construction
  // (defaultPose()) - update() is deliberately never called, so this stays
  // a fixed neutral standing pose (no idle-pool randomness), giving all 10
  // thumbnails a consistent look rather than each one landing on whatever
  // idle behavior happened to get picked.
  const pose = createAnimal(key).getPose();
  group.userData.applyPose(pose);
  thumbScene.add(group);
  thumbRenderer.render(thumbScene, thumbCamera);
  thumbScene.remove(group);
  disposeGroup(group);

  canvas.width = THUMB_RENDER_SIZE;
  canvas.height = THUMB_RENDER_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, THUMB_RENDER_SIZE, THUMB_RENDER_SIZE);
  ctx.drawImage(thumbCanvasEl, 0, 0);
}

function buildCharGrid() {
  charGrid.innerHTML = '';
  CHARACTERS.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'char-btn';
    btn.dataset.key = key;

    const canvas = document.createElement('canvas');
    btn.appendChild(canvas);
    const span = document.createElement('span');
    span.className = 'char-label';
    span.textContent = label;
    btn.appendChild(span);

    btn.addEventListener('click', () => {
      currentCharacter = key;
      updateCharSelection();
      // Live preview (round 8) - shows immediately in the real pet window,
      // before Save. Nothing is persisted here; see main.js's
      // 'preview-character' handler and its settingsWindow 'closed'
      // handler for the revert-if-not-saved side.
      window.focusPetAPI.previewCharacter(key);
    });
    charGrid.appendChild(btn);
    requestAnimationFrame(() => renderCharThumb(canvas, key));
  });
}

function updateCharSelection() {
  [...charGrid.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.key === currentCharacter);
  });
}

// Drives the range slider's CSS --fill custom property (settings.css) so
// its track shows a solid accent-colored "filled" portion up to the
// current value, instead of a plain flat native track.
function updateVolumeFill() {
  const min = Number(soundVolumeInput.min) || 0;
  const max = Number(soundVolumeInput.max) || 100;
  const pct = ((Number(soundVolumeInput.value) - min) / (max - min)) * 100;
  soundVolumeInput.style.setProperty('--fill', `${pct}%`);
}

function updateModeVisibility() {
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'interval';
  intervalSection.classList.toggle('hidden', mode === 'idle');
  idleSection.classList.toggle('hidden', mode === 'interval');
}

function fillForm(settings) {
  currentCharacter = settings.character;
  updateCharSelection();

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === settings.mode;
  });
  updateModeVisibility();

  intervalInput.value = settings.intervalMinutes;
  // idleThresholdSeconds is stored in seconds (settingsStore.js) - the
  // field itself now shows/edits minutes, so convert on the way in.
  idleInput.value = Math.round((settings.idleThresholdSeconds ?? 900) / 60);
  document.querySelectorAll('input[name="movementMode"]').forEach((r) => {
    r.checked = r.value === (settings.movementMode || 'stationary');
  });
  soundCheckbox.checked = settings.soundEnabled;
  // soundVolume is stored 0..1 (see settingsStore.js); the slider itself
  // works in 0..100 for a friendlier percent display.
  const volumePercent = Math.round((settings.soundVolume ?? 0.5) * 100);
  soundVolumeInput.value = volumePercent;
  soundVolumeLabel.textContent = `소리 크기 (${volumePercent}%)`;
  updateVolumeFill();
  // The textarea is meant to be "write your own custom lines here", not a
  // display of whatever list is currently in effect - settingsStore.js's
  // load() always returns SOME messages array (falls back to
  // DEFAULTS.messages via {...DEFAULTS, ...parsed} whenever the user never
  // saved their own), so settings.messages alone can't tell "genuinely
  // customized" apart from "just inherited the defaults". isDefaultMessages()
  // does that by comparing against the real DEFAULTS.messages content
  // (cached in init(), before fillForm() is ever called) - only an actual,
  // different custom list gets echoed back into the box; the untouched
  // case leaves it empty with the placeholder hint doing the explaining.
  // (An earlier version of this function unconditionally filled the box
  // with settings.messages - see git history/CLAUDE.md for that bug and
  // why the fallback-to-DEFAULTS runtime behavior in pickMessage() below
  // stays exactly as it was; only this display line changes.)
  messagesTextarea.value = isDefaultMessages(settings.messages) ? '' : (settings.messages || []).join('\n');
}

// True if `messages` is empty/missing OR is content-identical to the real
// default list - i.e. "nothing the user actually typed themselves".
// Conservative (returns false) if cachedDefaultMessages hasn't loaded yet,
// so a hypothetical very-early call never hides real custom content.
function isDefaultMessages(messages) {
  if (!messages || messages.length === 0) return true;
  if (!cachedDefaultMessages) return false;
  if (messages.length !== cachedDefaultMessages.length) return false;
  return messages.every((m, i) => m === cachedDefaultMessages[i]);
}

async function init() {
  buildCharGrid();
  // Fetched together (not sequentially) so fillForm() below only ever runs
  // once cachedDefaultMessages is already populated - isDefaultMessages()
  // needs it to tell "just inherited defaults" apart from "real custom
  // list" correctly on the very first render.
  const [defaults, settings] = await Promise.all([window.focusPetAPI.getDefaults(), window.focusPetAPI.getSettings()]);
  cachedDefaultMessages = defaults.messages;
  fillForm(settings);

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', updateModeVisibility);
  });
  soundVolumeInput.addEventListener('input', () => {
    soundVolumeLabel.textContent = `소리 크기 (${soundVolumeInput.value}%)`;
    updateVolumeFill();
  });
}

saveBtn.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'interval';
  const messages = messagesTextarea.value
    .split('\n')
    .map((m) => m.trim())
    .filter(Boolean);

  const movementMode = document.querySelector('input[name="movementMode"]:checked')?.value || 'stationary';

  const newSettings = {
    character: currentCharacter,
    mode,
    intervalMinutes: Number(intervalInput.value) || 30,
    // Convert the minutes shown in the field back to seconds for storage.
    idleThresholdSeconds: (Number(idleInput.value) || 15) * 60,
    movementMode,
    soundEnabled: soundCheckbox.checked,
    soundVolume: Number(soundVolumeInput.value) / 100,
    messages: messages.length ? messages : undefined
  };

  await window.focusPetAPI.saveSettings(newSettings);
  window.focusPetAPI.closeSettings();
});

resetBtn.addEventListener('click', async () => {
  const defaults = await window.focusPetAPI.getDefaults();
  fillForm(defaults);
  // Same live-preview courtesy the char-grid click handler gives - "기본값
  //으로" changes the character selection too, so preview that immediately
  // rather than leaving the pet window showing the old pick until Save.
  window.focusPetAPI.previewCharacter(defaults.character);
});

init();
