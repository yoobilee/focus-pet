// Round 12 issue 1 verification ("칼라 색이 완전히 새까만 선으로 보임") -
// for all 10 species, reads back the LIVE rendered seam collar material
// color(s) (getSeamCollarColors, straight from the scene graph - same anti
// cross-context-color-mismatch technique test/diag-seam-sweep-all-species.js
// established) and the body/head/leg colors it's derived from, then reports
// the relative luminance DROP from the surrounding part color to the collar
// color - the requested "15-20% darker" (round 12) / "더 연하게" (round 14
// issue 1) is a luminance-drop range, not a pass/fail color match, so this
// reports the actual numbers for a human (or a future round) to judge
// against the target range rather than asserting a tight bound itself.
//
// Round 14 issue 2 update: the neck collar can now be 1-3 separate mesh
// segments instead of always exactly 1 (addNeckSeamCollar samples belly/
// pattern decals across its width and splits wherever the underlying color
// changes) - `collars[0]`/`collars[1]` positional indexing would silently
// grab the wrong segment for any species with a decal overlap, so this
// filters by the seamPart marker instead and reports EVERY distinct neck
// segment found (comparing each against head/body - a decal-derived
// segment will show a large/negative "drop" here since it's not actually
// darkened relative to bodyColor at all, just relative to the decal color
// underneath it - that's expected, not a bug, see CLAUDE.md's round 14
// issue 2 writeup) plus the single shoulder-collar value (still always
// exactly 1 per addSeamCollar, unchanged this round).
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];

function relLum(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[page error]', message); });

  for (const key of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: key, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    const cfgInfo = await win.webContents.executeJavaScript(`window.focusPet3D.getCfgColors()`);
    const collars = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
    const headEff = cfgInfo.headColor || cfgInfo.bodyColor;
    const necks = collars.filter((c) => c.seamPart === 'neck');
    const shoulders = collars.filter((c) => c.seamPart === 'shoulder');
    const neckSummary = necks.map((c) => `${c.hex}(drop=${((relLum(headEff) - relLum(c.hex)) / relLum(headEff) * 100).toFixed(1)}%)`).join(', ');
    const shoulderHex = shoulders.length ? shoulders[0].hex : null;
    const shoulderDrop = shoulderHex ? ((relLum(cfgInfo.legColor) - relLum(shoulderHex)) / relLum(cfgInfo.legColor) * 100).toFixed(1) : 'n/a';
    console.log(`${key.padEnd(16)} head/body=${headEff} neckSegments(${necks.length})=[${neckSummary}]   leg=${cfgInfo.legColor} shoulderCollar=${shoulderHex} shoulderLumDrop=${shoulderDrop}%`);
  }
  app.quit();
});
