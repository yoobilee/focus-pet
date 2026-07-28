// Round 10 issue 4 verification ("360도 회전 등이 끝나고 원래 자세로
// 돌아올 때 부자연스럽게 툭 튕기듯 돌아옴"). Loads the real windows/pet/
// window standalone (no main.js, same pattern as launch-continuous-
// rotation-test.js) and uses a temporary debug hook
// (__rotationSnapTestHook__, removed after this verification) to directly
// inject the exact post-spin-idle handoff scenario: currentRotationY left
// at a large multi-lap value (as chasetail's spinAngle can genuinely reach,
// see its own POSE_FIELD_BOUNDS comment - ~16.5 rad at 5.5rad/s over 3s)
// while bodyRotationTargetY sits at a normal small cursor-tracked target -
// then samples consecutive rendered frames (both the numeric
// currentRotationY trace AND actual screenshots) to confirm the return is
// a smooth monotonic decay along the shortest path, not a multi-revolution
// snap/whirl.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'rotation-snap-frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

ipcMain.handle('get-settings', () => ({ character: 'dog_husky' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  // Simulate: a chasetail idle just ended (spinOverride flipped back to
  // false, which happens naturally for whatever idle is active right now -
  // none of the default-weighted idles set spinOverride), leaving
  // currentRotationY at ~5.25 laps (16.5 rad) while the cursor-tracked
  // target sits at a normal small angle deep in [-pi, 0].
  const START = 16.5;
  const TARGET = -1.2;

  // Wait for a non-spin idle to be active (the common case - breathe alone
  // has roughly half the total idle-pool weight), inject right after
  // confirming it, and start the sampling rAF loop in the SAME
  // executeJavaScript call so nothing else can run render() in between.
  const injectAndSample = (ms) => `
    new Promise((resolve) => {
      function tryInject() {
        if (window.__rotationSnapTestHook__.spinOverride) {
          setTimeout(tryInject, 30);
          return;
        }
        window.__rotationSnapTestHook__.currentRotationY = ${START};
        window.__rotationSnapTestHook__.bodyRotationTargetY = ${TARGET};
        const samples = [];
        const t0 = performance.now();
        function sample() {
          samples.push({ t: performance.now() - t0, y: window.__rotationSnapTestHook__.currentRotationY, spinOverride: window.__rotationSnapTestHook__.spinOverride });
          if (performance.now() - t0 < ${ms}) requestAnimationFrame(sample);
          else resolve(samples);
        }
        requestAnimationFrame(sample);
      }
      tryInject();
    });
  `;

  const trace = await win.webContents.executeJavaScript(injectAndSample(1200));
  fs.writeFileSync(path.join(OUT_DIR, 'trace.json'), JSON.stringify(trace, null, 1));

  // Screenshot sequence: re-inject the same way, then step through delays.
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      function tryInject() {
        if (window.__rotationSnapTestHook__.spinOverride) { setTimeout(tryInject, 30); return; }
        window.__rotationSnapTestHook__.currentRotationY = ${START};
        window.__rotationSnapTestHook__.bodyRotationTargetY = ${TARGET};
        resolve();
      }
      tryInject();
    })
  `);
  const shotDelaysMs = [0, 40, 80, 120, 180, 260, 360, 500, 700, 1000];
  for (const delay of shotDelaysMs) {
    await new Promise((r) => setTimeout(r, delay === shotDelaysMs[0] ? 0 : delay - shotDelaysMs[shotDelaysMs.indexOf(delay) - 1]));
    const img = await win.webContents.capturePage();
    const y = await win.webContents.executeJavaScript('window.__rotationSnapTestHook__.currentRotationY');
    fs.writeFileSync(path.join(OUT_DIR, `frame-t${String(delay).padStart(4, '0')}ms-y${y.toFixed(3)}.png`), img.toPNG());
  }

  // Analysis. IMPORTANT: TARGET's angular equivalents are TARGET+2*pi*k for
  // any integer k - a correct shortest-path ease converges to whichever
  // equivalent is nearest to the START value (here that's k=3, ~17.65, only
  // ~1.15 rad from the 16.5 start - NOT literal -1.2, which is 17.7 rad
  // away the "long way"). So "distance to target" must be measured with the
  // same wrapped math the fix itself uses, not raw subtraction - otherwise
  // this check would flag the fix's correct shortest-path convergence as a
  // failure. normalizeAngleDelta is reimplemented inline here (Node, not a
  // module import) but is byte-for-byte the same formula as animal-engine.js's.
  const normalizeAngleDelta = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  let maxFrameDelta = 0;
  let monotonic = true;
  let prevDist = Math.abs(normalizeAngleDelta(trace[0].y - TARGET));
  for (let i = 1; i < trace.length; i++) {
    const delta = Math.abs(trace[i].y - trace[i - 1].y);
    if (delta > maxFrameDelta) maxFrameDelta = delta;
    const dist = Math.abs(normalizeAngleDelta(trace[i].y - TARGET));
    if (dist > prevDist + 1e-6) monotonic = false;
    prevDist = dist;
  }
  const nearestEquivalentTarget = TARGET + Math.PI * 2 * Math.round((trace[0].y - TARGET) / (Math.PI * 2));
  console.log('start', trace[0].y, 'end', trace[trace.length - 1].y);
  console.log('literal target', TARGET, '-> nearest angular equivalent to the start value:', nearestEquivalentTarget);
  console.log('final angular distance to target (wrapped):', Math.abs(normalizeAngleDelta(trace[trace.length - 1].y - TARGET)).toFixed(4));
  console.log('frames captured', trace.length);
  console.log('max single-frame |delta y|:', maxFrameDelta, '(bound: pi =', Math.PI, ')');
  console.log('wrapped distance-to-target monotonically non-increasing:', monotonic);
  console.log(maxFrameDelta < Math.PI && monotonic ? 'PASS - smooth shortest-path decay, no snap' : 'FAIL - jump or oscillation detected');

  app.quit();
});
