const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: 'cat_tuxedo', spin: '0' } });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  const white = await win.webContents.executeJavaScript(`window.focusPet3D.getMeshesByColor('#ffffff')`);
  console.log('WHITE MESHES', JSON.stringify(white, null, 1));
  app.quit();
});
