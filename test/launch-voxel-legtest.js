// PROTOTYPE leg-joint capture (feature/3d-space branch, stage-3 joint-port
// work) - loads one or more voxel creatures, drives each's leg rig through
// a few test poses via window.focusPet3D.setLegPose() (see pet3d.js/
// voxel-engine.js), and captures a screenshot at each. Not a full gait/idle
// simulation - just enough distinct poses (neutral stand, mid-swing,
// tucked/sit, dangling, belly-up) to visually confirm the joint chain
// actually bends in plausible directions without breaking the silhouette,
// across every species' very different joint proportions (dachshund's
// stubby 0.7/0.7 legs under a 19-unit-long body, corgi's 0.6/0.6 under a
// shorter one, etc). Usage:
//   npx electron test/launch-voxel-legtest.js cat_a dog_dachshund dog_corgi ...
//   (no args = all 10 species)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ALL_SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];
const species = process.argv.slice(2).length ? process.argv.slice(2) : ALL_SPECIES;

const POSES = [
  { name: 'stand', pose: {} },
  { name: 'swing-fwd', pose: { legPhase: 0.85 } },
  { name: 'swing-back', pose: { legPhase: -0.85 } },
  { name: 'sit-tuck', pose: { legsTuckedFront: 1, legsTuckedBack: 1 } },
  { name: 'dangle', pose: { dangle: 1, dangleSway: 15 } },
  { name: 'bellyup', pose: { bellyUp: 1 } },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet3d] ${message} (${sourceId}:${line})`);
  });

  for (const key of species) {
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
    for (const { name, pose } of POSES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setLegPose(${JSON.stringify(pose)})`);
      await new Promise((r) => setTimeout(r, 120));
      const debug = await win.webContents.executeJavaScript('window.focusPet3D.getLegDebug()');
      const img = await win.webContents.capturePage();
      const outPath = path.join(__dirname, `voxel-legtest-${key}-0-${name}.png`);
      fs.writeFileSync(outPath, img.toPNG());
      console.log(`wrote ${outPath} | ${JSON.stringify(debug)}`);
    }
  }

  app.quit();
});

app.on('window-all-closed', () => {});
