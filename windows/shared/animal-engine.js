// Pixel-art animal engine (Canvas 2D). Replaces the earlier Three.js 3D
// version: at the ~96x80px size this pet actually renders at, exaggerated
// silhouette + flat color reads far better and faster than accurate 3D
// proportions/lighting - this is the same reason menu-bar/notch pet apps
// (e.g. Mac Pet) use pixel sprites rather than 3D models. The behavior
// state machine (walk <-> species-flavored idle behaviors, poke, sleep tie-
// in) carries over unchanged in spirit from the 3D version - only how a
// "pose" gets turned into pixels is different (this file draws rectangles
// on a canvas each frame instead of moving Three.js transforms).
//
// Everything is drawn on a fixed 24x20 logical-pixel grid at PX=4 (96x80
// canvas, matching the on-screen size directly - no scaling step, no
// external image files, nothing to regenerate when a character changes).
// Facing is always "right" in this coordinate space (head at high x, tail
// at low x); pet.js flips left-facing via CSS scaleX(-1) on the wrapper.

export const GRID_W = 24;
// 20 -> 24: the hop gait swings bodyBob (and everything anchored to it,
// including ear tips) up by a few grid units at the peak of the jump - at
// the old GRID_H=20 a tall earStyle:'long' rabbit ear had no headroom left
// above it and got clipped by the canvas's own top edge mid-hop. The extra
// 4 rows go entirely above the old content (every species' y-coordinates
// are authored +4 from where they were, GROUND_Y stays the same distance
// from the new bottom), so this is pure headroom, not a rescale.
export const GRID_H = 24;
export const PX = 4;
export const GROUND_Y = 22;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const randRange = (lo, hi) => lo + Math.random() * (hi - lo);
// Default fraction of the lower leg bone's length covered by cfg.pawColor
// (see drawLegChain) when a species sets one but doesn't override
// cfg.pawFraction - e.g. a tuxedo cat's white paw "socks" on otherwise
// black legs. 0.35 reads as "just the tip" without shrinking to sub-pixel
// width at PX=4 on the shortest lowerLen values in the roster.
const PAW_FRACTION_DEFAULT = 0.35;

// ---------------------------------------------------------------------
// Optional geometry instrumentation - a no-op in the shipped app (both
// pet.js and settings.js never call setGeometrySink, so geometrySink stays
// null and every reportPart() call below is a single `if` check). Exists
// for test/sim-invariants.mjs: the earlier "sit pose looks off" bug turned
// out to be a dynamically-computed value (neckLen not actually reaching the
// head - see the neck comment in drawCreature) that no amount of staring at
// screenshots caught, only a script that recomputed the real per-frame
// geometry did. This makes that same kind of check a permanent, reusable
// part of the engine instead of a one-off script: every structural part
// (body/head/neck/legs/tail) reports the exact grid-unit geometry it's
// about to draw, in the same local (pre-PX, pre-roll-rotation) coordinate
// space every SPECIES entry is authored in, so a long automated run can
// flag any frame where a part's computed size/position/length goes NaN,
// negative, or implausibly far from what the species table says it should
// be - without a human having to notice a screenshot looks "off".
let geometrySink = null;
export function setGeometrySink(fn) { geometrySink = fn; }
function reportPart(tag, data) { if (tag && geometrySink) geometrySink(tag, data); }

// ---------------------------------------------------------------------
// TEMPORARY debug instrumentation for tracking down a reported "dog looks
// like it's doing a handstand sometimes" bug - static rendering (fixed
// poses, no state-machine transitions) couldn't reproduce it, so this
// hooks the one thing static rendering can't cover: the exact combined
// rotation angle (pose.rollAngle+pose.waddleTilt, the same sum
// drawCreature feeds into ctx.rotate() - see its angle block) *during*
// live, transitioning execution. Zero cost unless something calls
// setRotationDebug() (same opt-in pattern as setGeometrySink above) - not
// wired into pet.js/main.js's normal startup path, only enabled ad hoc
// while actively chasing this. Remove this whole block (and its two call
// sites in createAnimal below) once the investigation is done, one way or
// the other - see CLAUDE.md for the outcome.
let rotationDebugSink = null;
let rotationDebugThreshold = 25;
export function setRotationDebug(sink, thresholdDeg = 25) {
  rotationDebugSink = sink;
  rotationDebugThreshold = thresholdDeg;
}
// Called every update() frame when a sink is registered. Maintains a small
// rolling history of behaviorState/currentIdle transitions (only appending
// on an actual change, so it stays compact over a long run) regardless of
// whether *this* frame trips the threshold, so a violation's log includes
// what led up to it - not just the offending frame in isolation, which is
// exactly what "직전 몇 프레임의 상태 전환 이력" asked for.
function recordRotationDebug(anim, elapsedSec) {
  if (!rotationDebugSink) return;
  const idleName = anim.currentIdle ? anim.currentIdle.name : null;
  if (!anim._debugHistory) anim._debugHistory = [];
  const last = anim._debugHistory[anim._debugHistory.length - 1];
  if (!last || last.behaviorState !== anim.behaviorState || last.currentIdleName !== idleName) {
    anim._debugHistory.push({ t: +elapsedSec.toFixed(3), behaviorState: anim.behaviorState, currentIdleName: idleName });
    if (anim._debugHistory.length > 20) anim._debugHistory.shift();
  }
  const combinedAngle = anim.pose.rollAngle + anim.pose.waddleTilt;
  if (Math.abs(combinedAngle) > rotationDebugThreshold) {
    rotationDebugSink({
      t: +elapsedSec.toFixed(3),
      combinedAngle,
      pose: { ...anim.pose },
      behaviorState: anim.behaviorState,
      currentIdleName: idleName,
      pinnedSleep: anim.pinnedSleep,
      pinnedHeld: anim.pinnedHeld,
      history: anim._debugHistory.slice(),
    });
  }
}

// ---------------------------------------------------------------------
// Low-level pixel drawing. Coordinates are in grid units; everything gets
// multiplied by PX and floored so rectangles always land on crisp pixel
// boundaries regardless of any fractional pose offsets upstream. `tag`
// (optional) is only used by the geometry instrumentation above.
// ---------------------------------------------------------------------
function px(ctx, x, y, w, h, color, tag) {
  if (tag) reportPart(tag, { x, y, w, h, skippedDraw: w <= 0 || h <= 0 });
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * PX), Math.round(y * PX), Math.round(w * PX), Math.round(h * PX));
}

// A rect with its 4 corner pixels shaved off - the standard cheap way to
// soften a pixel-art block without a smooth (non-pixel-art-looking) curve.
function pxSoft(ctx, x, y, w, h, color, tag) {
  // Reported once for the full intended rect, regardless of whether it's
  // drawn as one solid fill or the two overlapping strips below - the
  // inner px() calls in the strip branch don't get their own tag, so
  // there's exactly one geometry report per logical part.
  if (tag) reportPart(tag, { x, y, w, h, skippedDraw: w <= 0 || h <= 0 });
  // Below ~5 units, cutting a 1-unit corner is a big fraction of the whole
  // shape and reads as a spiky plus-sign rather than "rounded" (this bit
  // panda's small round ears) - just draw those solid instead.
  if (w < 5 || h < 5) { px(ctx, x, y, w, h, color); return; }
  px(ctx, x + 1, y, w - 2, h, color);
  px(ctx, x, y + 1, w, h - 2, color);
}

// A 2-color checkerboard dither over a region, at the PHYSICAL pixel level
// (not logical grid units, so the checker cells are single screen pixels,
// not PX-sized blocks) - the classic retro pixel-art way to fake an
// intermediate shade between two flat colors without introducing actual
// alpha blending or a smooth gradient, either of which would clash with
// the hard-edged look everything else here has. Used for the optional
// per-species `shade` highlight band (see drawCreature) - most species
// don't set one and just keep a flat bodyColor like before.
function pxDither(ctx, x, y, w, h, colorA, colorB) {
  const x0 = Math.round(x * PX), y0 = Math.round(y * PX);
  const x1 = Math.round((x + w) * PX), y1 = Math.round((y + h) * PX);
  for (let py = y0; py < y1; py++) {
    for (let pxCol = x0; pxCol < x1; pxCol++) {
      ctx.fillStyle = (pxCol + py) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(pxCol, py, 1, 1);
    }
  }
}

// 4x4 Bayer matrix, used below for ordered dithering - unlike pxDither's
// flat 50/50 checker (fine for a single uniform "highlight band"), this lets
// the colorA/colorB ratio vary smoothly per-pixel so a region can fade from
// "mostly colorA" to "mostly colorB" and read as an actual gradient instead
// of one flat checker pattern butting up against a hard edge.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Radial ordered-dither gradient: colorB (e.g. a colorpoint cat's dark mask)
// right at (focusX,focusY), fading out to colorA (the highlight) by the time
// distance from that point reaches `radius`. Built for faceShade (see
// drawCreature) - a straight two-band pxDither approximation of "dark at the
// eyes/nose, lighter toward the forehead/cheek edge" ended up as a hard
// L-shaped checker block instead of a gradient, since two independently-
// clipped rectangular bands don't blend into each other at their shared
// corner. Distance-from-focus + ordered dithering gives a genuinely radial
// falloff instead.
function pxDitherRadial(ctx, x, y, w, h, colorA, colorB, focusX, focusY, radius) {
  const x0 = Math.round(x * PX), y0 = Math.round(y * PX);
  const x1 = Math.round((x + w) * PX), y1 = Math.round((y + h) * PX);
  const fx = focusX * PX, fy = focusY * PX;
  const r = Math.max(1, radius * PX);
  for (let py = y0; py < y1; py++) {
    for (let pxCol = x0; pxCol < x1; pxCol++) {
      const d = Math.hypot(pxCol + 0.5 - fx, py + 0.5 - fy) / r;
      const density = d < 0 ? 0 : d > 1 ? 1 : d; // 0 = colorB dominant (at focus), 1 = colorA dominant (at/past radius)
      const threshold = BAYER4[py & 3][pxCol & 3] / 16;
      ctx.fillStyle = threshold < density ? colorA : colorB;
      ctx.fillRect(pxCol, py, 1, 1);
    }
  }
}

function pxTriangle(ctx, x1, y1, x2, y2, x3, y3, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1 * PX), Math.round(y1 * PX));
  ctx.lineTo(Math.round(x2 * PX), Math.round(y2 * PX));
  ctx.lineTo(Math.round(x3 * PX), Math.round(y3 * PX));
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------
// Single rotated limb/tail segment - the building block for every joint
// chain (legs, neck, tail) below. Draws a `width`-wide bar of `length`
// running from (hingeX,hingeY) at `angleDeg` (0 = straight down, positive
// = clockwise, i.e. swinging toward -x/tail; see legJointAngles for why),
// and returns the segment's far end so the caller can chain the next bone
// from there. Each call is a fresh save/rotate/restore against the
// *absolute* angle rather than a nested transform relative to the parent -
// with only 2-3 bones per chain this is simpler to reason about (and to
// unit-test: two calls with the same angle draw the same rectangle) than
// carrying compounded transform state across ctx.save() frames.
// ---------------------------------------------------------------------
function pxJoint(ctx, hingeX, hingeY, angleDeg, length, width, color, tag) {
  if (length <= 0 || width <= 0) {
    // A bone with a non-positive length/width silently draws nothing (see
    // the guard below) - every caller's length/width is either a positive
    // species constant or a computed value with its own floor (neckLen
    // floors at 0.3, tail boneLen floors at 1 via `|| 1`), so this branch
    // firing at runtime is itself a bug signal (a part quietly vanishing
    // reads as "the sprite looks wrong" just as much as a misplaced one
    // does) - flagged via skippedDraw rather than just silently returning.
    if (tag) reportPart(tag, { hingeX, hingeY, tipX: hingeX, tipY: hingeY, angleDeg, length, width, x: hingeX, y: hingeY, w: 0, h: 0, skippedDraw: true });
    return { x: hingeX, y: hingeY };
  }
  const rad = angleDeg * (Math.PI / 180);
  const sin = Math.sin(rad), cos = Math.cos(rad);
  const tipX = hingeX - sin * length, tipY = hingeY + cos * length;
  if (tag) {
    reportPart(tag, {
      hingeX, hingeY, tipX, tipY, angleDeg, length, width,
      // Coarse axis-aligned bounding box (hinge-to-tip span, padded by the
      // bone's own width) - not exact for a rotated rect, but plenty to
      // catch "drawn absurdly far from the creature" without needing to
      // replicate ctx's rotation math here.
      x: Math.min(hingeX, tipX) - width / 2,
      y: Math.min(hingeY, tipY) - width / 2,
      w: Math.abs(tipX - hingeX) + width,
      h: Math.abs(tipY - hingeY) + width,
      skippedDraw: false,
    });
  }
  ctx.save();
  ctx.translate(Math.round(hingeX * PX), Math.round(hingeY * PX));
  ctx.rotate(rad);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round((-width / 2) * PX), 0, Math.round(width * PX), Math.round(length * PX));
  ctx.restore();
  return { x: tipX, y: tipY };
}

// Two-bone leg chain (hip/shoulder -> knee/elbow -> paw). `hipAngle` and
// `kneeAngle` are both absolute (kneeAngle is NOT relative to the upper
// bone) since the caller (legJointAngles) already computes them that way.
// pawColor/pawFraction (both optional): a species whose paws are a
// different color from the rest of the leg (e.g. a tuxedo cat's white
// "socks" on an otherwise black leg) can't be expressed by a single
// `color` for the whole lower bone, so after drawing the lower bone
// normally, a second short pxJoint segment is drawn on top of just its
// far end (the last `pawFraction` of lowerLen, same angle/width so it
// lines up exactly with no seam) in pawColor. Species that don't set
// cfg.pawColor are completely unaffected - this whole block is skipped.
function drawLegChain(ctx, hipX, hipY, hipAngle, kneeAngle, upperLen, lowerLen, upperW, lowerW, color, tagPrefix, pawColor, pawFraction) {
  const knee = pxJoint(ctx, hipX, hipY, hipAngle, upperLen, upperW, color, tagPrefix && `${tagPrefix}:upper`);
  const lowerAngle = hipAngle + kneeAngle;
  pxJoint(ctx, knee.x, knee.y, lowerAngle, lowerLen, lowerW, color, tagPrefix && `${tagPrefix}:lower`);
  if (pawColor && pawFraction > 0) {
    const rad = lowerAngle * (Math.PI / 180);
    const capLen = lowerLen * pawFraction;
    const hingeLen = lowerLen - capLen;
    const capHingeX = knee.x - Math.sin(rad) * hingeLen;
    const capHingeY = knee.y + Math.cos(rad) * hingeLen;
    pxJoint(ctx, capHingeX, capHingeY, lowerAngle, capLen, lowerW, pawColor, tagPrefix && `${tagPrefix}:paw`);
  }
}

// One side (front or back) as a near+far pair instead of a single leg -
// the far one drawn first (so the near one overlaps it, matching which
// side of the body a viewer would actually see more of), offset toward
// the tail by a fraction of the leg's own width (proportional, not a
// fixed grid amount, so it scales sensibly across species whose legs
// range from 0.5 to 3 grid units wide), very slightly shorter/thinner,
// and a hair out of phase on the hip angle so the two don't move in
// perfect lockstep - all cheap, cosmetic offsets on top of the same
// legJointAngles() every other pose already uses, not a second pose
// system.
function drawLegPair(ctx, cfg, pose, isFront, legY) {
  const { hip, knee } = legJointAngles(cfg, pose, isFront);
  const side = isFront ? 'front' : 'back';
  // Raw joint angles, not a rect - the invariant checker just wants to know
  // these two numbers stayed finite and in a plausible range, since every
  // downstream leg-segment rect is derived from them via pxJoint anyway.
  reportPart(`legAngles:${side}`, { hip, knee });
  const j = isFront ? cfg.joints.front : cfg.joints.back;
  const w = isFront ? cfg.legFrontW : cfg.legBackW;
  const baseX = (isFront ? cfg.legFrontX : cfg.legBackX) + w / 2;
  const farW = Math.max(1, w - 1);
  const nearW = w;
  const farOffset = Math.max(0.9, w * 0.7);
  const pawColor = cfg.pawColor || null;
  const pawFraction = cfg.pawFraction ?? PAW_FRACTION_DEFAULT;
  // Belly-up rest (bellyUp): legs pointing up from the legY hinge (= the
  // body's own bottom edge) don't clear the squashed body's own
  // silhouette at their normal standing-reach length - a typical
  // species' upperLen+lowerLen is shorter than even the flattened body's
  // remaining height, so at normal length the legs just sit inside the
  // body outline instead of visibly poking up into open space above it
  // (confirmed by rendering + a numeric hinge-vs-body-top clearance check
  // - see CLAUDE.md's rollover-replacement note). A flat scale factor
  // doesn't work evenly across all 4 species though - e.g. pomeranian
  // (tall body, the shortest legs in the roster) needs a far bigger
  // multiplier than husky (moderate body, the longest legs) for the same
  // absolute clearance, and applying husky's needed factor to pomeranian
  // would look like giant stick legs. Instead, derive how much reach THIS
  // species actually needs: 0.15 is 1-0.85 (1 minus bellyUp's own peak
  // bodySquash, see IDLE_BEHAVIORS.bellyUp) per the squashY formula above
  // - so cfg.bodyH*0.15 is this species' actual squashed body height,
  // +2 grid units of margin so legs clearly poke into open space rather
  // than just grazing the edge. Capped at 4.2x so a species whose legs
  // are simply too short relative to its body (pomeranian) gets as much
  // clearance as still looks proportionate rather than literal stilts -
  // it won't fully escape the body silhouette every frame, which is a
  // known/accepted limitation (see CLAUDE.md) carried over unchanged from
  // the old rollover design (this derivation itself was never implicated
  // in any of rollover's actual bugs - only the dynamic leg motion was,
  // which bellyUp replaces with a fixed, unanimated angle - see below).
  const totalLegLen = j.upperLen + j.lowerLen;
  const neededReach = cfg.bodyH * 0.15 + 2;
  const maxReachScale = Math.min(4.2, Math.max(1, neededReach / totalLegLen));
  const reachScale = 1 + pose.bellyUp * (maxReachScale - 1);
  drawLegChain(ctx, baseX - farOffset, legY, hip * 0.85, knee, j.upperLen * 0.92 * reachScale, j.lowerLen * 0.92 * reachScale, farW, Math.max(1, farW - 1), cfg.legColor, `leg:${side}:far`, pawColor, pawFraction);
  drawLegChain(ctx, baseX, legY, hip, knee, j.upperLen * reachScale, j.lowerLen * reachScale, nearW, Math.max(1, nearW - 1), cfg.legColor, `leg:${side}:near`, pawColor, pawFraction);
}

// Converts the existing high-level pose intent (legPhase/legsTucked/
// frontLegRaise/frontLegExtend - unchanged from the pre-joint version, so
// none of the idle behaviors above needed rewriting) into a concrete
// (hip, knee) angle pair for one leg, using the per-species bend profile
// in cfg.joints. This is the one place species anatomy actually differs:
// e.g. a rabbit's back-leg tuckHip/tuckKnee fold much further than a
// cat's, giving the hock-heavy hind-leg fold real rabbits have instead of
// a generic "shrink the leg" hack.
function legJointAngles(cfg, pose, isFront) {
  const j = isFront ? cfg.joints.front : cfg.joints.back;
  // legPhase>0 used to shift the front leg toward -x (tail) and the back
  // leg toward +x (head) in the old rect-shift code - matching signs here
  // (positive angle = swings toward -x, see pxJoint) keeps that same
  // alternating gait direction.
  const phase = isFront ? pose.legPhase : -pose.legPhase;
  let hip = phase * j.swingAmp;
  // Knee bends most near mid-swing (phase ~ 0, leg lifted) and straightens
  // out at the stride extremes (footfall/push-off).
  let knee = (1 - Math.min(1, Math.abs(phase))) * j.kneeSwingAmp;

  // Front and back tuck independently (see defaultPose's legsTuckedFront/
  // Back comment) - sleep/hop set both to the same value (a
  // symmetric curl-up), but a dog's 'sit' sets only legsTuckedBack, so the
  // front leg's hip/knee here stay at their natural standing/idle angle
  // instead of folding too.
  const tuckAmt = isFront ? pose.legsTuckedFront : pose.legsTuckedBack;
  hip = lerp(hip, j.tuckHip, tuckAmt);
  knee = lerp(knee, j.tuckKnee, tuckAmt);

  if (isFront && pose.frontLegRaise > 0) {
    // Groom: paw folds up toward the face rather than down toward the
    // ground - a different target pose than the tuck above, not just more
    // of it, so it's blended in on top instead of through legsTucked.
    hip = lerp(hip, -160, pose.frontLegRaise);
    knee = lerp(knee, -50, pose.frontLegRaise);
  } else if (isFront && pose.frontLegExtend > 0) {
    // Stretch: reach forward and mostly straighten.
    hip = lerp(hip, -70, pose.frontLegExtend);
    knee = lerp(knee, 15, pose.frontLegExtend);
  }

  if (pose.dangle > 0) {
    // Grabbed (held): legs hang straight down (not tucked under - a held
    // animal's legs aren't bearing weight, they just hang) with a slow
    // pendulum sway (dangleSway, computed once per frame by the 'held'
    // idle behavior) instead of the walk/tuck angles above - applied last
    // so it always wins outright over whatever state the legs were in the
    // moment the grab started.
    hip = lerp(hip, pose.dangleSway, pose.dangle);
    knee = lerp(knee, 12, pose.dangle);
  }

  if (pose.bellyUp > 0) {
    // Belly-up rest (see IDLE_BEHAVIORS.bellyUp, replaces the deleted
    // rollover - see CLAUDE.md for why): legs flip to point UP (180°, the
    // opposite of the normal 0°=down convention - see pxJoint's rotation)
    // at a FIXED angle with no time-based animation at all - deliberately
    // the simplest possible thing that could work, after rollover broke
    // in a new way on nearly every attempt to make the legs do something
    // dynamic (handstand-looking rotation, a see-saw body wobble, legs
    // that read as "rowing", and finally a pose transition that looked
    // ambiguous mid-blend). A constant target can't develop any of those
    // failure modes - there's no animation to go wrong. Same front/back
    // target (unlike the old paddle mechanism's per-pair values) since
    // there's no motion left to differentiate between them. Applied
    // last, same "always wins" rule as every other override here.
    hip = lerp(hip, 180, pose.bellyUp);
    knee = lerp(knee, 15, pose.bellyUp);
  }
  return { hip, knee };
}

// ---------------------------------------------------------------------
// Ear drawers - this is the single biggest lever for telling species apart
// at a glance, so each style is a deliberately different silhouette rather
// than a recolor of the same shape.
// ---------------------------------------------------------------------
function drawEarPointy(ctx, cfg, side, flick) {
  const e = cfg.ear;
  const gap = e.gap / 2;
  const baseX = cfg.headX + cfg.headW / 2 + side * gap;
  const tipX = baseX + side * e.tipDX + flick * side;
  // color2 (optional): the near-side (side===1) ear uses a different color
  // than the far-side one - only calico needs this (real calico patching is
  // asymmetric between the two ears), every other species just sets one
  // `color` and gets the same shade both sides as before.
  const color = side === 1 && e.color2 ? e.color2 : e.color;
  pxTriangle(ctx, baseX - e.w / 2, cfg.headY + 1, baseX + e.w / 2, cfg.headY + 1, tipX, cfg.headY - e.h + 1, color);
  if (e.inner) {
    const iw = e.w * 0.45;
    pxTriangle(ctx, baseX - iw / 2, cfg.headY + 0.5, baseX + iw / 2, cfg.headY + 0.5, tipX, cfg.headY - e.h * 0.6 + 1, e.inner);
  }
}

function drawEarLong(ctx, cfg, side, flick) {
  const e = cfg.ear;
  const gap = e.gap / 2;
  const baseX = cfg.headX + cfg.headW / 2 + side * gap - e.w / 2;
  const x = baseX + flick * side * 0.4;
  pxSoft(ctx, x, cfg.headY - e.h + 2, e.w, e.h, e.color);
  if (e.inner) {
    pxSoft(ctx, x + e.w * 0.22, cfg.headY - e.h + 3, e.w * 0.56, e.h * 0.55, e.inner);
  }
}

function drawEarRound(ctx, cfg, side, flick) {
  const e = cfg.ear;
  const gap = e.gap / 2;
  const cx = cfg.headX + cfg.headW / 2 + side * gap;
  const cy = cfg.headY + 1 - e.h * 0.35;
  pxSoft(ctx, cx - e.w / 2 + flick * side * 0.3, cy - e.h / 2, e.w, e.h, e.color);
}

function drawEarFloppy(ctx, cfg, side, flick) {
  // Only the near-side (side===1, drawn last/on top) floppy ear reads well
  // in a pure side view; the far ear is skipped rather than drawn
  // overlapping/hidden, which is how the original 3D version's far-side
  // geometry behaved too.
  if (side < 0) return;
  const e = cfg.ear;
  const x = cfg.headX + cfg.headW * 0.08 + flick;
  // Drawn from 1 unit below headY, so an unclamped e.h taller than
  // (roughly) headH reaches past the head's own bottom edge - fine for a
  // little realistic overhang past the jawline, not fine once it reaches
  // far enough to read as a separate block hanging into the neck/body
  // area (confirmed on dog_dachshund: headH:6 with ear h:7 put the ear's
  // bottom at headY+8, 2 full units past the head's own bottom edge and
  // well into where the body/front-leg region starts). Capping to
  // headH-0.5 caps the overhang to about half a unit past the head's
  // bottom edge instead - still droops past the jaw, stays clearly
  // attached to the head rather than detached from it. A per-species e.h
  // that's already smaller than this just passes through unchanged.
  const maxH = Math.max(1, cfg.headH - 0.5);
  const effectiveH = Math.min(e.h, maxH);
  pxSoft(ctx, x, cfg.headY + 1, e.w, effectiveH, e.color);
}

const EAR_DRAWERS = { pointy: drawEarPointy, long: drawEarLong, round: drawEarRound, floppy: drawEarFloppy };

// ---------------------------------------------------------------------
// Full-frame draw. `pose` is a plain object of small numeric offsets
// (see defaultPose()) computed each tick by the gait/idle-behavior layer
// below - this function has no state of its own, it just paints whatever
// pose it's handed.
// ---------------------------------------------------------------------
function defaultPose() {
  return {
    legPhase: 0, // -1..1, drives the 2-way leg swap
    // 0..1 each, hides legs under the body (sleep/hop-flight tuck both
    // equally; sit tucks them independently per species - see IDLE_
    // BEHAVIORS.sit's sitStyle branches and legJointAngles). Split from a
    // single `legsTucked` into a front/back pair specifically so a sitting
    // dog can fold its hindquarters under while its front legs stay
    // standing - a single shared scalar couldn't tell the two apart.
    legsTuckedFront: 0,
    legsTuckedBack: 0,
    bodyBob: 0, // px, vertical body offset (walk bounce / crouch)
    bodySquash: 0, // 0..1, flattens body height (sleep)
    headDX: 0, headDY: 0, // head offset (groom dip, sleep droop)
    earFlick: 0, // px, ear tip wiggle
    tailPhase: 0, // radians, raw oscillator phase for the tail wave (see updateTailFlavor)
    tailAmp: 0, // current wag/swish amplitude multiplier applied to that wave
    eyesClosed: 0, // 0..1
    cheekPuff: 0, // 0..1
    frontLegRaise: 0, // 0..1 (groom: near paw lifted toward face)
    frontLegExtend: 0, // 0..1 (stretch: front legs forward)
    rollAngle: 0, // degrees, playful roll-onto-side wiggle (unused by any current idle - see CLAUDE.md's rollover-deletion note; left in place, same as waddleTilt below, since drawCreature's rotation still reads it)
    waddleTilt: 0, // degrees, small continuous side-to-side rock (panda)
    hopY: 0, // px, hop arc height
    dangle: 0, // 0..1, legs go loose/hanging (grabbed) instead of tucked
    dangleSway: 0, // degrees, hip angle target for hanging legs while dangle>0 - a slow pendulum sway when held
    tailOverride: false, // true while an idle behavior (held, tailtwitch) is driving tailPhase/tailAmp itself
    noseTwitch: 0, // 0..1, nose rect briefly grows (rabbit sniffing/twitching)
    // Belly-up rest (bellyUp): legs point straight up at a fixed angle -
    // dangle's counterpart for "flipped over" instead of "hanging", see
    // legJointAngles. Deliberately just a single 0..1 blend factor with no
    // companion sway/phase field (unlike dangle's dangleSway) - the target
    // angle is a hardcoded constant (180°/15°) since there's no animation
    // left to parameterize, see IDLE_BEHAVIORS.bellyUp.
    bellyUp: 0,
    // Cursor-look (see setCursorHint/updateCursorLook, driven by the
    // engine itself every frame, never by an idle behavior's apply()) -
    // a small additive head/eye offset toward the cursor, grid units.
    // Kept separate from headDX/headDY so it layers on top of whatever an
    // idle behavior already set there instead of competing with it - see
    // the hdx/hdy combination in drawCreature.
    lookDX: 0,
    lookDY: 0,
  };
}

// Pose fields that are documented above as 0..1 - checked for staying in
// range (small epsilon for float slop), on top of the blanket finite check
// every numeric pose field gets regardless of name.
const POSE_UNIT_FIELDS = ['legsTuckedFront', 'legsTuckedBack', 'bodySquash', 'dangle', 'eyesClosed', 'cheekPuff', 'noseTwitch', 'bellyUp'];
const POSE_EPS = 1e-6;
// Generous sanity ceilings for the non-0..1 pose fields, in whatever unit
// their defaultPose() comment says (degrees for angles, px for offsets).
// These are NOT tight bounds on "normal" motion - each is comfortably above
// the largest value any current idle behavior/gait ever authors (e.g.
// held's dangleSway is a slow +-9 pendulum, groom's frontLegRaise target
// is -160 which lands in legJointAngles's hip/knee, not here) precisely
// so a real bug (NaN, a forgotten reset, a runaway accumulator) has to
// blow past them by a wide margin before it's flagged - normal peaks
// never come close. rollAngle/waddleTilt bounds are kept even though
// nothing currently authors rollAngle (see CLAUDE.md's rollover-deletion
// note) - dormant, not dead: drawCreature's rotation still reads it, so a
// future idle that wants body rotation again can just start setting it.
const POSE_FIELD_BOUNDS = {
  rollAngle: 220, waddleTilt: 220, dangleSway: 60, earFlick: 10,
  bodyBob: 20, headDX: 10, headDY: 10, hopY: 20, tailAmp: 5,
  // lookDX/lookDY: updateCursorLook clamps its target to +-LOOK_MAX (0.8)
  // before easing toward it, so 5 is the same "comfortably above the real
  // peak" margin the other fields above use, not a tight bound.
  lookDX: 5, lookDY: 5,
};

/**
 * Checks one frame's pose + reported part geometry against a set of
 * sanity invariants. Returns an array of human-readable problem strings
 * (empty if the frame looks fine). Pure/stateless and independent of
 * canvas/DOM - built for test/sim-invariants.mjs, which runs long random
 * simulations and calls this once per frame via setGeometrySink() to
 * collect `geometry`, but it's plain data in/data out so it can be called
 * from anywhere (e.g. an interactive debugging session) just as well.
 *
 * `cfg` is a SPECIES[...] entry, `pose` is anim's current pose object,
 * `geometry` is the list of {tag, ...} objects reported via reportPart()
 * while drawing this exact frame (collect them in a geometrySink and clear
 * the list before each draw() call).
 */
export function checkPoseInvariants(cfg, pose, geometry = []) {
  const problems = [];

  for (const [key, v] of Object.entries(pose)) {
    if (typeof v !== 'number') continue;
    if (!Number.isFinite(v)) { problems.push(`pose.${key} is not finite: ${v}`); continue; }
    if (POSE_UNIT_FIELDS.includes(key) && (v < -POSE_EPS || v > 1 + POSE_EPS)) {
      problems.push(`pose.${key} out of [0,1]: ${v}`);
    }
    const bound = POSE_FIELD_BOUNDS[key];
    if (bound !== undefined && Math.abs(v) > bound) {
      problems.push(`pose.${key} out of sane range (+-${bound}): ${v}`);
    }
  }

  const CANVAS_MARGIN = 6; // grid units of slack beyond the 24x24 canvas before "off-canvas" is flagged
  const MAX_COORD = Math.max(GRID_W, GRID_H) + CANVAS_MARGIN;
  for (const g of geometry) {
    if (g.tag && g.tag.startsWith('legAngles:')) {
      if (!Number.isFinite(g.hip) || !Number.isFinite(g.knee)) {
        problems.push(`${g.tag}: non-finite (hip=${g.hip}, knee=${g.knee})`);
      } else if (Math.abs(g.hip) > 260 || Math.abs(g.knee) > 260) {
        problems.push(`${g.tag}: implausible angle (hip=${g.hip.toFixed(1)}, knee=${g.knee.toFixed(1)})`);
      }
      continue;
    }
    if (g.skippedDraw) {
      problems.push(`${g.tag}: part failed to draw (non-positive length/size) - ${JSON.stringify(g)}`);
    }
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.w) || !Number.isFinite(g.h)) {
      problems.push(`${g.tag}: non-finite geometry ${JSON.stringify(g)}`);
      continue;
    }
    if (g.w < -POSE_EPS || g.h < -POSE_EPS) problems.push(`${g.tag}: negative size w=${g.w} h=${g.h}`);
    if (g.x < -CANVAS_MARGIN || g.x > MAX_COORD || g.y < -CANVAS_MARGIN || g.y > MAX_COORD) {
      problems.push(`${g.tag}: drawn far outside canvas at x=${g.x.toFixed(2)} y=${g.y.toFixed(2)}`);
    }
    if (typeof g.length === 'number' && (!Number.isFinite(g.length) || g.length < 0)) {
      problems.push(`${g.tag}: invalid length ${g.length}`);
    }
  }

  // Neck length specifically - the exact quantity behind the earlier "sit
  // pose has a chunk poking out near the neck" bug (see the neck comment
  // in drawCreature). Checked directly rather than relying only on the
  // generic off-canvas scan above, since a bad neckLen showed up as a
  // short, disconnected bar near the body rather than something drawn far
  // outside the canvas.
  const neck = geometry.find((g) => g.tag === 'neck');
  if (neck && Number.isFinite(neck.length)) {
    if (neck.length <= 0) problems.push(`neck length non-positive: ${neck.length}`);
    else if (neck.length > Math.hypot(GRID_W, GRID_H)) problems.push(`neck length implausibly large: ${neck.length}`);
  }

  // Leg segment lengths must match the species' authored joints.{front,
  // back}.{upper,lower}Len, up to the three known cosmetic/behavioral scale
  // factors drawLegPair applies: the "far" leg (0.92x) vs "near" (1x), and
  // bellyUp's per-species-derived reachScale while pose.bellyUp>0 - legs
  // pointing up intentionally reach further than their normal standing
  // length so they clear the squashed body's own silhouette instead of
  // rendering hidden inside it (see CLAUDE.md/drawLegPair's reachScale
  // comment for the derivation and why it's per-species rather than a
  // flat multiplier). Anything outside those three known sites is a
  // segment stretching/shrinking from something else.
  for (const g of geometry) {
    const m = /^leg:(front|back):(near|far):(upper|lower)$/.exec(g.tag || '');
    if (!m || !Number.isFinite(g.length)) continue;
    const [, side, distance, bone] = m;
    const j = cfg.joints[side];
    const base = bone === 'upper' ? j.upperLen : j.lowerLen;
    const totalLegLen = j.upperLen + j.lowerLen;
    const neededReach = cfg.bodyH * 0.15 + 2;
    const maxReachScale = Math.min(4.2, Math.max(1, neededReach / totalLegLen));
    const reachScale = 1 + (pose.bellyUp || 0) * (maxReachScale - 1);
    const expected = base * (distance === 'far' ? 0.92 : 1) * reachScale;
    if (Math.abs(g.length - expected) > Math.max(0.05, expected * 0.05)) {
      problems.push(`${g.tag}: length ${g.length.toFixed(3)} != expected ${expected.toFixed(3)}`);
    }
  }

  // Body/head shouldn't drift from their authored footprint beyond what
  // squash/bob are supposed to do to them (see drawCreature: bodyH shrinks
  // by up to squashY=bodySquash*bodyH*0.35, headH by up to headH*0.25) -
  // generous margin on top of those known factors, not a tight bound.
  const body = geometry.find((g) => g.tag === 'body');
  if (body && Number.isFinite(body.h) && Number.isFinite(body.w)) {
    if (body.h < cfg.bodyH * 0.55 || body.h > cfg.bodyH * 1.05) {
      problems.push(`body height ${body.h.toFixed(2)} outside expected range for bodyH=${cfg.bodyH}`);
    }
    if (Math.abs(body.w - cfg.bodyW) > 0.05) {
      problems.push(`body width ${body.w.toFixed(2)} drifted from authored bodyW=${cfg.bodyW}`);
    }
  }
  const head = geometry.find((g) => g.tag === 'head');
  if (head && Number.isFinite(head.h) && Number.isFinite(head.w)) {
    if (head.h < cfg.headH * 0.65 || head.h > cfg.headH * 1.05) {
      problems.push(`head height ${head.h.toFixed(2)} outside expected range for headH=${cfg.headH}`);
    }
    if (Math.abs(head.w - cfg.headW) > 0.05) {
      problems.push(`head width ${head.w.toFixed(2)} drifted from authored headW=${cfg.headW}`);
    }
  }

  // Leg hip pivot must track the body's actual *rendered* bottom edge
  // exactly (body.y + body.h, which already folds in both bodyBob and the
  // squash offset) - not a loose sanity bound like the ones above, this
  // should hold to float precision whenever the engine is correct, by the
  // same authoring convention documented above SPECIES ("legY must equal
  // bodyY+bodyH exactly"). That convention is only guaranteed at the
  // *authored* (unposed) coordinates though; per-frame, bodyBob shifts both
  // by the same amount so it still holds, but bodySquash shrinks the body
  // rect *and* shifts its top down without any corresponding shift here -
  // exactly the same class of bug the neck/tail "detached from body" fix
  // (see the bodyShift/neckBaseY comments) already fixed for those two
  // parts. If this fires, it means legY needs the same squashY*0.5 term
  // neckBaseY/bodyShift already use.
  if (body && Number.isFinite(body.y) && Number.isFinite(body.h)) {
    const bodyBottomY = body.y + body.h;
    for (const g of geometry) {
      const m = /^leg:(front|back):(near|far):upper$/.exec(g.tag || '');
      if (!m || !Number.isFinite(g.hingeY)) continue;
      if (Math.abs(g.hingeY - bodyBottomY) > 0.15) {
        problems.push(`${g.tag}: hip pivot y=${g.hingeY.toFixed(3)} has drifted ${(g.hingeY - bodyBottomY).toFixed(3)} grid units from the body's actual bottom edge (y=${bodyBottomY.toFixed(3)}) - should track bob+squash exactly, same as neck/tail`);
      }
    }
  }

  return problems;
}

function drawCreature(ctx, cfg, pose) {
  ctx.save();
  const angle = (pose.rollAngle + pose.waddleTilt) * (Math.PI / 180);
  if (angle) {
    const cx = (cfg.bodyX + cfg.headX + cfg.headW) / 2;
    const cy = cfg.bodyY + cfg.bodyH / 2;
    ctx.translate(cx * PX, cy * PX);
    ctx.rotate(angle);
    ctx.translate(-cx * PX, -cy * PX);
  }

  const squashY = pose.bodySquash * cfg.bodyH * 0.35;
  // Squash shrinks the body symmetrically toward its own vertical center:
  // the top edge moves DOWN by squashY*0.5 (bodyY below gets +squashY*0.5)
  // while bodyH shrinks by the full squashY - which means the BOTTOM edge
  // (bodyY+bodyH) ends up moving UP by squashY*0.5, the opposite sign from
  // the top. legY anchors to the bottom edge (per the "legY must equal
  // bodyY+bodyH" authoring convention below SPECIES), so it needs -squashY
  // *0.5, not the top edge's +squashY*0.5 that neck/tail track (they
  // anchor near the top - see neckBaseY/bodyShift below).
  const bodyY = cfg.bodyY + pose.bodyBob + squashY * 0.5;
  const bodyH = cfg.bodyH - squashY;
  // Missing this term entirely (as this line originally did - just
  // cfg.legY + pose.bodyBob) meant legY silently drifted away from the
  // body's true bottom edge by squashY*0.5 any time bodySquash>0 - i.e.
  // during 'sleep' (in every species' idle pool) and drag-'held'
  // (setHeld(true)), both universal across every species - which is
  // exactly the "random, not tied to one species/state" squished/detached-
  // leg glitch the automated invariant sweep in test/sim-invariants.mjs
  // caught (see checkPoseInvariants' leg-hip-pivot-vs-body-bottom check).
  const legY = cfg.legY + pose.bodyBob - squashY * 0.5;

  // Cursor-look (see setCursorHint/updateCursorLook in createAnimal): a
  // small additive head/eye offset toward wherever the cursor currently
  // is, kept as its own pose field (lookDX/lookDY) rather than folded into
  // headDX/headDY so it layers on top of whatever an idle behavior already
  // set there instead of fighting it. Every head/eye/ear/nose/snout/cheek
  // draw below reads hdx/hdy instead of pose.headDX/headDY directly, so
  // cursor-look works underneath groom/sleep/sit/etc. without any of them
  // needing to know it exists.
  const hdx = pose.headDX + pose.lookDX;
  const hdy = pose.headDY + pose.lookDY;

  // Tail (behind everything). Segment 0 (closest to the body) is drawn
  // rigid at its authored rest position; each segment past that is a bone
  // chained from the previous one's tip, bent by a travelling sine wave
  // (phase-lagged per segment, amplitude growing toward the tip) instead
  // of the old uniform x-shear - the tail now actually curves joint to
  // joint rather than sliding as a flat stack. At amp 0 (or the rest
  // instant of the wave) this reconstructs the exact original authored
  // layout, since restAngle/boneLen are derived from those same positions.
  if (cfg.tail && cfg.tail.length) {
    const segs = cfg.tail;
    // Track the body's own top-edge shift exactly (same bodyBob+squashY
    // term the body rect above uses) rather than a fixed bodyBob-only
    // fraction - the old `-bodyBob*0.4` only accounted for the walk
    // bounce, so it was fine for small negative bodyBob but opened a
    // multi-pixel gap between the tail and the body whenever bodyBob went
    // positive and large (sit/sleep) since squash wasn't factored in at
    // all: the body's top edge sinks by bodyBob+squashY/2 but the tail
    // barely moved, visibly detaching it - exactly the gap glitch this
    // change is meant to fix.
    const bodyShift = pose.bodyBob + squashY * 0.5;
    px(ctx, segs[0].x, segs[0].y + bodyShift, segs[0].w, segs[0].h, segs[0].color, 'tail:0');
    let originX = segs[0].x + segs[0].w / 2;
    let originY = segs[0].y + segs[0].h / 2 + bodyShift;
    let cumAngle = 0;
    for (let i = 1; i < segs.length; i++) {
      const prevCX = segs[i - 1].x + segs[i - 1].w / 2;
      const prevCY = segs[i - 1].y + segs[i - 1].h / 2;
      const curCX = segs[i].x + segs[i].w / 2;
      const curCY = segs[i].y + segs[i].h / 2;
      const dx = curCX - prevCX, dy = curCY - prevCY;
      const boneLen = Math.hypot(dx, dy) || 1;
      const restAngle = Math.atan2(-dx, dy) * (180 / Math.PI);
      const wave = Math.sin(pose.tailPhase - i * 0.8) * pose.tailAmp * (6 + i * 5);
      cumAngle += wave;
      const tip = pxJoint(ctx, originX, originY, restAngle + cumAngle, boneLen, segs[i].h, segs[i].color, `tail:${i}`);
      originX = tip.x; originY = tip.y;
    }
  }

  // Back pair, then front pair (front drawn after so it overlaps on top,
  // matching the near-side-forward read of a walk cycle). Each pair is a
  // far leg (drawn first/behind, offset toward the tail, slightly shorter/
  // thinner, and a hair out of phase) plus a near leg (drawn second/on
  // top, at the authored position) - two hip->knee->paw chains instead of
  // one, so the silhouette reads as 4 legs instead of 2 flat slabs. See
  // legJointAngles for how the angles differ per species.
  //
  // bellyUp (belly-up rest, see IDLE_BEHAVIORS.bellyUp) is the one
  // exception to this order: legs pointing UP from the same legY hinge
  // reach back toward/through the body's own vertical span (their hip
  // anchor IS the body's bottom edge, and a typical leg's length doesn't
  // clear the squashed body's top edge - checked against every dog
  // species' joint lengths/squash math), so if drawn here (before the
  // body) they'd render fully hidden behind it. Deferred to the very end
  // of this function instead, where they paint on top of everything - a
  // dog resting belly-up has its raised legs as the nearest/foreground
  // element anyway, so this reads correctly rather than as a z-order hack.
  const bellyUp = pose.bellyUp > 0;
  if (!bellyUp) {
    if (cfg.legBackW > 0) drawLegPair(ctx, cfg, pose, false, legY);
    if (cfg.legFrontW > 0) drawLegPair(ctx, cfg, pose, true, legY);
  }

  // Body + pattern + belly
  pxSoft(ctx, cfg.bodyX, bodyY, cfg.bodyW, bodyH, cfg.bodyColor, 'body');
  // shade (optional): a dithered highlight band along the top of the body,
  // suggesting light from above / a rounded body rather than a flat panel.
  // Kept to a single opt-in species for now (siamese) rather than applied
  // everywhere - see CLAUDE.md for why the rest stayed flat.
  if (cfg.shade) {
    pxDither(ctx, cfg.bodyX, bodyY, cfg.bodyW, cfg.shade.bandH, cfg.shade.highlight, cfg.bodyColor);
  }
  // pattern/belly are authored as rects in the BODY's own unsquashed local
  // space (cfg.bodyY..cfg.bodyY+cfg.bodyH). bodyScaleY is the exact same
  // top-anchored linear squash the body rect itself just went through
  // above, so remapping any such rect through it guarantees its edges
  // never drift past the body's actual shrunk silhouette regardless of
  // how far bodySquash goes. Replaces the old per-element ad hoc offset/
  // shrink constants (bodyBob-only for pattern, +squashY*0.3/-squashY*0.5
  // for belly - neither derived from anything, just tuned to look ok at
  // small squash) that let a pattern/belly patch visibly poke out past the
  // body's edge once squash got large (sleep) - same detachment bug class
  // as the legY fix, just for a decorative rect instead of a leg joint (see
  // CLAUDE.md). At squashY=0, bodyScaleY=1 and this reduces to exactly the
  // old unsquashed behavior (r.y+bodyBob, no shrink).
  const bodyScaleY = bodyH / cfg.bodyH;
  const toBodySquashed = (r) => ({
    y: bodyY + (r.y - cfg.bodyY) * bodyScaleY,
    h: Math.max(0, r.h * bodyScaleY),
  });
  if (cfg.pattern) {
    for (const r of cfg.pattern) {
      const sq = toBodySquashed(r);
      px(ctx, r.x, sq.y, r.w, sq.h, r.color);
    }
  }
  if (cfg.belly) {
    const sq = toBodySquashed(cfg.belly);
    px(ctx, cfg.belly.x, sq.y, cfg.belly.w, sq.h, cfg.belly.color);
  }

  // Cheek pouches (hamster) - drawn before the head so the head's own
  // silhouette still reads on top at the jawline. +pose.bodyBob was
  // missing here previously (cheeks only tracked hdx/hdy) so they'd
  // visibly detach from the head during any bodyBob (walk bounce, sit,
  // sleep, groom...) - the head itself always includes +pose.bodyBob (see
  // headY below), cheeks now match it.
  if (cfg.cheeks) {
    const scale = 1 + pose.cheekPuff * 0.7;
    cfg.cheeks.forEach((c, i) => {
      const w = c.w * scale, h = c.h * scale;
      pxSoft(ctx, c.x - (w - c.w) / 2 + hdx, c.y - (h - c.h) / 2 + hdy + pose.bodyBob, w, h, c.color, `cheek:${i}`);
    });
  }

  // Head
  const headX = cfg.headX + hdx;
  const headY = cfg.headY + hdy + pose.bodyBob;
  const headH = cfg.headH * (1 - pose.bodySquash * 0.25);
  // Squash trims headH from the TOP only (see the px() call below - it
  // draws at headY+(cfg.headH-headH), not headY), so the head's actual
  // rendered top edge sits (cfg.headH-headH) BELOW headY whenever
  // bodySquash>0 (sleep/held). Anything meant to attach to the head's real
  // silhouette - not just its nominal anchor point - has to use this, not
  // headY, or it sits too high once the head visually shrinks. Missing
  // this was the ear-head gap bug (earCfg used to pass plain headY): at
  // full sleep squash the ears' base stayed at the old, higher position
  // while the head's drawn top sank (cfg.headH*0.25) below it, leaving a
  // background-colored strip between them - confirmed by rendering (see
  // CLAUDE.md, test/BEFORE-earhead-sleep-cat.png).
  const headTopY = headY + (cfg.headH - headH);

  // Neck: a single bone from a fixed body-anchor to wherever the head
  // currently is. At rest this sits fully hidden under the body/head
  // overlap (headX is authored to overlap the body's front edge), so it
  // only becomes visible once headDX/headDY pulls the head away from that
  // rest position (groom dip, sleep droop, stretch) - which is exactly
  // when a flat head-offset with no connecting joint used to look most
  // disjointed. Angle is derived (atan2) from the actual head position
  // each frame rather than duplicated per idle behavior, so every existing
  // headDX/headDY animation gets a bending neck for free (and now
  // cursor-look's lookDX/lookY too, since headX/headY above fold both in).
  const neckBaseX = cfg.headX - 0.3;
  // Same bodyBob+squashY term the body rect uses (see the tail fix above)
  // so the neck's root tracks the body's actual top edge instead of
  // drifting away from it whenever bodySquash kicks in (sleep).
  const neckBaseY = cfg.bodyY + 0.8 + pose.bodyBob + squashY * 0.5;
  const headAttachX = headX + cfg.headW * 0.2;
  const headAttachY = headY + cfg.headH * 0.55;
  const ndx = headAttachX - neckBaseX;
  const ndy = headAttachY - neckBaseY;
  const neckAngle = Math.atan2(-ndx, ndy) * (180 / Math.PI);
  // Length is the *actual* distance to the head attachment point, not
  // cfg.joints.neckLen (a fixed guess) - this was the real bug behind
  // "body looks like it has an extra chunk overlapping near the neck"
  // during sit/rest poses. A fixed-length bone only points *toward* the
  // head, it doesn't reach it - at rest that's invisible (the base and
  // head attachment happen to sit ~neckLen apart anyway), but the moment
  // bodyBob pushes the body down while the head stays where it is (sit,
  // groom, sleep), the true gap grows past the fixed length. The bone,
  // still fixed-length but now also thick (neckW), ends up as a short
  // diagonal bar that doesn't span the actual gap - which reads as a
  // disconnected extra black/colored block poking out of the silhouette
  // rather than a neck, especially on bicolor species (tuxedo, husky)
  // where the neck's bodyColor contrasts with an adjacent white patch;
  // same-colored species (cat_a) hid this by coincidence, not correctness.
  // cfg.joints.neckLen is unused for geometry now; a tiny floor avoids a
  // zero-length draw if the two points ever land exactly on each other.
  const neckLen = Math.max(0.3, Math.hypot(ndx, ndy));
  pxJoint(ctx, neckBaseX, neckBaseY, neckAngle, neckLen, cfg.joints.neckW, cfg.bodyColor, 'neck');

  // headColor (optional, defaults to bodyColor): lets a species' face read
  // as a different color/"mask" from its body - siamese points and pug's
  // black mask both need this; every species that doesn't set it keeps the
  // original single-color head.
  //
  // Plain px() here, not pxSoft() - the head used to get the same 1-unit
  // corner shave every "soft" rect gets, but for earStyle:'pointy' (7 of
  // 10 species) the ear triangle attaches right at/near that same top
  // corner and doesn't fully cover it (a triangle narrows toward its tip,
  // so at the exact row the corner-cut lives on it hasn't reached full
  // base width yet) - checked the actual coverage per species
  // (test/check-ear-coverage.mjs): 6 of 7 pointy-eared species fell
  // 0.6-1.0 grid units short, leaving a small enclosed triangular sliver
  // of background showing through the fur right where ear meets head -
  // confirmed visually via a tight zoomed crop (test/render-zoom.mjs),
  // reads exactly like a bite taken out of the silhouette. Tuning each
  // species' ear geometry to individually cover its own head's corner-cut
  // would be fragile (breaks again the next time an ear shape changes);
  // removing the corner-cut from the head instead fixes all of them at
  // once and costs only a barely-visible 1-unit corner shave that was
  // mostly hidden under ears anyway.
  px(ctx, headX, headTopY, cfg.headW, headH, cfg.headColor || cfg.bodyColor, 'head');
  // faceShade (optional, e.g. siamese): a colorpoint-style gradient across
  // the FACE, not the body - real colorpoint cats are darkest right around
  // the eyes/nose/mouth and lighten going outward toward the forehead and
  // the cheek/jaw edge. Radial (via pxDitherRadial) around the eye position
  // by default - the first version used two straight dithered bands pinned
  // to the head's top-left corner, which read as a flat checker block with
  // a hard edge rather than a gradient (confirmed by cropped screenshot -
  // see CLAUDE.md). focusX/focusY/radius are in the same absolute logical-
  // grid space as cfg.eye, and default to the eye position so callers that
  // don't care can just set `highlight`. Drawn after the flat head fill,
  // before ears/eyes/nose so those still render crisply on top.
  //
  // Uses headTopY (not headY) for the same reason the head fill above
  // does - this box has to line up with the head's actual rendered
  // silhouette. It happened to be less visually obvious than the ear gap
  // (the dither just ends up shifted/short rather than leaving a flat
  // background gap), found by inspection while fixing the ear case since
  // it reads from the exact same headY the ears used to.
  if (cfg.faceShade) {
    const fs = cfg.faceShade;
    const hc = cfg.headColor || cfg.bodyColor;
    const focusX = (fs.focusX ?? (cfg.eye.x + cfg.eye.w / 2)) + hdx;
    const focusY = (fs.focusY ?? (cfg.eye.y + cfg.eye.h / 2)) + hdy + pose.bodyBob;
    const radius = fs.radius ?? Math.max(cfg.headW, cfg.headH) * 0.95;
    pxDitherRadial(ctx, headX, headTopY, cfg.headW, headH, fs.highlight, hc, focusX, focusY, radius);
  }
  // snout accepts either one patch (every existing species) or an array of
  // them - tuxedo's white face blaze is a tapered shape (narrow between the
  // eyes, widening toward the chin) that one rectangle can't approximate,
  // so it's authored as 2-3 stacked patches of increasing width instead.
  if (cfg.snout) {
    const snoutPatches = Array.isArray(cfg.snout) ? cfg.snout : [cfg.snout];
    for (const s of snoutPatches) px(ctx, s.x + hdx, s.y + hdy + pose.bodyBob, s.w, s.h, s.color);
  }

  // Ears (attach to the head's current position, so groom/sleep head
  // motion carries the ears with it). headTopY, not headY - see its
  // comment above: during squash (sleep/held) the head's actual drawn top
  // sinks below headY, and the ear drawers all anchor to cfg.headY as "the
  // top of the head", so passing plain headY here left the ears' base
  // sitting at the old, higher position while the head itself visibly sank
  // out from under them - a background-colored gap opened up between ear
  // base and head top, worst at full sleep squash (see CLAUDE.md).
  const earCfg = { ...cfg, headX, headY: headTopY, headW: cfg.headW };
  const drawEar = EAR_DRAWERS[cfg.earStyle];
  if (drawEar) {
    drawEar(ctx, earCfg, -1, pose.earFlick);
    drawEar(ctx, earCfg, 1, pose.earFlick);
  }

  // Face: eyes + nose
  if (pose.eyesClosed < 0.5) {
    px(ctx, cfg.eye.x + hdx, cfg.eye.y + hdy + pose.bodyBob, cfg.eye.w, cfg.eye.h, cfg.eyeColor);
    px(ctx, cfg.eye.x + hdx + cfg.eye.w * 0.4, cfg.eye.y + hdy + pose.bodyBob, 1, 1, '#fff8ec');
  } else {
    px(ctx, cfg.eye.x + hdx, cfg.eye.y + hdy + pose.bodyBob + cfg.eye.h * 0.6, cfg.eye.w, Math.max(1, cfg.eye.h * 0.3), cfg.darkColor);
  }
  // nose.color (optional, defaults to darkColor): tuxedo's nose sits on a
  // white patch and is actually pink in the reference photo, not a dark
  // dot - every other species omits this and keeps the original look.
  // noseTwitch (rabbit's 'nosetwitch' idle): the nose rect briefly grows by
  // up to 60% around its own center rather than just its top-left corner,
  // so it reads as a twitch/sniff rather than the nose sliding sideways.
  const noseScale = 1 + pose.noseTwitch * 0.6;
  const noseW = cfg.nose.w * noseScale, noseH = cfg.nose.h * noseScale;
  px(
    ctx,
    cfg.nose.x + hdx - (noseW - cfg.nose.w) / 2,
    cfg.nose.y + hdy + pose.bodyBob - (noseH - cfg.nose.h) / 2,
    noseW, noseH,
    cfg.nose.color || cfg.darkColor
  );

  // bellyUp deferred draw - see the comment where the normal-order call
  // above was skipped. Drawn last so the raised legs sit in front of the
  // whole body/head silhouette instead of being swallowed by it.
  if (bellyUp) {
    if (cfg.legBackW > 0) drawLegPair(ctx, cfg, pose, false, legY);
    if (cfg.legFrontW > 0) drawLegPair(ctx, cfg, pose, true, legY);
  }

  ctx.restore();
}

function drawShadow(ctx, cfg) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  const w = cfg.bodyW * 0.8, h = 1.4;
  const x = cfg.bodyX + (cfg.bodyW - w) / 2 + (cfg.headW) * 0.15;
  ctx.beginPath();
  ctx.ellipse((x + w / 2) * PX, (GROUND_Y + 1) * PX, (w / 2) * PX, (h / 2) * PX, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------
// Idle behaviors - each is a pure function of (pose, t, duration). Same
// role as the 3D version's IDLE_BEHAVIORS: species opt into a weighted
// pool of these instead of one fixed "special" move.
// ---------------------------------------------------------------------
const IDLE_BEHAVIORS = {
  groom: {
    duration: () => randRange(1.6, 2.4),
    apply(pose, t) {
      pose.headDY = 2 + Math.sin(t * 5) * 0.4;
      pose.headDX = -0.5;
      pose.frontLegRaise = 1;
      pose.eyesClosed = 0.3;
    },
  },
  stretch: {
    duration: () => randRange(1.3, 1.7),
    apply(pose, t, duration) {
      const amt = t > duration - 0.4 ? lerp(1, 0, clamp01((t - (duration - 0.4)) / 0.4)) : clamp01(t / 0.5);
      pose.frontLegExtend = amt;
      pose.bodyBob = -amt * 1.2;
      pose.headDY = -amt * 0.6;
    },
  },
  // Real sit postures differ enough by body plan that one shared pose
  // doesn't read right for all of them - see cfg.sitStyle (set per SPECIES
  // entry below) and the branches here. `cfg` is the species config,
  // passed as apply()'s 4th argument (see update() in createAnimal) - every
  // other idle behavior above ignores it, only sit reads it.
  sit: {
    duration: () => randRange(2.2, 4),
    apply(pose, t, duration, cfg) {
      const s = clamp01(t / 0.4);
      const style = (cfg && cfg.sitStyle) || 'loaf';
      if (style === 'haunches') {
        // Dogs: real "sit" is hindquarters down, front legs straight and
        // still supporting the raised chest - only the back legs fold,
        // the front stays at its normal standing angle (legsTuckedFront
        // left at 0, so legJointAngles just uses the idle-standing knee
        // bend every other non-tucking idle already renders with).
        //
        // The leg-angle asymmetry alone turned out too subtle to read at
        // this scale - the tucked-up hind leg's paw barely clears the
        // body's own bottom edge (legY), so it mostly disappears behind
        // the body rect (drawn after the legs) instead of visibly folding,
        // especially on the short-legged breeds (corgi/dachshund).
        // Rendered screenshots confirmed this (see CLAUDE.md) - the fix is
        // a small backward-leaning tilt of the WHOLE creature (reusing
        // waddleTilt - degrees, otherwise dead code since no current
        // species uses the 'waddle' gait it was named for) on top of the
        // leg asymmetry, not instead of it. Negative because pose.rollAngle
        // /waddleTilt's rotation pivots the creature such that a positive
        // angle swings the head side (high x) DOWN (see drawCreature) - sit
        // wants the opposite: chest/head up, haunches down.
        pose.legsTuckedBack = s * 0.95;
        pose.legsTuckedFront = 0;
        pose.bodyBob = s * 1.0;
        pose.headDY = -s * 0.3;
        pose.waddleTilt = -s * 9;
      } else if (style === 'loafNoLegs') {
        // Rabbit: a tight loaf where the hind legs (already the dominant,
        // deeply-folding pair - see joints.back.tuckHip/tuckKnee) tuck
        // all the way under so they read as fully hidden, front legs
        // (already small) tuck partway rather than fully so they don't
        // vanish into the silhouette entirely.
        pose.legsTuckedBack = s;
        pose.legsTuckedFront = s * 0.7;
        pose.bodyBob = s * 1.8;
      } else if (style === 'roundPuff') {
        // Hamster: a smaller, gentler settle (its legs are already tiny
        // stubs, so a full tuck wouldn't read as anything new) plus a
        // slight constant cheek-puff so it looks like it's settled in
        // with its pouches a little full, harmonizing with the separate
        // 'cheekpuff' idle rather than looking unrelated to it.
        pose.legsTuckedFront = s * 0.5;
        pose.legsTuckedBack = s * 0.6;
        pose.bodyBob = s * 1.0;
        pose.cheekPuff = s * 0.25;
      } else {
        // 'loaf' (cats, default) - unchanged from the original shared sit:
        // all 4 legs tuck together into a rounded, bread-loaf crouch.
        pose.legsTuckedFront = s * 0.8;
        pose.legsTuckedBack = s * 0.8;
        pose.bodyBob = s * 1.6;
        pose.headDY = Math.sin(t * 1.1) * 0.3;
      }
    },
  },
  sleep: {
    duration: () => randRange(5, 9),
    apply(pose, t) {
      const s = clamp01(t / 0.7);
      pose.legsTuckedFront = s;
      pose.legsTuckedBack = s;
      pose.bodySquash = s;
      pose.bodyBob = s * 2 + Math.sin(t * 1.4) * 0.2 * s;
      pose.headDY = s * 1.4;
      pose.headDX = -s * 1.5;
      pose.eyesClosed = s;
    },
  },
  earflick: {
    duration: () => randRange(0.8, 1.3),
    apply(pose, t) {
      pose.earFlick = Math.sin(t * 16) * Math.exp(-t * 3.5) * 1.4;
    },
  },
  // The calm "default" state - just standing there breathing, no other
  // motion. Added because every idle behavior before this one was always
  // an active flourish (groom/stretch/sit/...), so the pet was
  // constantly doing SOMETHING - pickIdleBehavior always draws a named
  // behavior from the pool, there was never a genuine "nothing in
  // particular" state to fall back to (see CLAUDE.md - 산만하다는 피드
  // 백). This is deliberately the plainest possible behavior (one gentle
  // sine on bodyBob/headDY for a chest-rise, nothing else) given a much
  // longer duration and a dominant weight in every species' idlePool
  // (added below in SPECIES) so it's what the pet is doing most of the
  // time, with the other behaviors as occasional punctuation rather than
  // constant background noise.
  breathe: {
    duration: () => randRange(7, 13),
    apply(pose, t) {
      pose.bodyBob = Math.sin(t * 1.1) * 0.3;
      pose.headDY = Math.sin(t * 1.1 + 0.4) * 0.15;
    },
  },
  // ROLLOVER DELETED (see CLAUDE.md's rollover-deletion note for the full
  // history) - every redesign attempt broke in a new way (handstand-
  // looking rigid rotation, a see-saw body wobble, legs that traced a
  // "rowing" loop, and finally a pose that looked ambiguous mid-blend
  // into/out of it - possibly eyesClosed or the crossfade catching it at
  // an awkward in-between moment). Replaced with bellyUp: a deliberately
  // STATIC pose - lying on its back, legs up - with no time-based
  // animation anywhere in it (no rollAngle, no oscillating leg angles).
  // A constant target has no dynamics left to go wrong, which is the
  // entire point after several dynamic designs each failed differently.
  // eyesClosed is set explicitly (not just left at defaultPose's 0) so a
  // crossfade in from 'sleep' (which drives eyesClosed toward 1) can't
  // leave this pose looking like it's ambiguously half-asleep once the
  // blend settles - bellyUp's eyes are simply always open.
  bellyUp: {
    duration: () => randRange(4, 7),
    apply(pose, t) {
      const s = clamp01(t / 0.6); // ramp in once, then hold - same simple pattern 'sleep' already uses, not a continuous oscillation
      pose.bodySquash = s * 0.85;
      pose.bodyBob = s * 1.6;
      pose.bellyUp = s; // legs flip to a fixed up angle - see legJointAngles
      pose.headDY = s * 0.5;
      pose.headDX = -s * 0.3;
      pose.eyesClosed = 0;
    },
  },
  cheekpuff: {
    // A single fill-then-empty arc over the whole duration (hamster
    // stuffing then unloading its cheek pouches) rather than a continuous
    // in/out oscillation - reads as one clear action instead of jittering.
    duration: () => randRange(1.6, 2.4),
    apply(pose, t, duration) {
      pose.cheekPuff = Math.sin(clamp01(t / duration) * Math.PI) * 0.9;
    },
  },
  // Not in any species' idlePool - only ever entered/exited explicitly via
  // animal.setHeld(), the same pinned-override pattern forceSleep() uses
  // (see pinnedHeld in updateBehaviorState). Two parts: an immediate
  // squish on the way in (a fast-decaying pulse added on top of a mild
  // settled squash, so it reads as "quick squeeze that eases off" rather
  // than "stays squashed the whole time"), and everything else hanging
  // loose - legs via pose.dangle (see legJointAngles), head drooped, ears/
  // tail given a slow sway instead of their usual walk/idle motion.
  held: {
    duration: () => 1e9,
    apply(pose, t) {
      const squishPulse = Math.exp(-t * 8) * 0.5;
      pose.bodySquash = clamp01(0.12 + squishPulse);
      pose.dangle = 1;
      pose.dangleSway = Math.sin(t * 1.6) * 9;
      pose.headDY = 0.7 + Math.sin(t * 1.3) * 0.2;
      pose.headDX = -0.4;
      pose.earFlick = Math.sin(t * 1.9) * 0.7;
      pose.tailOverride = true; // see updateTailFlavor - otherwise it stomps this right back to the species' normal wag/swish
      pose.tailPhase = t * 1.1;
      pose.tailAmp = 0.7;
    },
  },
  // Tail-tip-only twitch (cats): a quick flick concentrated at the tip
  // rather than the whole tail swishing - the per-segment wave amplitude
  // in drawCreature already grows toward the tip (6 + i*5), so a short,
  // fast, hard-decaying burst here reads as "just the last joint or two
  // flicking" without needing any separate rendering path.
  tailtwitch: {
    duration: () => randRange(1.2, 2),
    apply(pose, t) {
      pose.tailOverride = true;
      pose.tailPhase = t * 14;
      pose.tailAmp = Math.exp(-t * 2.2) * 1.3;
    },
  },
  // Rabbit: a slower, held ear swivel (as if orienting toward a sound)
  // rather than earflick's quick sine-decay startle - same pose.earFlick
  // field, just a different time curve: rises, holds, releases.
  earalert: {
    duration: () => randRange(1.5, 2.5),
    apply(pose, t, duration) {
      const rise = clamp01(t / 0.3);
      const fall = t > duration - 0.4 ? clamp01((t - (duration - 0.4)) / 0.4) : 0;
      pose.earFlick = lerp(0, 1.6, rise) * (1 - fall);
    },
  },
  // Rabbit: rapid tiny nose twitching (see noseTwitch pose field / the
  // nose draw call in drawCreature) plus a faint whisker-adjacent ear
  // tremor so it doesn't read as a fully static body while just the nose
  // moves.
  nosetwitch: {
    duration: () => randRange(1, 1.6),
    apply(pose, t) {
      pose.noseTwitch = clamp01(0.5 + Math.sin(t * 13) * 0.5);
      pose.earFlick = Math.sin(t * 13) * 0.25;
    },
  },
};

function pickIdleBehavior(spec) {
  const pool = spec.idlePool;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return instantiateIdle(e.name);
  }
  return instantiateIdle(pool[pool.length - 1].name);
}
function instantiateIdle(name) {
  const def = IDLE_BEHAVIORS[name];
  return { name, apply: def.apply, duration: def.duration() };
}

// ---------------------------------------------------------------------
// Gait: drives pose.legPhase/bodyBob/tailSwing/hopY continuously while
// walking. Every gait reports {advance}, world-space (px) distance to
// move this tick, so bursty gaits (hop) and continuous ones (walk/trot)
// look identical from the caller's point of view.
// ---------------------------------------------------------------------
function updateContinuousGait(anim, dt, moving, opts) {
  anim.clock += moving ? dt : 0;
  const w = anim.clock * opts.freq * Math.PI * 2;
  if (moving) {
    anim.pose.legPhase = Math.sin(w);
    anim.pose.bodyBob = -Math.abs(Math.sin(w * 2)) * opts.bob;
    anim.pose.legsTuckedFront = 0;
    anim.pose.legsTuckedBack = 0;
    if (opts.waddle) anim.pose.waddleTilt = Math.sin(w) * opts.waddle;
  } else {
    anim.pose.legPhase *= 0.8;
    anim.pose.bodyBob *= 0.8;
    anim.pose.waddleTilt *= 0.8;
  }
  return moving ? opts.speed * dt : 0;
}

function updateHopGait(anim, dt, moving, opts) {
  if (!moving) {
    anim.hopClock = 0;
    anim._prevCum = 0;
    anim.pose.hopY *= 0.7;
    anim.pose.legsTuckedFront *= 0.7;
    anim.pose.legsTuckedBack *= 0.7;
    return 0;
  }
  anim.hopClock += dt;
  const T = opts.period;
  const fTotal = anim.hopClock / T;
  const cycleIndex = Math.floor(fTotal);
  const f = fTotal - cycleIndex;

  let y = 0, tuck = 0;
  if (f < 0.15) {
    tuck = lerp(0, 0.5, f / 0.15);
  } else if (f < 0.65) {
    const af = (f - 0.15) / 0.5;
    y = Math.sin(af * Math.PI) * opts.height;
    tuck = 0.6;
  } else {
    tuck = lerp(0.6, 0, (f - 0.65) / 0.35);
  }
  anim.pose.hopY = -y;
  anim.pose.bodyBob = -y;
  anim.pose.legsTuckedFront = tuck;
  anim.pose.legsTuckedBack = tuck;
  anim.pose.earFlick = -y * 0.5;

  const cum = cycleIndex * opts.stride + opts.stride * smoothstep((f - 0.15) / 0.5);
  const advance = Math.max(0, cum - anim._prevCum);
  anim._prevCum = cum;
  return advance;
}

// gaitTuning (optional per-species, e.g. { bob: 1.8 }): lets a species
// nudge just one or two numbers on top of its gait preset instead of
// needing a whole new named preset for every nuance - e.g. dachshund wants
// 'trot's timing but a much flatter bounce ("low glide"), pomeranian wants
// the opposite (extra bounce, "bouncing walk"). Species that don't set one
// get the preset's own defaults unchanged.
function gaitOpts(anim, defaults) {
  return { ...defaults, ...(anim.spec.gaitTuning || {}), speed: anim.spec.speed };
}

const GAIT_PRESETS = {
  walk: (anim, dt, moving) => updateContinuousGait(anim, dt, moving, gaitOpts(anim, { freq: 1.4, bob: 0.9 })),
  trot: (anim, dt, moving) => updateContinuousGait(anim, dt, moving, gaitOpts(anim, { freq: 2.1, bob: 1.3 })),
  waddle: (anim, dt, moving) => updateContinuousGait(anim, dt, moving, gaitOpts(anim, { freq: 1.0, bob: 0.6, waddle: 9 })),
  scamper: (anim, dt, moving) => updateContinuousGait(anim, dt, moving, gaitOpts(anim, { freq: 3.2, bob: 0.5 })),
  hop: (anim, dt, moving) => updateHopGait(anim, dt, moving, { period: 0.62, height: 4, stride: anim.spec.speed }),
};

function updateTailFlavor(anim, elapsed, walking) {
  const spec = anim.spec;
  if (!spec.hasTail) return;
  // tailOverride (set by an idle behavior's apply(), e.g. 'held' or
  // 'tailtwitch'): this function runs *after* that apply() every frame
  // (see update() below), so without this check it would immediately
  // overwrite whatever tailPhase/tailAmp the behavior just set with the
  // species' normal wag/swish rate instead of the behavior-specific motion
  // it was actually going for.
  if (anim.pose.tailOverride) return;
  if (spec.wagTail) {
    anim.pose.tailPhase = elapsed * 9;
    anim.pose.tailAmp = 1.2;
  } else if (spec.swishTail) {
    anim.pose.tailPhase = elapsed * 1.6;
    anim.pose.tailAmp = walking ? 1 : 0.5;
  } else {
    // Stub tails (rabbits): near-rigid, just a faint idle twitch rather
    // than a full swish/wag.
    anim.pose.tailPhase = elapsed * 1.6;
    anim.pose.tailAmp = 0.15;
  }
}

// ---------------------------------------------------------------------
// Every entry into a new behavior goes through one of these two helpers,
// which always reset anim.pose to a clean defaultPose() first. This is
// the fix for the tail/ear "cut off or gappy" glitch: each idle behavior's
// apply() only sets the handful of pose fields it actually cares about
// (e.g. earflick only touches earFlick), so any field left over from
// whatever behavior played *before* it - a still-partway rollAngle from a
// rollover interrupted by a poke, a stuck legsTucked from a sit that got
// cut short by the patrol edge - used to keep rendering every frame after.
// A stray rollAngle rotates the whole creature around a pivot near its
// body center on a canvas with almost no margin, so the tail (far to one
// side) or the ears (at the top of a canvas only 80px tall) swing past the
// canvas edge and get clipped; a stray legsTucked could shrink a leg's
// drawn height to 0. Resetting on every transition (not just idle->walk,
// which is all the original code did) means a new behavior always starts
// from a known-zero baseline and only ever shows fields it's actually
// driving.
// ---------------------------------------------------------------------
// lookDX/lookDY are the one exception to "every transition gets a clean
// defaultPose()" above: they're not owned by any idle behavior's apply()
// at all (see updateCursorAlertTrigger/applyCursorLookEasing) but by a
// completely separate, always-running system driven by setCursorHint(),
// so resetting them here would fight that system instead of protecting
// against a stale value the way resetting rollAngle/legsTucked/etc. does.
// Confirmed this mattered, not just in theory: without this preservation,
// a species whose idle durations are short (earflick alone is 0.8-1.3s)
// could cycle through several transitions before the cursor-look easing
// (time-to-95%-converged ~0.5s at LOOK_EASE_RATE=6) ever finished
// recovering from the previous reset, so lookDX sat well short of its
// target (e.g. -0.13 instead of ~-0.8 after a full 2s of a steady cursor
// hint) far more often than not - a visible sawtooth/stutter in the
// tracking instead of a smooth follow.
// Snapshots the pose about to be discarded (transitionFrom) and restarts
// the crossfade clock (transitionElapsed) before resetting - see
// applyPoseCrossfade below, called from update() every frame afterward to
// blend from this snapshot toward whatever the new behavior computes,
// instead of the instant pop a bare defaultPose() reset used to produce
// (see CLAUDE.md - 포즈 전환이 뚝뚝 끊기는 문제). If a transition happens
// again before the previous crossfade finished, this just re-snapshots
// the CURRENT (still mid-blend) pose and restarts the timer - the blend
// naturally chains from wherever it already was, no discontinuity.
function resetPose(anim) {
  const { lookDX, lookDY } = anim.pose;
  anim.transitionFrom = anim.pose;
  anim.transitionElapsed = 0;
  anim.pose = defaultPose();
  anim.pose.lookDX = lookDX;
  anim.pose.lookDY = lookDY;
}

function enterIdle(anim, idle) {
  resetPose(anim);
  anim.behaviorState = 'idle';
  anim.behaviorTimer = 0;
  anim.currentIdle = idle;
}

// Movement policy history (see CLAUDE.md for the full narrative): this
// engine went from "constant left-right patrol" (walk/idle alternating
// every few seconds) to "mostly parked, occasional short walk" (an
// idle-time accumulator gating rare short bursts) to now - fully
// cursor-reactive, no autonomous movement at all. enterWalk() and the
// 'walk' behaviorState/GAIT_PRESETS/species gait+speed+walkMin/walkMax
// fields are deliberately left in place rather than torn out - the whole
// walk-capable substrate (gait rendering, pet.js's position/bounds/
// direction plumbing) is still fully working and unrelated to *whether*
// something ever calls enterWalk(), so ripping it all out would be a much
// bigger, riskier change than what was actually asked (stop the pet from
// moving on its own) for zero behavioral benefit - same reasoning as
// keeping cfg.joints.neckLen (now-unused for geometry) documented further
// up rather than deleted. Nothing currently calls enterWalk(); it stays as
// a dormant, ready-to-use hook if autonomous movement (e.g. a deliberate
// "approach the cursor" feature) ever comes back.
function enterWalk(anim) {
  resetPose(anim);
  anim.behaviorState = 'walk';
  anim.behaviorTimer = 0;
  anim.walkDuration = randRange(anim.spec.walkMin, anim.spec.walkMax);
}

// Cursor-look: how much the head/eyes turn toward the cursor (LOOK_MAX, in
// grid units - small and subtle, not a big dramatic snap) and how fast
// that offset eases toward its target (LOOK_EASE_RATE, in the same
// 1-exp(-dt*rate) form the drag spring/other easings in this codebase
// don't use, but is the standard cheap frame-rate-independent exponential
// approach here). ALERT_BEHAVIOR_PRIORITY picks which of a species' own
// idlePool behaviors reads as "alert/startled" for the one-shot reaction
// when the cursor gets close (see updateCursorLook) - preferring a
// species' own signature alert move (rabbit's earalert, cat's tailtwitch)
// over the generic earflick every species has, so the reaction still
// feels species-specific rather than identical across all 10.
const LOOK_MAX = 0.8;
const LOOK_EASE_RATE = 6;
const ALERT_BEHAVIOR_PRIORITY = ['earalert', 'tailtwitch', 'nosetwitch', 'earflick'];
function pickAlertBehaviorName(spec) {
  const names = spec.idlePool.map((e) => e.name);
  for (const name of ALERT_BEHAVIOR_PRIORITY) {
    if (names.includes(name)) return name;
  }
  return 'earflick'; // always present in every species' idlePool - guaranteed fallback
}

// Fires the one-shot alert reaction on the cursor's far->close transition
// only (not every frame it happens to stay close) - interrupts whatever
// idle is currently playing with the species' own alert-flavored behavior
// (pickAlertBehaviorName), then lets normal idle cycling resume on its own
// once that plays out (whether or not the cursor has actually left yet)
// rather than needing a separate persistent "alert mode" to explicitly
// exit. Called BEFORE updateBehaviorState in update() - same reason
// poke()/setHeld() always trigger their transitions ahead of that frame's
// state-machine tick, so updateBehaviorState immediately sees (and does
// nothing further to) the freshly-entered behavior. Suppressed while
// pinnedSleep/pinnedHeld (asleep or being dragged - neither should react
// to a cursor it isn't "aware of").
function updateCursorAlertTrigger(anim, allowedToMove) {
  const suppressed = anim.pinnedSleep || anim.pinnedHeld;
  const hint = suppressed ? null : anim.cursorHint;
  const isClose = allowedToMove && !suppressed && !!(hint && hint.close);
  if (isClose && !anim.wasCursorClose) {
    enterIdle(anim, instantiateIdle(pickAlertBehaviorName(anim.spec)));
  }
  anim.wasCursorClose = isClose;
}

// Eases pose.lookDX/lookDY toward the current cursor hint (or back to 0 if
// there isn't one / it's suppressed by sleep/held). Called AFTER
// updateBehaviorState and the current idle's apply() in update() - the
// same ordering updateTailFlavor already uses for tailPhase/tailAmp, and
// for the same reason: any behavior transition this frame (an ordinary
// idle-to-idle cycle, or updateCursorAlertTrigger's own enterIdle call)
// resets the whole pose via defaultPose(), which would otherwise zero
// lookDX/lookY for one frame and force them to re-converge from scratch -
// running the easing afterward instead means a transition's reset gets
// corrected within the very same frame, so the look-offset never visibly
// blips back to center on every idle-pool reshuffle.
function applyCursorLookEasing(anim, dt) {
  const suppressed = anim.pinnedSleep || anim.pinnedHeld;
  const hint = suppressed ? null : anim.cursorHint;
  const targetX = hint ? clamp(hint.dx, -1, 1) * LOOK_MAX : 0;
  const targetY = hint ? clamp(hint.dy, -1, 1) * LOOK_MAX : 0;
  const ease = 1 - Math.exp(-dt * LOOK_EASE_RATE);
  anim.pose.lookDX = lerp(anim.pose.lookDX, targetX, ease);
  anim.pose.lookDY = lerp(anim.pose.lookDY, targetY, ease);
}

// Crossfades the pose over the first POSE_TRANSITION_DURATION seconds
// after a behavior transition, instead of the instant pop resetPose's
// defaultPose() call used to produce on its own (see CLAUDE.md - 포즈
// 전환이 뚝뚝 끊기는 문제). Called last in update(), after the current
// idle's apply() (and updateTailFlavor/applyCursorLookEasing) have
// already written this frame's target values into anim.pose - blends
// every numeric field from the pre-transition snapshot (transitionFrom,
// taken by resetPose) toward that target. Boolean fields (tailOverride)
// and anything resetPose didn't have a numeric counterpart for are left
// alone. A short 0.25s is enough to remove the visible snap without
// making transitions feel sluggish - shorter than the shortest idle
// duration in the roster (earflick's 0.8-1.3s) so it never eats a whole
// behavior's screen time.
const POSE_TRANSITION_DURATION = 0.25;
function applyPoseCrossfade(anim, dt) {
  if (anim.transitionElapsed >= POSE_TRANSITION_DURATION) return;
  const t = clamp01(anim.transitionElapsed / POSE_TRANSITION_DURATION);
  const from = anim.transitionFrom;
  for (const key in anim.pose) {
    const target = anim.pose[key];
    const start = from[key];
    if (typeof target !== 'number' || typeof start !== 'number') continue;
    anim.pose[key] = lerp(start, target, t);
  }
  anim.transitionElapsed += dt;
}

// ---------------------------------------------------------------------
// Behavior state machine - identical shape to the 3D version: alternates
// 'walk' (gait runs, advance can be > 0) and 'idle' (a species-flavored
// idle behavior plays, advance is always 0). allowedToMove=false (reminder
// bubble showing, or a patrol-edge bounce) forces idle regardless of the
// animal's own timer. pinnedSleep forces the sleep behavior indefinitely
// (system-idle tie-in) until explicitly woken. pinnedHeld (drag-to-move)
// outranks even pinnedSleep - if you grab a sleeping pet mid-nap it should
// dangle, not stay asleep in your hand.
// ---------------------------------------------------------------------
function updateBehaviorState(anim, dt, allowedToMove) {
  anim.behaviorTimer += dt;

  if (anim.pinnedHeld) {
    if (anim.behaviorState !== 'idle' || anim.currentIdle.name !== 'held') {
      enterIdle(anim, instantiateIdle('held'));
    }
    return anim.behaviorState;
  }

  if (anim.pinnedSleep) {
    if (anim.behaviorState !== 'idle' || anim.currentIdle.name !== 'sleep') {
      enterIdle(anim, { name: 'sleep', apply: IDLE_BEHAVIORS.sleep.apply, duration: 1e9 });
    }
    return anim.behaviorState;
  }

  if (!allowedToMove) {
    if (anim.behaviorState !== 'idle' || anim.behaviorTimer >= anim.currentIdle.duration) {
      enterIdle(anim, pickIdleBehavior(anim.spec));
    }
    return anim.behaviorState;
  }

  // 'walk' is never entered autonomously anymore (see the movement-policy
  // comment above enterWalk) - this branch is unreachable in practice, but
  // left as-is rather than deleted since anim.behaviorState could in
  // principle still be 'walk' if something external calls enterWalk().
  if (anim.behaviorState === 'walk') {
    if (anim.behaviorTimer >= anim.walkDuration) {
      enterIdle(anim, pickIdleBehavior(anim.spec));
    }
  } else if (anim.behaviorTimer >= anim.currentIdle.duration) {
    enterIdle(anim, pickIdleBehavior(anim.spec));
  }
  return anim.behaviorState;
}

// ---------------------------------------------------------------------
// Species table. Every rect/shape is given as an explicit grid-unit
// coordinate rather than derived from a smaller parameter set - with only
// ~10 characters and a 24x24 canvas, hand-placing is both simpler and safer
// than a derivation formula that then needs debugging per-species.
//
// Convention every entry here follows (learned the hard way from a rabbit
// whose legY sat above its own body's bottom edge and so got fully painted
// over by the body rect, drawn after the legs - see the "known limits"
// note in CLAUDE.md): legY must equal bodyY+bodyH exactly, so the leg hip
// pivot starts right at the body's bottom edge instead of inside it.
// ---------------------------------------------------------------------
const SPECIES = {
  cat_a: {
    label: '고양이 A',
    sitStyle: 'loaf', // see IDLE_BEHAVIORS.sit - cats loaf-sit, all 4 legs tucked
    bodyColor: '#e8935a', darkColor: '#2a1e16', eyeColor: '#2a1e16',
    bodyX: 4, bodyY: 13, bodyW: 13, bodyH: 6,
    headX: 15, headY: 9, headW: 7, headH: 7,
    snout: { x: 21, y: 12, w: 2, h: 3, color: '#f7e6c9' },
    belly: { x: 6, y: 17, w: 9, h: 2, color: '#f7e6c9' },
    pattern: [
      { x: 7, y: 13, w: 1, h: 6, color: '#c9743a' },
      { x: 10, y: 13, w: 1, h: 6, color: '#c9743a' },
      { x: 13, y: 13, w: 1, h: 6, color: '#c9743a' },
    ],
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#e8935a' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1 },
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#d9824a',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#e8935a' }, { x: 0, y: 12, w: 2, h: 2, color: '#e8935a' }, { x: 1, y: 10, w: 2, h: 2, color: '#e8935a' }],
    gait: 'walk', speed: 26,
    walkMin: 3.5, walkMax: 7.5,
    // Cat signature moves per real behavior: loaf-sitting, grooming,
    // tail-tip flicking, stretching - see CLAUDE.md for the research this
    // roster's idlePools are based on. cat_a leans groom-heavy (a
    // fastidious tabby).
    idlePool: [{ name: 'groom', weight: 3 }, { name: 'sit', weight: 2.5 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 1.5, lowerLen: 1.5, swingAmp: 18, kneeSwingAmp: 14, tuckHip: 15, tuckKnee: 125 },
      back: { upperLen: 1.6, lowerLen: 1.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 20, tuckKnee: 135 },
      neckLen: 1.8, neckW: 1.2,
    },
  },
  cat_tuxedo: {
    // Redesigned from assets/reference/tuxedo-cat-reference.jpg (the
    // earlier version was a generic bicolor guess, not based on a photo).
    // Reference shows: a face blaze that's centered/symmetric rather than
    // off to one side - forehead/ears/eye-surrounds black, a white
    // diamond-ish blaze running down the center from between the eyes
    // through the nose and mouth; mostly-black body; broad white chest;
    // white only at the very end of each leg (paws); black tail, bushier
    // at the tip. Pink nose, green-gold eyes.
    //
    // Translating a front-facing portrait into this engine's side-view
    // sprite: a "centered vertical blaze down the face" in profile is just
    // a light patch running down the FRONT edge of the head from eye-
    // height to chin-height - which is exactly what the `snout` field
    // already draws (see the array-of-patches support added for this),
    // just bigger and tapered (narrow near the eye, widest at the chin)
    // instead of the small single-rect nose-bridge patch other cats use.
    label: '고양이 (턱시도)',
    sitStyle: 'loaf',
    bodyColor: '#161616', darkColor: '#000000', eyeColor: '#b9cf4a',
    bodyX: 4, bodyY: 13, bodyW: 13, bodyH: 6,
    headX: 15, headY: 9, headW: 7, headH: 7,
    snout: [
      { x: 20, y: 12, w: 1.5, h: 2, color: '#ffffff' },
      { x: 19, y: 14, w: 3, h: 2, color: '#ffffff' },
    ],
    belly: { x: 6, y: 16, w: 10, h: 3, color: '#ffffff' },
    pattern: [{ x: 12, y: 13, w: 5, h: 3, color: '#ffffff' }],
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#161616' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1, color: '#d99a9e' },
    // legColor used to be pure white (the whole leg, thigh included) - the
    // reference photo (see comment above) is explicit that only the very
    // end of each leg (the paw) is white, the rest is body-black. Fixed by
    // making legColor match the body again and adding pawColor (see
    // drawLegChain) to cover just the last PAW_FRACTION_DEFAULT of the
    // lower leg bone in white instead - this is the case pawColor was
    // added for.
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#161616', pawColor: '#ffffff',
    hasTail: true, swishTail: true,
    // Last segment noticeably bigger than the others - a bushy tip without
    // needing any new rendering technique, just a wider/taller final bone.
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#161616' }, { x: 0, y: 12, w: 2, h: 2, color: '#161616' }, { x: -1, y: 9, w: 3, h: 3, color: '#161616' }],
    gait: 'walk', speed: 25,
    walkMin: 3.5, walkMax: 7.5,
    idlePool: [{ name: 'groom', weight: 3 }, { name: 'sit', weight: 2.5 }, { name: 'tailtwitch', weight: 2 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 1.5, lowerLen: 1.5, swingAmp: 18, kneeSwingAmp: 14, tuckHip: 15, tuckKnee: 125 },
      back: { upperLen: 1.6, lowerLen: 1.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 20, tuckKnee: 135 },
      neckLen: 1.8, neckW: 1.2,
    },
  },
  cat_calico: {
    // White base with unordered black + orange patches - the classic
    // calico signature is the patches themselves being asymmetric/random,
    // so unlike every other species here the two ears are deliberately
    // different colors (color2, see drawEarPointy) rather than mirrored.
    label: '고양이 (삼색이)',
    sitStyle: 'loaf',
    bodyColor: '#faf3e6', darkColor: '#2a2018', eyeColor: '#3a8f4a',
    bodyX: 4, bodyY: 13, bodyW: 13, bodyH: 6,
    headX: 15, headY: 9, headW: 7, headH: 7,
    snout: { x: 21, y: 13, w: 2, h: 2, color: '#faf3e6' },
    belly: null,
    pattern: [
      { x: 6, y: 13, w: 4, h: 4, color: '#242320' },
      { x: 12, y: 15, w: 4, h: 4, color: '#d97a34' },
    ],
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#242320', color2: '#d97a34' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1 },
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#faf3e6',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#faf3e6' }, { x: 0, y: 12, w: 2, h: 2, color: '#242320' }, { x: 1, y: 10, w: 2, h: 2, color: '#d97a34' }],
    gait: 'walk', speed: 24,
    walkMin: 3.5, walkMax: 7.5,
    idlePool: [{ name: 'stretch', weight: 3 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'groom', weight: 2 }, { name: 'sit', weight: 2.5 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 1.5, lowerLen: 1.5, swingAmp: 18, kneeSwingAmp: 14, tuckHip: 15, tuckKnee: 125 },
      back: { upperLen: 1.6, lowerLen: 1.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 20, tuckKnee: 135 },
      neckLen: 1.8, neckW: 1.2,
    },
  },
  cat_siamese: {
    // Pale cream body with dark seal-brown "points" on ears/face/paws/tail
    // and blue eyes - the points use headColor (new field, see drawCreature)
    // for the face since that's a genuinely different color from the body,
    // not just a patch on top of it.
    label: '고양이 (샴)',
    sitStyle: 'loaf',
    bodyColor: '#e8d9bb', darkColor: '#2a1c14', eyeColor: '#5aa7d6',
    headColor: '#5c4636',
    // Colorpoint gradient on the FACE, not the body (moved here from an
    // earlier body-only version, then from a flat-band approximation to a
    // real radial one - see CLAUDE.md) - darkest right around the eyes/
    // nose/mouth (default focus = eye position), lighter outward toward
    // the forehead/cheek edge as distance approaches `radius`.
    faceShade: { highlight: '#a9825f', radius: 6.5 },
    bodyX: 4, bodyY: 13, bodyW: 13, bodyH: 6,
    headX: 15, headY: 9, headW: 7, headH: 7,
    snout: null,
    belly: null,
    pattern: null,
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#5c4636' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1 },
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#5c4636',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#e8d9bb' }, { x: 0, y: 12, w: 2, h: 2, color: '#5c4636' }, { x: 1, y: 10, w: 2, h: 2, color: '#5c4636' }],
    gait: 'walk', speed: 27,
    walkMin: 3.5, walkMax: 7.5,
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'groom', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1.5 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 1.5, lowerLen: 1.5, swingAmp: 18, kneeSwingAmp: 14, tuckHip: 15, tuckKnee: 125 },
      back: { upperLen: 1.6, lowerLen: 1.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 20, tuckKnee: 135 },
      neckLen: 1.8, neckW: 1.2,
    },
  },
  dog_dachshund: {
    // Repurposed from the original single "dog" entry (same floppy ear
    // style + a close relative of its tan palette) rather than kept as a
    // separate generic dog - stretched drastically long and low, which is
    // the one unmistakable dachshund trait.
    label: '강아지 (닥스훈트)',
    sitStyle: 'haunches', // see IDLE_BEHAVIORS.sit - dogs sit on their haunches: back legs fold, front legs stay standing
    bodyColor: '#a8562e', darkColor: '#2e1810', eyeColor: '#2e1810',
    shade: { highlight: '#c97b4a', bandH: 1.5 },
    bodyX: 1, bodyY: 16, bodyW: 19, bodyH: 5,
    headX: 17, headY: 13, headW: 6, headH: 6,
    snout: { x: 22, y: 16, w: 2, h: 2, color: '#c97b4a' },
    belly: { x: 4, y: 19, w: 13, h: 2, color: '#c97b4a' },
    pattern: null,
    earStyle: 'floppy', ear: { gap: 0, w: 3, h: 7, color: '#8a3f1f' },
    eye: { x: 21, y: 15, w: 2, h: 2 }, nose: { x: 23, y: 17, w: 1, h: 1 },
    legFrontX: 17, legBackX: 4, legY: 21, legH: 2, legFrontW: 2, legBackW: 2, legColor: '#a8562e',
    hasTail: true, wagTail: true,
    tail: [{ x: 0, y: 17, w: 2, h: 2, color: '#a8562e' }],
    // "낮은 자세로 스윽 이동" - a long low dog reads as gliding when the
    // usual trot bounce (bob:1.3) is flattened way down, not when it's
    // bouncing like everything else.
    gait: 'trot', speed: 30, gaitTuning: { bob: 0.35 },
    walkMin: 2.8, walkMax: 6,
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'earflick', weight: 2 }, { name: 'sleep', weight: 1.5 }, { name: 'stretch', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 0.7, lowerLen: 0.7, swingAmp: 22, kneeSwingAmp: 16, tuckHip: 50, tuckKnee: 70 },
      back: { upperLen: 0.7, lowerLen: 0.7, swingAmp: 26, kneeSwingAmp: 20, tuckHip: 55, tuckKnee: 80 },
      neckLen: 1.6, neckW: 1.3,
    },
  },
  dog_corgi: {
    // Short legs (tiny upperLen/lowerLen), long-ish body, big rounded-
    // triangle ears (drawEarPointy just at a larger scale than any cat's),
    // and no tail at all - Pembroke Welsh Corgis are naturally bobtailed,
    // which is also a distinctive enough trait to help tell it apart from
    // every other short-legged dog here at a glance.
    label: '강아지 (코기)',
    sitStyle: 'haunches',
    bodyColor: '#d9a15c', darkColor: '#3a2418', eyeColor: '#3a2418',
    bodyX: 2, bodyY: 15, bodyW: 15, bodyH: 6,
    headX: 16, headY: 10, headW: 7, headH: 7,
    snout: { x: 22, y: 13, w: 2, h: 3, color: '#f5ead9' },
    belly: { x: 4, y: 19, w: 11, h: 2, color: '#f5ead9' },
    pattern: [{ x: 14, y: 15, w: 5, h: 4, color: '#f5ead9' }],
    earStyle: 'pointy', ear: { gap: 4, w: 4, h: 5, tipDX: 0.3, color: '#d9a15c', inner: '#f5ead9' },
    eye: { x: 21, y: 12, w: 2, h: 2 }, nose: { x: 23, y: 14, w: 1, h: 1 },
    legFrontX: 16, legBackX: 4, legY: 21, legH: 2, legFrontW: 2, legBackW: 2, legColor: '#f5ead9',
    hasTail: false,
    tail: null,
    // "짧은 다리로 종종거림" - scamper is the fast-turnover gait (freq 3.2
    // vs trot's 2.1) already used for hamster; short legs + quick steps is
    // exactly the corgi trait being aimed for here.
    gait: 'scamper', speed: 30,
    walkMin: 2.8, walkMax: 6,
    // bellyUp (see IDLE_BEHAVIORS.bellyUp) doesn't depend on a tail to
    // read - corgi has hasTail:false and none of bellyUp's fields
    // (bodySquash/bellyUp leg angle) reference the tail at all.
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 2.5 }, { name: 'sleep', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 0.6, lowerLen: 0.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 45, tuckKnee: 65 },
      back: { upperLen: 0.6, lowerLen: 0.6, swingAmp: 24, kneeSwingAmp: 18, tuckHip: 50, tuckKnee: 75 },
      neckLen: 1.6, neckW: 1.4,
    },
  },
  dog_husky: {
    // Gray body + white headColor face/chest, upright ears, blue eyes, and
    // a tail authored to curl up and forward over the back at rest (see
    // the tail-chain comment in drawCreature - segment rest positions are
    // free-form, so "curled" is just a different shape than "trailing",
    // not a different code path) instead of hanging/swishing.
    label: '강아지 (허스키)',
    sitStyle: 'haunches',
    bodyColor: '#5c6670', darkColor: '#1c2024', eyeColor: '#7ec8e8',
    headColor: '#e8e6e0',
    bodyX: 3, bodyY: 12, bodyW: 14, bodyH: 8,
    headX: 16, headY: 8, headW: 7, headH: 7,
    snout: { x: 22, y: 11, w: 2, h: 3, color: '#e8e6e0' },
    belly: { x: 5, y: 18, w: 8, h: 2, color: '#e8e6e0' },
    pattern: [{ x: 15, y: 12, w: 3, h: 6, color: '#e8e6e0' }],
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 5, tipDX: 0.5, color: '#5c6670', inner: '#e8e6e0' },
    eye: { x: 21, y: 10, w: 2, h: 2 }, nose: { x: 23, y: 12, w: 1, h: 1 },
    legFrontX: 16, legBackX: 5, legY: 20, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#e8e6e0',
    hasTail: true, swishTail: false,
    tail: [
      { x: 2, y: 13, w: 2, h: 2, color: '#5c6670' },
      { x: 1, y: 10, w: 2, h: 2, color: '#5c6670' },
      { x: 3, y: 8, w: 2, h: 2, color: '#5c6670' },
      { x: 6, y: 8, w: 2, h: 2, color: '#e8e6e0' },
    ],
    gait: 'trot', speed: 42,
    walkMin: 2.5, walkMax: 5.5,
    // "쫑긋한 귀가 소리에 반응하듯 움찔거림" - earflick's sharp sine-decay
    // startle already reads exactly like that, so this is weighted well
    // above the other dogs' earflick weight to make it this species'
    // signature move rather than an occasional aside.
    idlePool: [{ name: 'earflick', weight: 3.5 }, { name: 'sit', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'sleep', weight: 1 }, { name: 'bellyUp', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 1.1, lowerLen: 1.1, swingAmp: 24, kneeSwingAmp: 18, tuckHip: 48, tuckKnee: 68 },
      back: { upperLen: 1.1, lowerLen: 1.1, swingAmp: 28, kneeSwingAmp: 22, tuckHip: 53, tuckKnee: 78 },
      neckLen: 1.9, neckW: 1.5,
    },
  },
  dog_pomeranian: {
    // Replaces the earlier pug entry. Husky already covers "spitz-type:
    // pointy ears + tail curled over the back," so this needed a silhouette
    // that reads differently at a glance despite sharing that same basic
    // ear/tail vocabulary - a round, fluffy "fur-ball" body (bodyW and
    // bodyH close to equal, unlike every other dog here which is wider
    // than it is tall) does that: husky reads lean/athletic, this reads
    // round/puffy. Cream/gold rather than husky's gray or any of the
    // existing warm oranges (cat_a, dachshund), and it's the second `shade`
    // dither species (see cat_siamese) - the checkerboard highlight along
    // the back doubles as a cheap texture cue for "fluffy" at this
    // resolution.
    label: '강아지 (포메라니안)',
    sitStyle: 'haunches',
    bodyColor: '#e8c896', darkColor: '#4a3527', eyeColor: '#2a1c14',
    shade: { highlight: '#f7ecd5', bandH: 2 },
    bodyX: 4, bodyY: 11, bodyW: 14, bodyH: 10,
    headX: 15, headY: 8, headW: 7, headH: 7,
    snout: { x: 21, y: 11, w: 2, h: 2, color: '#c9a06a' },
    belly: null,
    pattern: [{ x: 13, y: 11, w: 4, h: 5, color: '#f7ecd5' }],
    earStyle: 'pointy', ear: { gap: 3, w: 2.5, h: 3, tipDX: 0.5, color: '#e8c896' },
    eye: { x: 20, y: 10, w: 2, h: 2 }, nose: { x: 22, y: 12, w: 1, h: 1 },
    legFrontX: 15, legBackX: 6, legY: 21, legH: 2, legFrontW: 2, legBackW: 2, legColor: '#e8c896',
    hasTail: true, swishTail: false,
    // Curled up over the back like the husky's, but shorter/more compact -
    // a small tight puff rather than a long sweeping curl, matching a
    // pomeranian's stubbier plumed tail.
    tail: [
      { x: 3, y: 12, w: 2, h: 2, color: '#e8c896' },
      { x: 2, y: 9, w: 2, h: 2, color: '#e8c896' },
      { x: 4, y: 8, w: 3, h: 3, color: '#f7ecd5' },
    ],
    // "통통 튀듯 걷기" - extra vertical bounce on top of trot's own (1.3),
    // the opposite tuning from the dachshund's flattened glide above.
    gait: 'trot', speed: 34, gaitTuning: { bob: 2.2 },
    walkMin: 2.5, walkMax: 5.5,
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'earflick', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'sleep', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'breathe', weight: 12 }],
    joints: {
      front: { upperLen: 0.6, lowerLen: 0.6, swingAmp: 20, kneeSwingAmp: 16, tuckHip: 40, tuckKnee: 100 },
      back: { upperLen: 0.6, lowerLen: 0.6, swingAmp: 24, kneeSwingAmp: 18, tuckHip: 45, tuckKnee: 110 },
      neckLen: 1.0, neckW: 1.6,
    },
  },
  rabbit_b: {
    label: '토끼',
    sitStyle: 'loafNoLegs', // see IDLE_BEHAVIORS.sit - full loaf, hind legs tuck away enough to read as fully hidden
    bodyColor: '#f5efe4', darkColor: '#5a6b78', eyeColor: '#5a6b78',
    bodyX: 5, bodyY: 13, bodyW: 11, bodyH: 7,
    headX: 14, headY: 10, headW: 7, headH: 6,
    snout: { x: 19, y: 13, w: 2, h: 2, color: '#f0b9c6' },
    belly: null,
    pattern: [{ x: 5, y: 17, w: 4, h: 3, color: '#f5efe4' }],
    earStyle: 'long', ear: { gap: 1, w: 2, h: 6, color: '#f5efe4', inner: '#f0b9c6' },
    eye: { x: 18, y: 12, w: 2, h: 2 }, nose: { x: 20, y: 14, w: 1, h: 1 },
    legFrontX: 14, legBackX: 6, legY: 20, legH: 4, legFrontW: 2, legBackW: 3, legColor: '#f5efe4',
    hasTail: true, swishTail: false,
    tail: [{ x: 3, y: 15, w: 2, h: 2, color: '#ffffff' }],
    gait: 'hop', speed: 32,
    walkMin: 2, walkMax: 4.5,
    // "귀 방향 바꾸기(경계), 코 씰룩거리기" - earalert (a held swivel, as if
    // orienting toward a sound - distinct from the sharper earflick
    // startle) and nosetwitch (rapid sniffing) are this species' two
    // signature moves, weighted above the generic earflick/sit.
    idlePool: [{ name: 'earalert', weight: 3 }, { name: 'nosetwitch', weight: 2.5 }, { name: 'sit', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    // Rabbits fold at the hock, not the hip: the back leg is the one that
    // does almost all the work (big tuck range) while the front legs stay
    // short and nearly still - the opposite emphasis from cat/dog, where
    // front and back are closer to symmetric.
    joints: {
      front: { upperLen: 1.0, lowerLen: 0.8, swingAmp: 10, kneeSwingAmp: 8, tuckHip: 25, tuckKnee: 35 },
      back: { upperLen: 1.0, lowerLen: 1.6, swingAmp: 8, kneeSwingAmp: 6, tuckHip: 95, tuckKnee: 130 },
      neckLen: 0.6, neckW: 1.4,
    },
  },
  hamster: {
    // Redesigned rounder/chunkier - real hamsters read as almost no neck
    // (head fully merged into a big round body), very short stubby legs,
    // tiny ears, no visible tail, and big cheek pouches. The previous
    // version's body was barely bigger than its head, which read as
    // "generic small rodent" rather than specifically hamster-like.
    label: '햄스터',
    sitStyle: 'roundPuff', // see IDLE_BEHAVIORS.sit - gentle round settle + a slight cheek puff, harmonizing with 'cheekpuff'
    bodyColor: '#e3ab5f', darkColor: '#2e1a10', eyeColor: '#1c1008',
    bodyX: 4, bodyY: 12, bodyW: 13, bodyH: 9,
    headX: 14, headY: 10, headW: 7, headH: 7,
    snout: null,
    belly: { x: 6, y: 17, w: 8, h: 4, color: '#f9e2ba' },
    pattern: null,
    earStyle: 'round', ear: { gap: 3.5, w: 2, h: 2, color: '#c98f49' },
    eye: { x: 18, y: 12, w: 2, h: 2 }, nose: { x: 20, y: 14, w: 1, h: 1 },
    legFrontX: 14, legBackX: 6, legY: 21, legH: 2, legFrontW: 2, legBackW: 2, legColor: '#e3ab5f',
    hasTail: false,
    tail: null,
    cheeks: [{ x: 17, y: 12, w: 4, h: 4, color: '#f9e2ba' }],
    gait: 'scamper', speed: 26,
    walkMin: 1.8, walkMax: 3.8,
    idlePool: [{ name: 'cheekpuff', weight: 3 }, { name: 'sit', weight: 2 }, { name: 'earflick', weight: 2 }, { name: 'sleep', weight: 1 }, { name: 'breathe', weight: 12 }],
    // Even shorter/stubbier than before - little legs barely peek out from
    // under the round body, and a near-zero neck fits the "head fused into
    // the body" hamster silhouette.
    joints: {
      front: { upperLen: 0.5, lowerLen: 0.5, swingAmp: 26, kneeSwingAmp: 20, tuckHip: 65, tuckKnee: 100 },
      back: { upperLen: 0.6, lowerLen: 0.6, swingAmp: 28, kneeSwingAmp: 22, tuckHip: 75, tuckKnee: 110 },
      neckLen: 0.3, neckW: 1.4,
    },
  },
};

export const CHARACTERS = Object.keys(SPECIES).map((key) => ({ key, label: SPECIES[key].label }));

export function createAnimal(key) {
  const spec = SPECIES[key] || SPECIES.cat_a;
  const anim = {
    spec,
    pose: defaultPose(),
    clock: 0,
    hopClock: 0,
    _prevCum: 0, // must exist before the first update() - hop gait starts "moving" and never passes through the !moving seeding branch on frame 1
    // Starts parked (idle), not mid-patrol - see the movement-policy
    // comment above updateBehaviorState. Unlike the old 'walk' initial
    // state (where currentIdle could safely stay null until the first
    // walk->idle transition, since the 'walk' branch never reads it),
    // starting in 'idle' means update()'s very first call reads
    // currentIdle.apply() immediately - so it has to be a real idle
    // behavior from construction, not null.
    behaviorState: 'idle',
    behaviorTimer: 0,
    walkDuration: 0,
    currentIdle: pickIdleBehavior(spec),
    pinnedSleep: false,
    pinnedHeld: false,
    cursorHint: null, // last value passed to setCursorHint() - see updateCursorLook
    wasCursorClose: false, // tracks the far->close edge for the one-shot alert reaction
    // No real transition has happened yet at construction time (the animal
    // starts directly in its first idle, not via enterIdle/resetPose - see
    // the comment above), so there's nothing to crossfade from - mark the
    // blend as already-finished rather than leaving transitionFrom
    // undefined (applyPoseCrossfade would otherwise read anim.pose[key]'s
    // starting values off a missing object on the very first frame).
    transitionFrom: defaultPose(),
    transitionElapsed: POSE_TRANSITION_DURATION,
  };

  const gaitFn = GAIT_PRESETS[spec.gait] || GAIT_PRESETS.walk;

  return {
    spec,
    isHopper: spec.gait === 'hop',
    poke() {
      if (anim.pinnedSleep || anim.pinnedHeld) return;
      enterIdle(anim, instantiateIdle('earflick'));
    },
    forceSleep() {
      anim.pinnedSleep = true;
    },
    wakeUp() {
      if (!anim.pinnedSleep) return;
      anim.pinnedSleep = false;
      enterIdle(anim, instantiateIdle('stretch'));
    },
    // Drag-to-move (see pet.js's mousedown/mouseup): held=true pins the
    // 'held' idle behavior (squish-in, then dangling legs/tail/ears) with
    // priority over even pinnedSleep - see updateBehaviorState. held=false
    // releases back into a normal idle pick (a little startled earflick,
    // same reaction poke() uses) rather than snapping straight back to
    // whatever it was doing before the grab.
    setHeld(held) {
      if (held) {
        if (anim.pinnedHeld) return;
        anim.pinnedHeld = true;
      } else {
        if (!anim.pinnedHeld) return;
        anim.pinnedHeld = false;
        enterIdle(anim, instantiateIdle('earflick'));
      }
    },
    // Cursor-reactive interaction (replaces the old autonomous patrol -
    // see the movement-policy comment above enterWalk): the caller (pet.js)
    // computes where the cursor is relative to the pet on screen and calls
    // this every frame with either null (cursor out of range / gone -
    // pet.js also treats a stale mousemove, i.e. none for a while, as this,
    // since a real 'mouseleave' isn't reliably delivered through the
    // click-through window's {forward:true} override) or
    // { dx, dy, close }: dx/dy a direction from the pet's center toward the
    // cursor (roughly -1..1, doesn't need to be exact - see
    // updateCursorLook, which clamps it anyway), close a bool for whether
    // the cursor is within the tighter "trigger an alert reaction" radius
    // pet.js defines. Purely stores the value; updateCursorLook (run every
    // frame from update() below) is what actually reacts to it.
    setCursorHint(hint) {
      anim.cursorHint = hint;
    },
    // dt in seconds, allowedToMove=false forces idle regardless of the
    // animal's own timer. Returns { advance } - px to move forward this
    // tick (always 0 in practice now that nothing calls enterWalk, but the
    // shape is kept in case that changes - see the movement-policy comment
    // above enterWalk).
    update(dt, allowedToMove, elapsed) {
      updateCursorAlertTrigger(anim, allowedToMove);
      const state = updateBehaviorState(anim, dt, allowedToMove);
      let advance = 0;
      if (state === 'walk') {
        advance = gaitFn(anim, dt, true);
      } else {
        gaitFn(anim, dt, false);
        if (anim.currentIdle) anim.currentIdle.apply(anim.pose, anim.behaviorTimer, anim.currentIdle.duration, anim.spec);
      }
      updateTailFlavor(anim, elapsed, state === 'walk');
      applyCursorLookEasing(anim, dt);
      applyPoseCrossfade(anim, dt); // last - blends the fully-computed pose above, see its comment
      recordRotationDebug(anim, elapsed); // no-op unless setRotationDebug() was called - see its comment above
      return { advance };
    },
    draw(ctx) {
      drawShadow(ctx, spec);
      drawCreature(ctx, spec, anim.pose);
    },
    // Debug/test-only accessor (used by test/sim-invariants.mjs to log the
    // exact state around a flagged frame) - not used anywhere in the app
    // itself. Returns a shallow snapshot, not a live reference, so a caller
    // can't accidentally mutate internal state through it.
    inspect() {
      return {
        pose: { ...anim.pose },
        behaviorState: anim.behaviorState,
        currentIdleName: anim.currentIdle ? anim.currentIdle.name : null,
        behaviorTimer: anim.behaviorTimer,
        pinnedSleep: anim.pinnedSleep,
        pinnedHeld: anim.pinnedHeld,
        cursorHint: anim.cursorHint,
        wasCursorClose: anim.wasCursorClose,
        transitionElapsed: anim.transitionElapsed,
      };
    },
  };
}
