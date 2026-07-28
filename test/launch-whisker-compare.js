// Round 10 issue 3 verification - before/after comparison for cat_calico
// specifically (the most dramatic case: near-white face #faf3e6 vs the
// old fixed cream whisker color #f5f0e8, nearly indistinguishable).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'frontdetail-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_calico', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(270 * Math.PI) / 180})`);
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.capturePage();
  await new Promise((r) => setTimeout(r, 150));
  const img = await win.webContents.capturePage();
  const scale = img.getSize().width / 96;
  const crop = { x: Math.round(25 * scale), y: Math.round(30 * scale), width: Math.round(46 * scale), height: Math.round(30 * scale) };
  const cropped = img.crop(crop).resize({ width: crop.width * 5, height: crop.height * 5, quality: 'good' });
  fs.writeFileSync(path.join(OUT_DIR, `whisker-${process.env.TAG || 'unlabeled'}-cat_calico.png`), cropped.toPNG());
  console.log('wrote whisker-' + (process.env.TAG || 'unlabeled') + '-cat_calico.png');
  app.quit();
});
