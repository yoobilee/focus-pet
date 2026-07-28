// Round 6 issue 2 verification: loads the real windows/pet/ window
// standalone (no main.js, so none of its polls interfere - same pattern
// as the earlier rotation-direction test) and dispatches synthetic
// mousemove events at several cursor X positions relative to the pet's
// center, checking that the body rotation target scales CONTINUOUSLY and
// proportionally instead of snapping between two states. A temporary
// debug hook (__getRotationDebug2__, removed after this verification)
// reads back bodyRotationTargetY/currentRotationY/direction numerically.
//
// Run: npx electron test/launch-continuous-rotation-test.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'continuous-rotation-frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

ipcMain.handle('get-settings', () => ({ character: 'dog_husky' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  // Pet center in this 340px-wide window: x starts at MARGIN=16,
  // WRAP_WIDTH=96 -> center = 16+48 = 64 (CSS px). CURSOR_DIRECTION_RANGE
  // is 130px.
  const PET_CENTER_X = 64;
  const RANGE = 130;
  const cases = [
    { label: 'dx+1.0-full-right', clientX: PET_CENTER_X + RANGE * 1.0, expectedClampedDx: 1.0 },
    { label: 'dx+0.6', clientX: PET_CENTER_X + RANGE * 0.6, expectedClampedDx: 0.6 },
    { label: 'dx+0.3', clientX: PET_CENTER_X + RANGE * 0.3, expectedClampedDx: 0.3 },
    { label: 'dx+0.0-center', clientX: PET_CENTER_X, expectedClampedDx: 0.0 },
    { label: 'dx-0.3', clientX: PET_CENTER_X - RANGE * 0.3, expectedClampedDx: -0.3 },
    { label: 'dx-0.6', clientX: PET_CENTER_X - RANGE * 0.6, expectedClampedDx: -0.6 },
    { label: 'dx-1.0-full-left', clientX: PET_CENTER_X - RANGE * 1.0, expectedClampedDx: -1.0 },
  ];

  const results = [];
  for (const c of cases) {
    // Dispatch a real mousemove DOM event - pet.js's own window-level
    // listener picks this up exactly as it would a genuine cursor move,
    // no synthetic test-only hook needed for the input side.
    await win.webContents.executeJavaScript(`
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${c.clientX}, clientY: 100 }));
    `);
    // Let the exponential ease (rate 8, ~0.35s to 95%) fully settle.
    await new Promise((r) => setTimeout(r, 900));
    const dbg = await win.webContents.executeJavaScript(`
      (function() {
        // Read the module-scope values via a one-off Function constructed
        // in this page's own module context isn't possible from outside,
        // so this relies on the temp debug hook added for this test.
        return window.__getRotationDebug2__ ? window.__getRotationDebug2__() : null;
      })()
    `);
    results.push({ ...c, dbg });
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${c.label}.png`), img.toPNG());
  }

  console.log(JSON.stringify(results, null, 1));
  console.log('DONE', OUT_DIR);
  app.quit();
});
