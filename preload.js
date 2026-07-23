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
  onCursorTrack: (callback) => ipcRenderer.on('cursor-track', (_event, data) => callback(data))
});
