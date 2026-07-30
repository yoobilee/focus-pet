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
  mode: 'interval',        // interval | idle - 'both' was retired (see load()'s migration below) - running both timers unsuppressed could fire far more often than either one alone, see main.js's applyTimers
  intervalMinutes: 30,
  idleThresholdSeconds: 900, // 15 minutes - the settings UI now shows/edits this field in minutes (see windows/settings/settings.js), but it's still stored in seconds internally, same as before
  soundEnabled: true,
  soundVolume: 0.5,        // 0..1, multiplies the notification knock's own peak gain (see pet.js's playBeep) - defaults to 50%, an existing settings.json without this field falls back here via the {...DEFAULTS, ...parsed} spread in load() below
  // Replaces the old 4-way 'position' (bottom-right/bottom-left/top-right/
  // top-left) field entirely - the pet is now always ground-anchored to the
  // taskbar (see main.js's groundWindowY), so a discrete corner choice no
  // longer means anything; horizontal placement is purely "wherever it was
  // last dragged/snapped to" (not persisted - see main.js's createPetWindow
  // comment for why). This is what actually replaces it as a user-facing
  // choice: stationary (today's behavior - idle pool only) or pacing (walks
  // the taskbar edge-to-edge, resting at each end - see pet.js's pacing
  // state machine).
  movementMode: 'stationary', // stationary | pacing
  paused: false,
  messages: [
    '저기요, 저 아직 살아있어요... 집중 좀 해주실래요? 🐾',
    '화면 반, 딴생각 반... 비율 조정이 필요해 보이는데요? 👀',
    '저는 펫이지 장식품이 아니에요. 봐주세요!',
    '지금 시선 처리... 저 아니고 다른 데 가있죠?',
    '허리는 왜 그렇게 굽어있어요, 새우도 아니고...',
    '물 마실 시간! 저처럼 촉촉하게 살아요 💧',
    '딴짓 탐지... 3, 2, 1... 걸렸다!',
    '잠깐, 지금 몇 분째 그 탭 보고 계신 거예요?',
    '저 심심해요. 근데 그쪽도 집중 안 하고 있는 거 다 보여요.',
    '눈 좀 깜빡여요, 화면이 얼굴에 붙을 기세인데.',
    '생산성 요정 등장! 근데 마법은 못 부리고 잔소리만 해요.',
    '지금이 딱 스트레칭 타이밍입니다, 삐걱대는 소리 들려요.'
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
      // 'both' mode retired - it ran the interval timer and the idle-poll
      // timer completely independently, with no cooldown/dedup between
      // them (see main.js's applyTimers/fireReminder), so a user with
      // bursty activity could get reminders far more often than either
      // timer alone would suggest. No longer selectable in the settings
      // UI; an existing settings.json saved with mode:'both' from before
      // falls back to 'interval' (the more predictable of the two,
      // rather than silently switching behavior to 'idle') instead of
      // silently keeping the old double-timer behavior forever.
      if (parsed.mode === 'both') {
        parsed.mode = 'interval';
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
