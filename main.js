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

const PET_SIZE = { width: 340, height: 210 }; // narrower than before - patrol range was too wide
const AWAY_IDLE_THRESHOLD_SEC = 180; // 3 minutes with no input -> pet dozes off (cosmetic only, unrelated to the reminder idle setting)
let petAway = false;
let awayPollTimer = null;
let dragPollTimer = null;
let cursorTrackPollTimer = null;
let alwaysOnTopPollTimer = null;

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
  // Click-through by default: the window is transparent but still occupies
  // a 340x210 rectangle, and without this the whole rectangle would eat
  // clicks meant for whatever's behind it. {forward:true} keeps mousemove
  // events reaching the renderer even while ignoring, so pet.js can hit-
  // test the cursor against the actually-drawn (non-transparent) pixels
  // and toggle this back off only while hovering one - see the
  // 'set-ignore-mouse-events' handler below.
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  // The pet window now renders actual 3D (Three.js) geometry instead of a
  // static sprite - surface any renderer-side errors here since they'd
  // otherwise be silent (no devtools open on a frameless overlay window).
  petWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet-window] ${message} (${sourceId}:${line})`);
  });
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
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Revert any unsaved live character preview (see 'preview-character'
    // below) back to whatever was actually last saved - `settings` here is
    // only ever mutated by the 'save-settings' handler, so at this point it
    // still holds the last-persisted value regardless of how many times the
    // user clicked around the character grid without saving. Reuses the
    // exact same 'settings-updated' channel/pet.js handler save already
    // uses (pet.js only reloads if the character actually differs from
    // what's currently showing), so this is a no-op whenever the settings
    // window closes via Save (character already matches) and only does
    // real work when it's closed some other way (the OS close button, etc.)
    // after previewing but not saving.
    if (petWindow) petWindow.webContents.send('settings-updated', settings);
  });
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
      soundEnabled: settings.soundEnabled,
      soundVolume: settings.soundVolume
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

function startAwayPoll() {
  if (awayPollTimer) return;
  awayPollTimer = setInterval(() => {
    const idleSec = powerMonitor.getSystemIdleTime();
    const shouldBeAway = idleSec >= AWAY_IDLE_THRESHOLD_SEC;
    if (shouldBeAway !== petAway) {
      petAway = shouldBeAway;
      if (petWindow) petWindow.webContents.send('pet-away-state', { away: petAway });
    }
  }, 5000);
}

// Continuously reports the cursor's position *relative to the pet window*
// (in the same coordinate space a local `mousemove` event's clientX/clientY
// would use) so pet.js's head/eye cursor-tracking works screen-wide, not
// only while the cursor happens to be over this small 340x210 click-
// through window - a plain renderer-side `mousemove` listener (which is
// all pet.js had before) can only ever fire while the cursor is inside the
// window's own bounds, the same blind spot documented on drag-start below.
// 100ms is plenty responsive for a coarse "which side is the cursor on"
// signal (unlike the drag-follow poll's 16ms, this isn't driving anything
// that needs to feel physically attached to the cursor) and negligible
// overhead next to the existing 5s away-poll.
function startCursorTrackPoll() {
  if (cursorTrackPollTimer) return;
  cursorTrackPollTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    petWindow.webContents.send('cursor-track', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
  }, 100);
}

// setAlwaysOnTop(true,'screen-saver') was only ever called once, at window
// creation - Windows can silently drop a window's topmost z-order, or
// push it behind another equally-"topmost" window, in several situations
// Electron has no direct event for (another app requesting its own
// topmost/screen-saver-level placement, certain exclusive-fullscreen
// games/players, UAC prompts, etc.), and neither Electron nor this app was
// re-asserting it afterward, so the pet could end up stuck behind
// whatever caused it until something else (e.g. restarting the app) fixed
// it. Unconditionally re-calling setAlwaysOnTop every few seconds - not
// gated behind isAlwaysOnTop() - covers both cases: it re-sets the flag if
// something cleared it outright, AND re-promotes this window to the front
// of the topmost group if another topmost window simply got placed above
// it while the flag itself stayed true. Cheap and idempotent when nothing
// changed, so a short poll self-heals within a few seconds regardless of
// the specific cause, without needing to detect or enumerate those causes
// individually.
function startAlwaysOnTopPoll() {
  if (alwaysOnTopPollTimer) return;
  alwaysOnTopPollTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  }, 3000);
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
  startAwayPoll();
  startCursorTrackPoll();
  startAlwaysOnTopPoll();

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

// Live character preview (round 8) - relays a not-yet-saved character
// pick straight to the pet window so it shows immediately, without
// touching `settings`/settingsStore at all. The revert-if-not-saved side
// of this lives in createSettingsWindow's 'closed' handler above, not
// here - this handler is purely "forward whatever settings.js clicked".
ipcMain.on('preview-character', (event, key) => {
  if (petWindow) petWindow.webContents.send('preview-character', key);
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setIgnoreMouseEvents(ignore, options);
});

// Drag-to-reposition: pet.js starts this on mousedown over the sprite and
// stops it on mouseup (see the 'drag' block in pet.js for why the actual
// following happens here rather than off the renderer's own mousemove -
// short version: mousemove can't track a cursor that's left this window's
// current bounds, but screen.getCursorScreenPoint() has no such blind
// spot). offset is the cursor's position *within* the window at drag-start
// (in the same coordinate space BrowserWindow x/y use), so the grabbed
// point keeps tracking the cursor exactly rather than snapping the
// window's top-left corner to it.
ipcMain.on('drag-start', (event, offset) => {
  if (dragPollTimer) return; // already dragging - ignore a stray duplicate start
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // setBounds() with width/height pinned to their drag-start values, not
  // setPosition(x,y) - empirically, calling setPosition() every ~16ms
  // together with screen.getCursorScreenPoint() while this specific
  // window (transparent/frameless/always-on-top, actively repainting a
  // canvas every frame) is on screen made its height creep upward
  // continuously for as long as the poll ran (confirmed via a dedicated
  // repro script; isolating narrower combinations - setPosition alone,
  // this window without dragging, a blank window with the same cursor+
  // setPosition polling - all stayed perfectly stable, so this is a
  // narrow interaction rather than setPosition being broken in general).
  // Explicitly re-asserting width/height every tick sidesteps it
  // regardless of the exact root cause.
  const { width, height, x: startX, y: startY } = win.getBounds();
  // Spring-follow instead of snapping straight to the cursor every tick -
  // makes the window lag/swing a little behind fast cursor movement rather
  // than tracking it 1:1, like something loosely held rather than glued to
  // the pointer. Standard damped-spring integration: force pulls the
  // current position toward the target (cursor - grab offset) in
  // proportion to how far away it is (SPRING_STIFFNESS), velocity bleeds
  // off in proportion to itself (SPRING_DAMPING). DAMPING is deliberately
  // set below critical (2*sqrt(stiffness) =~ 26.8 here) so it slightly
  // overshoots and settles rather than easing straight in - a bit of
  // "swing" is the point (see CLAUDE.md for the tuning rationale/values
  // tried).
  const SPRING_STIFFNESS = 180;
  const SPRING_DAMPING = 16;
  let curX = startX, curY = startY;
  let velX = 0, velY = 0;
  let lastTick = Date.now();
  dragPollTimer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(dragPollTimer); dragPollTimer = null; return; }
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastTick) / 1000); // clamp so a stall (e.g. debugger pause) can't fling the spring
    lastTick = now;
    const cursor = screen.getCursorScreenPoint();
    const targetX = cursor.x - offset.offsetX;
    const targetY = cursor.y - offset.offsetY;
    const accX = (targetX - curX) * SPRING_STIFFNESS - velX * SPRING_DAMPING;
    const accY = (targetY - curY) * SPRING_STIFFNESS - velY * SPRING_DAMPING;
    velX += accX * dt;
    velY += accY * dt;
    curX += velX * dt;
    curY += velY * dt;
    win.setBounds({ x: Math.round(curX), y: Math.round(curY), width, height });
  }, 16);
});

ipcMain.on('drag-end', () => {
  if (dragPollTimer) { clearInterval(dragPollTimer); dragPollTimer = null; }
});
