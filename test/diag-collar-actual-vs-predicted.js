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
  const collars = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
  console.log('predicted (material.color) neck collar hex:', collars[0].hex);

  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${Math.PI / 2})`);
  await new Promise((r) => setTimeout(r, 100));
  const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
  const { buf, w, h } = dump;

  const target = [0x16, 0xa2 & 0, 0]; // placeholder, real compute below
  const [tr, tg, tb] = [parseInt(collars[0].hex.slice(1, 3), 16), parseInt(collars[0].hex.slice(3, 5), 16), parseInt(collars[0].hex.slice(5, 7), 16)];
  let best = null, bestDist = Infinity;
  const allColors = new Map();
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const key = `${r},${g},${b}`;
    allColors.set(key, (allColors.get(key) || 0) + 1);
    const dist = Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb);
    if (dist < bestDist) { bestDist = dist; best = key; }
  }
  console.log(`closest actual pixel to predicted (${tr},${tg},${tb}): ${best}, L1 distance = ${bestDist}`);
  console.log('\nfull palette at 90deg:');
  for (const [k, v] of [...allColors.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}px`);
  app.quit();
});
