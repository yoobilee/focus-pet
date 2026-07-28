// Round 8 feature 3 verification: exercises the REAL preload.js/pet.js/
// settings.js code through a minimal stand-in for main.js's window
// orchestration (creates both windows, wires the same IPC channels
// main.js registers) so the actual click -> preview -> (no save) close ->
// revert flow can be driven and captured end to end, not just
// unit-verified in isolation.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('../settingsStore');

const OUT_DIR = path.join(__dirname, 'preview-test-frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

let settings = { ...store.DEFAULTS, character: 'cat_a' };
let petWindow, settingsWindow;

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-defaults', () => store.DEFAULTS);
ipcMain.handle('save-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  if (petWindow) petWindow.webContents.send('settings-updated', settings);
  return settings;
});
ipcMain.on('close-settings', () => { if (settingsWindow) settingsWindow.close(); });
ipcMain.on('preview-character', (event, key) => {
  if (petWindow) petWindow.webContents.send('preview-character', key);
});

app.whenReady().then(async () => {
  petWindow = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  petWindow.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[pet]', message);
  });
  await petWindow.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  async function capturePet(label) {
    const img = await petWindow.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), img.toPNG());
    const dump = await petWindow.webContents.executeJavaScript(`
      (function() {
        const canvas = document.getElementById('pet-canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const buf = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        // Sum all opaque pixel colors as a simple fingerprint - different
        // characters have very different color palettes/silhouettes.
        let sum = [0,0,0], count = 0;
        for (let i = 0; i < buf.length; i += 4) {
          if (buf[i+3] > 10) { sum[0]+=buf[i]; sum[1]+=buf[i+1]; sum[2]+=buf[i+2]; count++; }
        }
        return { avgColor: sum.map(v => Math.round(v/Math.max(1,count))), opaquePixels: count };
      })()
    `);
    console.log(label, JSON.stringify(dump));
    return dump;
  }

  console.log('--- initial (cat_a) ---');
  const initial = await capturePet('1-initial-cat_a');

  settingsWindow = new BrowserWindow({
    width: 420, height: 560, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  settingsWindow.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[settings]', message);
  });
  // Matches main.js's own createSettingsWindow 'closed' handler exactly -
  // my test harness re-implements main.js's window orchestration rather
  // than requiring the real file (which would run the real app's tray/
  // timers/etc under this test), so this has to be copied by hand.
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (petWindow) petWindow.webContents.send('settings-updated', settings);
  });
  await settingsWindow.loadFile(path.join(__dirname, '..', 'windows', 'settings', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  // Click the dog_husky character button (a very different palette from
  // cat_a - gray/white vs orange - so the fingerprint comparison below is
  // unambiguous), via a real DOM click on the actual rendered button.
  const clicked = await settingsWindow.webContents.executeJavaScript(`
    (function() {
      const btn = document.querySelector('.char-btn[data-key="dog_husky"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  console.log('clicked dog_husky button:', clicked);
  await new Promise((r) => setTimeout(r, 400));

  console.log('--- after preview click (should be dog_husky) ---');
  const previewed = await capturePet('2-previewed-dog_husky');

  // Close settings WITHOUT saving (no click on Save - just close the
  // window directly, like the user clicking the OS close button).
  settingsWindow.close();
  await new Promise((r) => setTimeout(r, 500));

  console.log('--- after closing settings without saving (should revert to cat_a) ---');
  const reverted = await capturePet('3-reverted-cat_a');

  const changed = JSON.stringify(initial.avgColor) !== JSON.stringify(previewed.avgColor);
  const revertedOk = JSON.stringify(initial.avgColor) === JSON.stringify(reverted.avgColor);
  console.log('Preview actually changed the pet:', changed);
  console.log('Reverted back to original after close-without-save:', revertedOk);

  // Additional check: preview + actually Save should persist (not
  // revert) - re-open settings, preview rabbit_b, click Save for real,
  // confirm the pet window keeps showing rabbit_b afterward.
  settingsWindow = new BrowserWindow({
    width: 420, height: 560, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (petWindow) petWindow.webContents.send('settings-updated', settings);
  });
  await settingsWindow.loadFile(path.join(__dirname, '..', 'windows', 'settings', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));
  await settingsWindow.webContents.executeJavaScript(`document.querySelector('.char-btn[data-key="rabbit_b"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  await settingsWindow.webContents.executeJavaScript(`document.getElementById('saveBtn').click()`);
  await new Promise((r) => setTimeout(r, 600)); // save -> closeSettings() -> window 'closed' fires too
  console.log('--- after preview rabbit_b + actual Save (should stay rabbit_b) ---');
  const saved = await capturePet('4-saved-rabbit_b');
  console.log('Settings window still open (should be false, Save closes it):', settingsWindow !== null);

  console.log('DONE', OUT_DIR);
  app.quit();
});
