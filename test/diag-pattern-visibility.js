// Round 10 REGRESSION check ("왼쪽 몸통 줄무늬가 사라짐") - unlike
// diag-tabby-zfight.js (which only detects INSTABILITY between adjacent
// angles and therefore can't see a stable-but-wrong state), this counts
// how many pixels of the pattern stripe color (#c9743a -> 201,116,58)
// are actually visible at each checkpoint around the full circle, so a
// side that's silently embedded/invisible every frame shows up as a
// flat 0 instead of just "no flicker".
const { app, BrowserWindow } = require('electron');
const path = require('path');

const CHECKPOINTS = [0, 45, 90, 135, 180, 225, 270, 315];
const PATTERN_COLOR = '201,116,58';
const BODY_COLOR = '232,147,90';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_a', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

  for (const deg of CHECKPOINTS) {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 80));
    const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
    const w = dump.w, h = dump.h;
    let patternCount = 0, bodyCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const key = `${dump.buf[idx]},${dump.buf[idx + 1]},${dump.buf[idx + 2]}`;
        if (key === PATTERN_COLOR) patternCount++;
        else if (key === BODY_COLOR) bodyCount++;
      }
    }
    console.log(`${deg}deg: pattern pixels=${patternCount}, body-only pixels=${bodyCount}`);
  }
  app.quit();
});
