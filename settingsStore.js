const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  character: 'cat',        // cat | dog | rabbit | panda | hamster
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
