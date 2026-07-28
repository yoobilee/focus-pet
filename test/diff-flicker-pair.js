// Decodes two PNGs via nativeImage and compares actual PIXEL data (not
// just the encoded PNG bytes, which is what launch-idle-cycle-flicker.js's
// quick check used - a non-deterministic PNG encoder could in principle
// produce different bytes for identical pixels, which would be a false
// positive, not a real rendering flicker). Reports how many pixels differ
// and by how much, to tell that apart from a genuine visual change.
const { app, nativeImage } = require('electron');
const path = require('path');

const [, , fileA, fileB] = process.argv;

app.whenReady().then(() => {
  const a = nativeImage.createFromPath(path.resolve(fileA));
  const b = nativeImage.createFromPath(path.resolve(fileB));
  const bmpA = a.toBitmap(), bmpB = b.toBitmap();
  console.log('sizes', a.getSize(), b.getSize(), 'bitmap bytes', bmpA.length, bmpB.length);
  let diffPixels = 0, maxDelta = 0;
  const n = Math.min(bmpA.length, bmpB.length);
  for (let i = 0; i < n; i += 4) {
    const dr = Math.abs(bmpA[i] - bmpB[i]);
    const dg = Math.abs(bmpA[i + 1] - bmpB[i + 1]);
    const db = Math.abs(bmpA[i + 2] - bmpB[i + 2]);
    const da = Math.abs(bmpA[i + 3] - bmpB[i + 3]);
    const d = Math.max(dr, dg, db, da);
    if (d > 0) { diffPixels++; maxDelta = Math.max(maxDelta, d); }
  }
  console.log('diffPixels:', diffPixels, '/ total:', n / 4, 'maxDelta:', maxDelta);
  app.quit();
});
