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
  const counts = new Map();
  for (let i = 0; i < buf.length; i += 4) {
    const key = `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('distinct colors:', sorted.length);
  for (const [color, count] of sorted.slice(0, 20)) console.log(`  ${color}: ${count}px`);

  // also print a vertical strip at the horizontal center, to see the color
  // sequence top-to-bottom right where the neck seam should be
  const cx = Math.floor(w / 2);
  console.log(`\nvertical strip at x=${cx} (center column):`);
  let prev = null;
  for (let y = 0; y < h; y++) {
    const fy = h - 1 - y; // raw buffer is bottom-up
    const idx = (fy * w + cx) * 4;
    const key = `${buf[idx]},${buf[idx + 1]},${buf[idx + 2]}`;
    if (key !== prev) { console.log(`  y=${y}: ${key}`); prev = key; }
  }
  app.quit();
});
