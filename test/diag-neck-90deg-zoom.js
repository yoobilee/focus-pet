const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'neck-90deg-zoom');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  for (const speciesKey of ['cat_a', 'cat_tuxedo', 'dog_corgi', 'dog_husky']) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: speciesKey, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${Math.PI / 2})`);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage();
    const full = img.resize({ width: 480, height: 480, quality: 'good' });
    fs.writeFileSync(path.join(OUT_DIR, `${speciesKey}-90deg-full.png`), full.toPNG());
    console.log('wrote', speciesKey);
  }
  app.quit();
});
