// Round 10 issue 2 investigation - checks whether cat_a's tabby stripe
// pattern (addSkinBoxRel decals on the body) z-fights against the body
// itself during rotation, using the SAME tiny-angle-delta technique the
// original neck z-fighting bug was found with (test/diag-neck-zfight.js)
// - a genuine coincident-depth surface swap shows up as an "interior"
// pixel (away from any silhouette edge) flipping between two flat colors
// across a rotation so small nothing should legitimately change at all.
// Checked at 8 checkpoints around the FULL circle (not just near 0deg)
// since cursor-driven body rotation in the real app continuously sweeps
// through every angle as the cursor moves around the screen.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const CHECKPOINTS = [0, 45, 90, 135, 180, 225, 270, 315];
const DELTAS = [0, 0.1, 0.3, 0.6, 1.0];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_a', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

  const at = (dump, x, y, w, h) => {
    const fy = h - 1 - y;
    const idx = (fy * w + x) * 4;
    return [dump.buf[idx], dump.buf[idx + 1], dump.buf[idx + 2]];
  };

  // 42,107,58 is pet3d.js's own scene.background color - a flip touching
  // it is just the silhouette edge moving by a sub-pixel amount as the
  // rotation changes (expected, not a bug); only a flip between two
  // NEITHER-background flat colors is the genuine "two solid surfaces
  // swapping z-order" signature.
  const BG = '42,107,58';
  // Only care about torso colors (body/pattern/belly) for this bug -
  // eye pupil/highlight flips near the head are a separate, unreported
  // issue and would otherwise drown out the signal.
  const TORSO_COLORS = new Set(['232,147,90', '201,116,58', '247,230,201']);
  let anyFound = false;
  for (const base of CHECKPOINTS) {
    const dumps = [];
    for (const delta of DELTAS) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${((base + delta) * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 40));
      dumps.push(await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()'));
    }
    let totalFlips = 0;
    const samples = [];
    for (let i = 1; i < dumps.length; i++) {
      const a = dumps[i - 1], b = dumps[i];
      const w = a.w, h = a.h;
      for (let y = 10; y < h - 10; y++) {
        for (let x = 10; x < w - 10; x++) {
          const [ar, ag, ab] = at(a, x, y, w, h);
          const [br, bg, bb] = at(b, x, y, w, h);
          const aKey = `${ar},${ag},${ab}`, bKey = `${br},${bg},${bb}`;
          if (aKey === BG || bKey === BG) continue; // silhouette edge, not interior
          if (!TORSO_COLORS.has(aKey) || !TORSO_COLORS.has(bKey)) continue; // unrelated (e.g. eye) flip
          const d = Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
          if (d > 60) {
            totalFlips++;
            if (samples.length < 5) samples.push({ x, y, a: [ar, ag, ab], b: [br, bg, bb], fromDeg: base + DELTAS[i - 1], toDeg: base + DELTAS[i] });
          }
        }
      }
    }
    console.log(`checkpoint ${base}deg: ${totalFlips} TRUE interior flips (excluding background) across +0..+1deg sweep`);
    if (totalFlips > 0) { console.log(JSON.stringify(samples)); anyFound = true; }
  }
  console.log(anyFound ? 'FOUND genuine interior z-fight candidate(s) - see above' : 'no interior z-fighting found at any checkpoint (rest pose)');
  app.quit();
});
