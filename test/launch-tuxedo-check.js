// Round 4 issue 5 verification: cat_tuxedo's back/upper-body used to have
// a white patch (removed - see the `pattern` field's removal comment in
// animal-engine.js's SPECIES table). Captures a plain standing-pose
// screenshot to confirm the back now reads as solid black, with the
// chest/belly and paw-tip white markings still intact (untouched by this
// change).
// Run: npx electron test/launch-tuxedo-check.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'tuxedo-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_tuxedo', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);
  await new Promise((r) => setTimeout(r, 100));
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'tuxedo-side.png'), img.toPNG());

  // A slight turn (not full 270 front-on) so the back/spine is more
  // visible than the pure side profile, and the chest/belly still shows.
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(45 * Math.PI) / 180})`);
  await new Promise((r) => setTimeout(r, 100));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'tuxedo-45deg.png'), img.toPNG());

  console.log('DONE', OUT_DIR);
  app.quit();
});
