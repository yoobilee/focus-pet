const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 620, show: false });
  await win.loadFile(path.join(__dirname, 'comparison.html'));
  await new Promise((r) => {
    const check = setInterval(async () => {
      const err = await win.webContents.executeJavaScript('window.__error || null');
      if (err) { clearInterval(check); console.error('ERROR', err); r(); return; }
      const done = await win.webContents.executeJavaScript('window.__done === true');
      if (done) { clearInterval(check); r(); }
    }, 100);
  });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'siamese-comparison.png'), img.toPNG());
  console.log('wrote test/siamese-comparison.png');
  app.quit();
});
