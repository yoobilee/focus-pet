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

// ---------------------------------------------------------------------
// Bubble merged back into the pet window ("말풍선을 다시 펫 창에 내장"): the
// reminder bubble briefly lived in its own separate BrowserWindow (see git
// history / CLAUDE.md's several rounds on this) - the idea was that
// decoupling the bubble's clipping behavior from the pet window's own size
// would remove the recurring gap/centering bugs, but in practice it just
// relocated the same class of bug: two INDEPENDENTLY DPI-rounded windows
// (pet + bubble) having to agree with each other on screen position turned
// out to be its own steady source of the exact same symptoms (visible
// gaps, off-center tails) the split was meant to fix. Simplifying back to
// ONE window removes that whole failure mode structurally, not just
// patches around it again - at the cost of PET_SIZE now being a
// deliberately oversized fixed rectangle (see its own comment) rather than
// tightly fit to the sprite, with the bubble living inside it again as a
// plain DOM element (positioned/clamped entirely by pet.js - see its
// positionBubble()) instead of a second window main.js has to manage.
const SPRITE_WIDTH = 96; // mirrors pet.js's WRAP_WIDTH - duplicated here rather than imported since main.js and the renderer don't share a module boundary
// Mirrors pet.css's #pet-wrap{bottom:...} - how far the sprite's feet sit
// above this window's own bottom edge (and thus the taskbar, since the
// window is ground-anchored - see groundWindowY below). Also used by
// pet.css to anchor the bubble's own vertical position above the sprite -
// keep the three (here, pet.css's #pet-wrap, pet.css's #bubble) in sync if
// this ever changes.
const SPRITE_BOTTOM_INSET = 3;
// Smallest margin ever left between the sprite and the pet window's own
// edge, on whichever side sits nearer a screen edge (see
// spriteWindowLayout below) - covers pet-canvas's own CSS drop-shadow
// filter (which paints a little outside the canvas's own box) plus a bit
// of DPI-rounding safety margin (this project has repeatedly measured a
// few px of "requested vs granted window bounds" drift at non-100% scale
// factors - see CLAUDE.md's history).
const MIN_SPRITE_MARGIN = 16;
// Fixed window size - generous enough that the bubble (CSS-capped at
// #bubble{max-width:190px} in pet.css, ~230px including padding/shadow
// clearance - see pet.js's positionBubble for the exact figure) always has
// somewhere to fit within it regardless of message length, AND (combined
// with spriteWindowLayout's asymmetric margin split below) the window
// itself stays safely on-screen even with the sprite resting flush against
// a screen edge - anything the window extends PAST the screen's own edge
// is invisible/clipped by the OS regardless of what pet.js's own internal
// CSS clamping does, so the window's on-screen-ness is the thing that
// actually has to hold, not just "is the window wide enough" in the
// abstract. Deliberately NOT resized per-message (a single static size,
// unlike the earlier separate bubble window's per-message auto-sizing) -
// verified against 100%/125% Windows display scaling specifically per this
// round's request; other scale factors aren't covered this round.
const PET_SIZE = { width: 420, height: 400 };

// How far from the screen's left/right edge the SPRITE rests once snapped
// there - shared by three call sites that all need to agree on the exact
// same resting spot: the initial launch position, drag-release edge-snap,
// and pacing's own turnaround points (see edgeSpriteX below).
const EDGE_MARGIN = 24;

const AWAY_IDLE_THRESHOLD_SEC = 180; // 3 minutes with no input -> pet dozes off (cosmetic only, unrelated to the reminder idle setting)
let petAway = false;
let awayPollTimer = null;
let dragPollTimer = null;
let cursorTrackPollTimer = null;
let alwaysOnTopPollTimer = null;

// Ground anchor: workArea already excludes the taskbar, so its own bottom
// edge IS the taskbar's top edge - the window's bottom edge sitting flush
// with that puts the pet "바로 위" (right above) the taskbar, with pet.css's
// own `#pet-wrap{bottom:3px}` (SPRITE_BOTTOM_INSET) providing a little
// natural standing-room gap between the sprite's feet and the window's
// (and thus the taskbar's) edge. No multi-monitor handling (same accepted
// limitation as the rest of the app - always screen.getPrimaryDisplay()).
function groundWindowY(display) {
  return display.workArea.y + display.workArea.height - PET_SIZE.height;
}

// Where the SPRITE's own left edge should sit on screen when resting
// EDGE_MARGIN px from the given screen edge - deliberately independent of
// window size/layout (see spriteWindowLayout below, which turns this into
// an actual window position + local sprite offset pair). "sprite" here
// always means the 96px sprite itself, not the (now much wider) window.
function edgeSpriteX(side, display) {
  const { workArea } = display;
  return side === 'left'
    ? workArea.x + EDGE_MARGIN
    : workArea.x + workArea.width - EDGE_MARGIN - SPRITE_WIDTH;
}

// Splits PET_SIZE.width's total spare margin (width - SPRITE_WIDTH)
// asymmetrically between the sprite's left/right sides so the (now
// window-embedded) speech bubble always has room to shift AWAY from
// whichever screen edge the sprite is nearest, without the WINDOW itself
// ever needing to extend past that edge: MIN_SPRITE_MARGIN is kept on the
// side nearer the edge, and everything else goes to the far side.
// Continuously interpolated by how close the sprite currently is to either
// edge (t=0 right at the left edge, t=1 right at the right edge) rather
// than a hard two-state switch, so this also degrades gracefully for a
// freely-dropped position that isn't snapped to either edge (t≈0.5,
// roughly symmetric margins).
//
// Returns BOTH the window's own origin (winX) and the sprite's resulting
// LOCAL offset within it (localX - the window-local px pet.js needs to
// render the sprite, and thus the bubble which positions itself relative
// to the sprite, at). Every caller that uses winX MUST also push the
// matching localX to pet.js (see pushSpriteLocalX) so the two stay in sync
// - winX + localX always equals the spriteScreenX this was computed from.
function spriteWindowLayout(spriteScreenX, display) {
  const { workArea } = display;
  const extra = PET_SIZE.width - SPRITE_WIDTH;
  const usableExtra = Math.max(0, extra - MIN_SPRITE_MARGIN * 2);
  const range = Math.max(1, workArea.width - SPRITE_WIDTH);
  const t = Math.max(0, Math.min(1, (spriteScreenX - workArea.x) / range));
  const localX = MIN_SPRITE_MARGIN + t * usableExtra;
  return { winX: spriteScreenX - localX, localX };
}

// Mirrors whatever local X was last pushed to pet.js (see pushSpriteLocalX)
// - lets pace-move compare the sprite's CURRENT on-screen position against
// the screen edges without a round trip, and gives drag/drop a known
// starting point to interpolate away from. Read from what WE last set,
// never from anything read back off the window (same principle as
// PET_SIZE itself being reasserted from a constant every tick rather than
// from win.getBounds() - see drag-start's own comment on why that matters
// on this platform). Starts symmetric (matching PET_SIZE.width's own
// midpoint) purely as a sane pre-launch default - createPetWindow
// immediately overwrites this with the real computed value before the
// window is ever shown.
let currentSpriteLocalX = (PET_SIZE.width - SPRITE_WIDTH) / 2;

function pushSpriteLocalX(win, localX) {
  currentSpriteLocalX = localX;
  if (win && !win.isDestroyed()) win.webContents.send('sprite-local-x', localX);
}

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  // Starts at the right edge every launch, matching the old default
  // position's spirit ('bottom-right') - arbitrary free X positions were
  // never persisted before either, so not persisting the new free X on
  // restart isn't a behavioral downgrade.
  const spriteX = edgeSpriteX('right', display);
  const layout = spriteWindowLayout(spriteX, display);
  const y = groundWindowY(display);

  petWindow = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: layout.winX,
    y,
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
  // The BrowserWindow constructor and a runtime setBounds() call apparently
  // don't settle on quite the same actual size on this platform (see
  // earlier rounds' investigation in CLAUDE.md) - re-asserting bounds
  // through the exact same setBounds() path every other size-setting call
  // uses makes the very first frame settle into the same size as
  // everything after it, instead of being its own one-off case.
  petWindow.setBounds({ x: layout.winX, y, width: PET_SIZE.width, height: PET_SIZE.height });
  currentSpriteLocalX = layout.localX;

  // Stay above other windows, including fullscreen apps (lecture videos, etc.)
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through by default: the window is transparent but still occupies
  // a PET_SIZE rectangle, and without this the whole rectangle would eat
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
  // Pushes the initial local X the instant the page is ready, so pet.js's
  // very first rendered frame already reflects the correct (possibly
  // asymmetric) sprite offset instead of the plain centered pre-launch
  // default (currentSpriteLocalX's own comment) - only ever visible, if at
  // all, for the handful of frames before this fires.
  petWindow.webContents.once('did-finish-load', () => {
    pushSpriteLocalX(petWindow, layout.localX);
  });
  petWindow.loadFile(path.join(__dirname, 'windows', 'pet', 'index.html'));
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 640,
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

  // 'both' mode retired (see settingsStore.js's load() migration) - each
  // branch now checks its own mode only, not an OR with 'both'.
  if (settings.mode === 'interval') {
    const ms = Math.max(1, settings.intervalMinutes) * 60 * 1000;
    intervalTimer = setInterval(fireReminder, ms);
  }

  if (settings.mode === 'idle') {
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
// only while the cursor happens to be over this small click-through
// window - a plain renderer-side `mousemove` listener (which is
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
    if (petWindow && !petWindow.isDestroyed()) petWindow.setAlwaysOnTop(true, 'screen-saver');
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
  // No more position-based repositioning here - the old 4-corner 'position'
  // setting this handler used to snap the window to on every save is gone
  // (see settingsStore.js). pet.js's own 'settings-updated' handler reacts
  // to movementMode changing (stopping/starting the pacing walk) the same
  // way it already reacts to the character changing - nothing for main.js
  // to do about window position on a settings save anymore.
  if (petWindow) petWindow.webContents.send('settings-updated', settings);
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
//
// The sprite's LOCAL offset within the window (currentSpriteLocalX) is
// deliberately left untouched for the whole drag - offset.offsetX was
// captured from pet.js's own mousedown as the click's window-local
// position, which is only a stable "grabbed point" reference if the
// sprite's own local offset doesn't move out from under it mid-drag. The
// asymmetric-margin layout (spriteWindowLayout) only gets (re)applied once
// the pet SETTLES somewhere - drag-end's drop animation, or a pacing edge
// hit - not during active real-time following.
ipcMain.on('drag-start', (event, offset) => {
  if (dragPollTimer) return; // already dragging - ignore a stray duplicate start
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // Grabbing the pet again while a just-finished drop animation (below) is
  // still sliding/falling into place would otherwise leave two timers both
  // calling setBounds() on the same window.
  if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
  // Invalidates any in-progress pacing baseline (see the pacing section
  // below) - the window is about to move somewhere pacing knows nothing
  // about, so its next move must re-seed from wherever the drag actually
  // leaves it, not keep incrementing a now-stale float.
  paceFloatX = null;
  // setBounds() with width/height pinned every tick, not setPosition(x,y) -
  // empirically, calling setPosition() every ~16ms together with
  // screen.getCursorScreenPoint() while this specific window (transparent/
  // frameless/always-on-top, actively repainting a canvas every frame) is
  // on screen made its height creep upward continuously for as long as the
  // poll ran (confirmed via a dedicated repro script - see CLAUDE.md).
  // Explicitly re-asserting width/height every tick, reading them from the
  // PET_SIZE constant rather than win.getBounds(), sidesteps it regardless
  // of the exact root cause AND prevents any cross-session creep (see
  // CLAUDE.md's window-size-consistency round for the full story).
  const { x: startX, y: startY } = win.getBounds();
  const width = PET_SIZE.width, height = PET_SIZE.height;
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
  // tried). Both axes run this same spring independently, with their own
  // velocity/target.
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
    velX += accX * dt; velY += accY * dt;
    curX += velX * dt; curY += velY * dt;
    win.setBounds({ x: Math.round(curX), y: Math.round(curY), width, height });
  }, 16);
});

// Drop-to-taskbar on release ("놓으면 작업표시줄로 떨어지게"): wherever the
// pet gets released, Y always animates back down to groundWindowY - there's
// no "stay floating in mid-air" outcome anymore, free vertical dragging (see
// drag-start above) is only ever temporary, for the duration of the drag
// itself. X either stays exactly where it was released, or - if that's
// close enough to the left/right screen edge - eases into the same
// EDGE_MARGIN-from-the-edge resting spot the edge-snap always used.
const EDGE_SNAP_RADIUS = 50; // px - sprite has to release within this distance of a screen edge to snap to it
const DROP_DURATION_MS = 350; // "몇백 ms" - a bit longer than a pure-X snap since this also travels vertically, often a good deal farther
let dropTimer = null;

// Returns the SPRITE's target screen X if it should snap to whichever
// screen edge it was released nearest (within EDGE_SNAP_RADIUS), or null if
// it should just stay wherever the drag left it (X unchanged, only Y
// animates back to the ground - see animateDrop).
function findDropTargetSpriteX(win, display, spriteRect) {
  const { workArea } = display;
  const { x: winX } = win.getBounds();
  // Falls back to the currently-known local offset if pet.js somehow
  // didn't send a rect (defensive only - every real drag-end call includes
  // one, with the sprite's REAL rendered position, which is what actually
  // determines "how close to an edge" here).
  const rect = spriteRect || { left: currentSpriteLocalX, width: SPRITE_WIDTH };
  const spriteX = winX + rect.left;
  const spriteRight = spriteX + rect.width;
  const leftDist = Math.abs(spriteX - workArea.x);
  const rightDist = Math.abs((workArea.x + workArea.width) - spriteRight);
  const nearestIsLeft = leftDist <= rightDist;
  const dist = nearestIsLeft ? leftDist : rightDist;
  if (dist > EDGE_SNAP_RADIUS) return null;
  return edgeSpriteX(nearestIsLeft ? 'left' : 'right', display);
}

// Animates from wherever the window currently is to (targetWinX,
// groundWindowY) over DROP_DURATION_MS. The two axes deliberately use
// DIFFERENT easing curves: X (only ever moving if it's snapping to an
// edge) eases OUT - quick start, gentle settle, same "slides into place"
// feel an edge-snap should have - while Y eases IN - slow start,
// accelerating - which reads as an actual falling/gravity motion rather
// than a glide, matching "떨어지는" more than a symmetric ease would.
//
// When snapSpriteTargetX is non-null (edge-snap), the sprite's LOCAL
// offset within the window ALSO smoothly interpolates alongside winX,
// using the SAME easing curve, from whatever it was at drag-end to the new
// asymmetric value the edge position needs (see spriteWindowLayout) -
// interpolating both together (rather than only updating localX once the
// animation finishes) keeps winX+localX - the sprite's TRUE screen
// position - moving smoothly for the whole animation; updating localX only
// at the very end would have the sprite visibly animating toward the WRONG
// intermediate point for the whole slide, then snapping the remaining
// distance in the last frame.
function animateDrop(win, snapSpriteTargetX) {
  const { x: startX, y: startY } = win.getBounds();
  const startLocalX = currentSpriteLocalX;
  const display = screen.getPrimaryDisplay();
  const targetY = groundWindowY(display);
  const width = PET_SIZE.width, height = PET_SIZE.height;
  let targetWinX = startX, targetLocalX = startLocalX;
  if (snapSpriteTargetX !== null) {
    const layout = spriteWindowLayout(snapSpriteTargetX, display);
    targetWinX = layout.winX;
    targetLocalX = layout.localX;
  }
  const startTime = Date.now();
  dropTimer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(dropTimer); dropTimer = null; return; }
    const t = Math.min(1, (Date.now() - startTime) / DROP_DURATION_MS);
    const easedX = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const easedY = t * t * t; // easeInCubic - accelerating "falling" feel
    win.setBounds({
      x: Math.round(startX + (targetWinX - startX) * easedX),
      y: Math.round(startY + (targetY - startY) * easedY),
      width,
      height
    });
    if (targetLocalX !== startLocalX) {
      pushSpriteLocalX(win, startLocalX + (targetLocalX - startLocalX) * easedX);
    }
    if (t >= 1) { clearInterval(dropTimer); dropTimer = null; }
  }, 16);
}

ipcMain.on('drag-end', (event, spriteRect) => {
  if (dragPollTimer) { clearInterval(dragPollTimer); dragPollTimer = null; }
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const snapSpriteTargetX = findDropTargetSpriteX(win, display, spriteRect);
  animateDrop(win, snapSpriteTargetX);
});

// ---------------------------------------------------------------------
// Pacing ("좌우 이동" movement mode) - pet.js owns ALL of the walk/rest
// timing and direction decisions (see its own pacing state machine); this
// side is a "dumb" position executor plus boundary detector, driven by
// per-frame delta requests from the renderer rather than a main-process
// poll. The actual per-frame movement AMOUNT comes from the character's own
// gait animation (animal-engine.js's `advance`, computed in the renderer
// where the gait state lives) - a main-process poll trying to
// independently guess a constant "walking speed" would drift out of sync
// with the leg animation's real instantaneous pace, which isn't constant
// even at a fixed average speed (a real gait cycle speeds up/slows down
// through its stride). Letting the renderer, which already computes that
// per-frame number for the leg animation anyway, just forward it here as a
// delta keeps the window's translation and the legs' swing perfectly
// synced by construction.
// ---------------------------------------------------------------------
// Float (not the rounded integers getBounds() reports) so many small
// per-frame deltas accumulate without rounding error compounding over a
// long walk leg - re-seeded from the window's ACTUAL current position on
// the first move of a session (null again after any drag, see drag-start
// above) rather than assumed, so it's always accurate regardless of how the
// window got to wherever it currently is.
let paceFloatX = null;

ipcMain.on('pace-move', (event, deltaX) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const delta = Number(deltaX);
  if (!Number.isFinite(delta) || delta === 0) return;
  const display = screen.getPrimaryDisplay();
  if (paceFloatX === null) paceFloatX = win.getBounds().x;
  paceFloatX += delta;

  // Compares the sprite's CURRENT screen position (using whichever local
  // offset is currently in effect - unchanged for the whole walk, only
  // ever updated on an actual edge hit below) against the two edge
  // thresholds, rather than comparing raw window X - the window's own
  // origin isn't directly meaningful once the sprite can sit at different
  // local offsets within it.
  const spriteScreenX = paceFloatX + currentSpriteLocalX;
  const leftEdgeX = edgeSpriteX('left', display);
  const rightEdgeX = edgeSpriteX('right', display);
  let hitSide = null;
  if (spriteScreenX <= leftEdgeX) hitSide = 'left';
  else if (spriteScreenX >= rightEdgeX) hitSide = 'right';

  if (hitSide) {
    // Settle winX and localX together, atomically, so the sprite's screen
    // position lands EXACTLY on the edge target with no separate jump (see
    // spriteWindowLayout's own comment) - pacing approaches the edge
    // continuously in small per-frame deltas, so (unlike the drop
    // animation, which can start from an arbitrary unrelated position)
    // there's no large gap to interpolate across here, just this one
    // combined update right at the moment of contact.
    const target = spriteWindowLayout(edgeSpriteX(hitSide, display), display);
    paceFloatX = target.winX;
    pushSpriteLocalX(win, target.localX);
  }

  win.setBounds({ x: Math.round(paceFloatX), y: groundWindowY(display), width: PET_SIZE.width, height: PET_SIZE.height });
  // Fire-and-forget notification, not a reply to this fire-and-forget
  // 'send' (there's nothing to reply to) - pet.js listens for this to know
  // when to stop the current walk leg and start resting, since main.js is
  // the only side that actually knows where the screen edges are.
  if (hitSide) win.webContents.send('pace-hit-edge', hitSide);
});
