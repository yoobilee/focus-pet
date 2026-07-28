// Round 13 verification ("SEAM_COLOR_DARKEN 재보정 이후에도 실제 앱에서 새까맣게
//보인다"는 리포트) - loads the REAL windows/pet/index.html (main.js's actual
// production entry point, not the pet3d.js prototype viewer) and drives it
// entirely through the real IPC channels pet.js consumes in production
// ('preview-character', 'cursor-track'), with NO modifications to pet.js or
// main.js source - the raw pixel readback below uses only #pet-canvas's own
// public WebGL context, the same generic technique launch-preview-test.js's
// capturePet() already established, so this script alone is enough to rule
// out "the fix only landed in a diagnostic-only code path" without needing
// any temporary debug hooks baked into the production files.
//
// Conclusion from the investigation that produced this script: the seam
// collar itself renders correctly (subtle tan/gold band, matching
// SEAM_COLOR_DARKEN=0.32) in the real app - what a screenshot report
// ("seam-still-black-real-app.png") circled as "pitch black" is actually
// the dog's EYES (cfg.eyeColor, e.g. #2a1c14) and NOSE (cfg.darkColor, e.g.
// #4a3527), an unrelated round-6 facial-detail feature that sits a few
// canvas rows above/overlapping the neck seam and reads as one dark blob at
// 96x96 - not a regression in addSeamCollar/SEAM_COLOR_DARKEN.
//
// Run: npx electron test/launch-seam-realapp-check.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'seam-realapp-check');
fs.mkdirSync(OUT_DIR, { recursive: true });

ipcMain.handle('get-settings', () => ({ character: 'cat_a' }));
let petWindow;
ipcMain.on('preview-character', (event, key) => {
  if (petWindow) petWindow.webContents.send('preview-character', key);
});

const SPECIES = ['dog_pomeranian', 'cat_a', 'dog_husky', 'cat_siamese', 'dog_corgi'];
// dx=0 is front-on (-90deg); dx=+-0.5 is the 3/4 angle the actual bug-report
// photos show (muzzle prominent to one side, far ear peeking out the other).
const ANGLES = [
  { label: 'front', dx: 0 },
  { label: 'threeQuarterR', dx: 0.5 },
  { label: 'threeQuarterL', dx: -0.5 },
];
const PET_CENTER_X = 170; // (340 CSS-px window - 96 WRAP_WIDTH)/2 + 48, round-10's centered start
const CURSOR_DIRECTION_RANGE = 130;

app.whenReady().then(async () => {
  petWindow = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  petWindow.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[pet]', message); });
  await petWindow.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  for (const key of SPECIES) {
    petWindow.webContents.send('preview-character', key);
    await new Promise((r) => setTimeout(r, 400));
    for (const { label, dx } of ANGLES) {
      const cx = PET_CENTER_X + dx * CURSOR_DIRECTION_RANGE;
      for (let i = 0; i < 12; i++) {
        petWindow.webContents.send('cursor-track', { x: cx, y: 100 });
        await new Promise((r) => setTimeout(r, 100));
      }
      // Darkest-color scan of the real #pet-canvas framebuffer via its own
      // public WebGL context - no pet.js internals touched.
      const darkest = await petWindow.webContents.executeJavaScript(`
        (function() {
          const canvas = document.getElementById('pet-canvas');
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const w = canvas.width, h = canvas.height;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const counts = new Map();
          for (let i = 0; i < buf.length; i += 4) {
            if (buf[i+3] < 10) continue;
            const hex = '#' + [buf[i],buf[i+1],buf[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
            counts.set(hex, (counts.get(hex)||0) + 1);
          }
          const relLum = (hex) => {
            const n = parseInt(hex.slice(1), 16);
            const r=(n>>16)&0xff, g=(n>>8)&0xff, b=n&0xff;
            return (0.2126*r+0.7152*g+0.0722*b)/255;
          };
          return [...counts.entries()].sort((a,b) => relLum(a[0]) - relLum(b[0])).slice(0, 5)
            .map(([hex,count]) => ({ hex, count, relLum: +relLum(hex).toFixed(3) }));
        })()
      `);
      console.log(key, label, JSON.stringify(darkest));
      const img = await petWindow.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${key}-${label}-full.png`), img.toPNG());
    }
  }
  console.log('DONE', OUT_DIR);
  app.quit();
});
