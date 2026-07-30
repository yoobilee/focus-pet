import * as THREE from 'three';
import { createAnimal, CHARACTERS, normalizeAngleDelta } from '../shared/animal-engine.js';
import { buildVoxelCreature } from '../shared/voxel-engine.js';

const VALID_KEYS = new Set(CHARACTERS.map((c) => c.key));

const stageEl = document.getElementById('stage');
const petWrapEl = document.getElementById('pet-wrap');
const canvas = document.getElementById('pet-canvas');
const bubbleEl = document.getElementById('bubble');
const bubbleTextEl = document.getElementById('bubble-text');
const bubbleSnoozeBtn = document.getElementById('bubble-snooze');

// 3D voxel renderer (feature/3d-space branch - replaces the earlier Canvas
// 2D drawCreature() rendering entirely; see CLAUDE.md's "실제 pet 창에
// 연결" note). Same camera/frustum as the windows/pet3d/ prototype viewer
// this was validated against, so nothing about the already-checked
// silhouette/rotation/pose behavior changes going from prototype to real
// window - only the surrounding glue (click-through, drag, bubble, sound)
// stays exactly as it was for the 2D version.
//
// alpha:true + preserveDrawingBuffer:true (NOT the prototype viewer's
// settings - that one uses a solid background and doesn't need pixel
// readback) - alpha:true + a null scene.background gives a transparent
// canvas (required for click-through against whatever's behind this
// window, same requirement the 2D canvas's transparent fill already had),
// and preserveDrawingBuffer:true keeps the rendered buffer readable after
// present so the click-through hit test below can read its alpha channel
// back via gl.readPixels - the WebGL equivalent of the 2D context's
// getImageData(x,y,1,1).data[3] this replaces.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(96, 96, false); // false: canvas.width/height attributes + pet.css's own 96px sizing already match, no need to also let three.js touch the CSS style
renderer.setClearColor(0x000000, 0); // fully transparent clear - background stays see-through wherever no geometry is drawn

const scene = new THREE.Scene(); // no scene.background set - stays transparent, unlike the prototype viewer's solid debug-green fill
const FRUSTUM = 26; // same as windows/pet3d/pet3d.js - already validated against this exact frustum/camera setup
const CENTER_Y = 11;
const camera = new THREE.OrthographicCamera(-FRUSTUM / 2, FRUSTUM / 2, FRUSTUM / 2, -FRUSTUM / 2, 0.1, 200);
camera.position.set(0, CENTER_Y, 60);
camera.lookAt(0, CENTER_Y, 0);

const gl = renderer.getContext();
const pixelBuf = new Uint8Array(4);

const WRAP_WIDTH = 96;
// Mirrors main.js's PET_SIZE.width - only used as a pre-layout fallback
// (stageEl.clientWidth reading 0 before the page has laid out) and as the
// "before the very first main.js push arrives" default below.
const PET_WINDOW_WIDTH_FALLBACK = 420;
const PET_WINDOW_HEIGHT_FALLBACK = 400;

let character = 'cat_a';
let animal = null;
let group = null; // current species' voxel-engine.js THREE.Group (see loadCharacter)
let direction = 1; // 1 = right, -1 = left
// The sprite's LOCAL horizontal offset within the (now much wider than the
// sprite itself) window - see main.js's spriteWindowLayout/pushSpriteLocalX
// for why this is no longer simply "always centered": the window is now
// generously oversized so the embedded speech bubble always has room to
// shift away from a nearby screen edge (CLAUDE.md's "말풍선을 다시 펫
// 창에 내장" round), and how that extra width splits between the sprite's
// left/right sides depends on how close the sprite currently is to a
// screen edge - main.js computes that and pushes the result here (see
// onSpriteLocalX below) every time it repositions the window. Starts
// centered purely as a sane pre-launch default; onSpriteLocalX overwrites
// this with the real value within a frame or two of the window loading (a
// did-finish-load push from main.js, same "request the current value on
// load" pattern getSettings() already uses below).
let x = (PET_WINDOW_WIDTH_FALLBACK - WRAP_WIDTH) / 2;
window.focusPetAPI.onSpriteLocalX((localX) => {
  x = localX;
});
let paused = false; // true only while a reminder bubble is showing
let asleep = false;
let lastTs = null;

// "펫 숨기기" (quick-controls pause/hide - see main.js's setPetVisible) -
// the WINDOW stays open the whole time (reminders must keep firing/showing
// as a bubble-only, per the request), only the sprite itself disappears.
// #pet-wrap.pet-hidden (pet.css) collapses the sprite's own
// getBoundingClientRect() to a zero rect, which sampleHit()'s existing
// zero-rect guard already treats as an automatic click-through miss - no
// separate hit-test bypass needed for the sprite itself. tick()/render()
// below skip all pose/gait/rotation work while hidden (nothing to animate
// for an invisible sprite), but deliberately keep running the bubble
// positioning/click-through-for-the-snooze-button logic unconditionally.
let petHidden = false;
window.focusPetAPI.onPetHiddenState(({ hidden }) => {
  petHidden = hidden;
  petWrapEl.classList.toggle('pet-hidden', hidden);
  // See HIDDEN_BUBBLE_BOTTOM's own comment (further below - this is above
  // its declaration purely because bubbleEl/the API subscription both live
  // up here already, hoisting makes the const's own textual position
  // irrelevant to this reference working correctly) - swaps pet.css's
  // #bubble{bottom} over to a taskbar-hugging value while hidden, and back
  // to the default (sprite-head-relative) one once shown again.
  if (hidden) {
    bubbleEl.style.setProperty('--bubble-bottom', `${HIDDEN_BUBBLE_BOTTOM}px`);
  } else {
    bubbleEl.style.removeProperty('--bubble-bottom');
  }
  // main.js holds the whole window at opacity 0 across this transition and
  // only restores it once this ack arrives (see its own
  // armPetHiddenOpacityRestore) - double rAF (not just one) waits for an
  // actual PAINT reflecting the class/property changes just above to have
  // happened, not merely for this callback to have run, before telling
  // main.js it's safe to make the window visible again. See main.js's own
  // comment on why a single ordered IPC send couldn't guarantee this on
  // its own.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.focusPetAPI.notifyHiddenApplied());
  });
});

// ---------------------------------------------------------------------
// Pacing ("좌우 이동" movement mode) - the pet walks the taskbar edge to
// edge, resting at each end before turning back. Unlike the old dormant
// patrol block this replaces (see git history / CLAUDE.md), pacing moves
// the WINDOW itself across the screen (via main.js's 'pace-move' IPC every
// frame, see updatePacing/tick below) rather than pet.js's own local `x` -
// `x` stays exactly where it currently is throughout a walk (only updated
// by main.js's onSpriteLocalX push, which pacing doesn't trigger mid-leg -
// see main.js's pace-move handler); it's the window's absolute screen
// position that changes now, matching how dragging already works, not a
// second, different "the sprite moves within a giant window" mechanism.
//
// pet.js owns every timing/direction DECISION (when to start walking, when
// to rest, which way); main.js is purely a "move by this much, tell me if
// you hit a screen edge" executor - see main.js's own comment on this for
// why the actual per-frame movement amount has to come from here (the
// gait's own `advance`, not a main-process-guessed constant speed).
// ---------------------------------------------------------------------
let movementMode = 'stationary'; // stationary | pacing - from settings.movementMode, see onSettingsUpdated/getSettings below
let pacing = false; // true only while actively mid-leg (walking toward an edge) - false while resting at an edge or in stationary mode
// Random rest duration at each end, in real seconds - "차분하게" per the
// request: several tens of seconds walking (a full screen width at a
// species' own walk speed already takes a while) plus a comparably long
// rest, so direction changes are rare and unhurried rather than a
// twitchy back-and-forth.
const PACING_REST_MIN_MS = 30000;
const PACING_REST_MAX_MS = 60000;
let pacingRestUntil = performance.now() + 4000; // small initial delay so the pet doesn't immediately start walking the instant the page loads, even in pacing mode

function safeNumber(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

// Safety-clamp range for `x` (see the hard clamp at the bottom of tick()) -
// not a "how far can x wander during a walk" range (pacing moves the
// window instead of x - see the pacing block above) or a deliberate margin
// choice (main.js's spriteWindowLayout already keeps x within a much
// tighter, sensible range than this). Just guards against onSpriteLocalX
// (or a future bug) ever leaving `x` at a NaN/out-of-bounds value by
// keeping it somewhere the sprite is still fully inside the window:
// [0, stageWidth-WRAP_WIDTH].
function bounds() {
  const stageWidth = stageEl.clientWidth || PET_WINDOW_WIDTH_FALLBACK;
  return { min: 0, max: Math.max(0, stageWidth - WRAP_WIDTH) };
}

function loadCharacter(key) {
  character = VALID_KEYS.has(key) ? key : 'cat_a';
  animal = createAnimal(character);
  if (asleep) animal.forceSleep();
  if (group) scene.remove(group);
  group = buildVoxelCreature(character);
  scene.add(group);
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
// peak: 0.17 -> 0.42 (~2.5x) - the tone/weight itself was already right,
// just too quiet in practice. Headroom check: the three oscillators sum
// to at most peak*(1+0.55+0.14)=peak*1.69 if they ever all peaked exactly
// in phase (they won't in practice, different frequencies), so 0.42*1.69
// ≈ 0.71 stays comfortably under 1.0 (no digital clipping at the
// destination) even in that worst case. This 0.42 is now the "100% volume"
// reference peak - the settings window's 0-100% slider (soundVolume,
// see settingsStore.js) multiplies it directly, so 50% (the default)
// lands back at the previously-tuned 0.21-ish level and 100% matches this
// exact value; headroom math above still holds at any volume <=100%
// since it can only ever shrink the peak, never exceed it.
function knockNote(ctxA, freq, startAt, duration = 0.5, peak = 0.42) {
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

// One AudioContext for the whole page's lifetime, created lazily on first
// use and reused forever after - playBeep() used to `new AudioContext()`
// on every single call and never close() the old one, which silently ran
// into Chromium's per-page AudioContext cap (~6) after a handful of
// notifications: every context past that limit is still constructible
// (the `new` call itself doesn't throw) but never actually produces sound,
// and playBeep's own try/catch swallows nothing here since nothing DOES
// throw - it just goes quiet with no visible error, hence "works once,
// then never again". Reusing a single context sidesteps the cap entirely
// (this page never has more than one open).
let sharedAudioContext = null;
function getSharedAudioContext() {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioContext;
}

function computeBeepPeak(volume) {
  // Clamp defensively - a hand-edited settings.json could carry any value,
  // and this feeds directly into an audio gain (see knockNote's headroom
  // comment - out-of-range input here is the one thing that could actually
  // break that guarantee).
  const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
  return 0.42 * safeVolume;
}

// Actually WAITS for resume() to settle before scheduling anything, rather
// than firing the oscillators immediately and letting resume() "catch up"
// later. That fire-and-forget approach (the previous version of this
// function) rested on the assumption that Web Audio scheduling against a
// still-suspended context's currentTime just works once resume() completes
// - true enough in quick back-to-back testing, but the spec doesn't actually
// guarantee it, and it's the most likely explanation for "plays once, then
// silently never again" in real use: this window is focusable:false and
// normally sits idle for the app's default 30-minute reminder interval
// between plays - exactly the kind of prolonged inactivity Chromium's
// background power-management can suspend an AudioContext over. Scheduling
// ahead of an already-(re)suspended context under those conditions may
// simply produce no audio, with nothing to catch: resume() still resolves,
// the context still reports 'running' afterward, nothing throws - it just
// goes quiet. Actually awaiting resume() first removes that gap.
async function playViaContext(ctxA, peak) {
  if (ctxA.state !== 'running') await ctxA.resume();
  knockNote(ctxA, 185, 0, 0.5, peak);     // F#3-ish - low, wooden
  knockNote(ctxA, 185, 0.16, 0.5, peak); // same pitch, a beat later - a repeated knock, not a rising melody
}

async function playBeep(volume = 0.5) {
  const peak = computeBeepPeak(volume);
  try {
    let ctxA = getSharedAudioContext();
    // Some Chromium/OS power-management paths can end up closing a
    // long-lived AudioContext out from under a window that's never focused
    // (this app never calls close() itself) - discard and recreate rather
    // than staying silently dead for the rest of the app's lifetime.
    if (ctxA.state === 'closed') {
      sharedAudioContext = null;
      ctxA = getSharedAudioContext();
    }
    await playViaContext(ctxA, peak);
  } catch (e) {
    // The shared context (or its resume()) failed in some way this
    // session - recreate once and retry, rather than silently going dead
    // for every reminder afterward the way the un-caught version of this
    // bug would.
    try {
      sharedAudioContext = null;
      await playViaContext(getSharedAudioContext(), peak);
    } catch (e2) {
      // Truly nothing more to do here - ignore silently, same as before.
    }
  }
}

// ---------------------------------------------------------------------
// Reminder/poke speech bubble - back to being a plain DOM element inside
// THIS window (see CLAUDE.md's "말풍선을 다시 펫 창에 내장" round for why
// the earlier separate-BrowserWindow design was abandoned: two
// independently DPI-rounded windows having to agree with each other on
// screen position turned out to be its own steady source of the exact
// gap/off-center bugs the split was meant to fix, not fewer than before
// it). main.js's only remaining job re: the bubble is keeping PET_SIZE
// generously oversized and telling pet.js where to render the sprite
// within it (see onSpriteLocalX) - actually showing/positioning/fading the
// bubble is entirely local to this file now, no IPC round trip needed.
// ---------------------------------------------------------------------
let bubbleVisible = false; // true from the moment a bubble starts showing until its fade-out finishes - gates the per-frame positionBubble() call in tick()
let bubbleHideTimer = null;
let bubbleFadeOutTimer = null;
// px kept between the bubble's clamped left/right edges and the (generous)
// window's own edges - purely aesthetic breathing room; with PET_SIZE this
// wide the clamp below will rarely actually engage in practice.
const BUBBLE_SAFE_MARGIN = 16;

// Bug fix ("펫 숨김 상태일 때 말풍선이 작업표시줄에서 너무 멀리 떠 있음"):
// pet.css's default #bubble{bottom} (101px) reserves room ABOVE a visible
// 96px-tall sprite, so the bubble sits well clear of its head - correct
// while the sprite is drawn, but with #pet-wrap hidden that whole 96px is
// just empty dead space between the bubble and the taskbar, reading as
// "floating far above" it even though the pixel offset from the window's
// own (taskbar-anchored) bottom edge hasn't changed. While petHidden, the
// bubble should hug the taskbar the way the sprite's own feet normally do
// (pet.css's #pet-wrap{bottom:3px}) instead of leaving room for a sprite
// that isn't there - see onPetHiddenState below, which swaps pet.css's
// --bubble-bottom custom property to this value only while hidden.
const HIDDEN_BUBBLE_BOTTOM = 16;

// Positions #bubble horizontally so it's centered on the sprite by default,
// but clamped to stay within the window's own bounds (minus
// BUBBLE_SAFE_MARGIN) if that would run it past the window's edge -
// exactly the "shift the box, counter-shift the tail" approach this
// project has used since the very first embedded-bubble version, just
// computed in THIS window's local coordinate space again (rather than
// across two windows' worth of screen coordinates, like the separate-
// window version briefly had to). Vertical position needs no equivalent
// clamping - see pet.css's #bubble{bottom:101px} comment for why that's a
// fixed anchor, not something computed here.
function positionBubble() {
  const spriteCenterX = x + WRAP_WIDTH / 2;
  const bubbleWidth = bubbleEl.offsetWidth;
  const stageWidth = stageEl.clientWidth || PET_WINDOW_WIDTH_FALLBACK;
  const idealLeft = spriteCenterX - bubbleWidth / 2;
  const minLeft = BUBBLE_SAFE_MARGIN;
  const maxLeft = Math.max(minLeft, stageWidth - bubbleWidth - BUBBLE_SAFE_MARGIN);
  const clampedLeft = Math.max(minLeft, Math.min(maxLeft, idealLeft));
  bubbleEl.style.left = `${clampedLeft}px`;
  // Kept within the box's own rounded corners (not flush with either
  // edge) so the triangle never renders past the box's curvature.
  const tailX = spriteCenterX - clampedLeft;
  bubbleEl.style.setProperty('--tail-x', `${Math.max(20, Math.min(bubbleWidth - 20, tailX))}px`);
}

// Only set while a bubble showing showSnooze=true is up - the message the
// snooze button should re-fire 10 minutes later (see main.js's
// 'snooze-reminder'). null for poke reactions (no snooze button shown at
// all) and once any bubble has been dismissed either way.
let currentReminderMessage = null;

function fadeOutBubble() {
  paused = false;
  bubbleEl.classList.remove('show');
  bubbleFadeOutTimer = setTimeout(() => {
    bubbleVisible = false; // stop the per-frame positionBubble() calls once fully faded out
  }, 250); // matches pet.css's own 0.25s opacity/transform transition
}

// showSnooze: only actual reminders (main.js's onReminder below) get the
// "10분 뒤 다시" button - poke reactions (a quick 1.4s "왜 불러요?"-style
// aside, not something worth snoozing) never do. Always sets
// bubbleSnoozeBtn.style.display explicitly on every call (both branches),
// rather than relying on any HTML/CSS default, so there's no ambiguity
// about whether a leftover snooze button from a previous reminder could
// still be showing during a later poke reaction.
function showBubble(message, durationMs = 6000, showSnooze = false) {
  bubbleTextEl.textContent = message;
  currentReminderMessage = showSnooze ? message : null;
  bubbleSnoozeBtn.style.display = showSnooze ? '' : 'none';
  bubbleVisible = true;
  positionBubble(); // position BEFORE the fade-in starts, using the just-updated text's real laid-out width
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  paused = true;
  if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
  if (bubbleFadeOutTimer) clearTimeout(bubbleFadeOutTimer);
  bubbleHideTimer = setTimeout(fadeOutBubble, durationMs);
}

// Dismisses the current bubble immediately (same fade-out as a normal
// timeout) and asks main.js to re-fire this exact message 10 minutes from
// now - see main.js's 'snooze-reminder' handler for the actual re-fire
// (shared with the regular timer path's paused/오늘-하루-끄기 gating, so a
// snoozed reminder can't bypass either).
bubbleSnoozeBtn.addEventListener('click', () => {
  if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
  if (bubbleFadeOutTimer) clearTimeout(bubbleFadeOutTimer);
  const message = currentReminderMessage;
  fadeOutBubble();
  if (message) window.focusPetAPI.snoozeReminder(message);
});

// ---------------------------------------------------------------------
// Click-through hit-testing. main.js defaults the whole window to
// setIgnoreMouseEvents(true, {forward:true}) so the transparent PET_SIZE
// rectangle never blocks clicks meant for whatever's behind it; forward
// keeps mousemove reaching us anyway so we can decide, per-frame, whether
// the cursor sits over an actually-drawn (non-transparent) pixel and
// toggle mouse capture back on only for that. Alpha sampling (vs. a
// bounding-box approximation) is cheap here - a single-pixel WebGL
// readback (gl.readPixels, see sampleHit) per mousemove, coalesced to once
// per animation frame below - and exact,
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
//      while the cursor happens to be inside this small window. A plain
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
  // bottom pinned 3px above the stage floor per pet.css's #pet-wrap -
  // same box the click-through hit-test's canvas.getBoundingClientRect()
  // would report, just computed directly since we only need its center
  // here.
  const stageHeight = stageEl.clientHeight || PET_WINDOW_HEIGHT_FALLBACK;
  const centerX = x + WRAP_WIDTH / 2;
  const centerY = stageHeight - 3 - WRAP_WIDTH / 2;
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

// Turns the whole sprite (a 3D rotation.y, see render()) proportionally
// toward whichever side of the pet the cursor is on - the head/eyes
// already lean that way via lookDX/lookY (animal-engine.js's cursor-look,
// unchanged/kept as-is), this makes the body's facing direction agree
// with it too. Eye tracking on top of this was deliberately left out -
// independently moving pupils AND turning the whole body reads as
// overkill for a 96px sprite.
//
// ROUND 6 REDESIGN ("커서 방향 회전을 좌/우 이분법이 아니라 각도 기반
// 연속 회전으로"): this used to be a hard binary flip - direction was
// either +1 or -1 (with DIRECTION_FLIP_HYSTERESIS as a dead zone so it
// didn't flicker between the two near dx=0), and render() picked one of
// exactly two target angles (0 or FACING_LEFT_Y) based on that sign. Now
// this computes a genuinely continuous target angle proportional to how
// far to one side the cursor is - clampedDx (the same -1..1 value
// updateCursorHint already derives for the head-look hint, recomputed
// here from the same lastMouseClient/CURSOR_DIRECTION_RANGE inputs)
// maps linearly across the body's full turning range: clampedDx=+1
// (cursor at/past CURSOR_DIRECTION_RANGE to the right) -> 0 (full right
// profile, same end state the old direction=1 produced), clampedDx=-1
// -> FACING_LEFT_Y (full left profile, same as old direction=-1), and
// clampedDx=0 (cursor directly above/below the pet) -> -pi/2, i.e. the
// body faces the camera nearly head-on. Everything in between is a real
// intermediate diagonal angle, not just a smoothed transition between two
// fixed endpoints - the END states are unchanged from before, only the
// path (and now, ability to rest at any point along it) is new. No
// hysteresis dead zone needed anymore: there's no discrete state to
// flicker between, and render()'s existing ROTATION_EASE_RATE easing
// already low-pass-filters any small jitter in the target itself.
//
// Called from tick() AFTER the movement/bounds block, and ONLY while not
// actively pacing-walking - tick() overrides bodyRotationTargetY to face
// the walk direction instead while `pacing` is true (a creature mid-stride
// orients toward where it's going, not toward the cursor - see tick()'s own
// comment). `direction` itself is read here indirectly only through that
// override, never by this function.
function updateBodyRotationTarget() {
  if (!lastMouseClient) return;
  const stale = performance.now() - lastMouseMoveAt > CURSOR_STALE_MS;
  if (stale) return;
  const centerX = x + WRAP_WIDTH / 2;
  const dx = lastMouseClient.x - centerX;
  const clampedDx = Math.max(-1, Math.min(1, dx / CURSOR_DIRECTION_RANGE));
  bodyRotationTargetY = (clampedDx - 1) * (Math.PI / 2);
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

// Neighborhood (not a single exact pixel) read for the hit test - the
// voxel model is constantly re-posed (breathing/idle micro-motion never
// fully stops, see animal-engine.js's 'breathe' behavior), so the exact
// alpha at one fixed pixel can flicker opaque/transparent frame to frame
// even while the cursor is clearly resting "on" the sprite, most often
// right at silhouette edges - confirmed by direct instrumentation: hitState
// flipped false during a stationary-cursor double-click purely from ~120ms
// of idle pose drift (see CLAUDE.md's "더블클릭이 다시 안 열리는 버그"
// note). A REAL OS-routed click arriving during that instant would be
// forwarded to whatever's behind this window instead of reaching it at
// all (unlike the synthetic sendInputEvent probes used to diagnose this,
// which inject directly into the renderer and bypass that risk) - a
// single-pixel sample has no tolerance for that. HIT_RADIUS pixels of
// slack in every direction absorbs it without meaningfully hurting
// precision (a few backing pixels is imperceptible at this 96x96 size).
const HIT_RADIUS = 2;
const hitBlockBuf = new Uint8Array((HIT_RADIUS * 2 + 1) * (HIT_RADIUS * 2 + 1) * 4);

function sampleHit(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || !pointInRect(clientX, clientY, rect)) return false;

  // No CSS mirror to undo anymore - facing direction is now a real 3D
  // rotation.y baked into the rendered pixels themselves (see render()),
  // not a CSS scaleX(±1) on the canvas element, so the backing-pixel
  // mapping is a plain top-left-origin conversion.
  const cx = Math.max(0, Math.min(canvas.width - 1, Math.floor(((clientX - rect.left) / rect.width) * canvas.width)));
  const cy = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  if (cy < 0 || cy >= canvas.height) return false;

  // Clamp the read block to stay within the canvas - readPixels errors
  // (or returns garbage) if any part of the requested rect is off-buffer.
  const blockX = Math.max(0, Math.min(canvas.width - (HIT_RADIUS * 2 + 1), cx - HIT_RADIUS));
  const blockYtop = Math.max(0, Math.min(canvas.height - (HIT_RADIUS * 2 + 1), cy - HIT_RADIUS));
  const blockSize = HIT_RADIUS * 2 + 1;

  try {
    // gl.readPixels' Y origin is bottom-left (WebGL convention), the
    // opposite of the top-left-origin cy computed above - this is the
    // WebGL equivalent of the 2D context's getImageData(...).data[3], just
    // over a small block instead of one pixel.
    gl.readPixels(blockX, canvas.height - blockSize - blockYtop, blockSize, blockSize, gl.RGBA, gl.UNSIGNED_BYTE, hitBlockBuf);
    for (let i = 3; i < hitBlockBuf.length; i += 4) {
      if (hitBlockBuf[i] > ALPHA_HIT_THRESHOLD) return true;
    }
    return false;
  } catch (e) {
    return false; // fail closed (click-through) rather than risk permanently blocking clicks
  }
}

// #bubble itself stays pointer-events:none (purely decorative box - see
// pet.css), but #bubble-snooze opts back into pointer-events:auto so it's
// actually clickable - that CSS override alone isn't enough on its own,
// though: OS-level click-through (setIgnoreMouseEvents) is driven entirely
// by this file's own alpha-sampled hit test, which only ever looks at
// #pet-canvas and has no idea the button exists. This extends that same
// hit test with an explicit rect check against the button, so real mouse
// events actually get forwarded to it while the cursor is over it.
function isOverSnoozeButton(clientX, clientY) {
  if (bubbleSnoozeBtn.style.display === 'none') return false;
  const rect = bubbleSnoozeBtn.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return pointInRect(clientX, clientY, rect);
}

function processPendingMouse() {
  // Skip re-sampling entirely while dragging (see the drag block below) -
  // hitState/ignore are pinned to "hit" for the whole drag regardless of
  // what the alpha test would say from frame to frame.
  if (dragging) return;
  if (!pendingMouse) return;
  const hit = sampleHit(pendingMouse.x, pendingMouse.y) || isOverSnoozeButton(pendingMouse.x, pendingMouse.y);
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
let dragStartClientX = 0;
let dragStartClientY = 0;
// px of cursor movement (not window movement - the spring-damper follow in
// main.js can lag/overshoot slightly even for a stationary cursor, so
// comparing raw cursor displacement is the more reliable "did the user
// actually drag vs. just click" signal) below which a mousedown->mouseup
// pair counts as a plain click, not a drag - see the mouseup handler below.
// mousedown ALWAYS starts a drag-follow session regardless of this (the
// spring has nowhere to go for a near-zero-movement click, so starting and
// immediately ending it is harmless - see animal.setHeld() below), this
// threshold only controls whether the trailing 'click' event gets
// suppressed afterward.
const DRAG_MOVE_THRESHOLD = 4;

canvas.addEventListener('mousedown', (e) => {
  if (!hitState) return;
  dragging = true;
  dragStartClientX = e.clientX;
  dragStartClientY = e.clientY;
  paused = true;
  if (animal) animal.setHeld(true); // squish-in, then dangling legs/tail/ears - see animal-engine.js
  canvas.style.cursor = 'grabbing';
  // Being picked up always fully ends a pacing leg (rather than resuming it
  // once released) - the user just manually repositioned the pet, so
  // marching off again toward whatever edge the interrupted leg was headed
  // for (which might now be behind it, or the wrong direction entirely)
  // would look wrong; a fresh rest period lets the normal pacing decision
  // pick a sensible direction from wherever the drag actually ends up.
  if (pacing) {
    pacing = false;
    if (animal) animal.stopWalking();
    pacingRestUntil = performance.now() + PACING_REST_MIN_MS + Math.random() * (PACING_REST_MAX_MS - PACING_REST_MIN_MS);
  }
  window.focusPetAPI.dragStart({ offsetX: e.clientX, offsetY: e.clientY });
});

// window-level, not canvas-level, for the same robustness reason the
// click-through mousemove listener is window-level.
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  paused = false;
  if (animal) animal.setHeld(false);
  canvas.style.cursor = 'grab';
  // Only suppress the trailing 'click' if the cursor actually moved a
  // meaningful amount between mousedown and mouseup - mousedown starts a
  // drag-follow session unconditionally whenever the cursor is over the
  // sprite (see its own comment), which previously meant EVERY plain click
  // (no movement at all) was also treated as "a drag just ended" and had
  // its own trailing click swallowed - poke() and double-click-to-open-
  // settings could never actually fire, since click 1 of a double-click
  // (and every ordinary single click) got eaten here before ever reaching
  // the 'click' handler's logic. Confirmed via direct instrumentation
  // (see CLAUDE.md's "더블클릭이 다시 안 열리는 버그" note) - a plain
  // click's own mouseup consistently reported suppressNextClick=true at
  // the following 'click' event, for both clicks of a double-click.
  const dx = e.clientX - dragStartClientX, dy = e.clientY - dragStartClientY;
  if (Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD) suppressNextClick = true;
  // Edge-snap (main.js's 'drag-end' handler) needs to know where the
  // actual VISIBLE sprite sits on screen, not just where this window's own
  // edges are - #pet-wrap (96x96) sits inset within the (now much wider)
  // window at whatever offset `x` currently is (see onSpriteLocalX -
  // possibly quite off-center, not necessarily "roughly centered"),
  // anchored near the bottom. main process code has no visibility into
  // this renderer-side layout, so it's sent along explicitly here rather
  // than main.js guessing/hardcoding the offset.
  const wrapRect = petWrapEl.getBoundingClientRect();
  window.focusPetAPI.dragEnd({ left: wrapRect.left, top: wrapRect.top, width: wrapRect.width, height: wrapRect.height });
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

// Facing direction: animates rotation.y toward its target instead of
// snapping instantly - see currentRotationY below. ROTATION_EASE_RATE
// matches the exponential-ease form (1-exp(-dt*rate)) already used
// elsewhere in this codebase (animal-engine.js's applyCursorLookEasing) -
// ~0.35s to reach 95% of the target turn, fast enough to feel responsive
// to a cursor-direction change, slow enough that the eye actually sees
// the model sweep through the intermediate angles (~45°/90°) instead of
// popping between the two end states in a single frame.
//
// BUG FOUND (user report - "회전이 좌우반전처럼 보임"): the previous
// version set `group.rotation.y = direction===1?0:Math.PI` directly, an
// instant single-frame snap - a genuinely 3D model turned this way is, in
// terms of what actually reaches the screen, indistinguishable from the
// old CSS scaleX(-1) instant mirror it replaced, since there's no motion
// for the eye to see the geometry's own depth unfold through. All of the
// depth/rotation validation earlier in this branch (voxel-viewer.html's
// drag-to-rotate, the auto-spin prototype) exercised CONTINUOUS rotation,
// which never exposed this - the real pet window's direction changes were
// never actually driven through render()'s per-frame path with a
// continuously-updated angle until now.
const ROTATION_EASE_RATE = 8;
let currentRotationY = 0;

// Facing-left END STATE is -Math.PI, not +Math.PI (both represent the
// exact same final orientation, mod 2π, so this doesn't change the
// resting pose either way - only which INTERMEDIATE angles a turn passes
// through). BUG FOUND (user report - "회전 중간에 뒤통수가 카메라를
// 향한다"): with +Math.PI, the standard Y-axis rotation matrix
// (x'=x·cosθ+z·sinθ, z'=-x·sinθ+z·cosθ) sends the nose (local +X, Z=0)
// to NEGATIVE z as θ increases through positive values - since the
// camera sits at +Z looking toward -Z, negative z is AWAY from the
// camera, so the face swings away and the animal's back faces the
// camera at the θ=90° midpoint. Using -Math.PI instead means θ sweeps
// through NEGATIVE values instead, which sends the nose to POSITIVE z
// (toward the camera) at that same midpoint - the face leads the turn
// instead of the back.
//
// updateBodyRotationTarget() (round 6 - continuous rotation) keeps every
// target angle it produces within [FACING_LEFT_Y, 0] = [-π, 0] for
// exactly this reason - the face-leads property this constant's sign was
// chosen for holds continuously across that whole range, not just at the
// two old binary endpoints, so no separate wraparound/sign logic is
// needed for the continuous version either.
const FACING_LEFT_Y = -Math.PI;

// Continuous body-rotation target, radians - see updateBodyRotationTarget
// for how this is derived from the cursor's position. Starts at 0 (facing
// right), matching the old direction=1 default resting pose.
let bodyRotationTargetY = 0;

function render(dt) {
  petWrapEl.style.transform = `translateX(${x}px)`;
  // petHidden: #pet-wrap is display:none anyway (pet.css), so skip the
  // actual WebGL render/pose work too - nothing to show for it, and it'd
  // just be wasted GPU work every frame while hidden.
  if (!animal || !group || petHidden) return;
  const pose = animal.getPose();
  if (pose.spinOverride) {
    // Round 8 issue 1 - Z-axis idles (prowlcircle/chasetail/hopspin) drive
    // the whole-body facing angle themselves (a continuous, already-smooth
    // authored rotation - see animal-engine.js's spinAngle comment) -
    // bypass the cursor-tracked ease entirely rather than easing toward an
    // already-moving target, which would just lag behind it. Keeping
    // currentRotationY in sync (not just group.rotation.y) means control
    // hands back to the cursor-tracked path below with no pop the instant
    // the behavior ends and spinOverride flips back to false - the same
    // "an instant snap reads as fake" lesson ROTATION_EASE_RATE's own
    // comment describes, just avoided on the handoff instead of the turn
    // itself this time.
    currentRotationY = pose.spinAngle;
  } else {
    // Round 10 issue 4 fix ("회전이 끝나고... 부자연스럽게 툭 튕기듯
    // 돌아옴"): spinAngle above is deliberately unwrapped/multi-lap (a
    // single chasetail can leave currentRotationY over 16 radians from
    // bodyRotationTargetY's [-π,0] range the instant spinOverride flips
    // back off) - a plain `(target-current)*ease` starts the very next
    // frame with that whole raw distance as its error term, producing an
    // enormous initial angular velocity (target 16+ radians away scaled by
    // ROTATION_EASE_RATE) that reads as a snap/whirl rather than a turn.
    // normalizeAngleDelta collapses the error to its shortest-path
    // equivalent in (-π,π] first, so the ease always turns the visually
    // short way regardless of how many laps currentRotationY has
    // accumulated - and since this runs every frame, currentRotationY
    // itself settles back to within one lap of the target instead of
    // drifting arbitrarily far from it over repeated spin idles.
    const ease = 1 - Math.exp(-dt * ROTATION_EASE_RATE);
    currentRotationY += normalizeAngleDelta(bodyRotationTargetY - currentRotationY) * ease;
  }
  group.rotation.y = currentRotationY;
  group.userData.applyPose(pose);
  renderer.render(scene, camera);
}

// Starts/continues/rests a pacing leg - see the pacing state's own
// top-level comment for the overall design. Doesn't touch `pacing` at all
// while interrupted (bubble/drag/sleep) - just waits, since
// animal-engine.js's own updateBehaviorState already forces idle
// internally during any of those regardless of what this thinks it's
// doing (allowedToMove=false, or pinnedSleep/pinnedHeld) - the SAME leg
// picks back up once the interruption clears via the idempotent
// startWalking() re-assertion below, rather than pet.js needing to detect
// and react to the desync itself.
function updatePacing(nowMs, allowedToMove) {
  if (movementMode !== 'pacing') return;
  if (!allowedToMove || dragging || asleep) return;
  if (pacing) {
    animal.startWalking(); // idempotent no-op if already walking - see its own comment in animal-engine.js for why this is safe/necessary to call every qualifying frame
    return;
  }
  if (nowMs >= pacingRestUntil) {
    pacing = true;
    animal.startWalking();
  }
}

function tick(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  // petHidden: freeze all gait/pose/rotation/pacing work while the sprite
  // itself isn't being drawn (see render()'s own petHidden check) - the
  // bubble (positioned below, unconditionally) is the only thing that still
  // needs to update every frame while hidden, per "펫을 숨긴 상태에서도
  // 알림 트리거는 계속 정상 작동". Resumes exactly where it left off once
  // un-hidden (nothing here is time-based/accumulating while skipped).
  if (animal && !petHidden) {
    updateCursorHint();
    const allowedToMove = !paused;
    // Decide whether to start/continue/rest a pacing leg BEFORE
    // animal.update() runs, so a freshly-started leg's advance is already
    // nonzero on this same frame - same ordering principle
    // updateCursorAlertTrigger uses inside animal-engine.js (decide state
    // transitions, then let the state machine/gait catch up in the same
    // tick rather than a frame late).
    updatePacing(ts, allowedToMove);
    const { advance } = animal.update(dt, allowedToMove, ts / 1000);

    // Pacing movement moves the WINDOW (via main.js's 'pace-move' IPC), not
    // pet.js's own local `x` - see the pacing state's own top-level comment
    // for why this is a cleaner model than the old dormant "x += advance*
    // direction, bounce at a local boundary" patrol block it replaces.
    // advance is 0 whenever state!=='walk' (stationary mode never calls
    // startWalking, so this is simply always a no-op there), so this is
    // safe to leave unconditional on `pacing` alone.
    if (pacing) {
      const delta = safeNumber(advance, 0) * direction; // already a per-frame px amount (gait fns multiply by dt internally) - do not multiply by dt again here
      if (delta !== 0) window.focusPetAPI.paceMove(delta);
    }
    // Hard clamp - guards against NaN (which Math.min/max alone would NOT
    // catch, since Math.min(NaN, n) is NaN) and keeps x sane regardless of
    // any future bug in onSpriteLocalX's own input - see bounds()'s own
    // comment for why this is just a safety net, not a movement range.
    const { min, max } = bounds();
    x = Math.max(min, Math.min(max, safeNumber(x, 0)));

    if (pacing) {
      // Face the walk direction instead of the cursor while actively
      // mid-leg - a creature walking somewhere orients toward where it's
      // going, not toward wherever the user's mouse happens to be. The
      // head/eyes still track the cursor independently either way
      // (animal-engine.js's lookDX/lookDY cursor-look, untouched by this -
      // only the whole-body facing this drives is overridden).
      bodyRotationTargetY = direction === 1 ? 0 : FACING_LEFT_Y;
    } else {
      updateBodyRotationTarget();
    }
  }

  render(dt);
  processPendingMouse();
  if (bubbleVisible) positionBubble();
  requestAnimationFrame(tick);
}

window.focusPetAPI.getSettings().then((settings) => {
  loadCharacter(settings.character);
  movementMode = settings.movementMode || 'stationary';
});

window.focusPetAPI.onSettingsUpdated((settings) => {
  if (settings.character !== character) loadCharacter(settings.character);
  if (settings.movementMode !== movementMode) {
    movementMode = settings.movementMode || 'stationary';
    // Switching away from pacing mid-leg needs an explicit stop - nothing
    // else would ever tell the animal/main.js to end the walk (there's no
    // edge to hit if the mode itself is what changed), so without this the
    // pet would just keep walking under the old mode's rules forever.
    if (movementMode !== 'pacing' && pacing) {
      pacing = false;
      if (animal) animal.stopWalking();
    }
  }
});

// Fired by main.js whenever a pacing move would cross a screen edge (see
// its own 'pace-move' handler) - main.js is the only side that actually
// knows where the screen edges are, so it owns this decision; pet.js just
// reacts by ending the current leg and starting a rest period before the
// next one (in the opposite direction).
window.focusPetAPI.onPaceHitEdge((side) => {
  if (!pacing) return; // stale - the leg already ended some other way (mode switched off, a drag interrupted it) before this notification arrived
  pacing = false;
  direction = side === 'right' ? -1 : 1; // turn back the other way for the next leg
  animal.stopWalking();
  pacingRestUntil = performance.now() + PACING_REST_MIN_MS + Math.random() * (PACING_REST_MAX_MS - PACING_REST_MIN_MS);
});

// Live, unsaved character preview from the settings window (round 8) -
// reuses loadCharacter() as-is, which never touches settingsStore itself
// (only main.js's save-settings handler does), so previewing is
// side-effect-free. Reverting an unsaved preview when the settings window
// closes without saving is handled entirely on the main.js side (it just
// re-sends 'settings-updated' with the last-actually-saved character,
// which the handler above already knows how to react to) - nothing extra
// needed here for that half.
window.focusPetAPI.onPreviewCharacter((key) => {
  if (key !== character) loadCharacter(key);
});

window.focusPetAPI.onReminder(({ message, soundEnabled, soundVolume }) => {
  // showSnooze:true - only real reminders get the "10분 뒤 다시" button
  // (poke reactions above never pass it, so default to false there).
  showBubble(message, 6000, true);
  if (soundEnabled) playBeep(soundVolume);
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
