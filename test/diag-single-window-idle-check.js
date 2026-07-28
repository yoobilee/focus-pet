// Sanity check: does a SINGLE pet window (matching real single-instance
// app usage - main.js never creates more than one) cycle idles normally?
// The 4-parallel-windows diagnostic showed cat_a/cat_tuxedo stuck at
// currentIdleName=null for 90s straight, which smelled like a resource-
// contention artifact from concurrent window creation rather than a real
// per-species bug - this isolates a single species in its own process run
// to check.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const speciesKey = process.env.SPECIES || 'cat_a';
ipcMain.handle('get-settings', () => ({ character: speciesKey }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) consoleErrors.push(message); });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  const idleSequence = [];
  const t0 = Date.now();
  const WINDOW_MS = 60 * 1000;
  while (Date.now() - t0 < WINDOW_MS) {
    const dbg = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null').catch((e) => ({ error: String(e) }));
    const name = dbg && dbg.currentIdleName;
    if (idleSequence.length === 0 || idleSequence[idleSequence.length - 1].name !== name) {
      idleSequence.push({ name, t: ((Date.now() - t0) / 1000).toFixed(1) });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`[${speciesKey}] sequence:`, idleSequence.map((e) => `${e.name}@${e.t}s`).join(' -> '));
  console.log(`[${speciesKey}] console errors:`, consoleErrors.length ? consoleErrors : 'none');
  app.quit();
});
