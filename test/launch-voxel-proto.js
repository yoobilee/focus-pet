// PROTOTYPE launcher (feature/3d-space branch) - completely separate from
// the real app's main.js, on purpose: this is exploratory rendering-only
// work (see CLAUDE.md's "3D 복셀 공간 실험" note), not yet wired into the
// pet window/behavior system. Run directly with electron, e.g.:
//   npx electron test/launch-voxel-proto.js -- cat_a static out.png
//   npx electron test/launch-voxel-proto.js -- dog_husky spin out.png
// Loads windows/pet3d/index.html with the given species (and spin=1 if
// requested), waits for a frame to render (checked via
// window.focusPet3D.ready/frameCount rather than a blind timeout), then
// captures a screenshot via capturePage() - same technique used
// throughout this project's test/ scripts for verifying real rendered
// output rather than reasoning about code alone.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const species = argv[0] || 'cat_a';
const mode = argv[1] || 'static'; // 'static' or 'spin'
const outPath = argv[2] || path.join(__dirname, `voxel-${species}-${mode}.png`);
const spinFrames = argv[3] ? parseInt(argv[3], 10) : null; // for spin mode: how many rAF frames to let play before capturing (undefined/null = just wait a fixed short time)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 480,
    height: 480,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet3d] ${message} (${sourceId}:${line})`);
  });

  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species, spin: mode === 'spin' ? '1' : '0' },
  });

  if (mode === 'spin' && spinFrames) {
    // Let the spin animation play for a specific number of rendered
    // frames (polled via window.focusPet3D.frameCount) before capturing,
    // so successive captures can be compared at known points in the
    // rotation rather than at an arbitrary wall-clock moment.
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const target = ${spinFrames};
        const check = () => {
          if (window.focusPet3D && window.focusPet3D.frameCount >= target) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
    `);
  } else {
    // Static mode (or spin with no explicit frame target): just wait for
    // the first real frame to confirm rendering succeeded.
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => {
          if (window.focusPet3D && window.focusPet3D.ready) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
    `);
  }

  const img = await win.webContents.capturePage();
  fs.writeFileSync(outPath, img.toPNG());
  console.log(`wrote ${outPath}`);
  app.quit();
});

app.on('window-all-closed', () => {}); // keep alive until we explicitly quit above
