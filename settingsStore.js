const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Legacy keys from earlier character rosters - mapped to their closest
// surviving equivalent so an existing settings.json doesn't just silently
// fall back to the default character after a roster change.
const LEGACY_CHARACTER_MAP = {
  cat: 'cat_a',
  rabbit: 'rabbit_b',
  cat_b: 'cat_tuxedo',
  rabbit_a: 'rabbit_b',
  rabbit_c: 'rabbit_b',
  panda: 'hamster',
  dog: 'dog_dachshund',
  dog_pug: 'dog_pomeranian',
};

const VALID_CHARACTERS = new Set([
  'cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese',
  'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian',
  'rabbit_b', 'hamster',
]);

const DEFAULTS = {
  character: 'cat_a',      // cat_a | cat_tuxedo | cat_calico | cat_siamese | dog_dachshund | dog_corgi | dog_husky | dog_pomeranian | rabbit_b | hamster
  mode: 'interval',        // interval | idle | both
  intervalMinutes: 25,
  idleThresholdSeconds: 90,
  soundEnabled: true,
  position: 'bottom-right', // bottom-right | bottom-left | top-right | top-left
  paused: false,
  messages: [
    '집중할 시간이에요! 🧐',
    '허리 좀 펴볼까요? 🙆',
    '눈 좀 쉬게 해주세요 👀',
    '물 한 잔 마시고 와요 💧',
    '딴 길로 샌 건 아니죠? 😼'
  ]
};

function getFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  const file = getFilePath();
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.character && LEGACY_CHARACTER_MAP[parsed.character]) {
        parsed.character = LEGACY_CHARACTER_MAP[parsed.character];
      }
      if (!VALID_CHARACTERS.has(parsed.character)) {
        parsed.character = DEFAULTS.character;
      }
      return { ...DEFAULTS, ...parsed };
    }
  } catch (e) {
    console.error('설정 로드 실패, 기본값 사용:', e);
  }
  return { ...DEFAULTS };
}

function save(settings) {
  const file = getFilePath();
  try {
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('설정 저장 실패:', e);
    return false;
  }
}

module.exports = { load, save, DEFAULTS };
