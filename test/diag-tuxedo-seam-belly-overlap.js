// Diagnostic for the "턱시도 목 칼라가 흰 배 무늬 위에 튀어나와 보임" report -
// loads the pet3d.js prototype viewer for cat_tuxedo and inspects the ACTUAL
// world-space bounding boxes of the neck seam collar mesh vs the belly decal
// mesh (getSeamCollarColors + the new getMeshesByColor accessor), to see
// exactly how much they overlap rather than hand-deriving it from SPECIES
// x/y/w/h fields.
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

  const collars = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
  console.log('SEAM COLLAR CENTERS', JSON.stringify(collars, null, 1));
  const neckHex = collars[0].hex;
  const collarBoxes = await win.webContents.executeJavaScript(`window.focusPet3D.getMeshesByColor(${JSON.stringify(neckHex)})`);
  console.log('NECK COLLAR BBOX (color=' + neckHex + ')', JSON.stringify(collarBoxes.filter((b) => b.isSeamCollar), null, 1));
  const whiteBoxes = await win.webContents.executeJavaScript(`window.focusPet3D.getMeshesByColor('#ffffff')`);
  console.log('WHITE (belly/snout) BBOXES', JSON.stringify(whiteBoxes, null, 1));

  app.quit();
});
