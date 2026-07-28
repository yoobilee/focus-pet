// PROTOTYPE batch capture (feature/3d-space branch) - renders every given
// species at two angles (0° side view, 270° front-face view - the two
// most informative angles from the front/back detail check) in a single
// Electron process, reusing one BrowserWindow. Usage:
//   npx electron test/launch-voxel-batch.js cat_tuxedo cat_calico ...
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const species = process.argv.slice(2);
const ANGLES = [0, 270];

app.whenReady().then(async () => {
  // show:true - a show:false window's WebGL canvas updates correctly (confirmed
  // via toDataURL()) but capturePage() intermittently grabs a stale compositor
  // frame for a hidden window (same root cause as the FPS-measurement throttling
  // found earlier - see CLAUDE.md); this cost 3 of 8 species an identical
  // 0deg/270deg pair in the first batch run.
  const win = new BrowserWindow({ width: 480, height: 480, show: true });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error(`[pet3d] ${message}`);
  });

  for (const key of species) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: key, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      // setAngle's renderer.render() call is synchronous, but the compositor
      // that capturePage() reads from lags behind the WebGL draw by a
      // non-deterministic amount (confirmed via toDataURL() showing the
      // correct new frame immediately while capturePage() still intermittently
      // returned a stale one, on different species each run) - a settle delay
      // is the reliable fix, not show:true alone.
      await new Promise((r) => setTimeout(r, 120));
      const img = await win.webContents.capturePage();
      const outPath = path.join(__dirname, `voxel-batch-${key}-${String(deg).padStart(3, '0')}.png`);
      fs.writeFileSync(outPath, img.toPNG());
      console.log(`wrote ${outPath}`);
    }
  }

  app.quit();
});

app.on('window-all-closed', () => {});
