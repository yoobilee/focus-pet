// Final verification screenshots (round 5, issue 5) - cropped/zoomed
// views of the head/body junction during rotation, for cat_siamese and
// dog_husky (the two species where head/body z-fighting was actually
// visible, per HEAD_Z_NUDGE's comment in voxel-engine.js).
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const OUT_DIR = path.join(__dirname, 'neck-rotation-final');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SPECIES = ['cat_siamese', 'dog_husky'];

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
    await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
    for (const deg of [0, 15, 30, 45, 60]) {
      await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(deg * Math.PI) / 180})`);
      await new Promise((r) => setTimeout(r, 80));
      const img = await win.webContents.capturePage();
      // Crop tight around the head/body junction (roughly x:250-500,
      // y:130-330 in the 480x480x(devicePixelRatio) capture) and upscale
      // further for a clear close-up.
      const sz = img.getSize();
      const scale = sz.width / 480;
      const rect = { x: Math.round(260 * scale), y: Math.round(120 * scale), width: Math.round(220 * scale), height: Math.round(220 * scale) };
      const cropped = img.crop(rect);
      const big = cropped.resize({ width: rect.width * 3, height: rect.height * 3, quality: 'good' });
      fs.writeFileSync(path.join(OUT_DIR, `${key}-neck-${String(deg).padStart(3, '0')}.png`), big.toPNG());
    }
  }

  console.log('DONE', OUT_DIR);
  app.quit();
});
