const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[page]', message); });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'cat_calico', spin: '0', live: '1' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);

  const trace = await win.webContents.executeJavaScript(`
    (function() {
      const seq = [];
      let lastName = null;
      for (let i = 0; i < 2000; i++) {
        window.focusPet3D.stepIdle(0.05);
        const dbg = window.focusPet3D.getIdleDebug();
        if (dbg.currentIdleName !== lastName) {
          seq.push({ name: dbg.currentIdleName, t: +(i*0.05).toFixed(2), behaviorTimer: +dbg.behaviorTimer.toFixed(2) });
          lastName = dbg.currentIdleName;
        }
      }
      return seq;
    })()
  `);
  console.log('cat_calico driven-simulation idle sequence (100s simulated):');
  console.log(trace.map(e => `${e.name}@${e.t}s`).join(' -> '));
  app.quit();
});
