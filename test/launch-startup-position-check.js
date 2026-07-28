// Round 10 issue 3 verification - captures the real pet window right after
// launch (same standalone-load pattern as the other launch-*.js scripts)
// to confirm the pet starts horizontally centered in the 340px-wide stage
// instead of at the old left-edge MARGIN position.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'startup-position');
fs.mkdirSync(OUT_DIR, { recursive: true });

ipcMain.handle('get-settings', () => ({ character: 'cat_a' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  // Give it a moment to render its first real frame, but this is close to
  // t=0 - the whole point is to see where it starts, not where it drifts
  // to.
  await new Promise((r) => setTimeout(r, 600));

  const x = await win.webContents.executeJavaScript('window.__idleReadHook__ ? "hook-not-relevant-here" : "ok"').catch(() => 'n/a');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'startup-full-stage.png'), img.toPNG());

  const bitmap = img.toBitmap();
  const size = img.getSize();
  let minX = size.width, maxX = -1, minY = size.height, maxY = -1;
  for (let y = 0; y < size.height; y++) {
    for (let px = 0; px < size.width; px++) {
      const a = bitmap[(y * size.width + px) * 4 + 3];
      if (a > 40) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  console.log('captured stage size:', size);
  console.log('creature bbox: x[' + minX + ',' + maxX + '] y[' + minY + ',' + maxY + ']');
  console.log('creature center X:', cx, '/ stage width:', size.width, '-> expected near', size.width / 2);
  console.log('creature center X as fraction of stage width:', (cx / size.width).toFixed(3), '(0.5 = perfectly centered, old behavior was ~0.19 for MARGIN=16,WRAP=96 in a 340px stage)');

  app.quit();
});
