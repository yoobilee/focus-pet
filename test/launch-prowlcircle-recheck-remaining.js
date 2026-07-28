// Re-check just cat_calico and cat_siamese (cat_a/cat_tuxedo already
// confirmed working with genuine on-screen circular motion in the real
// app - see test/prowlcircle-realapp/results.json from the sequential
// run). Same methodology as launch-prowlcircle-real-app-check.js.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'prowlcircle-realapp');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_calico', 'cat_siamese'];
const speciesByWebContentsId = new Map();

ipcMain.handle('get-settings', (event) => ({
  character: speciesByWebContentsId.get(event.sender.id) || 'cat_a',
}));

function bboxFromPNG(buf, w, h) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

async function runSpecies(speciesKey) {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  speciesByWebContentsId.set(win.webContents.id, speciesKey);
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  const log = (msg) => console.log(`[${speciesKey}] ${msg}`);
  log('waiting for real RNG to pick prowlcircle...');

  const POLL_MS = 700;
  const MAX_WAIT_MS = 10 * 60 * 1000;
  const startWait = Date.now();
  let dbg = null;
  while (Date.now() - startWait < MAX_WAIT_MS) {
    dbg = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null');
    if (dbg && dbg.currentIdleName === 'prowlcircle') break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!dbg || dbg.currentIdleName !== 'prowlcircle') {
    log('TIMED OUT');
    win.close();
    return { speciesKey, timedOut: true, frames: [] };
  }
  log(`prowlcircle detected after ${((Date.now() - startWait) / 1000).toFixed(1)}s`);

  const frames = [];
  const CAPTURE_MS = [0, 400, 800, 1200, 1600, 2000, 2500, 3000, 3600, 4200];
  const t0 = Date.now();
  for (const targetMs of CAPTURE_MS) {
    const waitMore = targetMs - (Date.now() - t0);
    if (waitMore > 0) await new Promise((r) => setTimeout(r, waitMore));
    const dbgNow = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null');
    if (!dbgNow || dbgNow.currentIdleName !== 'prowlcircle') break;
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    const bitmap = img.toBitmap();
    const bbox = bboxFromPNG(bitmap, size.width, size.height);
    fs.writeFileSync(path.join(OUT_DIR, `${speciesKey}-t${String(targetMs).padStart(4, '0')}ms.png`), img.toPNG());
    frames.push({ t: targetMs, bbox });
    log(`t=${targetMs}ms bbox=${JSON.stringify(bbox)}`);
  }
  win.close();
  return { speciesKey, timedOut: false, frames };
}

app.whenReady().then(async () => {
  const results = [];
  for (const key of SPECIES) results.push(await runSpecies(key));
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.timedOut) { console.log(`${r.speciesKey}: TIMED OUT`); continue; }
    const valid = r.frames.filter((f) => f.bbox);
    const cxSwing = Math.max(...valid.map((f) => f.bbox.cx)) - Math.min(...valid.map((f) => f.bbox.cx));
    const cySwing = Math.max(...valid.map((f) => f.bbox.cy)) - Math.min(...valid.map((f) => f.bbox.cy));
    const wSwing = Math.max(...valid.map((f) => f.bbox.w)) - Math.min(...valid.map((f) => f.bbox.w));
    console.log(`${r.speciesKey}: ${valid.length} frames, X swing=${cxSwing}px, Y swing=${cySwing}px, scale swing=${wSwing}px`);
  }
  app.quit();
});
