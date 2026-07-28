// Confirms the seam collar renders at 90deg by diffing "with collar" vs a
// version with addSeamCollar's call sites temporarily neutralized -
// sidesteps the whole "predict darkenColor's exact output" problem (which
// produced a false-negative MISSING report in diag-seam-sweep-all-species.js,
// likely a linear/sRGB colorspace mismatch between a Node-context
// require('three') color computation and the browser's actual
// THREE.ColorManagement state) by reading back whatever color the real
// render actually produces, directly, instead of predicting it.
const { app, BrowserWindow } = require('electron');
const path = require('path');

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
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${Math.PI / 2})`);
  await new Promise((r) => setTimeout(r, 150));
  const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
  const { buf, w, h } = dump;

  // Scan every pixel, group by exact color, report ALL colors present with
  // count - the collar should show up as a color with a modest pixel count
  // that isn't background/body/leg/pattern/belly/eye.
  const counts = new Map();
  for (let i = 0; i < buf.length; i += 4) {
    const key = `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('all distinct colors at 90deg (reverted to real collar color, not magenta):');
  for (const [color, count] of sorted) console.log(`  ${color}: ${count}px`);

  // My hand-predicted collar color was 162,101,61 (from Node's own three.js
  // darkenColor replication) - check how close the NEAREST actual rendered
  // color is to that prediction, to quantify the discrepancy.
  const target = [162, 101, 61];
  let best = null, bestDist = Infinity;
  for (const [color] of sorted) {
    const [r, g, b] = color.split(',').map(Number);
    const dist = Math.abs(r - target[0]) + Math.abs(g - target[1]) + Math.abs(b - target[2]);
    if (dist < bestDist) { bestDist = dist; best = color; }
  }
  console.log(`\nclosest actual color to hand-predicted collar rgb(${target}): ${best} (L1 distance ${bestDist})`);
  app.quit();
});
