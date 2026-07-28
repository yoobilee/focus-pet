// Round 8 issue 2 final verification pass - full-frame renders at the
// nose-forward angle (270 deg, per this rig's established convention) for
// every species with a front-detail addition, plus 0/45 deg side angles
// for whisker legibility. Single script covering the whole checklist so it
// can be rerun wholesale after any tweak instead of piecing together
// several one-off scripts.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'frontdetail-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const JOBS = [
  { key: 'cat_a', angles: [0, 45, 270] },
  { key: 'cat_tuxedo', angles: [270] },
  { key: 'cat_calico', angles: [270] },
  { key: 'cat_siamese', angles: [270] },
  { key: 'dog_husky', angles: [270] },
  { key: 'dog_corgi', angles: [270] },
  { key: 'dog_dachshund', angles: [270] },
  { key: 'dog_pomeranian', angles: [270] },
  { key: 'rabbit_b', angles: [270] },
  { key: 'hamster', angles: [270] },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[pet3d]', message);
  });

  for (const { key, angles } of JOBS) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: key, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of angles) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 300));
      await win.webContents.capturePage(); // warm-up, see CLAUDE.md's capturePage timing note
      await new Promise((r) => setTimeout(r, 200));
      await win.webContents.capturePage(); // second warm-up - round 9's extra outline meshes per part made the first-render noticeably heavier, the old single warm-up margin stopped being enough
      await new Promise((r) => setTimeout(r, 200));
      const img = await win.webContents.capturePage();
      const full = img.resize({ width: 480, height: 480, quality: 'good' });
      fs.writeFileSync(path.join(OUT_DIR, `final-${key}-${String(deg).padStart(3, '0')}.png`), full.toPNG());
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
