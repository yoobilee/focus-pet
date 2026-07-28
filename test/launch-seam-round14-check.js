// Round 14 verification (issue 1: SEAM_COLOR_DARKEN lowered so the seam
// reads as subtler than round 12's 0.32; issue 2: neck collar now samples
// belly/pattern decals so it blends into e.g. cat_tuxedo's white chest
// instead of floating as a dark bar on it) - renders a representative set
// of species/angles. Run once with the CURRENT voxel-engine.js content to
// get "before" or "after" shots (the caller swaps the file between runs -
// see CLAUDE.md's round 14 writeup for the before/after procedure used).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'seam-round14-check');
fs.mkdirSync(OUT_DIR, { recursive: true });
const TAG = process.argv[2] || 'shot'; // 'before' / 'after', passed on the command line

// issue 2 needs species whose belly/pattern decal actually reaches the neck
// collar's own X/Y footprint (checked all 10 in the investigation - see
// CLAUDE.md): cat_tuxedo (white chest, most dramatic - bodyColor is near-
// black), cat_calico (orange pattern patch), dog_corgi/dog_husky/
// dog_pomeranian (lighter cream/white pattern patches). cat_a/dog_dachshund/
// rabbit_b/hamster have decals but NOT overlapping the neck line X/Y range
// (checked, no overlap) so they're included as an issue-1-only "did this
// change anything it shouldn't" control instead.
const ISSUE2_SPECIES = ['cat_tuxedo', 'cat_calico', 'dog_corgi', 'dog_husky', 'dog_pomeranian'];
const ISSUE1_CONTROL_SPECIES = ['cat_a', 'dog_dachshund', 'rabbit_b'];
const ANGLES = [0, 45];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });

  for (const key of [...ISSUE2_SPECIES, ...ISSUE1_CONTROL_SPECIES]) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: key, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 250));
      await win.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      const full = img.resize({ width: 480, height: 480, quality: 'good' });
      fs.writeFileSync(path.join(OUT_DIR, `${TAG}-${key}-${String(deg).padStart(3, '0')}.png`), full.toPNG());
    }
  }
  console.log('DONE', OUT_DIR, TAG);
  app.quit();
});
