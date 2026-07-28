// Round 10 issue 2 verification - renders a visual DIFF: takes two
// near-identical-angle captures (0deg, 0.3deg) and produces an image
// where any pixel that changed color between them is painted bright
// magenta, everything else dimmed - so the flicker (or its absence) is
// visible at a glance instead of needing to spot single-pixel changes in
// a normal side-by-side crop. Run once with the fix in place (current
// state) and once with it reverted (git stash equivalent - handled by
// the caller toggling the nudge constants) to get a true before/after.
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'tabby-zfight');

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

  const raws = [];
  for (const deg of [0, 0.1]) {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 60));
    raws.push(await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()'));
  }
  const [a, b] = raws;
  const w = a.w, h = a.h;
  // Build a diff bitmap: unchanged pixels shown dimmed (as-is / 3), any
  // changed pixel painted bright magenta - top-down for nativeImage.
  const out = Buffer.alloc(w * h * 4);
  let changedCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((h - 1 - y) * w + x) * 4; // raw buffer is bottom-up
      const dstIdx = (y * w + x) * 4;
      const ar = a.buf[srcIdx], ag = a.buf[srcIdx + 1], ab = a.buf[srcIdx + 2];
      const br = b.buf[srcIdx], bg = b.buf[srcIdx + 1], bb = b.buf[srcIdx + 2];
      const changed = Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb) > 30;
      if (changed) {
        changedCount++;
        // BGRA order - createFromBitmap expects BGRA (confirmed empirically:
        // an RGBA fill made the cat's orange body render navy-blue in the
        // "unchanged/dimmed" pixels; magenta is symmetric under R/B swap so
        // it looked right either way and almost masked this).
        out[dstIdx] = 255; out[dstIdx + 1] = 0; out[dstIdx + 2] = 255; out[dstIdx + 3] = 255;
      } else {
        out[dstIdx] = Math.round(ab / 2.5); out[dstIdx + 1] = Math.round(ag / 2.5); out[dstIdx + 2] = Math.round(ar / 2.5); out[dstIdx + 3] = 255;
      }
    }
  }
  const img = nativeImage.createFromBitmap(out, { width: w, height: h });
  const big = img.resize({ width: w * 6, height: h * 6, quality: 'nearest' });
  const tag = process.env.TAG || 'unlabeled';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `diff-${tag}.png`), big.toPNG());
  console.log(tag, 'changed pixels:', changedCount, 'of', w * h);
  app.quit();
});
