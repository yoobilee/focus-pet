// Round 9 issue 1 verification - precisely-centered crops right at the
// head/body seam, computed from the REAL head-mesh world position
// (getBodyDebug) converted through the known camera mapping (FRUSTUM=26,
// CENTER_Y=11, established in prior rounds) rather than guessing pixel
// offsets from a full-frame screenshot, which twice landed on the wrong
// region this round.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'frontdetail-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const FRUSTUM = 26, CENTER_Y = 11;
// Species where headColor falls back to bodyColor (the exact "no visible
// seam" complaint) - cover a cat and a dog for the write-up, plus one
// that already had a DIFFERENT headColor (dog_husky) as a control (the
// outline should still show there too, just less critically needed).
const JOBS = [
  { key: 'cat_a', angles: [0, 45, 90, 270] },
  { key: 'dog_dachshund', angles: [0, 270] },
  { key: 'rabbit_b', angles: [0, 270] },
  { key: 'dog_husky', angles: [0, 270] },
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
      await new Promise((r) => setTimeout(r, 200));
      const dbg = await win.webContents.executeJavaScript(`window.focusPet3D.getBodyDebug()`);
      // The actual seam is at the head's BOTTOM edge, not its center - a
      // first attempt used the head mesh's center Y (getBodyDebug) and the
      // crop landed well above the seam, on plain uninterrupted head
      // color. getBBoxDebug's head AABB gives the true bottom edge
      // directly, independent of how tall any given species' head is.
      const bbox = await win.webContents.executeJavaScript(`window.focusPet3D.getBBoxDebug()`);
      const seamWorldY = bbox.head.min.y;
      await win.webContents.capturePage(); // warm-up
      await new Promise((r) => setTimeout(r, 150));
      await win.webContents.capturePage(); // second warm-up, see this round's own NaN-vs-timing false lead - kept as extra insurance
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      // capturePage()'s pixel dimensions are the WINDOW's backing-store
      // size (devicePixelRatio-scaled - 600x600 for a "480x480"
      // BrowserWindow in this environment, confirmed by reading a prior
      // capture's own PNG header rather than assuming), NOT the <canvas>
      // element's internal render resolution (96x96, RENDER_SIZE in
      // pet3d.js) - conflating the two is exactly what made the first
      // attempt at this crop land on blank background again even after
      // fixing the seam-Y math, since a 96-scale pixel offset is tiny
      // relative to a 600px-wide captured image. Read the ACTUAL capture
      // size back from the image itself instead of assuming either number.
      const capSize = img.getSize();
      const px = Math.round(((dbg.head.x + FRUSTUM / 2) / FRUSTUM) * capSize.width);
      const py = Math.round(((CENTER_Y + FRUSTUM / 2 - seamWorldY) / FRUSTUM) * capSize.height);
      const half = Math.round(capSize.width * 0.22);
      const cropX = Math.max(0, Math.min(capSize.width - half * 2, px - half));
      const cropY = Math.max(0, Math.min(capSize.height - half * 2, py - half));
      const cropped = img.crop({ x: cropX, y: cropY, width: half * 2, height: half * 2 }).resize({ width: half * 2 * 3, height: half * 2 * 3, quality: 'good' });
      fs.writeFileSync(path.join(OUT_DIR, `neckseam-${key}-${String(deg).padStart(3, '0')}.png`), cropped.toPNG());
      console.log(key, deg, 'head world', dbg.head, '-> px', px, py);
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
