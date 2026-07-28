// Round 11 issues 1+2 visual verification - full-frame screenshots for all
// 10 species at all 8 rotation checkpoints (0-315deg in 45deg steps, same
// sweep test/diag-seam-sweep-all-species.js and test/diag-front-seam-
// poke.js use numerically) so the seam-collar fix can be eyeballed
// alongside the numeric pixel-bbox check, matching this codebase's
// established two-track verification habit. Also grabs a 4x zoomed crop of
// cat_tuxedo's front paw specifically (the only species with cfg.pawColor)
// at the near-front-on angle the paw diagnostic used, for a close look at
// the lowerMesh/pawMesh tiling fix.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'seam-fix-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });

  for (const key of SPECIES) {
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
      await new Promise((r) => setTimeout(r, 300));
      await win.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 200));
      await win.webContents.capturePage();
      await new Promise((r) => setTimeout(r, 200));
      const img = await win.webContents.capturePage();
      const full = img.resize({ width: 480, height: 480, quality: 'good' });
      fs.writeFileSync(path.join(OUT_DIR, `${key}-${String(deg).padStart(3, '0')}.png`), full.toPNG());

      if (key === 'cat_tuxedo' && (deg === 270 || deg === 0)) {
        // Crop around the front paw/sock boundary - near the BOTTOM of the
        // frame (raw framebuffer row 0 is GL-bottom, i.e. large screen_y in
        // a top-left-origin screenshot - found by locating the exact rows
        // test/diag-tuxedo-paw-zfight.js flagged, not guessed from eyeballing
        // the full frame, which undershot this by ~150px on the first two
        // tries).
        const crop = img.crop({ x: 130, y: 370, width: 230, height: 110 }).resize({ width: 690, height: 330, quality: 'good' });
        fs.writeFileSync(path.join(OUT_DIR, `tuxedo-paw-crop-${String(deg).padStart(3, '0')}.png`), crop.toPNG());
      }
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
