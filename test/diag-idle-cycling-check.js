// Round 10 issue 2 follow-up diagnostic - 3 of 4 cat species never
// naturally picked prowlcircle in an 8-minute real-time window each
// (jointly far too improbable to be chance at ~3.8% pick weight). Before
// assuming a prowlcircle-specific selection bug, first check the more
// mundane possibility: is the idle state machine even cycling normally
// for these species, or is something (a silent JS exception, a stuck
// transition) freezing it on one idle indefinitely? Captures console
// errors AND the full sequence of distinct idle names observed over a
// shorter (90s) window for all 4 species in parallel.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese'];
const speciesByWebContentsId = new Map();

ipcMain.handle('get-settings', (event) => ({
  character: speciesByWebContentsId.get(event.sender.id) || 'cat_a',
}));

async function runSpecies(speciesKey) {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  speciesByWebContentsId.set(win.webContents.id, speciesKey);
  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) consoleErrors.push(`[${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    consoleErrors.push(`RENDER PROCESS GONE: ${JSON.stringify(details)}`);
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  const idleSequence = [];
  const timestamps = [];
  const t0 = Date.now();
  const WINDOW_MS = 90 * 1000;
  while (Date.now() - t0 < WINDOW_MS) {
    const dbg = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null').catch((e) => ({ error: String(e) }));
    const name = dbg && dbg.currentIdleName;
    if (idleSequence.length === 0 || idleSequence[idleSequence.length - 1] !== name) {
      idleSequence.push(name);
      timestamps.push(((Date.now() - t0) / 1000).toFixed(1));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  win.close();
  return { speciesKey, idleSequence, timestamps, consoleErrors, transitionCount: idleSequence.length };
}

app.whenReady().then(async () => {
  const results = await Promise.all(SPECIES.map(runSpecies));
  for (const r of results) {
    console.log(`\n=== ${r.speciesKey} ===`);
    console.log(`transitions observed in 90s: ${r.transitionCount}`);
    console.log(`sequence: ${r.idleSequence.map((n, i) => `${n}@${r.timestamps[i]}s`).join(' -> ')}`);
    if (r.consoleErrors.length) {
      console.log(`CONSOLE ERRORS (${r.consoleErrors.length}):`);
      r.consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e));
    } else {
      console.log('no console errors');
    }
  }
  app.quit();
});
