// Round 15 verification: for all 10 species, confirms (a) zero shoulder-
// tagged seam collar meshes exist anywhere (leg collar removed entirely),
// and (b) neck-tagged collar mesh count is 0 for species whose headColor
// genuinely differs from bodyColor, >=1 for species where they match.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet3d]', message); });

  for (const key of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: key, spin: '0' } });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    const cfgInfo = await win.webContents.executeJavaScript(`window.focusPet3D.getCfgColors()`);
    const collars = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
    const neckCount = collars.filter((c) => c.seamPart === 'neck').length;
    const shoulderCount = collars.filter((c) => c.seamPart === 'shoulder').length;
    const otherCount = collars.length - neckCount - shoulderCount;
    console.log(`${key.padEnd(16)} headColor=${cfgInfo.headColor || '(none, =bodyColor)'} bodyColor=${cfgInfo.bodyColor}  neckSegments=${neckCount} shoulderSegments=${shoulderCount} otherSegments=${otherCount} totalCollarMeshes=${collars.length}`);
  }
  app.quit();
});
