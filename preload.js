const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusPetAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  openSettings: () => ipcRenderer.send('open-settings'),
  onReminder: (callback) => ipcRenderer.on('reminder', (_event, data) => callback(data)),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, data) => callback(data))
});
