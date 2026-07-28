// Diagnostic: for each circular-path idle, measure how much the on-screen
// bbox shifts horizontally (lateralX -> real screen position, orthographic
// projection) vs how much it changes SIZE (depthZ -> the DEPTH_SCALE_FACTOR
// fake-perspective hack) at the radius's extremes, to check whether the
// scale swing visually dominates the position swing (which would explain
// "looks like it's just growing/shrinking in place" reports) - and compare
// across all 4 species-specific behaviors to see which are well-balanced.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const BG = [42, 107, 58];
function bbox(buf, w, h) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i] !== BG[0] || buf[i + 1] !== BG[1] || buf[i + 2] !== BG[2]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX, cx: (minX + maxX) / 2, clipped: minX === 0 || maxX === w - 1 };
}

const CASES = [
  { key: 'cat_a', radius: 2.6 },
  { key: 'dog_husky', radius: 1.5 },
  { key: 'rabbit_b', radius: 1.8 },
  { key: 'hamster', radius: 0.8 },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: false, frame: false });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[pet3d]', message);
  });
  for (const { key, radius } of CASES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: key, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);
    const results = {};
    for (const [label, lateralX, depthZ] of [['restX0', 0, 0], ['lateralMax', radius, 0], ['lateralMin', -radius, 0], ['depthNear', 0, radius], ['depthFar', 0, -radius]]) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({lateralX: ${lateralX}, depthZ: ${depthZ}, spinOverride: true, spinAngle: 0})`);
      const raw = await win.webContents.executeJavaScript(`window.focusPet3D.getRawPixels()`);
      results[label] = bbox(raw.buf, raw.w, raw.h);
    }
    const lateralSwingPx = Math.abs(results.lateralMax.cx - results.lateralMin.cx);
    const scaleSwingPx = results.depthNear.w - results.depthFar.w;
    console.log(`${key} (radius=${radius}): lateral swing=${lateralSwingPx}px, scale swing=${scaleSwingPx}px (near clipped=${results.depthNear.clipped}), ratio scale/lateral=${(scaleSwingPx / lateralSwingPx).toFixed(2)}`);
  }
  app.quit();
});
