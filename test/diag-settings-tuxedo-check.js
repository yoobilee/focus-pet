// Round 17 sanity check: cat_tuxedo's belly field became an array this
// round (voxel-engine.js's V-taper work) - the settings window's character
// grid still uses the 2D renderer (drawCreature) for its thumbnails, so
// this confirms that path handles an array belly without erroring/crashing.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('../settingsStore');

let settings = { ...store.DEFAULTS, character: 'cat_tuxedo' };
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-defaults', () => store.DEFAULTS);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420, height: 560, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  let sawError = false;
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) { sawError = true; console.error('[settings]', message); }
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'settings', 'index.html'));
  await new Promise((r) => setTimeout(r, 800));
  console.log('Console errors seen:', sawError);
  const img = await win.webContents.capturePage();
  require('fs').writeFileSync(path.join(__dirname, 'settings-tuxedo-check.png'), img.toPNG());
  console.log('DONE');
  app.quit();
});
