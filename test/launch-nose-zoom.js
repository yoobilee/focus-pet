// Precisely-centered nose crop: computes the actual screen pixel location
// of the nose group from its real world position (after rotating to the
// nose-forward angle) via the known orthographic camera mapping
// (FRUSTUM=26, CENTER_Y=11, pet3d.js), instead of guessing crop
// coordinates from a wide shot - the first two guesses missed the nose
// entirely (one showed a stretched-looking oversized bar, the other
// landed on the ear/eye).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'frontdetail-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

// capturePage() returns backing-store pixels, not CSS pixels - this
// window's actual capture came back 600x600 for a "480x480" BrowserWindow
// (devicePixelRatio 1.25 in this environment), found by reading a
// previous capture's PNG header directly rather than assuming 1:1.
const FRUSTUM = 26, CENTER_Y = 11, CANVAS = 600;
const SPECIES = ['dog_husky', 'rabbit_b'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: CANVAS, height: CANVAS, show: true, frame: false });
  for (const key of SPECIES) {
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
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(270 * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 150));
    // Established project pattern (CLAUDE.md's "capturePage() 자체의 알려진
    // 타이밍 이슈") - the very first capturePage() after a fresh loadFile
    // can return a stale/empty compositor frame; a throwaway capture
    // "warms up" the pipeline before the one that's actually used. Was
    // returning a 0x0 crop for whichever species loaded first until this
    // was added.
    await win.webContents.capturePage();
    await new Promise((r) => setTimeout(r, 100));
    const dump = await win.webContents.executeJavaScript(`window.focusPet3D.getNoseDetailDebug()`);
    const noseBase = dump[0]; // base nose mesh is always children[0]
    const px = Math.round(((noseBase.pos.x + FRUSTUM / 2) / FRUSTUM) * CANVAS);
    const py = Math.round(((CENTER_Y + FRUSTUM / 2 - noseBase.pos.y) / FRUSTUM) * CANVAS);
    console.log(key, 'nose world', noseBase.pos, '-> screen px', px, py);

    const img = await win.webContents.capturePage();
    // half=40 originally clipped the nostril dots almost exactly at the
    // crop edge (they sit ~38px off-center at this scale, per the Z=1.65
    // grid-unit offset converted through FRUSTUM/CANVAS) - widened so both
    // sit comfortably inside with margin instead of right on the boundary.
    const half = 65;
    const rawCrop = img.crop({ x: px - half, y: py - half, width: half * 2, height: half * 2 });
    console.log(key, 'rawCrop size', rawCrop.getSize(), 'isEmpty', rawCrop.isEmpty());
    const cropped = rawCrop.resize({ width: 640, height: 640, quality: 'good' });
    fs.writeFileSync(path.join(OUT_DIR, `${key}-nosezoom.png`), cropped.toPNG());
  }
  console.log('DONE');
  app.quit();
});
