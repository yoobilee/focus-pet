const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'siamese-gradient-final');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_siamese', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  for (const deg of [0, 45, 90]) {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 100));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `siamese-${String(deg).padStart(3, '0')}.png`), img.toPNG());
    const sz = img.getSize();
    const cropped = img.crop({ x: Math.round(sz.width * 0.55), y: Math.round(sz.height * 0.2), width: Math.round(sz.width * 0.35), height: Math.round(sz.height * 0.35) });
    const big = cropped.resize({ width: cropped.getSize().width * 3, height: cropped.getSize().height * 3, quality: 'good' });
    fs.writeFileSync(path.join(OUT_DIR, `siamese-${String(deg).padStart(3, '0')}-crop.png`), big.toPNG());
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
