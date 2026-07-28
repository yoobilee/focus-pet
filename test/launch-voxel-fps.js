// PROTOTYPE fps check (feature/3d-space branch) - loads the spin mode and
// polls window.focusPet3D.frameCount against wall-clock time to get an
// actual measured frame rate, rather than just eyeballing a screenshot
// (which can't show motion at all) or assuming requestAnimationFrame
// "must" be smooth. Usage: npx electron test/launch-voxel-fps.js cat_a
const { app, BrowserWindow } = require('electron');
const path = require('path');

const species = process.argv[2] || 'cat_a';

app.whenReady().then(async () => {
  // show:true this time - backgroundThrottling:false alone didn't fix the
  // ~1fps reading (still throttled), so the window needs to actually be
  // shown/composited for requestAnimationFrame to run at a normal rate at
  // all in this environment - a real pet window is always visible anyway,
  // so this matches the real use case, not just a workaround for the test.
  const win = new BrowserWindow({ width: 480, height: 480, show: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error(`[pet3d] ${message}`);
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species, spin: '1' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  const before = await win.webContents.executeJavaScript('window.focusPet3D.frameCount');
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 3000));
  const after = await win.webContents.executeJavaScript('window.focusPet3D.frameCount');
  const elapsed = (Date.now() - t0) / 1000;
  const fps = (after - before) / elapsed;
  console.log(`frames: ${before} -> ${after} over ${elapsed.toFixed(2)}s = ${fps.toFixed(1)} fps`);
  app.quit();
});

app.on('window-all-closed', () => {});
