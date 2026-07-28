const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.join(__dirname, 'frontdetail-check', 'cat_a-000.png'));
  const sz = img.getSize();
  const cropped = img.crop({ x: Math.round(sz.width*0.62), y: Math.round(sz.height*0.42), width: Math.round(sz.width*0.35), height: Math.round(sz.height*0.28) });
  const big = cropped.resize({ width: cropped.getSize().width*5, height: cropped.getSize().height*5, quality: 'good' });
  fs.writeFileSync(path.join(__dirname, 'frontdetail-check', 'cat_a-whiskers-zoom.png'), big.toPNG());
  app.quit();
});
