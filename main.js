const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, nativeImage } = require('electron');
const path = require('path');
const store = require('./settingsStore');

let petWindow = null;
let settingsWindow = null;
let tray = null;

let settings = store.load();

let intervalTimer = null;
let idlePollTimer = null;
let wasIdle = false; // tracks whether we've already fired a reminder for the current idle stretch

const PET_SIZE = { width: 460, height: 210 };

function getPetPosition(display) {
  const { workArea } = display;
  const margin = 24;
  const positions = {
    'bottom-right': {
      x: workArea.x + workArea.width - PET_SIZE.width - margin,
      y: workArea.y + workArea.height - PET_SIZE.height - margin
    },
    'bottom-left': {
      x: workArea.x + margin,
      y: workArea.y + workArea.height - PET_SIZE.height - margin
    },
    'top-right': {
      x: workArea.x + workArea.width - PET_SIZE.width - margin,
      y: workArea.y + margin
    },
    'top-left': {
      x: workArea.x + margin,
      y: workArea.y + margin
    }
  };
  return positions[settings.position] || positions['bottom-right'];
}

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const pos = getPetPosition(display);

  petWindow = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Stay above other windows, including fullscreen apps (lecture videos, etc.)
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadFile(path.join(__dirname, 'windows', 'pet', 'index.html'));
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'FocusPet 설정',
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'windows', 'settings', 'index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function pickMessage() {
  const list = settings.messages && settings.messages.length ? settings.messages : store.DEFAULTS.messages;
  return list[Math.floor(Math.random() * list.length)];
}

function fireReminder() {
  if (settings.paused) return;
  if (petWindow) {
    petWindow.webContents.send('reminder', {
      message: pickMessage(),
      soundEnabled: settings.soundEnabled
    });
  }
}

function clearTimers() {
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  if (idlePollTimer) { clearInterval(idlePollTimer); idlePollTimer = null; }
}

function applyTimers() {
  clearTimers();
  wasIdle = false;

  if (settings.mode === 'interval' || settings.mode === 'both') {
    const ms = Math.max(1, settings.intervalMinutes) * 60 * 1000;
    intervalTimer = setInterval(fireReminder, ms);
  }

  if (settings.mode === 'idle' || settings.mode === 'both') {
    idlePollTimer = setInterval(() => {
      const idleSec = powerMonitor.getSystemIdleTime();
      const threshold = Math.max(5, settings.idleThresholdSeconds);
      if (idleSec >= threshold) {
        if (!wasIdle) {
          wasIdle = true;
          fireReminder();
        }
      } else {
        wasIdle = false;
      }
    }, 5000);
  }
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('FocusPet');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: settings.paused ? '알림 재개' : '알림 일시정지',
      click: () => {
        settings.paused = !settings.paused;
        store.save(settings);
        refreshTrayMenu();
      }
    },
    {
      label: petWindow && petWindow.isVisible() ? '펫 숨기기' : '펫 보이기',
      click: () => {
        if (!petWindow) return;
        if (petWindow.isVisible()) petWindow.hide(); else petWindow.show();
        refreshTrayMenu();
      }
    },
    { type: 'separator' },
    { label: '설정 열기', click: () => createSettingsWindow() },
    { label: '지금 바로 알림 테스트', click: () => fireReminder() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(() => {
  createPetWindow();
  buildTray();
  applyTimers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('window-all-closed', (e) => {
  // Keep running in tray even if windows are closed
  e.preventDefault ? null : null;
});

// ---- IPC ----

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  store.save(settings);
  applyTimers();
  refreshTrayMenu();
  if (petWindow) {
    const display = screen.getPrimaryDisplay();
    const pos = getPetPosition(display);
    petWindow.setPosition(pos.x, pos.y);
    petWindow.webContents.send('settings-updated', settings);
  }
  return settings;
});

ipcMain.handle('get-defaults', () => store.DEFAULTS);

ipcMain.on('close-settings', () => {
  if (settingsWindow) settingsWindow.close();
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});
