const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  for (const angle of ['000', '045']) {
    const before = nativeImage.createFromPath(path.join(__dirname, 'seam-round14-check', `before-cat_tuxedo-${angle}.png`));
    const after = nativeImage.createFromPath(path.join(__dirname, 'seam-round14-check', `after-cat_tuxedo-${angle}.png`));
    const sz = before.getSize();
    const bBuf = before.toBitmap(); // BGRA
    const aBuf = after.toBitmap();
    const diffCanvasData = Buffer.alloc(bBuf.length);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, changed = 0;
    for (let y = 0; y < sz.height; y++) {
      for (let x = 0; x < sz.width; x++) {
        const i = (y * sz.width + x) * 4;
        const db = bBuf[i] - aBuf[i], dg = bBuf[i + 1] - aBuf[i + 1], dr = bBuf[i + 2] - aBuf[i + 2];
        if (Math.abs(db) + Math.abs(dg) + Math.abs(dr) > 15) {
          changed++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          diffCanvasData[i] = 0; diffCanvasData[i + 1] = 0; diffCanvasData[i + 2] = 255; diffCanvasData[i + 3] = 255; // magenta-ish in BGRA (B=0,G=0,R=255)
        } else {
          diffCanvasData[i] = bBuf[i]; diffCanvasData[i + 1] = bBuf[i + 1]; diffCanvasData[i + 2] = bBuf[i + 2]; diffCanvasData[i + 3] = 255;
        }
      }
    }
    console.log(`angle ${angle}: changed=${changed} bbox=[${minX},${minY}]-[${maxX},${maxY}]`);
    if (changed > 0) {
      const diffImg = nativeImage.createFromBitmap(diffCanvasData, { width: sz.width, height: sz.height });
      fs.writeFileSync(path.join(__dirname, 'seam-round14-check', `diff-cat_tuxedo-${angle}.png`), diffImg.toPNG());
      // Also crop tightly around the changed bbox, zoomed, for a close look.
      if (maxX > minX) {
        const pad = 15;
        const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
        const cw = Math.min(sz.width - cx, maxX - minX + pad * 2), ch = Math.min(sz.height - cy, maxY - minY + pad * 2);
        const cropB = before.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: cw * 6, height: ch * 6, quality: 'good' });
        const cropA = after.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: cw * 6, height: ch * 6, quality: 'good' });
        fs.writeFileSync(path.join(__dirname, 'seam-round14-check', `zoomdiff-before-cat_tuxedo-${angle}.png`), cropB.toPNG());
        fs.writeFileSync(path.join(__dirname, 'seam-round14-check', `zoomdiff-after-cat_tuxedo-${angle}.png`), cropA.toPNG());
      }
    }
  }
  app.quit();
});
setTimeout(() => app.quit(), 15000);
