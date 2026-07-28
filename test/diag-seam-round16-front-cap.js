// Round 16 issue 2 verification: for each NECK_SEAM_SPECIES member, reads
// the live neck-collar material color (getSeamCollarColors) then scans the
// raw WebGL framebuffer at all 8 standard sweep angles (0-315deg, 45deg
// steps) for how many pixels of that exact color appear - confirms the
// front-cap-only design (visible near 270deg/front, fully absent at 0/180
// profile and 90 back, foreshortened in between) rather than trusting the
// geometry math alone.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SPECIES = ['cat_a', 'cat_tuxedo', 'cat_calico', 'dog_dachshund', 'dog_husky', 'rabbit_b', 'hamster'];
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

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
    const collars = await win.webContents.executeJavaScript(`window.focusPet3D.getSeamCollarColors()`);
    const targetHex = collars.length ? collars[0].hex : null;
    const results = [];
    for (const deg of ANGLES) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 200));
      const count = await win.webContents.executeJavaScript(`
        (function() {
          const canvas = document.getElementById('stage');
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const w = canvas.width, h = canvas.height;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const target = ${JSON.stringify(targetHex)};
          if (!target) return 0;
          const n = parseInt(target.slice(1), 16);
          const tr = (n>>16)&0xff, tg=(n>>8)&0xff, tb=n&0xff;
          let count = 0;
          for (let i = 0; i < buf.length; i += 4) {
            if (Math.abs(buf[i]-tr) <= 2 && Math.abs(buf[i+1]-tg) <= 2 && Math.abs(buf[i+2]-tb) <= 2 && buf[i+3] > 200) count++;
          }
          return count;
        })()
      `);
      results.push(`${deg}deg:${count}px`);
    }
    console.log(`${key.padEnd(16)} collarColor=${targetHex}  ${results.join('  ')}`);
  }
  app.quit();
});
