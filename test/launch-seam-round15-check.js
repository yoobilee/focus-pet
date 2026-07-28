// Round 15 verification screenshots - all 10 species at 0deg (profile,
// where the leg-collar removal is easiest to see at the shoulder/hip) and
// 270deg (near-front, where the neck-collar removal/retention is easiest
// to see against the head-body junction - matches prior rounds' angle
// choices for this same junction).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'seam-round15-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];
const ANGLES = [0, 270];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });

  for (const key of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: key, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 250));
      await win.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${key}-${String(deg).padStart(3, '0')}.png`), img.toPNG());
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
