// Round 17 verification screenshots.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'round17-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const JOBS = [
  { species: 'dog_pomeranian', angles: [0, 45, 270, 315] },
  { species: 'cat_tuxedo', angles: [0, 45, 90, 135, 180, 225, 270, 315] },
  { species: 'dog_dachshund', angles: [0, 315, 45] },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });

  for (const { species, angles } of JOBS) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of angles) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 200));
      await win.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${species}-${String(deg).padStart(3, '0')}.png`), img.toPNG());
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
