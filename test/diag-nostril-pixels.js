// Follow-up to the first magenta-scan (which came back 0 across the WHOLE
// canvas, meaning the debug-colored dots plausibly aren't rendering at
// all) - dumps the raw RGB grid around the nose's own screen position (the
// canvas here is actually only 96x96 real WebGL pixels, not 480x480 -
// confirmed by the first scan - so there's very little room for anti-
// aliasing/rounding to hide a whole dot) so the actual colors present can
// be read directly instead of guessing thresholds.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.error('[pet3d]', message);
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), {
    query: { species: 'dog_husky', spin: '0' },
  });
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); };
      check();
    });
  `);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(270 * Math.PI) / 180})`);
  await new Promise((r) => setTimeout(r, 200));

  const dump = await win.webContents.executeJavaScript(`window.focusPet3D.getNoseDetailDebug()`);
  console.log('scene graph children:', JSON.stringify(dump));

  const result = await win.webContents.executeJavaScript(`
    (function() {
      const canvas = document.getElementById('stage');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const w = canvas.width, h = canvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const rows = [];
      const cx = 48, cy = h - 1 - 53; // predicted nose center, converted to gl's bottom-up row index
      for (let y = cy - 10; y <= cy + 10; y++) {
        let row = '';
        for (let x = cx - 15; x <= cx + 15; x++) {
          if (x < 0 || x >= w || y < 0 || y >= h) { row += '  ?'; continue; }
          const i = (y * w + x) * 4;
          const r = buf[i], g = buf[i+1], b = buf[i+2], a = buf[i+3];
          // classify into a single-char code for a compact ASCII map
          let c = '.';
          if (a < 10) c = ' '; // transparent
          else if (r > 180 && g < 100 && b > 180) c = 'M'; // magenta dot
          else if (r < 60 && g < 60 && b < 70) c = 'D'; // dark nose color
          else if (r > 200 && g > 190 && b > 180) c = 'W'; // white/cream snout
          else c = '?';
          row += '  ' + c;
        }
        rows.push(row);
      }
      return { w, h, canvasWH: canvas.width + 'x' + canvas.height, grid: rows.join('\\n') };
    })()
  `);
  console.log('canvas', result.canvasWH);
  console.log(result.grid);
  app.quit();
});
