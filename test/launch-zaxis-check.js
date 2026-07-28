// Round 8 issue 1 verification - drives the REAL idle state machine
// (pet3d.js's ?live=1 mode, same technique test/launch-idle-cycle-flicker.js
// and CLAUDE.md's other "loop until we see it" checks use) with a fixed dt
// per step rather than waiting on real wall-clock idle-pool RNG timing,
// until each species' new Z-axis idle (prowlcircle/chasetail/hopspin/
// wheelrun) actually gets picked, then captures a numeric trace
// (depthZ/lateralX/spinAngle every step) plus a screenshot sequence across
// that behavior's full duration - both the math AND the actual render, not
// just one or the other (this codebase's established two-track verification
// habit). (`approach`, this round's 5th Z-axis idle, was removed in round
// 11 issue 3 - see animal-engine.js's IDLE_BEHAVIORS comment - so it's no
// longer in the job list below.)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'zaxis-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const JOBS = [
  { species: 'cat_a', idle: 'prowlcircle' },
  { species: 'dog_husky', idle: 'chasetail' },
  { species: 'rabbit_b', idle: 'hopspin' },
  { species: 'hamster', idle: 'wheelrun' },
];

const STEP_DT = 0.05; // 50ms simulated steps
const MAX_STEPS = 20000; // ~1000s simulated - generous given weight-1 entries against a pool totaling ~20-25

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[pet3d]', message);
  });

  for (const { species, idle } of JOBS) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species, live: '1' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);

    // Fast-forward until the target idle is picked (or bail out after
    // MAX_STEPS - would indicate a wiring bug, e.g. a typo'd name in the
    // idlePool that never resolves to anything real).
    const found = await win.webContents.executeJavaScript(`
      (function() {
        for (let i = 0; i < ${MAX_STEPS}; i++) {
          window.focusPet3D.stepIdle(${STEP_DT});
          const dbg = window.focusPet3D.getIdleDebug();
          if (dbg.currentIdleName === '${idle}' && dbg.behaviorTimer < ${STEP_DT} * 1.5) {
            return { hitAtStep: i };
          }
        }
        return null;
      })()
    `);
    if (!found) {
      console.log(`${species}/${idle}: NEVER PICKED in ${MAX_STEPS} steps - possible wiring bug`);
      continue;
    }
    console.log(`${species}/${idle}: picked at step ${found.hitAtStep}`);

    // Now step through this behavior's ENTIRE duration, capturing a
    // numeric trace every step and a screenshot at a handful of points.
    const trace = [];
    let frameIdx = 0;
    const SHOT_EVERY = 4; // ~5 screenshots across a typical 2-6s duration at 0.2s/shot
    while (true) {
      const dbg = await win.webContents.executeJavaScript(`
        (function() {
          window.focusPet3D.stepIdle(${STEP_DT});
          const dbg = window.focusPet3D.getIdleDebug();
          return { name: dbg.currentIdleName, t: dbg.behaviorTimer, pose: {
            depthZ: dbg.pose.depthZ, lateralX: dbg.pose.lateralX,
            spinOverride: dbg.pose.spinOverride, spinAngle: dbg.pose.spinAngle,
            hopY: dbg.pose.hopY, legPhase: dbg.pose.legPhase,
          }};
        })()
      `);
      if (dbg.name !== idle) break; // behavior ended, moved on to the next
      trace.push(dbg);
      if (trace.length % SHOT_EVERY === 0) {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(OUT_DIR, `${species}-${idle}-f${String(frameIdx).padStart(2, '0')}.png`), img.toPNG());
        frameIdx++;
      }
      if (trace.length > 400) break; // safety valve
    }
    console.log(`${species}/${idle}: traced ${trace.length} steps, captured ${frameIdx} frames`);
    fs.writeFileSync(path.join(OUT_DIR, `${species}-${idle}-trace.json`), JSON.stringify(trace, null, 1));
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
