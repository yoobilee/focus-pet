import { createAnimal, CHARACTERS } from '../shared/animal-engine.js';

const VALID_KEYS = new Set(CHARACTERS.map((c) => c.key));

const stageEl = document.getElementById('stage');
const petWrapEl = document.getElementById('pet-wrap');
const canvas = document.getElementById('pet-canvas');
// willReadFrequently: the click-through hit test below calls getImageData
// on every mousemove, on top of the per-frame draw calls this context
// already does - hint the backend to keep pixel readback fast.
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.imageSmoothingEnabled = false;

const bubbleEl = document.getElementById('bubble');
const bubbleTextEl = document.getElementById('bubble-text');

const WRAP_WIDTH = 96;
const MARGIN = 16;

let character = 'cat_a';
let animal = null;
let direction = 1; // 1 = right, -1 = left
let x = MARGIN;
let paused = false; // true only while a reminder bubble is showing
let asleep = false;
let bubbleTimeout = null;
let lastTs = null;

function safeNumber(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

function bounds() {
  const stageWidth = stageEl.clientWidth || 340;
  return { min: MARGIN, max: Math.max(MARGIN, stageWidth - WRAP_WIDTH - MARGIN) };
}

function loadCharacter(key) {
  character = VALID_KEYS.has(key) ? key : 'cat_a';
  animal = createAnimal(character);
  if (asleep) animal.forceSleep();
}

// Deep "wooden box knock" (묵직한 "도독" 소리) - the previous version (a
// C5/E5 marimba-pluck pair) still read as too light/clicky, described as
// similar to an iPhone mute-switch click. Two changes account for that:
// (1) register - C5/E5 (523/659Hz) sit in a bright, small-percussion
// range; a heavy knock on wood is much lower, so the fundamental drops
// roughly two octaves (~185Hz), (2) harmonic balance - the old partial
// sat at 4x the fundamental (a bright, thin-sounding overtone) with
// nothing reinforcing the low end; this version adds a sub-oscillator at
// HALF the fundamental (an octave down) at a substantial gain - that's
// where the actual "무게감"/weight comes from, not just a lower
// fundamental alone - and moves the partial down to 2x at a quieter gain
// (still a little wood-like definition on top, not the dominant color).
// Attack stays soft (linear ramp, slightly longer than before - 18ms) but
// decay is stretched from 0.32s to 0.5s so the knock has room to resonate
// and trail off instead of cutting off quickly. Two knocks at the SAME
// low pitch (not a rising two-note run like the old C5->E5) reads as a
// repeated physical knock rather than a little tune, matching "손등으로
// 나무 상자를 두드리는" more directly.
function knockNote(ctxA, freq, startAt, duration = 0.5, peak = 0.17) {
  const now = ctxA.currentTime;
  const t0 = now + startAt;
  const fundamental = ctxA.createOscillator();
  const sub = ctxA.createOscillator();
  const partial = ctxA.createOscillator();
  const subGain = ctxA.createGain();
  const partialGain = ctxA.createGain();
  const masterGain = ctxA.createGain();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  sub.type = 'sine';
  sub.frequency.value = freq * 0.5; // an octave down - the actual source of the "weight"
  subGain.gain.value = 0.55;
  partial.type = 'sine';
  partial.frequency.value = freq * 2; // was 4x - moved down for a rounder, less bright overtone
  partialGain.gain.value = 0.14;
  masterGain.gain.setValueAtTime(0.0001, t0);
  masterGain.gain.linearRampToValueAtTime(peak, t0 + 0.018); // soft attack, slightly softer than before
  masterGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration); // longer, weightier decay
  fundamental.connect(masterGain);
  sub.connect(subGain).connect(masterGain);
  partial.connect(partialGain).connect(masterGain);
  masterGain.connect(ctxA.destination);
  fundamental.start(t0);
  sub.start(t0);
  partial.start(t0);
  fundamental.stop(t0 + duration + 0.05);
  sub.stop(t0 + duration + 0.05);
  partial.stop(t0 + duration + 0.05);
}

function playBeep() {
  try {
    const ctxA = new (window.AudioContext || window.webkitAudioContext)();
    knockNote(ctxA, 185, 0);     // F#3-ish - low, wooden
    knockNote(ctxA, 185, 0.16); // same pitch, a beat later - a repeated knock, not a rising melody
  } catch (e) {
    // ignore audio errors silently
  }
}

// px of breathing room past the stage's own edge - NOT just the bubble
// box's own footprint. #bubble's box-shadow (0 6px 16px) extends visually
// past the box's geometric edges by roughly its 16px blur radius; the
// original 4px margin only cleared the box itself, so once the bubble
// was clamped close enough to the stage edge, the shadow's own blur
// extended past x=0 and got hard-clipped by the stage's overflow:hidden -
// a shadow that fades smoothly on 3 sides but gets sliced flat on the
// 4th reads exactly like a stray gray smudge in that corner (confirmed by
// screenshot comparison at margin=4 vs 20 - see CLAUDE.md; the tail
// pointer itself was checked separately with a red debug fill and was
// never actually misaligned, despite that being the original suspicion).
const BUBBLE_SAFE_MARGIN = 20;

// #bubble is centered on the pet by default (pet.css's left:50%, relative
// to the 96px-wide #pet-wrap), which never accounted for #pet-wrap's own
// position within the wider 340px stage - so a pet parked near the left
// edge (x near MARGIN) had its up-to-190px-wide bubble extend well past
// stage x=0, clipped by the stage's overflow:hidden (see pet.css). No
// clamp existed anywhere for this (checked both here and in pet.css)
// despite it having been believed fixed - this is the actual fix: shift
// the bubble box (via an inline `left` override) just far enough to keep
// its full width within the stage, then counter-shift the tail pointer
// (via the --tail-shift CSS variable) so it still points at the pet
// itself rather than at the bubble's new, off-center middle.
function positionBubble() {
  const stageWidth = stageEl.clientWidth || 340;
  const petCenterX = x + WRAP_WIDTH / 2; // pet-wrap's center, in stage-local coords - same quantity updateCursorHint uses
  const bubbleWidth = bubbleEl.offsetWidth || 190; // offsetWidth needs the 'hidden' class already removed (see caller) to lay out correctly; 190 (the CSS max-width) is a reasonable fallback otherwise
  const halfWidth = bubbleWidth / 2;
  const minCenter = halfWidth + BUBBLE_SAFE_MARGIN;
  const maxCenter = Math.max(minCenter, stageWidth - halfWidth - BUBBLE_SAFE_MARGIN);
  const clampedCenterX = Math.max(minCenter, Math.min(maxCenter, petCenterX));
  const shift = clampedCenterX - petCenterX; // 0 unless the pet is close enough to an edge that centering would clip
  bubbleEl.style.left = `${WRAP_WIDTH / 2 + shift}px`;
  bubbleEl.style.setProperty('--tail-shift', `${-shift}px`);
}

function showBubble(message, durationMs = 6000) {
  bubbleTextEl.textContent = message;
  bubbleEl.classList.remove('hidden');
  positionBubble(); // after 'hidden' is removed, so offsetWidth reflects the actual laid-out width of this message
  requestAnimationFrame(() => bubbleEl.classList.add('show'));

  paused = true;
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => {
    bubbleEl.classList.remove('show');
    paused = false;
    setTimeout(() => bubbleEl.classList.add('hidden'), 250);
  }, durationMs);
}

// ---------------------------------------------------------------------
// Click-through hit-testing. main.js defaults the whole window to
// setIgnoreMouseEvents(true, {forward:true}) so the transparent 340x210
// rectangle never blocks clicks meant for whatever's behind it; forward
// keeps mousemove reaching us anyway so we can decide, per-frame, whether
// the cursor sits over an actually-drawn (non-transparent) pixel and
// toggle mouse capture back on only for that. Alpha sampling (vs. a
// bounding-box approximation) is cheap here - a single getImageData(1,1)
// per mousemove, coalesced to once per animation frame below - and exact,
// which matters since the sprite is a small, irregular, constantly
// re-posed silhouette rather than a fixed image where a box approximation
// would be safe.
const ALPHA_HIT_THRESHOLD = 128; // above the ~46/255 drop shadow, at the flat-fill sprite pixels
let pendingMouse = null;
let hitState = null; // null until the first sample; then a plain boolean

// ---------------------------------------------------------------------
// Cursor-reactive interaction - replaces the old autonomous left-right
// patrol (see animal-engine.js's movement-policy history in CLAUDE.md).
// Two layers:
//   1. Always-on direction tracking: the head/eyes lean toward whichever
//      side of the pet the cursor is currently on, screen-wide - not just
//      while the cursor happens to be inside this 340x210 window. A plain
//      renderer `mousemove` listener can only ever fire while the cursor
//      is over this window (a blind spot the drag-follow poll in main.js
//      already had to work around the same way - see 'drag-start' there),
//      so main.js separately polls screen.getCursorScreenPoint() every
//      100ms and pushes it here via the 'cursor-track' IPC channel
//      (onCursorTrack below), already converted to this window's local
//      client-coordinate space (cursor - window bounds origin) so it can
//      be fed through the exact same math as a real mousemove event.
//   2. Proximity alert: unchanged from before - within CURSOR_CLOSE_RADIUS
//      of the sprite, fire one of the species' own idlePool "alert"
//      behaviors (see pickAlertBehaviorName in animal-engine.js). This is
//      an ADDITIONAL reaction layered on top of the always-on tracking,
//      not a replacement for it - direction tracking never turns off.
//
// lastMouseClient is fed by BOTH the local `mousemove` listener (precise,
// high-frequency, but only fires while the cursor is actually over this
// window) and the global 'cursor-track' IPC push (coarser at 100ms, but
// works everywhere on screen) - harmless overlap, whichever fired most
// recently wins, and either source keeps CURSOR_STALE_MS from tripping.
// ---------------------------------------------------------------------
const CURSOR_DIRECTION_RANGE = 130; // px - cursor this far to one side (or farther) = fully looking that way
const CURSOR_CLOSE_RADIUS = 55; // px - inside this tighter ring, fire the one-shot alert reaction
const CURSOR_STALE_MS = 400; // safety fallback only - the 100ms global poll normally keeps this from ever tripping
const DIRECTION_FLIP_HYSTERESIS = 20; // px - dead zone around the pet's own center so it doesn't flip back and forth when the cursor sits almost directly above/below it

let lastMouseClient = null;
let lastMouseMoveAt = 0;

// window-level (not canvas-level) so movement through empty margin space
// still updates pendingMouse and can flip a stale "captured" state back to
// click-through.
window.addEventListener('mousemove', (e) => {
  pendingMouse = { x: e.clientX, y: e.clientY };
  lastMouseClient = pendingMouse;
  lastMouseMoveAt = performance.now();
});

window.focusPetAPI.onCursorTrack(({ x: cx, y: cy }) => {
  lastMouseClient = { x: cx, y: cy };
  lastMouseMoveAt = performance.now();
});

function updateCursorHint() {
  if (!animal) return;
  const stale = performance.now() - lastMouseMoveAt > CURSOR_STALE_MS;
  if (!lastMouseClient || stale) {
    animal.setCursorHint(null);
    return;
  }
  // Pet-wrap's on-screen box: left edge at `x` (the translateX below),
  // bottom pinned 14px above the stage floor per pet.css - same box the
  // click-through hit-test's canvas.getBoundingClientRect() would report,
  // just computed directly since we only need its center here.
  const stageHeight = stageEl.clientHeight || 210;
  const centerX = x + WRAP_WIDTH / 2;
  const centerY = stageHeight - 14 - WRAP_WIDTH / 2;
  const dx = lastMouseClient.x - centerX;
  const dy = lastMouseClient.y - centerY;
  const dist = Math.hypot(dx, dy);
  // No "too far away, stop caring" cutoff here anymore - dx/dy are always
  // computed and handed off, just clamped to +-1 (CURSOR_DIRECTION_RANGE
  // is a saturation distance, not a range limit) so the pet is always
  // leaning toward wherever the cursor currently is on screen, however far.
  animal.setCursorHint({
    dx: Math.max(-1, Math.min(1, dx / CURSOR_DIRECTION_RANGE)),
    dy: Math.max(-1, Math.min(1, dy / CURSOR_DIRECTION_RANGE)),
    close: dist <= CURSOR_CLOSE_RADIUS,
  });
}

// Flips the whole sprite (canvas scaleX, see render()) to face whichever
// side of the pet the cursor is on - the head/eyes already lean that way
// via lookDX/lookY (animal-engine.js's cursor-look, unchanged/kept as-is),
// this makes the body's facing direction agree with it too. Eye tracking
// on top of this was deliberately left out - independently moving pupils
// AND flipping the whole body reads as overkill for a 96px sprite.
//
// Called from tick() AFTER the movement/bounds block below, not from
// updateCursorHint() above where the cursor math itself lives: the
// dormant patrol-bounce code in that block (`if (x<=min) direction=1...`)
// still runs every frame and would silently overwrite this exact frame's
// assignment if this ran first - see the comment on that block for why
// it's kept rather than deleted despite never actually triggering
// (advance is always 0, so x never leaves `min`, so that branch pins
// direction=1 every single frame on its own). Running after it instead
// means this is always the last word on `direction`, without having to
// touch that dormant movement-policy substrate at all.
function updateBodyDirection() {
  if (!lastMouseClient) return;
  const stale = performance.now() - lastMouseMoveAt > CURSOR_STALE_MS;
  if (stale) return;
  const centerX = x + WRAP_WIDTH / 2;
  const dx = lastMouseClient.x - centerX;
  if (dx > DIRECTION_FLIP_HYSTERESIS) direction = 1;
  else if (dx < -DIRECTION_FLIP_HYSTERESIS) direction = -1;
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function sampleHit(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || !pointInRect(clientX, clientY, rect)) return false;

  // getBoundingClientRect already reflects the CSS scaleX(±1) flip (the
  // box itself doesn't move/resize under a flip around its own center),
  // so map to canvas-backing space first and only then undo the flip to
  // land on the correct backing pixel.
  let cx = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const cy = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  if (direction === -1) cx = canvas.width - 1 - cx;
  cx = Math.max(0, Math.min(canvas.width - 1, cx));
  if (cy < 0 || cy >= canvas.height) return false;

  try {
    const alpha = ctx.getImageData(cx, cy, 1, 1).data[3];
    return alpha > ALPHA_HIT_THRESHOLD;
  } catch (e) {
    return false; // fail closed (click-through) rather than risk permanently blocking clicks
  }
}

function processPendingMouse() {
  // Skip re-sampling entirely while dragging (see the drag block below) -
  // hitState/ignore are pinned to "hit" for the whole drag regardless of
  // what the alpha test would say from frame to frame.
  if (dragging) return;
  if (!pendingMouse) return;
  const hit = sampleHit(pendingMouse.x, pendingMouse.y);
  pendingMouse = null;
  if (hit === hitState) return;
  hitState = hit;
  window.focusPetAPI.setIgnoreMouseEvents(!hit, { forward: true });
}

// ---------------------------------------------------------------------
// Drag-to-reposition: mousedown on the sprite starts a drag (reusing
// hitState from the click-through hit-test above instead of re-sampling -
// if a mousedown reached us at all, the cursor must already be over a hit
// pixel), which pauses patrol/gait (the same `paused` flag the reminder
// bubble already uses to force idle) and tells main.js to start following
// the cursor. The renderer does not move the window itself: a stray
// mousemove alone can't track a cursor that's wandered outside this
// window's current (pre-move) bounds, so main.js instead polls
// screen.getCursorScreenPoint() and calls setPosition() every ~16ms (see
// 'drag-start' in main.js) - a main-process API with no such blind spot.
//
// While dragging we also force the click-through hit-test to always
// report "hit" (processPendingMouse above just bails out early). Without
// that override, if setPosition() lags the cursor by even a frame, the
// alpha test could sample a now-transparent (or off-canvas) point and flip
// the window back to click-through mid-drag - which would stop it from
// ever receiving the eventual mouseup, wedging the drag on permanently.
// ---------------------------------------------------------------------
let dragging = false;
let suppressNextClick = false;

canvas.addEventListener('mousedown', (e) => {
  if (!hitState) return;
  dragging = true;
  paused = true;
  if (animal) animal.setHeld(true); // squish-in, then dangling legs/tail/ears - see animal-engine.js
  canvas.style.cursor = 'grabbing';
  window.focusPetAPI.dragStart({ offsetX: e.clientX, offsetY: e.clientY });
});

// window-level, not canvas-level, for the same robustness reason the
// click-through mousemove listener is window-level.
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  paused = false;
  if (animal) animal.setHeld(false);
  canvas.style.cursor = 'grab';
  // A plain mousedown+move+mouseup over the same DOM element still fires a
  // trailing 'click' afterward - without this it'd also poke() right as
  // the pet gets dropped, which reads as an unrelated reaction rather than
  // part of the drag gesture.
  suppressNextClick = true;
  window.focusPetAPI.dragEnd();
});

const POKE_REACTIONS = ['왜 불러요? 😳', '간지러워요! 😆', '네? 🐾', '헤헤 😊', '음냐...? 😽'];
let pokeCooldownUntil = 0;
// Gear button is gone - settings now open via the tray menu or by
// double-clicking the pet itself. Double-click detection here is manual
// (a click-timestamp gap under DOUBLE_CLICK_MS) rather than the native
// 'dblclick' event: this window is focusable:false, and in practice the
// browser's own double-click coalescing didn't reliably fire on it, so we
// just track it ourselves off the 'click' events we already get.
const DOUBLE_CLICK_MS = 300;
let lastClickAt = 0;
canvas.addEventListener('click', () => {
  if (suppressNextClick) { suppressNextClick = false; return; }

  const now = performance.now();
  const isDoubleClick = now - lastClickAt < DOUBLE_CLICK_MS;
  lastClickAt = isDoubleClick ? 0 : now; // reset so a triple-click doesn't also count clicks 2-3 as another double

  if (isDoubleClick) {
    window.focusPetAPI.openSettings();
    return;
  }

  if (!animal || paused || asleep) return;
  if (now < pokeCooldownUntil) return;
  pokeCooldownUntil = now + 2500;
  animal.poke();
  showBubble(POKE_REACTIONS[Math.floor(Math.random() * POKE_REACTIONS.length)], 1400);
});

function render() {
  petWrapEl.style.transform = `translateX(${x}px)`;
  canvas.style.transform = direction === 1 ? 'scaleX(1)' : 'scaleX(-1)';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (animal) animal.draw(ctx);
}

function tick(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (animal) {
    updateCursorHint();
    const allowedToMove = !paused;
    const { advance } = animal.update(dt, allowedToMove, ts / 1000);

    // advance is always 0 now - the engine never enters 'walk' on its own
    // anymore (see animal-engine.js's movement-policy comment above
    // enterWalk). This block is left in place rather than removed for the
    // same reason: it costs nothing to sit dormant and is exactly what a
    // future deliberate movement (e.g. "approach the cursor") would need,
    // without pet.js and the engine getting out of sync about which one
    // still knows how to move the pet.
    if (allowedToMove) {
      const safeAdvance = safeNumber(advance, 0); // already a per-frame px delta (gait fns multiply by dt internally) - do not multiply by dt again here
      x = safeNumber(x + safeAdvance * direction, x);
      const { min, max } = bounds();
      if (x <= min) { x = min; direction = 1; }
      else if (x >= max) { x = max; direction = -1; }
    }
    // Hard clamp regardless of the branch above - guards against NaN (which
    // Math.min/max alone would NOT catch, since Math.min(NaN, n) is NaN)
    // and against ever landing outside the visible window.
    const { min, max } = bounds();
    x = Math.max(min, Math.min(max, safeNumber(x, MARGIN)));
    updateBodyDirection();
  }

  render();
  processPendingMouse();
  requestAnimationFrame(tick);
}

window.focusPetAPI.getSettings().then((settings) => {
  loadCharacter(settings.character);
});

window.focusPetAPI.onSettingsUpdated((settings) => {
  if (settings.character !== character) loadCharacter(settings.character);
});

window.focusPetAPI.onReminder(({ message, soundEnabled }) => {
  showBubble(message);
  if (soundEnabled) playBeep();
});

// Cosmetic tie-in to the app's own system-idle tracking (independent of the
// user's reminder-mode setting): the pet dozes off after a long stretch of
// no input, and wakes with a little stretch when activity resumes.
window.focusPetAPI.onAwayStateChanged(({ away }) => {
  asleep = away;
  if (!animal) return;
  if (away) animal.forceSleep();
  else animal.wakeUp();
});

requestAnimationFrame(tick);
