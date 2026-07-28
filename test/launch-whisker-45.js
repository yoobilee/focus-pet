const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: true, frame: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: 'cat_a', spin: '0' } });
  await win.webContents.executeJavaScript(`new Promise((resolve) => { const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); }; check(); });`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${(35*Math.PI)/180})`);
  await new Promise(r => setTimeout(r, 150));
  const img = await win.webContents.capturePage();
  const sz = img.getSize();
  const cropped = img.crop({ x: Math.round(sz.width*0.5), y: Math.round(sz.height*0.35), width: Math.round(sz.width*0.4), height: Math.round(sz.height*0.35) });
  const big = cropped.resize({ width: cropped.getSize().width*4, height: cropped.getSize().height*4, quality: 'good' });
  fs.writeFileSync(path.join(__dirname, 'frontdetail-check', 'cat_a-035-whiskers.png'), big.toPNG());
  app.quit();
});
