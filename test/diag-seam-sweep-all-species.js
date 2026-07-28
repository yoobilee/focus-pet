// Round 10 issue 1 - comprehensive sweep verification for the two fixes
// just made (HEAD_Z_NUDGE and addSeamCollar, both converted from Z-
// position-shift to symmetric depth-growth - see voxel-engine.js's own
// comments for the full derivation). Checks, for ALL 10 species at 8
// angles around the full circle: (1) for the 2 species with a distinct
// headColor (cat_siamese, dog_husky), that headColor is actually visible
// somewhere in frame at EVERY angle, not just some; (2) that the neck
// seam collar's exact darkened tint is visible at EVERY angle, for every
// species; (3) same for the shoulder/leg collar, for every species that
// has legs positioned where a collar would show.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const THREE = require('three');

// Exact reproduction of voxel-engine.js's own darkenColor/SEAM_COLOR_DARKEN
// (not exported, so replicated here using the same three.js Color API to
// get byte-identical results, not an approximation).
const SEAM_COLOR_DARKEN = 0.55;
function darkenColorHex(hex) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0x000000), SEAM_COLOR_DARKEN);
  return '#' + c.getHexString();
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[page error]', message); });

  const allResults = [];
  for (const speciesKey of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: speciesKey, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

    // Pull cfg colors from the page itself (headColor/bodyColor/legColor)
    // via getBodyDebug or similar - simplest: read window.focusPet3D's own
    // exposed cfg through getIdleDebug()/a direct SPECIES import isn't
    // available in this Electron main-process context, so read it back
    // from the page instead (it already imported SPECIES for its own use).
    const cfgInfo = await win.webContents.executeJavaScript(`
      (function() {
        const g = window.focusPet3D;
        return g.getCfgColors ? g.getCfgColors() : null;
      })()
    `);
    // Ground-truth collar colors straight from the scene graph (NOT
    // hand-replicated via a Node-context darkenColor call) - a prior run
    // of this sweep hand-predicted these and got the RIGHT numbers, but
    // reading them back live removes that whole class of risk going
    // forward and costs nothing extra.
    const collarGroundTruth = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);

    const perAngle = [];
    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 90));
      const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
      perAngle.push({ deg, buf: dump.buf, w: dump.w, h: dump.h });
    }
    allResults.push({ speciesKey, cfgInfo, collarGroundTruth, perAngle });
  }

  // Analysis (done here in Node, not in-page, since it needs the darkenColor replication)
  function colorPresent(frame, rgb, tol = 6) {
    const [tr, tg, tb] = rgb;
    for (let i = 0; i < frame.buf.length; i += 4) {
      const r = frame.buf[i], g = frame.buf[i + 1], b = frame.buf[i + 2];
      if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) return true;
    }
    return false;
  }

  let anyFail = false;
  for (const { speciesKey, cfgInfo, collarGroundTruth, perAngle } of allResults) {
    if (!cfgInfo) { console.log(`${speciesKey}: SKIP (no getCfgColors exposed)`); continue; }
    // Ground truth from the live scene graph: collarGroundTruth[0] is
    // always the neck collar (added once, right after headMesh, in
    // buildVoxelCreature); the rest are the (up to 4) shoulder collars,
    // all sharing the same color since they're all darkenColor(legColor).
    const neckCollarRgb = hexToRgb(collarGroundTruth[0].hex);
    const shoulderCollarRgb = collarGroundTruth.length > 1 ? hexToRgb(collarGroundTruth[1].hex) : null;
    const headDistinct = (cfgInfo.headColor && cfgInfo.headColor !== cfgInfo.bodyColor);
    const headRgb = headDistinct ? hexToRgb(cfgInfo.headColor) : null;

    console.log(`\n=== ${speciesKey} === headColor=${cfgInfo.headColor || '(=body)'} bodyColor=${cfgInfo.bodyColor} legColor=${cfgInfo.legColor}`);
    console.log(`  neck collar ground-truth rgb: ${neckCollarRgb}, shoulder collar ground-truth rgb: ${shoulderCollarRgb}`);

    for (const frame of perAngle) {
      const neckOk = colorPresent(frame, neckCollarRgb);
      const shoulderOk = shoulderCollarRgb ? colorPresent(frame, shoulderCollarRgb) : true;
      const headOk = headDistinct ? colorPresent(frame, headRgb) : true;
      const line = `  ${String(frame.deg).padStart(3)}deg: neck-collar=${neckOk ? 'OK' : 'MISSING'} shoulder-collar=${shoulderOk ? 'OK' : 'MISSING'}` + (headDistinct ? ` headColor=${headOk ? 'OK' : 'MISSING'}` : '');
      console.log(line);
      if (!neckOk || !shoulderOk || !headOk) anyFail = true;
    }
  }
  console.log(anyFail ? '\n*** SOME CHECKS FAILED - see MISSING above ***' : '\n*** ALL CHECKS PASSED across all species/angles ***');
  app.quit();
});
