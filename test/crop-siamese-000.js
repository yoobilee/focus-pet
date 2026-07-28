const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(() => {
  const img = nativeImage.createFromPath(path.join(__dirname, 'siamese-gradient-final', 'siamese-000.png'));
  const sz = img.getSize();
  const cropped = img.crop({ x: Math.round(sz.width*0.62), y: Math.round(sz.height*0.28), width: Math.round(sz.width*0.28), height: Math.round(sz.height*0.32) });
  const big = cropped.resize({ width: cropped.getSize().width*8, height: cropped.getSize().height*8, quality: 'good' });
  fs.writeFileSync(path.join(__dirname, 'siamese-gradient-final', 'siamese-000-zoom.png'), big.toPNG());
  app.quit();
});
