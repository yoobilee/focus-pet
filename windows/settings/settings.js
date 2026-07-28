import { createAnimal, GRID_W, GRID_H, PX, CHARACTERS } from '../shared/animal-engine.js';

const charGrid = document.getElementById('char-grid');
const intervalSection = document.getElementById('interval-section');
const idleSection = document.getElementById('idle-section');
const intervalInput = document.getElementById('intervalMinutes');
const idleInput = document.getElementById('idleThresholdSeconds');
const positionSelect = document.getElementById('position');
const soundCheckbox = document.getElementById('soundEnabled');
const soundVolumeInput = document.getElementById('soundVolume');
const soundVolumeLabel = document.getElementById('soundVolumeLabel');
const messagesTextarea = document.getElementById('messages');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');

let currentCharacter = 'cat_a';

function renderCharThumb(canvas, key) {
  canvas.width = GRID_W * PX;
  canvas.height = GRID_H * PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const anim = createAnimal(key);
  anim.draw(ctx);
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
  idleInput.value = settings.idleThresholdSeconds;
  positionSelect.value = settings.position;
  soundCheckbox.checked = settings.soundEnabled;
  // soundVolume is stored 0..1 (see settingsStore.js); the slider itself
  // works in 0..100 for a friendlier percent display.
  const volumePercent = Math.round((settings.soundVolume ?? 0.5) * 100);
  soundVolumeInput.value = volumePercent;
  soundVolumeLabel.textContent = `소리 크기 (${volumePercent}%)`;
}

async function init() {
  buildCharGrid();
  const settings = await window.focusPetAPI.getSettings();
  fillForm(settings);

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', updateModeVisibility);
  });
  soundVolumeInput.addEventListener('input', () => {
    soundVolumeLabel.textContent = `소리 크기 (${soundVolumeInput.value}%)`;
  });
}

saveBtn.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'interval';
  const messages = messagesTextarea.value
    .split('\n')
    .map((m) => m.trim())
    .filter(Boolean);

  const newSettings = {
    character: currentCharacter,
    mode,
    intervalMinutes: Number(intervalInput.value) || 25,
    idleThresholdSeconds: Number(idleInput.value) || 90,
    position: positionSelect.value,
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
