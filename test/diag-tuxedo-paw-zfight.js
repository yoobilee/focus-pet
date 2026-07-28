// Round 11 issue 2 verification ("턱시도 고양이 발쪽이 아직 살짝
// 지지직거림") - cat_tuxedo is the only species with cfg.pawColor (grep-
// confirmed), so it's the only one that could ever hit the lowerMesh/
// pawMesh coincident-geometry bug addLegChain's own comment describes.
// Two checks: (1) geometry - lowerMesh and pawMesh's own LOCAL Y ranges no
// longer overlap at all (the actual fix - see addLegChain's comment for
// why "tile instead of stack" removes the z-fight rather than just
// margining it); (2) pixels - the same tiny-angle-delta flicker technique
// test/diag-neck-zfight.js/diag-tabby-zfight.js established (two coincident
// depth surfaces flip between colors well under 1 degree of rotation;
// legitimate geometry doesn't), filtered down to the one color-pair (leg
// black <-> paw white) that's this specific bug's actual fingerprint - see
// this file's own comment further down for why a blanket "zero flips
// anywhere" bar isn't the right one for this renderer.
const { app, BrowserWindow } = require('electron');
const path = require('path');

function closeRgb(a, b, tol = 6) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[page error]', message); });

  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: 'cat_tuxedo', spin: '0' } });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

  // --- Check 1: geometry (no Y overlap), in LOCAL space (see getLegDebug's
  // own comment on why a WORLD Box3 gives a false positive here once the
  // leg is rotated - lowerMesh/pawMesh share a parent with no rotation
  // between THEM, so their own local Y ranges are what actually matters) ---
  const legDebug = await win.webContents.executeJavaScript(`window.focusPet3D.getLegDebug()`);
  const [lowerMin, lowerMax] = legDebug.front.lowerLocalYRange;
  const [pawMin, pawMax] = legDebug.front.pawLocalYRange;
  console.log('frontLower local Y range:', lowerMin, '..', lowerMax);
  console.log('frontPaw   local Y range:', pawMin, '..', pawMax);
  const overlapY = Math.min(lowerMax, pawMax) - Math.max(lowerMin, pawMin);
  const geomOk = overlapY <= 0.001; // touching at a shared boundary is fine (~0), genuine overlap is not
  console.log(`local-space overlap: ${overlapY.toFixed(4)} units -> ${geomOk ? 'OK (no overlap)' : 'FAIL (still overlapping)'}`);

  // --- Check 2: pixel flicker across a sub-degree rotation delta ---
  let flips = 0;
  const baseDeg = 250; // near 270 (front-on), where the paw is most on-screen and most likely to show any residual z-fight
  const capture = async (deg) => {
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 60));
    return win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
  };
  const a = await capture(baseDeg);
  const b = await capture(baseDeg + 0.1);
  const w = a.w;
  const flipLocs = [];
  for (let i = 0; i < a.buf.length; i += 4) {
    const dr = Math.abs(a.buf[i] - b.buf[i]), dg = Math.abs(a.buf[i + 1] - b.buf[i + 1]), db = Math.abs(a.buf[i + 2] - b.buf[i + 2]);
    if (dr > 40 || dg > 40 || db > 40) {
      flips++;
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      flipLocs.push({ x: px, y: py, a: [a.buf[i], a.buf[i + 1], a.buf[i + 2]], b: [b.buf[i], b.buf[i + 1], b.buf[i + 2]] });
    }
  }
  console.log(`pixel flips between ${baseDeg}deg and ${baseDeg + 0.1}deg: ${flips}`);
  for (const f of flipLocs) console.log(`  (${f.x},${f.y}): ${f.a} -> ${f.b}`);
  // The lowerMesh/pawMesh z-fight this round fixed has a specific
  // fingerprint: a pixel flipping directly between cfg.legColor (#161616 =
  // 22,22,22) and cfg.pawColor (#ffffff = 255,255,255) - the two coincident
  // boxes swapping which one wins the depth test - AND landing near the
  // ground (raw framebuffer row 0 is GL-bottom, where the paw physically
  // sits; PAW_Y_MAX=20 comfortably covers the actual paw geometry with
  // margin). BOTH conditions matter: tuxedo's bodyColor/belly happen to be
  // the exact same two hex values as legColor/pawColor (both black, both
  // white), so a color-only filter alone also catches an UNRELATED belly-
  // vs-body boundary much higher up the frame (y=30-46, confirmed present
  // and byte-identical before and after this round's fix by re-running this
  // script against a temporarily-reverted copy of the old stacked-box code -
  // this specific residual is that renderer's ordinary, pre-existing
  // "antialias:false hard edge lands on a different rasterized pixel at a
  // sub-degree rotation" category, same as round 10's own single-pixel-
  // column PATTERN_OVER_BODY_NUDGE residual, not the bug being checked here).
  const LEG_RGB = [22, 22, 22], PAW_RGB = [255, 255, 255];
  const PAW_Y_MAX = 20;
  const isLegPawFlip = (rgb1, rgb2) => (closeRgb(rgb1, LEG_RGB) && closeRgb(rgb2, PAW_RGB)) || (closeRgb(rgb1, PAW_RGB) && closeRgb(rgb2, LEG_RGB));
  const zFightFlips = flipLocs.filter((f) => f.y <= PAW_Y_MAX && isLegPawFlip(f.a, f.b)).length;
  console.log(`  of which are leg<->paw color swaps near the ground (y<=${PAW_Y_MAX}, the actual z-fight signature): ${zFightFlips}`);
  const pixelOk = zFightFlips === 0;

  console.log(geomOk && pixelOk ? '\n*** PASSED ***' : '\n*** FAILED ***');
  app.quit();
});
