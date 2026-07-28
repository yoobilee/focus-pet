// Round 10 REGRESSION verification - "왼쪽 몸통 줄무늬가 사라짐". Renders
// cat_a from a "left" checkpoint (180deg, one of the ones diag-pattern-
// visibility.js found at exactly 0 pattern pixels before the fix) and a
// "right" checkpoint (0deg, already working before the fix) side by side
// as separate crops, so both can be eyeballed directly.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'tabby-stripe-lr');
fs.mkdirSync(OUT_DIR, { recursive: true });

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

  for (const [label, deg] of [['right-000deg', 0], ['left-180deg', 180], ['left-135deg', 135], ['left-225deg', 225]]) {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage();
    const scale = img.getSize().width / 96;
    const crop = { x: 0, y: Math.round(20 * scale), width: Math.round(96 * scale), height: Math.round(60 * scale) };
    const cropped = img.crop(crop).resize({ width: crop.width * 4, height: crop.height * 4, quality: 'good' });
    fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), cropped.toPNG());
    console.log('wrote', label);
  }
  app.quit();
});
