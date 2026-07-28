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
  await new Promise((r) => setTimeout(r, 100));

  // Get the neck collar's world position at 90deg specifically (post-
  // rotation) and the head/body meshes' own world bounding boxes, to see
  // exactly what's where.
  const info = await win.webContents.executeJavaScript(`
    (function() {
      const collars = window.focusPet3D.getSeamCollarColors();
      const bodyDebug = window.focusPet3D.getBodyDebug();
      return { collars, bodyDebug };
    })()
  `);
  console.log('at 90deg:', JSON.stringify(info, null, 1));

  // Now hide every mesh EXCEPT seam collars, re-render, see if a collar
  // shows up somewhere unexpected (confirms it's genuinely there, just
  // occluded, and reveals where on screen it WOULD be).
  await win.webContents.executeJavaScript(`
    (function() {
      const scene = window.focusPet3D.__debugScene ? window.focusPet3D.__debugScene() : null;
    })()
  `).catch(() => {});
  app.quit();
});
