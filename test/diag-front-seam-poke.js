// Round 11 issue 1 verification ("정면에서 보면 다리-몸통/몸통-얼굴 경계에
// 이상한 선이 삐죽 튀어나와 보임") - checks, for ALL 10 species at all 8
// rotation checkpoints (0-315deg in 45deg steps, same sweep test/diag-seam-
// sweep-all-species.js used for round 10's visibility check), that neither
// seam collar (neck or shoulder) ever renders WIDER on screen than the rest
// of the creature's own silhouette - the exact shape of the reported bug
// (a colored band poking out past the body/head/leg edges).
//
// Method: classify every pixel in the raw framebuffer (getRawPixels, RGBA,
// no alpha channel to lean on since this viewer uses an opaque debug
// background - see pet3d.js's own scene.background comment) as background
// (matches the known debug green within a tolerance) or creature, then
// split "creature" further into "collar-colored" (matches one of the two
// ground-truth collar tints read straight from the scene graph via
// getSeamCollarColors, same anti-cross-context-color-mismatch technique
// diag-seam-sweep-all-species.js established) vs "everything else". If the
// collar-colored pixels' own X bounding box extends past the
// everything-else bounding box (by more than a couple pixels of slack for
// this file's own antialias:false rasterization jitter), that's the
// poke-out bug reproduced numerically, not just a hunch from a screenshot.
// Also keeps the round 10 "is the collar visible at all" check (a
// regression on THAT fix would be just as bad as re-introducing this one).
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const BG_RGB = [0x2a, 0x6b, 0x3a]; // matches pet3d.js's scene.background ('#2a6b3a')
const BG_TOL = 10;
const COLLAR_TOL = 4; // tight - these are exact darkenColor() outputs read back from the live material, not eyeballed
const POKE_SLACK_PX = 2; // antialias:false rasterization can land a silhouette edge a pixel or two differently frame to frame at a hard tie - only flag a genuine, comfortably-outside-slack excess

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function closeRgb(a, b, tol) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[page error]', message); });

  let anyFail = false;
  for (const speciesKey of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: speciesKey, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

    const collarGroundTruth = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
    const neckRgb = hexToRgb(collarGroundTruth[0].hex);
    const shoulderRgb = collarGroundTruth.length > 1 ? hexToRgb(collarGroundTruth[1].hex) : null;

    console.log(`\n=== ${speciesKey} === neck collar rgb=${neckRgb} shoulder collar rgb=${shoulderRgb || '(none)'}`);

    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 90));
      const { w, h, buf } = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');

      let creatureMinX = Infinity, creatureMaxX = -Infinity;
      let collarMinX = Infinity, collarMaxX = -Infinity;
      let collarSeen = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const rgb = [buf[i], buf[i + 1], buf[i + 2]];
          if (closeRgb(rgb, BG_RGB, BG_TOL)) continue; // background
          const isCollar = closeRgb(rgb, neckRgb, COLLAR_TOL) || (shoulderRgb && closeRgb(rgb, shoulderRgb, COLLAR_TOL));
          if (isCollar) {
            collarSeen = true;
            if (x < collarMinX) collarMinX = x;
            if (x > collarMaxX) collarMaxX = x;
          } else {
            if (x < creatureMinX) creatureMinX = x;
            if (x > creatureMaxX) creatureMaxX = x;
          }
        }
      }

      const visOk = collarSeen; // round 10 regression check - must still be visible somewhere
      const pokeLeft = collarSeen ? Math.max(0, creatureMinX - collarMinX) : 0;
      const pokeRight = collarSeen ? Math.max(0, collarMaxX - creatureMaxX) : 0;
      const pokeOk = pokeLeft <= POKE_SLACK_PX && pokeRight <= POKE_SLACK_PX;
      const status = visOk && pokeOk ? 'OK' : 'FAIL';
      if (status === 'FAIL') anyFail = true;
      console.log(`  ${String(deg).padStart(3)}deg: visible=${visOk} pokeLeft=${pokeLeft}px pokeRight=${pokeRight}px -> ${status}`);
    }
  }
  console.log(anyFail ? '\n*** SOME CHECKS FAILED ***' : '\n*** ALL CHECKS PASSED across all 10 species x 8 angles ***');
  app.quit();
});
