const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 480, show: false });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet3d', 'index.html'), { query: { species: 'cat_a', spin: '0' } });
  await win.webContents.executeJavaScript(`new Promise((resolve) => { const check = () => { if (window.focusPet3D && window.focusPet3D.ready) resolve(); else requestAnimationFrame(check); }; check(); });`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setBodyPose({})`);
  await win.webContents.executeJavaScript(`window.focusPet3D.setAngle(${Math.PI/2})`);
  await new Promise(r => setTimeout(r, 150));
  const dump = await win.webContents.executeJavaScript(`window.focusPet3D.getRawPixels()`);
  const { w, h, buf } = dump;
  function px(x,y) { const fy=h-1-y; const i=(fy*w+x)*4; return [buf[i],buf[i+1],buf[i+2],buf[i+3]]; }
  const isBg = (r,g,b) => Math.abs(r-42)<12 && Math.abs(g-107)<12 && Math.abs(b-58)<12;
  // scan a vertical strip through where the eye should be
  for (let y = 30; y < 55; y++) {
    let row = '';
    for (let x = 55; x < 75; x++) {
      const [r,g,b,a] = px(x,y);
      row += isBg(r,g,b) ? '.' : `(${r},${g},${b})`;
    }
    console.log(`y=${y}: ${row}`);
  }
  app.quit();
});
