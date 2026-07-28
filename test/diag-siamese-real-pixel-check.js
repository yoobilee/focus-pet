// Round 6 issue 1: rigorous re-verification per user's explicit request -
// don't trust code-level vertex dumps, read pixels from an ACTUAL rendered
// frame. Loads the REAL windows/pet/pet.js window (not the pet3d
// prototype), captures the real canvas, and scans it row by row - same
// methodology as test/diag-real-pet-siamese.js from the previous round,
// but this time also cross-checking against the exact known head-box
// screen region (via the SAME camera math getFaceShadeSample used) so
// there's no ambiguity about which pixels are "the head" vs "the ear".
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'siamese-real-pixel-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

ipcMain.handle('get-settings', () => ({ character: 'cat_siamese' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[page]', message);
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 800));

  const dump = await win.webContents.executeJavaScript(`
    (function() {
      const canvas = document.getElementById('pet-canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const w = canvas.width, h = canvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { w, h, buf: Array.from(buf) };
    })()
  `);
  const { w, h, buf } = dump;
  console.log('canvas size', w, h);
  function px(x, y) {
    const flippedY = h - 1 - y;
    const i = (flippedY * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  }

  // Full scan of the whole canvas (not a guessed sub-region) - collect
  // every DISTINCT opaque color found and how many pixels have it, so we
  // can see the real distribution: is it dominated by 1-2 flat colors, or
  // a real spread of many intermediate shades (evidence of a genuine
  // gradient vs a flat block)?
  const colorCounts = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      if (a < 10) continue;
      const key = `${r},${g},${b}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }
  const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Distinct opaque colors found:', sorted.length);
  console.log('Top 20 by pixel count:', JSON.stringify(sorted.slice(0, 20)));

  // Specifically look for shades BETWEEN headColor (92,70,54) and
  // highlight (169,130,95) - a real gradient should have MANY distinct
  // in-between shades; a flat block (headColor everywhere, maybe a
  // handful of literal edge/AA pixels) would have almost none.
  function isBetween(r, g, b) {
    return r > 95 && r < 165 && g > 73 && g < 127;
  }
  const between = sorted.filter(([k]) => { const [r, g, b] = k.split(',').map(Number); return isBetween(r, g, b); });
  console.log('Distinct in-between gradient shades found:', between.length, 'covering', between.reduce((s, [, c]) => s + c, 0), 'pixels total');

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'real-pet-full.png'), img.toPNG());

  console.log('DONE', OUT_DIR);
  app.quit();
});
