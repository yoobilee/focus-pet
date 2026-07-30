const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusPetAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  dragStart: (offset) => ipcRenderer.send('drag-start', offset),
  dragEnd: (spriteRect) => ipcRenderer.send('drag-end', spriteRect),
  // Pacing ("좌우 이동" movement mode) - fire-and-forget per-frame delta
  // requests (renderer -> main, see main.js's 'pace-move' handler) and a
  // fire-and-forget notification back (main -> renderer) whenever a move
  // would cross a screen edge, so pet.js's pacing state machine knows when
  // to stop the current leg and start resting - see pet.js's own comment
  // for why main.js, not pet.js, owns the boundary check.
  paceMove: (deltaX) => ipcRenderer.send('pace-move', deltaX),
  onPaceHitEdge: (callback) => ipcRenderer.on('pace-hit-edge', (_event, side) => callback(side)),
  // Pushed whenever main.js (re)positions the pet window - the LOCAL
  // (window-relative) X pet.js should render the sprite, and thus the now
  // window-embedded speech bubble (which positions itself relative to the
  // sprite - see pet.js's positionBubble), at. See main.js's
  // spriteWindowLayout/pushSpriteLocalX for why this isn't just "always
  // centered" - the window is now much wider than the sprite, and how that
  // extra width splits left/right depends on how close the sprite
  // currently is to a screen edge.
  onSpriteLocalX: (callback) => ipcRenderer.on('sprite-local-x', (_event, x) => callback(x)),
  onReminder: (callback) => ipcRenderer.on('reminder', (_event, data) => callback(data)),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, data) => callback(data)),
  onAwayStateChanged: (callback) => ipcRenderer.on('pet-away-state', (_event, data) => callback(data)),
  onCursorTrack: (callback) => ipcRenderer.on('cursor-track', (_event, data) => callback(data)),
  // Live character preview (settings window -> pet window, unsaved) - see
  // main.js's 'preview-character' handler and settings.js's char-grid
  // click handler.
  previewCharacter: (key) => ipcRenderer.send('preview-character', key),
  onPreviewCharacter: (callback) => ipcRenderer.on('preview-character', (_event, key) => callback(key)),
  // Pushed whenever main.js flips "펫 숨기기" (see its own setPetVisible) -
  // pet.js stops drawing the sprite (and, by construction, its own
  // click-through hit-test naturally goes fully pass-through) while
  // hidden:true, but keeps showing reminder bubbles as normal.
  onPetHiddenState: (callback) => ipcRenderer.on('pet-hidden-state', (_event, data) => callback(data)),
  // Fired back to main.js once pet.js has actually applied a
  // 'pet-hidden-state' push and had a real paint reflect it (see pet.js's
  // own double-requestAnimationFrame) - main.js holds the window at
  // opacity 0 for the whole reposition+IPC handshake and only restores it
  // to 1 once this ack lands, so the position jump itself is never visible
  // (see main.js's armPetHiddenOpacityRestore).
  notifyHiddenApplied: () => ipcRenderer.send('pet-hidden-applied'),
  // "10분 뒤 다시" snooze button (pet.js's own bubble markup) - fire-and-
  // forget, see main.js's 'snooze-reminder' handler.
  snoozeReminder: (message) => ipcRenderer.send('snooze-reminder', message),
  // Quick controls ("트레이 메뉴 전용 기능들을 설정 페이지에서도") - the
  // settings window's own equivalents of the tray menu's pause/resume,
  // show/hide, and "test now" actions, plus "오늘 하루 알림 끄기" (tray-
  // menu-only features don't need a tray equivalent, just the reverse).
  // getStatus/onStatusUpdated are how the settings window's toggles stay in
  // sync with whatever the tray (or the settings window itself) last did -
  // see main.js's getStatus/broadcastStatus.
  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatusUpdated: (callback) => ipcRenderer.on('status-updated', (_event, status) => callback(status)),
  togglePaused: () => ipcRenderer.send('toggle-paused'),
  togglePetVisible: () => ipcRenderer.send('toggle-pet-visible'),
  toggleOffToday: () => ipcRenderer.send('toggle-off-today'),
  fireReminderNow: () => ipcRenderer.send('fire-reminder-now')
});
