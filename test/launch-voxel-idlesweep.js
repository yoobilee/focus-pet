// PROTOTYPE idle-pool sweep (feature/3d-space branch, stage-2/3 pose-port
// work) - fast-forwards createAnimal()'s real state machine (not a fixed
// test pose) for each species, capturing a screenshot once each idle
// behavior has been playing for >0.3s (past the 0.25s pose crossfade, so
// the settled pose is captured rather than mid-transition), until every
// entry in that species' idlePool has been seen at least once (or a
// generous frame cap is hit). Gives good coverage of the whole idle-
// behavior pool without needing to get lucky waiting on weighted-random
// selection in real time - reusable any time voxel-engine.js's pose
// rendering changes and needs re-checking across the full idle roster.
// Usage: npx electron test/launch-voxel-idlesweep.js [species...]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SPECIES_LIST = process.argv.slice(2).length ? process.argv.slice(2) : ['cat_a', 'cat_tuxedo', 'cat_siamese', 'dog_dachshund', 'dog_corgi', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true });
  win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error(`[pet3d] ${message}`); });

  for (const species of SPECIES_LIST) {
    await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species, spin: '0' } });
    await win.webContents.executeJavaScript(`new Promise((resolve) => { const c=()=>{if(window.focusPet3D&&window.focusPet3D.ready)resolve();else requestAnimationFrame(c);}; c(); })`);
    await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(0)`);

    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const mod = await import('../shared/animal-engine.js');
        const animal = mod.createAnimal('${species}');
        const idlePool = mod.SPECIES['${species}'].idlePool.map(e => e.name);
        const wanted = new Set(idlePool);
        const seen = new Map(); // name -> pose snapshot, taken once behaviorTimer has advanced past the 0.25s crossfade so the settled pose is captured, not the mid-transition blend
        let elapsed = 0;
        const dt = 1/30;
        for (let frame = 0; frame < 30000 && seen.size < wanted.size; frame++) {
          animal.update(dt, true, elapsed);
          elapsed += dt;
          const info = animal.inspect();
          if (wanted.has(info.currentIdleName) && !seen.has(info.currentIdleName) && info.behaviorTimer > 0.3) {
            seen.set(info.currentIdleName, JSON.parse(JSON.stringify(animal.getPose())));
          }
        }
        return { idlePool, seenNames: [...seen.keys()], poses: Object.fromEntries(seen) };
      })()
    `);
    console.log(species, 'idlePool:', result.idlePool.join(','), '| seen:', result.seenNames.join(','));
    const missing = result.idlePool.filter((n) => !result.seenNames.includes(n));
    if (missing.length) console.log('  MISSING (not seen in 20000 frames):', missing.join(','));

    for (const [name, pose] of Object.entries(result.poses)) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose(${JSON.stringify(pose)})`);
      await new Promise((r) => setTimeout(r, 80));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, `voxel-idlesweep-${species}-${name}.png`), img.toPNG());
    }
  }
  console.log('done');
  app.quit();
});
app.on('window-all-closed', () => {});
