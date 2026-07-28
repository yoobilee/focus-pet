const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusPetAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  dragStart: (offset) => ipcRenderer.send('drag-start', offset),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onReminder: (callback) => ipcRenderer.on('reminder', (_event, data) => callback(data)),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, data) => callback(data)),
  onAwayStateChanged: (callback) => ipcRenderer.on('pet-away-state', (_event, data) => callback(data)),
  onCursorTrack: (callback) => ipcRenderer.on('cursor-track', (_event, data) => callback(data)),
  // Live character preview (settings window -> pet window, unsaved) - see
  // main.js's 'preview-character' handler and settings.js's char-grid
  // click handler.
  previewCharacter: (key) => ipcRenderer.send('preview-character', key),
  onPreviewCharacter: (callback) => ipcRenderer.on('preview-character', (_event, key) => callback(key))
});
