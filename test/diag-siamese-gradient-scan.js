// Round 5 issues 3/4 re-investigation: scan the ACTUAL rendered pixels of
// cat_siamese's head (not a raw geometry-attribute dump, and not a couple
// of hand-picked sample points) to see what the gradient really looks
// like on screen, at the real 96x96 render resolution the app actually
// uses (not the 480x480 upscaled prototype canvas).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'siamese-gradient-scan');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 200, height: 200, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[page]', message);
  });
  // Use the pet3d prototype but at RENDER_SIZE-matching small display -
  // pet3d.js always renders at the true 96x96 backing resolution
  // (RENDER_SIZE) regardless of the CSS display size, so this doesn't
  // change what's actually rendered, just what we screenshot.
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_siamese', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  await new Promise((r) => setTimeout(r, 150));

  // Read back the raw WebGL framebuffer directly (gl.readPixels over the
  // WHOLE 96x96 canvas), not via capturePage()/PNG - eliminates any
  // question about screenshot compositing/DPI scaling and lets us dump
  // exact per-pixel RGB for a horizontal scanline through the head.
  const dump = await win.webContents.executeJavaScript(`window.focusPet3D.getRawPixels()`);
  const { w, h, buf } = dump;
  console.log('canvas size', w, h);

  function px(x, y) {
    const flippedY = h - 1 - y; // gl.readPixels is bottom-left origin
    const i = (flippedY * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  }

  // scene.background is opaque debug green (#2a6b3a = 42,107,58) in this
  // prototype viewer, not transparent - distinguish "background" from
  // "creature" by RGB proximity to that known green instead of alpha.
  const isBg = (r, g, b) => Math.abs(r - 42) < 12 && Math.abs(g - 107) < 12 && Math.abs(b - 58) < 12;
  for (let y = 20; y < 55; y += 2) {
    let row = '';
    for (let x = 40; x < 96; x++) {
      const [r, g, b] = px(x, y);
      row += isBg(r, g, b) ? '        .        ' : `(${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)})`;
    }
    console.log(`y=${y}: ${row}`);
  }

  console.log('DONE');
  app.quit();
});
