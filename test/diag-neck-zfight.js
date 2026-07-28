// Round 5 issue 5 investigation: check whether the head and body boxes
// actually overlap in 3D (no neck-bridging geometry exists in
// voxel-engine.js at all - confirmed by grep) by rendering the SAME
// static pose twice in a row (like the flicker check) but ALSO rendering
// at several near-identical angles (0, 0.5, 1, 2 degrees) to see if the
// head/body junction boundary flips inconsistently - the hallmark of
// z-fighting (two coincident-depth opaque surfaces racing for the same
// pixels), as opposed to a stable silhouette edge.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'neck-zfight');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_siamese', 'dog_husky'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });

  for (const key of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: key, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);

    // Tiny angle steps (well under 1 degree) - if the junction boundary
    // changes AT ALL between these near-identical frames, that's
    // real-geometry-shifted-a-hair instability (consistent with two
    // coincident/near-coincident depth surfaces), not a coincidence.
    const angles = [0, 0.1, 0.3, 0.6, 1.0, 2.0];
    const dumps = [];
    for (const deg of angles) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 60));
      const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
      dumps.push(dump);
    }

    // Compare consecutive angle-step dumps pixel-by-pixel in the region
    // where head/body silhouettes are known to be close (roughly the
    // area around x=63-88,y=30-56 per the earlier gradient scan) and
    // count how many pixels change color in a way NOT explained by the
    // overall silhouette shifting slightly (a rotation naturally moves
    // edges - what's diagnostic is a pixel INSIDE the solid interior,
    // away from any silhouette edge, still changing color, which can
    // only mean two competing surfaces are swapping z-order there).
    for (let i = 1; i < dumps.length; i++) {
      const a = dumps[i - 1], b = dumps[i];
      let interiorFlips = 0;
      const w = a.w, h = a.h;
      const at = (dump, x, y) => {
        const fy = h - 1 - y;
        const idx = (fy * w + x) * 4;
        return [dump.buf[idx], dump.buf[idx + 1], dump.buf[idx + 2]];
      };
      const samples = [];
      for (let y = 25; y < 60; y++) {
        for (let x = 55; x < 92; x++) {
          const [ar, ag, ab] = at(a, x, y);
          const [br, bg, bb] = at(b, x, y);
          // An "interior flip" candidate: both pixels are opaque/colored
          // (not background), AND the color jumps by a large amount - a
          // smoothly shifting gradient/anti-alias would change gradually,
          // not jump between two very different flat colors.
          const dr = Math.abs(ar - br), dg = Math.abs(ag - bg), db = Math.abs(ab - bb);
          if (dr + dg + db > 60) { interiorFlips++; if (samples.length < 4) samples.push({ x, y, a: [ar, ag, ab], b: [br, bg, bb] }); }
        }
      }
      console.log(`${key}: angle ${angles[i - 1]}deg -> ${angles[i]}deg: ${interiorFlips} large-jump pixels in junction region`, JSON.stringify(samples));
    }

    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(45 * Math.PI) / 180})`);
    await new Promise((r) => setTimeout(r, 80));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${key}-45deg.png`), img.toPNG());
  }

  console.log('DONE', OUT_DIR);
  app.quit();
});
