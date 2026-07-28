// Round 10 issue 2 (this round) - the user explicitly flagged that BOTH
// prior "verified" rounds for prowlcircle (round 8's parameter retune,
// round 9's re-check) only ever drove windows/pet3d/pet3d.js's simulated
// ?live=1 mode (accelerated/manual stepIdle calls), never the REAL
// windows/pet/ app's own natural requestAnimationFrame loop + real random
// idle-pool timing end-to-end. This script does exactly that: loads the
// real pet.js window standalone (no main.js, same pattern as
// launch-continuous-rotation-test.js) for all 4 cat species AT ONCE (in
// parallel, so total wall-clock time is bounded by the slowest one, not
// the sum), lets REAL time pass, polls a minimal READ-ONLY temp debug hook
// (__idleReadHook__, added to pet.js for this verification only - removed
// after) until prowlcircle is naturally selected by the real RNG, then
// captures a screenshot burst across that activation and measures the
// ACTUAL on-screen bounding-box center from the captured pixels (alpha
// channel - the real window is transparent) - not a pose-value trace, a
// literal "where are the non-transparent pixels in this PNG" measurement,
// so there is no layer left where a real-world rendering-pipeline bug
// could hide from the previous simulation-only verification.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'prowlcircle-realapp');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese'];
const speciesByWebContentsId = new Map();

ipcMain.handle('get-settings', (event) => ({
  character: speciesByWebContentsId.get(event.sender.id) || 'cat_a',
}));

function bboxFromPNG(buf, w, h) {
  // buf is a raw RGBA bitmap (from nativeImage.toBitmap(), BGRA on this
  // platform per electron's own convention - but we only need the ALPHA
  // channel, which is byte offset 3 regardless of R/B channel order).
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
  log('window ready, waiting for real RNG to pick prowlcircle...');

  const POLL_MS = 700;
  const MAX_WAIT_MS = 8 * 60 * 1000; // generous - expected wait is ~2-3 real minutes at prowlcircle's ~3.8% pick weight
  const startWait = Date.now();
  let dbg = null;
  while (Date.now() - startWait < MAX_WAIT_MS) {
    dbg = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null');
    if (dbg && dbg.currentIdleName === 'prowlcircle') break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!dbg || dbg.currentIdleName !== 'prowlcircle') {
    log('TIMED OUT waiting for prowlcircle - giving up on this species');
    win.close();
    return { speciesKey, timedOut: true, frames: [] };
  }
  log(`prowlcircle detected after ${((Date.now() - startWait) / 1000).toFixed(1)}s real time - capturing burst`);

  const frames = [];
  const CAPTURE_MS = [0, 400, 800, 1200, 1600, 2000, 2500, 3000, 3600, 4200];
  const t0 = Date.now();
  for (const targetMs of CAPTURE_MS) {
    const waitMore = targetMs - (Date.now() - t0);
    if (waitMore > 0) await new Promise((r) => setTimeout(r, waitMore));
    const dbgNow = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null');
    if (!dbgNow || dbgNow.currentIdleName !== 'prowlcircle') {
      log(`activation ended early at t=${targetMs}ms (idle now: ${dbgNow ? dbgNow.currentIdleName : 'null'}) - stopping capture`);
      break;
    }
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    const bitmap = img.toBitmap();
    const bbox = bboxFromPNG(bitmap, size.width, size.height);
    const fname = `${speciesKey}-t${String(targetMs).padStart(4, '0')}ms.png`;
    fs.writeFileSync(path.join(OUT_DIR, fname), img.toPNG());
    frames.push({
      t: targetMs,
      file: fname,
      bbox,
      pose: { lateralX: dbgNow.pose.lateralX, depthZ: dbgNow.pose.depthZ, spinAngle: dbgNow.pose.spinAngle },
    });
    log(`t=${targetMs}ms bbox=${JSON.stringify(bbox)} pose.lateralX=${dbgNow.pose.lateralX.toFixed(3)} pose.depthZ=${dbgNow.pose.depthZ.toFixed(3)}`);
  }

  win.close();
  return { speciesKey, timedOut: false, frames };
}

app.whenReady().then(async () => {
  // SEQUENTIAL, not Promise.all - a diagnostic run (test/diag-single-
  // window-idle-check.js) found that running 4 pet windows CONCURRENTLY
  // in one process causes real resource contention (cat_a/cat_tuxedo's
  // idle state machine got stuck reporting currentIdleName=null for a
  // full 90s straight when loaded alongside 3 siblings, but cycled
  // completely normally within seconds when loaded alone) - an artifact
  // of the parallel TEST harness, not a real bug, but one that would have
  // invalidated this exact verification (3 of 4 species "timed out"
  // waiting for prowlcircle in the parallel version, purely because their
  // animal loop was stalled, not because prowlcircle itself never got
  // picked). The real app only ever runs ONE pet window at a time, so
  // sequential is what actually matches real usage anyway - slower here,
  // but the only methodologically valid way to test this.
  const results = [];
  for (const key of SPECIES) results.push(await runSpecies(key));
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 1));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.timedOut) { console.log(`${r.speciesKey}: TIMED OUT (prowlcircle never naturally selected within the wait window)`); continue; }
    const validBboxes = r.frames.filter((f) => f.bbox);
    if (validBboxes.length < 2) { console.log(`${r.speciesKey}: only ${validBboxes.length} valid frame(s), cannot assess movement`); continue; }
    const cxs = validBboxes.map((f) => f.bbox.cx);
    const cys = validBboxes.map((f) => f.bbox.cy);
    const ws = validBboxes.map((f) => f.bbox.w);
    const cxSwing = Math.max(...cxs) - Math.min(...cxs);
    const cySwing = Math.max(...cys) - Math.min(...cys);
    const wSwing = Math.max(...ws) - Math.min(...ws);
    console.log(`${r.speciesKey}: ${validBboxes.length} frames, on-screen bbox-center X swing=${cxSwing}px, Y swing=${cySwing}px, width(scale) swing=${wSwing}px`);
    console.log(`  cx sequence: ${cxs.join(', ')}`);
    console.log(`  cy sequence: ${cys.join(', ')}`);
  }
  app.quit();
});
