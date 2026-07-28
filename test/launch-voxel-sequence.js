// PROTOTYPE sequence capture (feature/3d-space branch) - loads one voxel
// creature once, then steps through several specific Y-rotation angles
// (via window.focusPet3D.setAngle, see pet3d.js) and captures a
// screenshot at each, all from a single Electron process launch. Used to
// judge "does the silhouette/color-blocking still read at various
// rotation angles" - a sequence of static angles is more useful for this
// than sampling an auto-spin at arbitrary moments.
// Usage: npx electron test/launch-voxel-sequence.js cat_a
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const species = process.argv[2] || 'cat_a';
const ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

app.whenReady().then(async () => {
  // show:true + a settle delay before each capturePage() - a show:false
  // window's WebGL canvas updates correctly on setAngle() but capturePage()
  // intermittently grabs a stale compositor frame (same root cause as the
  // FPS-measurement throttling; confirmed via toDataURL() staying correct
  // while capturePage() lagged - see launch-voxel-batch.js/CLAUDE.md).
  const win = new BrowserWindow({
    width: 480,
    height: 480,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet3d] ${message} (${sourceId}:${line})`);
  });

  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species, spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => {
        if (window.focusPet3D && window.focusPet3D.ready) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  `);

  for (const deg of ANGLES_DEG) {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const outPath = path.join(__dirname, `voxel-seq-${species}-${String(deg).padStart(3, '0')}.png`);
    fs.writeFileSync(outPath, img.toPNG());
    console.log(`wrote ${outPath}`);
  }

  app.quit();
});

app.on('window-all-closed', () => {});
