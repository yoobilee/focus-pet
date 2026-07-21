const SPRITE_BASE = '../../assets/sprites';
const CHARACTERS = ['cat', 'dog', 'rabbit', 'panda', 'hamster'];

const stageEl = document.getElementById('stage');
const petWrapEl = document.getElementById('pet-wrap');
const petSpriteEl = document.getElementById('pet-sprite');
const bubbleEl = document.getElementById('bubble');
const bubbleTextEl = document.getElementById('bubble-text');
const gearBtn = document.getElementById('gear');

const WRAP_WIDTH = 96;
const MARGIN = 16;
const SPEED = 42; // px per second
const FRAME_INTERVAL_MS = 220;

let character = 'cat';
let x = MARGIN;
let direction = 1; // 1 = right, -1 = left
let paused = false;
let pauseUntil = 0;
let lastFrameSwapAt = 0;
let currentFrame = 'A';
let lastTs = null;
let bubbleTimeout = null;

function spriteSrc(frame) {
  return `${SPRITE_BASE}/${character}_${frame}.png`;
}

function bounds() {
  const stageWidth = stageEl.clientWidth;
  return { min: MARGIN, max: Math.max(MARGIN, stageWidth - WRAP_WIDTH - MARGIN) };
}

function applyCharacter(key) {
  character = CHARACTERS.includes(key) ? key : 'cat';
  petSpriteEl.src = spriteSrc(currentFrame);
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // ignore audio errors silently
  }
}

function showBubble(message) {
  bubbleTextEl.textContent = message;
  bubbleEl.classList.remove('hidden');
  requestAnimationFrame(() => bubbleEl.classList.add('show'));

  paused = true;
  pauseUntil = 0;
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => {
    bubbleEl.classList.remove('show');
    paused = false;
    setTimeout(() => bubbleEl.classList.add('hidden'), 250);
  }, 6000);
}

function render() {
  petWrapEl.style.transform = `translateX(${x}px)`;
  petSpriteEl.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';
  petSpriteEl.src = spriteSrc(paused ? 'A' : currentFrame);
}

function tick(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  if (!paused) {
    const { min, max } = bounds();
    x += direction * SPEED * dt;

    if (x <= min) { x = min; direction = 1; pauseUntil = ts + (600 + Math.random() * 1200); paused = true; }
    if (x >= max) { x = max; direction = -1; pauseUntil = ts + (600 + Math.random() * 1200); paused = true; }

    if (ts - lastFrameSwapAt > FRAME_INTERVAL_MS) {
      currentFrame = currentFrame === 'A' ? 'B' : 'A';
      lastFrameSwapAt = ts;
    }
  } else if (pauseUntil && ts >= pauseUntil) {
    paused = false;
    pauseUntil = 0;
  }

  render();
  requestAnimationFrame(tick);
}

gearBtn.addEventListener('click', () => {
  window.focusPetAPI.openSettings();
});

window.focusPetAPI.getSettings().then((settings) => {
  applyCharacter(settings.character);
});

window.focusPetAPI.onSettingsUpdated((settings) => {
  applyCharacter(settings.character);
});

window.focusPetAPI.onReminder(({ message, soundEnabled }) => {
  showBubble(message);
  if (soundEnabled) playBeep();
});

requestAnimationFrame(tick);
