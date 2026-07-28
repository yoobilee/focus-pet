// Diagnostic (round 5, issue 1): step the real idle state machine and log
// frontLegRaise/groomWipe/currentIdleName every simulated step, specifically
// around any groom->non-groom transition, to see whether those fields
// actually return to 0 afterward or stay stuck.
const { app, BrowserWindow } = require('electron');
const path = require('path');

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

  const DT = 0.05;
  let prevIdle = null;
  let lastWasGroom = false;
  let framesSinceGroomEnd = 0;
  let reportedAfterGroom = false;

  for (let i = 0; i < 4000; i++) {
    await win.webContents.executeJavaScript(`window.focusPet3D.stepIdle(${DT})`);
    const dbg = await win.webContents.executeJavaScript('window.focusPet3D.getIdleDebug()');
    const idleName = dbg.currentIdleName;
    if (idleName !== prevIdle) {
      console.log(`[transition] t=${(i*DT).toFixed(2)} ${prevIdle} -> ${idleName} | frontLegRaise=${dbg.pose.frontLegRaise.toFixed(3)} groomWipe=${dbg.pose.groomWipe.toFixed(2)} legsTuckedFront=${dbg.pose.legsTuckedFront.toFixed(3)} legsTuckedBack=${dbg.pose.legsTuckedBack.toFixed(3)} bodyBob=${dbg.pose.bodyBob.toFixed(3)}`);
      if (prevIdle === 'groom') { lastWasGroom = true; framesSinceGroomEnd = 0; reportedAfterGroom = false; }
      prevIdle = idleName;
    }
    if (lastWasGroom) {
      framesSinceGroomEnd++;
      if (framesSinceGroomEnd === 20 && !reportedAfterGroom) {
        console.log(`  +20 frames after groom ended: frontLegRaise=${dbg.pose.frontLegRaise.toFixed(3)} groomWipe=${dbg.pose.groomWipe.toFixed(2)} idle=${idleName}`);
        reportedAfterGroom = true;
      }
    }
  }

  console.log('DONE');
  app.quit();
});
