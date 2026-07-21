const CHARACTERS = {
  cat: '🐱',
  dog: '🐶',
  rabbit: '🐰',
  panda: '🐼',
  hamster: '🐹'
};

const petCharEl = document.getElementById('pet-char');
const bubbleEl = document.getElementById('bubble');
const bubbleTextEl = document.getElementById('bubble-text');
const gearBtn = document.getElementById('gear');

let bubbleTimeout = null;

function applyCharacter(key) {
  petCharEl.textContent = CHARACTERS[key] || CHARACTERS.cat;
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

  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => {
    bubbleEl.classList.remove('show');
    setTimeout(() => bubbleEl.classList.add('hidden'), 250);
  }, 6000);
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
