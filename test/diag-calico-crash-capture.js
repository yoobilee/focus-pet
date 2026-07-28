const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

ipcMain.handle('get-settings', () => ({ character: 'cat_calico' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 340, height: 210, show: true, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    console.log(`[console L${level}] ${message}  (${sourceId}:${line})`);
  });
  await win.loadFile(path.join(__dirname, '..', 'windows', 'pet', 'index.html'));

  // Install a page-level error handler via executeJavaScript, storing any
  // caught error on window for retrieval - window.onerror/unhandledrejection
  // catch things a console-message listener alone might not surface
  // identically.
  await win.webContents.executeJavaScript(`
    window.__caughtErrors__ = [];
    window.addEventListener('error', (e) => {
      window.__caughtErrors__.push({ type: 'error', message: e.message, stack: e.error && e.error.stack, filename: e.filename, lineno: e.lineno, colno: e.colno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      window.__caughtErrors__.push({ type: 'unhandledrejection', reason: String(e.reason), stack: e.reason && e.reason.stack });
    });
  `);

  await new Promise((r) => setTimeout(r, 8000));

  const errors = await win.webContents.executeJavaScript('window.__caughtErrors__');
  const idleDbg = await win.webContents.executeJavaScript('window.__idleReadHook__ ? window.__idleReadHook__() : null');
  console.log('\ncaught errors:', JSON.stringify(errors, null, 1));
  console.log('current idle state after 8s:', idleDbg ? idleDbg.currentIdleName : 'N/A', 'behaviorTimer:', idleDbg ? idleDbg.behaviorTimer : 'N/A');
  app.quit();
});
