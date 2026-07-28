// Round 10 issue 4 verification, part 2: applyPoseCrossfade's spinAngle
// special-case. Drives the REAL idle state machine (pet3d.js's ?live=1
// mode + stepIdle, same "driven simulation instead of waiting on real RNG
// timing" pattern as test/sim-invariants.mjs) for dog_husky, whose only
// circular idle is chasetail (duration ~2.5-3.5s). Every frame's
// pose.spinAngle (read via getIdleDebug()/inspect(), which snapshots the
// live anim.pose) IS the crossfade-blended value - so a same-idle restart
// (chasetail ends, a fresh chasetail gets picked right after) exercises
// exactly the scenario where `from.spinAngle` (however many laps the
// PREVIOUS activation accumulated) and `raw.spinAngle` (the NEW
// activation's fresh, small t=0-based value) both get blended together
// over the 0.25s transition window while spinOverride stays true the whole
// time - unlike the pet.js-level handoff test (part 1), which covers
// spinOverride flipping OFF, this covers it STAYING on across a boundary.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'dog_husky', spin: '0', live: '1' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);

  const DT = 0.03;
  const TOTAL_SIM_SECONDS = 900;
  const STEPS = Math.round(TOTAL_SIM_SECONDS / DT);

  const trace = await win.webContents.executeJavaScript(`
    (function() {
      const samples = [];
      for (let i = 0; i < ${STEPS}; i++) {
        window.focusPet3D.stepIdle(${DT});
        const dbg = window.focusPet3D.getIdleDebug();
        samples.push({
          spinAngle: dbg.pose.spinAngle,
          spinOverride: dbg.pose.spinOverride,
          idle: dbg.currentIdleName,
          transitionElapsed: dbg.transitionElapsed,
        });
      }
      return samples;
    })();
  `);

  // Find consecutive-frame pairs where spinOverride was true on BOTH sides
  // (so a real consumer - pet.js/pet3d.js's own stepIdle - would actually
  // be reading spinAngle across this exact pair) and flag any |delta|
  // bigger than a generous per-frame bound. chasetail's own fastest
  // natural angularSpeed is 3.4 rad/s (see its own apply()); at dt=0.03
  // that's ~0.102 rad/frame from legitimate motion alone, so use a bound
  // several times that (0.5 rad/frame) to comfortably clear normal motion
  // while still catching a multi-radian crossfade jump.
  const BOUND = 0.5;
  let maxDelta = 0;
  let maxDeltaAt = -1;
  let idleRestarts = 0;
  let violations = [];
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    // A transition boundary is any frame where transitionElapsed DROPPED
    // (resetPose() just re-snapshotted transitionFrom) - idle NAME alone
    // misses a same-name restart (chasetail ending and a fresh chasetail
    // getting picked immediately after is still "chasetail" -> "chasetail"
    // but is a genuine new activation with its own t=0 spinAngle).
    const isBoundary = b.transitionElapsed < a.transitionElapsed;
    if (isBoundary && a.spinOverride && b.spinOverride) idleRestarts++;
    if (!a.spinOverride || !b.spinOverride) continue;
    const delta = Math.abs(b.spinAngle - a.spinAngle);
    if (delta > maxDelta) { maxDelta = delta; maxDeltaAt = i; }
    if (delta > BOUND) violations.push({ i, a, b, delta });
  }
  console.log('total frames', trace.length, 'spin-idle-boundary transitions (idle name changed, override true both sides):', idleRestarts);
  console.log('max frame-to-frame |spinAngle delta| while spinOverride true both sides:', maxDelta.toFixed(4), 'at frame', maxDeltaAt);
  console.log('violations (> ' + BOUND + ' rad/frame):', violations.length);
  if (violations.length) console.log(JSON.stringify(violations.slice(0, 5), null, 1));
  console.log(violations.length === 0 && idleRestarts > 0 ? 'PASS - no crossfade jump across ' + idleRestarts + ' spin-idle boundaries' : (idleRestarts === 0 ? 'INCONCLUSIVE - no spin-idle boundary occurred in this run, try again' : 'FAIL'));
  app.quit();
});
