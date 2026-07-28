// Round 5 issue 2 verification: confirms the raised-paw color fix -
// species without cfg.pawColor (siamese) should show NO color change on
// the raised leg at all, and tuxedo (the only species with pawColor)
// should keep its normal dark leg + white paw tip, not a gray leg.
// Run: npx electron test/launch-groom-paw-color-check.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'groom-paw-color-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_tuxedo', 'cat_siamese'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });

  for (const key of SPECIES) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
      query: { species: key, spin: '0' },
    });
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
        check();
      });
    `);
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);

    // Not raised, for a baseline comparison.
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    await new Promise((r) => setTimeout(r, 80));
    let img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${key}-baseline.png`), img.toPNG());

    // Raised (mid-wipe-sweep for a representative frame).
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose(${JSON.stringify({ frontLegRaise: 1, groomWipe: 10 })})`);
    await new Promise((r) => setTimeout(r, 80));
    const debug = await win.webContents.executeJavaScript('window.focusPet3D.getLegDebug()');
    console.log(key, 'raised leg colors:', JSON.stringify({ upper: debug.front.upperColor, lower: debug.front.lowerColor }));
    img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${key}-raised.png`), img.toPNG());
  }

  console.log('DONE', OUT_DIR);
  app.quit();
});
