import { createAnimal, GRID_W, GRID_H, PX, CHARACTERS } from '../shared/animal-engine.js';

const charGrid = document.getElementById('char-grid');
const intervalSection = document.getElementById('interval-section');
const idleSection = document.getElementById('idle-section');
const intervalInput = document.getElementById('intervalMinutes');
const idleInput = document.getElementById('idleThresholdSeconds');
const positionSelect = document.getElementById('position');
const soundCheckbox = document.getElementById('soundEnabled');
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
  messagesTextarea.value = (settings.messages || []).join('\n');
}

async function init() {
  buildCharGrid();
  const settings = await window.focusPetAPI.getSettings();
  fillForm(settings);

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', updateModeVisibility);
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
    messages: messages.length ? messages : undefined
  };

  await window.focusPetAPI.saveSettings(newSettings);
  window.focusPetAPI.closeSettings();
});

resetBtn.addEventListener('click', async () => {
  const defaults = await window.focusPetAPI.getDefaults();
  fillForm(defaults);
});

init();
