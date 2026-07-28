// Round 7 issue investigation, step 1: confirm the actual vertex count and
// layout of the head geometry currently used for cat_siamese's faceShade.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_siamese', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  const result = await win.webContents.executeJavaScript(`
    window.focusPet3D.getFaceShadeVertexColors ? (function() {
      const colors = window.focusPet3D.getFaceShadeVertexColors();
      const uniquePositions = new Set(colors.map(c => c.x2d + ',' + c.y2d));
      return { totalVertexEntries: colors.length, uniqueXY: uniquePositions.size, uniqueList: [...uniquePositions] };
    })() : 'no debug hook'
  `);
  console.log(JSON.stringify(result, null, 1));
  app.quit();
});
