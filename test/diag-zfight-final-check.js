// Final confirmation for round 5 issue 5: render the exact same angle
// twice in a row (zero change) for cat_siamese/dog_husky at several
// angles including ones known to be problematic before the fix, and
// confirm byte-identical raw pixels every time - the strictest possible
// z-fighting check (if two renders of the IDENTICAL scene ever differ,
// that's unambiguous non-determinism, always a red flag).
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SPECIES = ['cat_siamese', 'dog_husky', 'cat_a', 'dog_pomeranian'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  let totalDiffs = 0;

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
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of [0, 15, 30, 45, 60, 90, 135, 180, 270]) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 60));
      const a = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
      const b = await win.webContents.executeJavaScript('window.focusPet3D.getRawPixels()');
      let diffs = 0;
      for (let i = 0; i < a.buf.length; i++) if (a.buf[i] !== b.buf[i]) diffs++;
      if (diffs > 0) console.log(`${key} @ ${deg}deg: ${diffs} bytes differ between two identical-state renders!`);
      totalDiffs += diffs;
    }
    console.log(`${key}: checked all angles`);
  }

  console.log('TOTAL DIFF BYTES (should be 0):', totalDiffs);
  app.quit();
});
