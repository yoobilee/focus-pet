// Round 5 issues 3/4: same raw-pixel scan as diag-siamese-gradient-scan.js
// but against the REAL windows/pet/pet.js rendering path (transparent
// background, alpha:true renderer, no debug green) - to rule out any
// difference between the pet3d.js prototype viewer and what the actual
// app renders.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'real-pet-siamese');
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
  await new Promise((r) => setTimeout(r, 600)); // let loadCharacter()/first frames settle

  // pet.js doesn't expose a debug hook at all right now - read the canvas
  // element's own backing pixels directly the same way its own
  // click-through hit test does (gl.readPixels on the #pet-canvas
  // context), via a one-off inline script. #pet-canvas is a plain DOM
  // element (not behind any module-scope closure issue) so this is safe
  // to reach from outside, unlike pet3d.js's renderer/canvas consts.
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

  for (let y = 20; y < 55; y += 2) {
    let row = '';
    for (let x = 40; x < 96; x++) {
      const [r, g, b, a] = px(x, y);
      row += a < 10 ? '        .        ' : `(${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)})`;
    }
    console.log(`y=${y}: ${row}`);
  }

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'real-pet-siamese.png'), img.toPNG());

  console.log('DONE', OUT_DIR);
  app.quit();
});
