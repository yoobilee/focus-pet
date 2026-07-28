const { app, BrowserWindow } = require('electron');
const path = require('path');

function colorPresent(buf, rgb, tol = 6) {
  const [tr, tg, tb] = rgb;
  for (let i = 0; i < buf.length; i += 4) {
    if (Math.abs(buf[i] - tr) <= tol && Math.abs(buf[i + 1] - tg) <= tol && Math.abs(buf[i + 2] - tb) <= tol) return true;
  }
  return false;
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${Math.PI / 2})`);
  await new Promise((r) => setTimeout(r, 100));
  const dump = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
  const shoulderRgb = hexToRgb(collars[1].hex);
  console.log(`cat_a @ 90deg: shoulder collar ${collars[1].hex} present = ${colorPresent(dump.buf, shoulderRgb)}`);
  app.quit();
});
