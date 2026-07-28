// Final verification screenshots (round 5, issue 1) - runs the real idle
// state machine (live=1), captures a frame during groom (paw raised) and
// then several frames after it transitions away, to visually confirm the
// leg actually comes back down instead of staying stuck raised. Repeats
// through multiple groom cycles to make sure it's not a one-off.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'groom-transition-final');
fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_a', spin: '0', live: '1' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);

  const DT = 0.05;
  let prevIdle = null;
  let groomCyclesShot = 0;
  const MAX_CYCLES = 3;

  for (let i = 0; i < 6000 && groomCyclesShot < MAX_CYCLES; i++) {
    await win.webContents.executeJavaScript(`window.focusPet3D.stepIdle(${DT})`);
    const dbg = await win.webContents.executeJavaScript('window.focusPet3D.getIdleDebug()');
    const idleName = dbg.currentIdleName;
    if (idleName !== prevIdle) {
      if (prevIdle === 'groom') {
        groomCyclesShot++;
        // Capture a short sequence: right at the transition, then a few
        // frames later, to see the leg actually settle back down.
        for (const extraFrames of [0, 5, 10, 20]) {
          for (let f = 0; f < extraFrames; f++) await win.webContents.executeJavaScript(`window.focusPet3D.stepIdle(${DT})`);
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(OUT_DIR, `cycle${groomCyclesShot}-${idleName}-plus${extraFrames}f.png`), img.toPNG());
        }
      } else if (idleName === 'groom') {
        // Mid-groom shot for contrast.
        await win.webContents.executeJavaScript(`window.focusPet3D.stepIdle(${1.0})`); // let it settle into the raised pose
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(OUT_DIR, `cycle${groomCyclesShot + 1}-during-groom.png`), img.toPNG());
      }
      prevIdle = idleName;
    }
  }

  console.log('Captured', groomCyclesShot, 'groom transition cycles');
  console.log('DONE', OUT_DIR);
  app.quit();
});
