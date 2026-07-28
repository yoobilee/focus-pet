// Round 4 issue 3 verification: the groom idle was redesigned from a
// one-shot static paw-raise into a continuous "wiper" sweep (groomWipe,
// see animal-engine.js's IDLE_BEHAVIORS.groom and legJointAngles). Drives
// the front leg's raised pose through a full sweep cycle via
// setBodyPose({frontLegRaise:1, groomWipe: 30*sin(phase)}) - the exact
// field the real groom behavior sets every frame - and captures a frame
// at each step, plus reads back the actual applied hip angle via
// getLegDebug() to confirm numerically (not just by eye) that the paw is
// really swinging side to side around its raised base angle, not sitting
// static.
//
// Run: npx electron test/launch-groom-wiper-test.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'groom-wiper-frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_a', 'dog_husky'];
const STEPS = 8; // one full sine cycle, evenly sampled

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

    const angles = [];
    for (let i = 0; i < STEPS; i++) {
      const phase = (i / STEPS) * Math.PI * 2;
      const groomWipe = 30 * Math.sin(phase);
      await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose(${JSON.stringify({ frontLegRaise: 1, groomWipe })})`);
      await new Promise((r) => setTimeout(r, 80));
      const debug = await win.webContents.executeJavaScript('window.focusPet3D.getLegDebug()');
      angles.push({ i, groomWipe: +groomWipe.toFixed(1), hip: +debug.front.hip.toFixed(1), knee: +debug.front.knee.toFixed(1) });
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${key}-f${String(i).padStart(2, '0')}.png`), img.toPNG());
    }
    console.log(key, JSON.stringify(angles));
  }

  console.log('DONE', OUT_DIR);
  app.quit();
});
