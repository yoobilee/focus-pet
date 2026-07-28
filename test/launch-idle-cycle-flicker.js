// Round 4 issue 4 verification: fast-forwards cat_siamese through many
// REAL idle-state-machine transitions (via pet3d.js's live=1/stepIdle
// mode - the actual createAnimal()/update() code path, not a hand-picked
// pose) and, at sampled checkpoints, captures a screenshot TWICE in a row
// with no state change in between. If the two captures ever differ, that
// is exactly the flicker signature GROOM_WOBBLE used to produce (a
// real-time-driven value changing the render even though the logical
// pose/idle state did not) - the old bug was confirmed this way (0 diffs
// at rest, 448 toggling frames during groom) before GROOM_WOBBLE was
// removed and replaced with the deterministic, t-driven groomWipe field.
// Also dumps a couple of pixel samples from the face-gradient region to
// numerically confirm the siamese colorpoint gradient (issue 4's other
// half - addFaceShadedHeadBox in voxel-engine.js) is actually darker near
// the eye/nose and lighter toward the head's outer edge, not flat.
//
// Run: npx electron test/launch-idle-cycle-flicker.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'idle-cycle-frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  // frame:false - a titled OS window can have its own live chrome (title
  // bar text cursor, DPI-scaled frame borders, etc.) that capturePage()
  // would include and that has nothing to do with this page's own WebGL
  // canvas - ruling that out as a confound before trusting any pixel diff
  // found below.
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet3d] ${message} (${sourceId}:${line})`);
  });

  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_siamese', spin: '0', live: '1' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);

  const DT = 0.05;
  const STEPS_PER_CHECKPOINT = 40; // 2 simulated seconds between checkpoints
  const CHECKPOINTS = 200; // 400 simulated seconds total - enough for many idle-pool picks including low-weight ones like groom

  const idleCounts = {};
  let diffCount = 0;
  let diffDetails = [];

  for (let cp = 0; cp < CHECKPOINTS; cp++) {
    for (let s = 0; s < STEPS_PER_CHECKPOINT; s++) {
      await win.webContents.executeJavaScript(`window.focusPet3D.stepIdle(${DT})`);
    }
    const dbg = await win.webContents.executeJavaScript('window.focusPet3D.getIdleDebug()');
    const idleName = dbg.currentIdleName || 'none';
    idleCounts[idleName] = (idleCounts[idleName] || 0) + 1;

    // Small delay before EACH capture (not just once) - this project's own
    // prior investigation (see CLAUDE.md's "캡처 자체가 가끔 오래된 프레임을
    // 반환하는 버그" note) found capturePage() can occasionally return a
    // stale/not-yet-composited frame, fixed there with the same kind of
    // delay. Isolating whether that's what's producing any diff found here
    // (a capture-harness artifact) vs. a genuine render-state difference is
    // the whole point of this loop, so give the compositor room to settle
    // before BOTH captures, not just the first.
    await new Promise((r) => setTimeout(r, 60));
    const imgA = await win.webContents.capturePage();
    await new Promise((r) => setTimeout(r, 60));
    const imgB = await win.webContents.capturePage(); // no step in between - identical state, must render identically
    const bufA = imgA.toPNG(), bufB = imgB.toPNG();
    if (!bufA.equals(bufB)) {
      diffCount++;
      diffDetails.push({ checkpoint: cp, idleName, behaviorTimer: dbg.behaviorTimer });
      if (diffDetails.length <= 3) {
        fs.writeFileSync(path.join(OUT_DIR, `diff-cp${cp}-${idleName}-A.png`), bufA);
        fs.writeFileSync(path.join(OUT_DIR, `diff-cp${cp}-${idleName}-B.png`), bufB);
      }
    }
    if (cp === CHECKPOINTS - 1 || (idleName === 'groom' && !idleCounts.__groomSampleSaved)) {
      fs.writeFileSync(path.join(OUT_DIR, `sample-cp${cp}-${idleName}.png`), bufA);
      if (idleName === 'groom') idleCounts.__groomSampleSaved = true;
    }
  }

  console.log('Idle coverage over', CHECKPOINTS, 'checkpoints:', JSON.stringify(idleCounts));
  console.log('Flicker diffs (should be 0):', diffCount);
  if (diffDetails.length) console.log('Diff details:', JSON.stringify(diffDetails.slice(0, 10)));

  // Gradient sample check - independent of the flicker loop above, at rest
  // (default pose via setBodyPose({})) so the face gradient is judged in
  // isolation. Uses pet3d.js's getFaceShadeSample(), which projects the
  // actual faceShade focus point and the head-rect corner farthest from it
  // through the real camera/frustum and reads back real rendered pixels -
  // exact by construction, not a guessed screen region.
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  const gradImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'gradient-check.png'), gradImg.toPNG());
  const sample = await win.webContents.executeJavaScript('window.focusPet3D.getFaceShadeSample()');
  console.log('Face-shade sample:', JSON.stringify(sample));

  console.log('DONE', OUT_DIR);
  app.quit();
});
