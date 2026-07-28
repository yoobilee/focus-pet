const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SPECIES = ['cat_calico', 'dog_corgi', 'dog_husky', 'dog_pomeranian'];

app.whenReady().then(() => {
  for (const key of SPECIES) {
    for (const angle of ['000', '045']) {
      const beforePath = path.join(__dirname, 'seam-round14-check', `before-${key}-${angle}.png`);
      const afterPath = path.join(__dirname, 'seam-round14-check', `after-${key}-${angle}.png`);
      if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) { console.log(key, angle, 'MISSING'); continue; }
      const before = nativeImage.createFromPath(beforePath);
      const after = nativeImage.createFromPath(afterPath);
      const sz = before.getSize();
      const bBuf = before.toBitmap();
      const aBuf = after.toBitmap();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, changed = 0;
      for (let y = 0; y < sz.height; y++) {
        for (let x = 0; x < sz.width; x++) {
          const i = (y * sz.width + x) * 4;
          const db = bBuf[i] - aBuf[i], dg = bBuf[i + 1] - aBuf[i + 1], dr = bBuf[i + 2] - aBuf[i + 2];
          if (Math.abs(db) + Math.abs(dg) + Math.abs(dr) > 15) {
            changed++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      console.log(`${key} ${angle}: changed=${changed} bbox=[${minX},${minY}]-[${maxX},${maxY}]`);
      if (changed > 5 && maxX > minX) {
        const pad = 15;
        const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
        const cw = Math.min(sz.width - cx, maxX - minX + pad * 2), ch = Math.min(sz.height - cy, maxY - minY + pad * 2);
        const cropB = before.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: cw * 6, height: ch * 6, quality: 'good' });
        const cropA = after.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: cw * 6, height: ch * 6, quality: 'good' });
        fs.writeFileSync(path.join(__dirname, 'seam-round14-check', `zoomdiff-before-${key}-${angle}.png`), cropB.toPNG());
        fs.writeFileSync(path.join(__dirname, 'seam-round14-check', `zoomdiff-after-${key}-${angle}.png`), cropA.toPNG());
      }
    }
  }
  app.quit();
});
setTimeout(() => app.quit(), 20000);
