// PROTOTYPE zoomed-crop capture (feature/3d-space branch) - same idea as
// the bubble-shadow investigation's crop tool but for the voxel window:
// renders one species at one angle, crops+zooms a specific pixel region
// (e.g. the leg area) so subtle multi-box separation is actually visible
// instead of lost at 96px. Usage:
//   npx electron test/launch-voxel-crop.js cat_a 270 0 380 480 100 out.png
//   (species, angleDeg, cropX, cropY, cropW, cropH, outPath)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [species, angleDeg, cropX, cropY, cropW, cropH, outName] = process.argv.slice(2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: species || 'cat_a', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(parseFloat(angleDeg) * Math.PI) / 180})`);
  const img = await win.webContents.capturePage();
  const cropped = img.crop({ x: parseInt(cropX, 10), y: parseInt(cropY, 10), width: parseInt(cropW, 10), height: parseInt(cropH, 10) });
  const zoomed = cropped.resize({ width: parseInt(cropW, 10) * 3, height: parseInt(cropH, 10) * 3, quality: 'good' });
  const outPath = path.join(__dirname, outName || 'voxel-crop.png');
  fs.writeFileSync(outPath, zoomed.toPNG());
  console.log(`wrote ${outPath}`);
  app.quit();
});

app.on('window-all-closed', () => {});
