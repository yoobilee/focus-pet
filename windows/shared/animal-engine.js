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
// Round 10 issue 4 ("회전이 끝나고... 부자연스럽게 툭 튕기듯 돌아옴") -
// wraps a raw angle DIFFERENCE (target-current, in radians, either side
// possibly many laps away from the other - e.g. chasetail's spinAngle can
// accumulate ~16 radians over one activation, see its own POSE_FIELD_BOUNDS
// comment) into the equivalent shortest-path difference in (-pi, pi]. Any
// code that eases or blends toward an angle - not just a plain numeric
// value - needs this, or the raw numeric distance (which has no ceiling,
// unlike the angle it actually represents mod 2*pi) drives the interpolation
// instead of the true angular distance, producing a multi-revolution "snap"
// even though every individual value involved is perfectly finite and
// in-range. Used by both applyPoseCrossfade (spinAngle specifically) and
// pet.js's render() (the spinOverride->cursor-tracked handoff) - the two
// places besides circleStep's own angle generation (already unwrapped by
// design, see spinAngle's defaultPose comment) that interpolate an angle.
export function normalizeAngleDelta(delta) {
  return delta - Math.PI * 2 * Math.round(delta / (Math.PI * 2));
}
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
// Exported (same additive spirit as SPECIES's own `export`, see its
// comment) so the 3D voxel prototype (feature/3d-space branch) can reuse
// this exact angle math to drive its leg-joint chain instead of
// reimplementing it - see CLAUDE.md's "관절/idle 시스템 3D 이식" note.
export function legJointAngles(cfg, pose, isFront) {
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
    // Groom ("wiper" redesign, round 4 issue 3): paw folds up toward the
    // face rather than down toward the ground - a different target pose
    // than the tuck above, not just more of it, so it's blended in on top
    // instead of through legsTucked. groomWipe (set every frame by
    // IDLE_BEHAVIORS.groom, degrees, oscillating) rides on TOP of the
    // raised base angle, swinging the whole rigid arm side to side from
    // its hip pivot like a wiper blade - knee stays fixed (not also
    // oscillated) so the sweep reads as one rigid arm pivoting, not a
    // floppy multi-joint flail. Base raise angle backed off slightly from
    // the old static -160 to -150 to leave clean headroom for the +-30
    // sweep without the hip angle ever getting close to the +-180 wrap
    // point.
    hip = lerp(hip, -150 + (pose.groomWipe || 0), pose.frontLegRaise);
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
    groomWipe: 0, // degrees, groom's wiper side-to-side sweep offset added on top of frontLegRaise's hip target - see legJointAngles
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
    // Round 8 issue 1 - Z-axis motion (prowlcircle/chasetail/hopspin/
    // wheelrun below - see IDLE_BEHAVIORS' own comment on the in-place
    // `approach` idle this originally shipped alongside, removed in round
    // 11 once the circular-path idles made it redundant). Grid units,
    // world-space, consumed only by voxel-engine.js's applyPose
    // (outer.position + a matching uniform scale for the closer-looks-
    // bigger cue) - drawCreature (2D) has no camera/depth concept at all
    // and simply never reads these, same as any other pose field a given
    // idle/renderer combination doesn't care about. depthZ: +toward
    // camera / -away. lateralX: sideways drift, for idles that trace a
    // circular path.
    depthZ: 0,
    lateralX: 0,
    // spinOverride/spinAngle: lets an idle behavior drive the WHOLE-BODY
    // facing angle itself (continuous multi-lap rotation for
    // prowlcircle/chasetail/hopspin) instead of the cursor-tracked facing
    // direction pet.js's render() normally eases toward - see its own
    // comment for how it hands control back smoothly the instant this
    // flips to false (booleans snap instantly through the pose crossfade,
    // unlike the numeric fields - see applyPoseCrossfade's comment).
    // spinAngle itself is radians and can run past a single +-2*pi lap
    // (deliberately not wrapped - wrapping it would reintroduce exactly
    // the "unwind the long way" glitch pet.js's own FACING_LEFT_Y sign
    // fix was written to avoid), but is only ever READ while spinOverride
    // is true, so its crossfade-blended value at the moment override
    // turns off is simply never consulted.
    spinOverride: false,
    spinAngle: 0,
  };
}

// Fields some ALWAYS-RUNNING per-frame mechanism reads its OWN previous
// value from in order to decay/ease it smoothly - these are the ONLY
// fields that need to be seeded from the current displayed pose into a
// fresh per-frame "raw" pose before that frame's gait/idle-behavior/
// look-easing code runs (see update()'s own comment and the big one above
// applyPoseCrossfade for the bug this fixes). Every OTHER pose field
// starts each frame at its defaultPose() value and is left there unless
// the CURRENTLY ACTIVE idle behavior's apply() explicitly sets it that
// frame - which is exactly the "each idle only touches the fields it
// cares about" convention every idle behavior above already assumes.
//
// Split in two because the two gait families decay disjoint field sets,
// and seeding a field NEITHER family's gait function actually reads would
// silently reintroduce the exact same stuck-forever bug for that field
// (round 5 follow-up: legsTuckedFront/Back were first added here
// unconditionally to serve updateHopGait's *=0.7 idle-branch decay, which
// promptly got legsTuckedFront/Back stuck at 0.8 forever after any sit for
// every WALK-gait species too - updateContinuousGait's idle branch never
// touches those two fields at all, so nothing was left to ever bring them
// back toward 0 once seeding made them carry over). update() picks
// whichever list matches anim.spec.gait, never both.
const LOOK_CONTINUITY_FIELDS = ['lookDX', 'lookDY']; // applyCursorLookEasing - every species, regardless of gait
const CONTINUOUS_GAIT_FIELDS = ['legPhase', 'bodyBob', 'waddleTilt']; // updateContinuousGait's idle-branch *=0.8 decay (walk/trot/waddle/scamper)
const HOP_GAIT_FIELDS = ['hopY', 'legsTuckedFront', 'legsTuckedBack']; // updateHopGait's idle-branch *=0.7 decay

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
  groomWipe: 45, // GROOM_WIPE_AMPLITUDE is 30 - comfortable margin above the real peak, same spirit as the other bounds here
  // lookDX/lookDY: updateCursorLook clamps its target to +-LOOK_MAX (0.8)
  // before easing toward it, so 5 is the same "comfortably above the real
  // peak" margin the other fields above use, not a tight bound.
  lookDX: 5, lookDY: 5,
  // depthZ/lateralX: prowlcircle's orbit radius is the largest current
  // user (~2.6 grid units), comfortably inside this. spinAngle: chasetail
  // spins fastest (~5.5 rad/s) over a duration up to ~3s, so ~16.5 radians
  // at most - bounded generously above that, same "wide margin, not a
  // tight bound" spirit as every other entry here.
  depthZ: 8, lateralX: 8, spinAngle: 40,
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
    // Array support (round 17 issue 3, "턱시도... V자") - mirrors cfg.pattern's
    // own Array.isArray branch just above. `zWidth` (voxel-engine.js only,
    // for the 3D front-view taper) has no 2D counterpart and is simply
    // ignored here - each segment still renders as a normal flat 2D rect,
    // same as any other multi-segment belly/pattern.
    const bellies = Array.isArray(cfg.belly) ? cfg.belly : [cfg.belly];
    for (const b of bellies) {
      const sq = toBodySquashed(b);
      px(ctx, b.x, sq.y, b.w, sq.h, b.color);
    }
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
// groom's wiper sweep (see IDLE_BEHAVIORS.groom below): degrees added to/
// subtracted from the raised paw's hip angle, oscillating like a car
// wiper pivoting from a fixed shoulder joint. Amplitude picked to be a
// clearly visible sweep without the hip angle wrapping into a weird pose
// (base raise target is -150deg, see legJointAngles - +-30 stays well
// short of the +-180 wrap point). Frequency picked so an average-length
// groom (~2.7s, see groom's duration()) fits a bit over 2 full back-and-
// forth sweeps - reads as "repeated wiping", not one twitch.
const GROOM_WIPE_AMPLITUDE = 30;
const GROOM_WIPE_FREQ = 7;

// Round 9 issue 2 - shared position/heading math for the circular-path
// walking idles (prowlcircle/chasetail/hopspin/wheelrun, see their own
// comment above IDLE_BEHAVIORS.prowlcircle). envelope-ramped radius
// (0->1->0, so the path starts/ends at rest instead of popping onto it)
// around a fixed angular speed (NOT scaled by env, so heading keeps
// turning smoothly through the ramp instead of slowing to a crawl right
// when it's hardest to notice). Heading faces the tangent (direction of
// travel) - the same sign relationship (-angle-PI/2) verified by
// rendering in round 8 (prowlcircle's first, in-place-spin version),
// unchanged here since the rotation.y convention it depends on hasn't
// changed.
function circleStep(pose, t, radius, angularSpeed, env) {
  const angle = t * angularSpeed;
  pose.lateralX = Math.cos(angle) * radius * env;
  pose.depthZ = Math.sin(angle) * radius * env;
  pose.spinOverride = true;
  pose.spinAngle = -angle - Math.PI / 2;
  return angle;
}

const IDLE_BEHAVIORS = {
  // Redesigned as a "wiper" (round 4 issue 3) - the previous version just
  // held the paw statically raised toward the face for the whole behavior
  // duration (frontLegRaise=1, no motion of its own beyond the 3D port's
  // now-removed GROOM_WOBBLE hack, see voxel-engine.js's history) which,
  // per direct user feedback, never actually read as "grooming" in either
  // the 2D or 3D renderer - a raised paw alone looks like a wave, not a
  // wash. groomWipe drives a continuous side-to-side sweep of the SAME
  // raised paw (see legJointAngles's frontLegRaise branch below) instead
  // of a one-shot lift, repeating for the whole behavior duration.
  groom: {
    duration: () => randRange(2.2, 3.2), // longer than before (was 1.6-2.4) so a few full wipe cycles actually fit - see GROOM_WIPE_FREQ
    apply(pose, t) {
      pose.headDY = 2 + Math.sin(t * 5) * 0.4;
      pose.headDX = -0.5;
      pose.frontLegRaise = 1;
      pose.groomWipe = Math.sin(t * GROOM_WIPE_FREQ) * GROOM_WIPE_AMPLITUDE;
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
  // Round 8 issue 1 originally added an `approach` idle here (a single
  // in-place depthZ drift toward/away from the camera, no real leg
  // motion or heading change) - removed in round 11 issue 3 ("커졌다
  // 작아졌다만 하는 동작 삭제") once the circular-path idles below
  // actually shipped: `approach` read as redundant/flat next to
  // prowlcircle/chasetail/etc. (which walk a real path on this species'
  // own gait, not just grow and shrink in place) and added nothing
  // approach-only. Deleted outright rather than left dormant (unlike e.g.
  // enterWalk()/GAIT_PRESETS, kept because a substrate still worth reusing
  // later) since there's no part of this idle a future feature would want
  // back - the whole "in-place Z drift" mechanism it demonstrated is
  // exactly what circleStep below replaced.
  // ===== Round 9 issue 2: circular-path walking =====
  // The four behaviors below (prowlcircle/chasetail/hopspin/wheelrun) all
  // trace a real path in the X-Z ground plane WHILE actually walking -
  // not spinning/scaling in place, which is what a first attempt at Z-
  // axis motion (round 8) did instead. Position comes from the
  // module-level circleStep() helper (defined above IDLE_BEHAVIORS,
  // alongside this file's other small pose-math helpers); LEG motion is
  // deliberately NOT set here at all - see WALKING_IDLE_NAMES below,
  // which tells update() to drive this species' own real gaitFn
  // (moving=true) for the whole duration one of these plays, exactly
  // like the (dormant) 'walk' state does. That's what makes the legs
  // actually swing through this species' own authored gait (walk/trot/
  // scamper/hop, whichever cfg.gait says) rather than a hand-faked
  // approximation - and also means these behaviors must NOT set
  // pose.bodyBob/legPhase/hopY/legsTucked* themselves, since apply()
  // runs AFTER gaitFn each frame (see update()'s own comment) and would
  // silently clobber whatever the real gait just computed.
  prowlcircle: {
    // Cats: stalking something it's spotted, watching it (via the
    // existing cursor-look system layered on top, not by walking
    // backwards) while padding around it on real paws.
    //
    // Round 10 issue 1 - the original 2.6-radius/0.9rad/s combo (over a
    // 5-7.5s duration) only completes ~0.9 of a full lap before the
    // behavior ends - reported as "looks like it's just growing and
    // shrinking in place", and a direct measurement backed that up: at
    // this radius, the on-screen POSITION swing from lateralX (an
    // orthographic-projection-faithful screen shift) was only ~11px,
    // while the on-screen SIZE swing from depthZ (via the manual
    // DEPTH_SCALE_FACTOR fake-perspective hack applied to a Z-axis an
    // orthographic camera doesn't otherwise render at all) was ~31px -
    // nearly 3x more visually dominant. dog_husky's chasetail measured a
    // nearly IDENTICAL ratio (2.88 vs cat's 2.82) despite reading fine to
    // the user, which ruled out "rebalance the ratio" as the fix -
    // chasetail's actual advantage is completing ~1.6 laps within its
    // short 2.5-3.5s duration (3.4rad/s), giving a viewer several repeats
    // of the size+position correlation to piece together as "circling"
    // instead of catching only one slow, easy-to-mistake-for-static leg
    // of the path. Sped up and tightened to complete a comparable ~1.5-2
    // laps per activation while staying noticeably more leisurely than
    // chasetail's frantic pace - the "wide, slow prowl" feel now comes
    // from being slower in absolute rad/s and covering more radius than
    // chasetail, not from taking so long per lap that the loop itself
    // becomes imperceptible.
    duration: () => randRange(4, 5.5),
    apply(pose, t, duration) {
      const env = Math.sin(clamp01(t / duration) * Math.PI);
      circleStep(pose, t, 2.2, 1.8, env);
      pose.tailOverride = true;
      pose.tailPhase = t * 3;
      pose.tailAmp = 0.6 * env;
    },
  },
  chasetail: {
    // Dogs: a tight, fast loop - chasing its own tail in a real (if
    // small) circle instead of a stationary pirouette, legs genuinely
    // stepping through it via this species' own trot/scamper gait.
    duration: () => randRange(2.5, 3.5),
    apply(pose, t, duration) {
      const env = Math.sin(clamp01(t / duration) * Math.PI);
      circleStep(pose, t, 1.5, 3.4, env);
      pose.tailOverride = true;
      pose.tailPhase = t * 10;
      pose.tailAmp = 1.1 * env;
    },
  },
  hopspin: {
    // Rabbit: circles while hopping - the hop gait itself (hopY/
    // legsTucked bounce-and-tuck cycle) comes from gaitFn via
    // WALKING_IDLE_NAMES same as the others; this only adds the
    // traveling-in-a-circle path on top, so each hop lands a little
    // further around the loop instead of straight ahead.
    duration: () => randRange(2.5, 4),
    apply(pose, t, duration) {
      const env = Math.sin(clamp01(t / duration) * Math.PI);
      circleStep(pose, t, 1.8, 2.3, env);
    },
  },
  wheelrun: {
    // Hamster: a small, quick scurrying loop - much tighter and faster
    // than the cat's wide prowl, matching a hamster's own short legs and
    // scamper gait. (Earlier version modeled this as literally running
    // in place on a wheel with no heading change - abandoned in favor of
    // a real walked circle, per this round's request that every one of
    // these actually move through the ground plane.)
    duration: () => randRange(2.5, 4),
    apply(pose, t, duration) {
      const env = Math.sin(clamp01(t / duration) * Math.PI);
      circleStep(pose, t, 0.8, 4.4, env);
    },
  },
};

// Round 9 issue 2 - idle behaviors whose legs should be driven by this
// species' own real gaitFn (moving=true) instead of the usual idle decay
// (moving=false) - see update()'s own comment for where this is
// consulted.
const WALKING_IDLE_NAMES = new Set(['prowlcircle', 'chasetail', 'hopspin', 'wheelrun']);

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
// pose: this frame's raw target pose (see update()'s own comment) - reads
// from it too (not just writes), since the idle (!moving) branch decays
// legPhase/bodyBob/waddleTilt from whatever they currently are. That
// "currently are" value has to be the CONTINUING one from the previous
// displayed frame (seeded into `pose` by update() via
// POSE_CONTINUITY_FIELDS before this runs), not a fresh defaultPose()
// zero - otherwise this decay would just multiply 0*0.8 forever instead
// of ever actually decaying anything.
function updateContinuousGait(anim, pose, dt, moving, opts) {
  anim.clock += moving ? dt : 0;
  const w = anim.clock * opts.freq * Math.PI * 2;
  if (moving) {
    pose.legPhase = Math.sin(w);
    pose.bodyBob = -Math.abs(Math.sin(w * 2)) * opts.bob;
    pose.legsTuckedFront = 0;
    pose.legsTuckedBack = 0;
    if (opts.waddle) pose.waddleTilt = Math.sin(w) * opts.waddle;
  } else {
    pose.legPhase *= 0.8;
    pose.bodyBob *= 0.8;
    pose.waddleTilt *= 0.8;
  }
  return moving ? opts.speed * dt : 0;
}

// pose: see updateContinuousGait's comment - same reasoning, the idle
// (!moving) branch decays hopY/legsTuckedFront/Back from their current
// (continuity-seeded) value.
function updateHopGait(anim, pose, dt, moving, opts) {
  if (!moving) {
    anim.hopClock = 0;
    anim._prevCum = 0;
    pose.hopY *= 0.7;
    pose.legsTuckedFront *= 0.7;
    pose.legsTuckedBack *= 0.7;
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
  pose.hopY = -y;
  pose.bodyBob = -y;
  pose.legsTuckedFront = tuck;
  pose.legsTuckedBack = tuck;
  pose.earFlick = -y * 0.5;

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
  walk: (anim, pose, dt, moving) => updateContinuousGait(anim, pose, dt, moving, gaitOpts(anim, { freq: 1.4, bob: 0.9 })),
  trot: (anim, pose, dt, moving) => updateContinuousGait(anim, pose, dt, moving, gaitOpts(anim, { freq: 2.1, bob: 1.3 })),
  waddle: (anim, pose, dt, moving) => updateContinuousGait(anim, pose, dt, moving, gaitOpts(anim, { freq: 1.0, bob: 0.6, waddle: 9 })),
  scamper: (anim, pose, dt, moving) => updateContinuousGait(anim, pose, dt, moving, gaitOpts(anim, { freq: 3.2, bob: 0.5 })),
  hop: (anim, pose, dt, moving) => updateHopGait(anim, pose, dt, moving, { period: 0.62, height: 4, stride: anim.spec.speed }),
};

// pose: this frame's raw target pose (see update()'s comment). Not in
// POSE_CONTINUITY_FIELDS - tailPhase/tailAmp are always recomputed here as
// an ABSOLUTE function of `elapsed` (a monotonic clock, not a decayed
// previous value), and tailOverride is meant to start false each frame
// and only flip true if the CURRENTLY active idle's apply() (called
// before this, see update()) sets it - so neither field needs seeding
// from the previous displayed pose the way the gait-decay fields do.
function updateTailFlavor(pose, spec, elapsed, walking) {
  if (!spec.hasTail) return;
  // tailOverride (set by an idle behavior's apply(), e.g. 'held' or
  // 'tailtwitch'): this function runs *after* that apply() every frame
  // (see update() below), so without this check it would immediately
  // overwrite whatever tailPhase/tailAmp the behavior just set with the
  // species' normal wag/swish rate instead of the behavior-specific motion
  // it was actually going for.
  if (pose.tailOverride) return;
  if (spec.wagTail) {
    pose.tailPhase = elapsed * 9;
    pose.tailAmp = 1.2;
  } else if (spec.swishTail) {
    pose.tailPhase = elapsed * 1.6;
    pose.tailAmp = walking ? 1 : 0.5;
  } else {
    // Stub tails (rabbits): near-rigid, just a faint idle twitch rather
    // than a full swish/wag.
    pose.tailPhase = elapsed * 1.6;
    pose.tailAmp = 0.15;
  }
}

// ---------------------------------------------------------------------
// Every entry into a new behavior goes through one of these two helpers.
// The actual "start every field the current behavior doesn't touch from a
// clean 0" guarantee (the fix for the tail/ear "cut off or gappy" glitch -
// each idle behavior's apply() only sets the handful of pose fields it
// actually cares about, e.g. earflick only touches earFlick, so anything
// left over from whatever behavior played *before* it used to keep
// rendering every frame after) now lives in update()'s own per-frame
// `raw = defaultPose()` rebuild, not here - see its comment and the big
// one above applyPoseCrossfade for the full story (round 5: that
// per-transition reset used to happen HERE, via `anim.pose =
// defaultPose()`, which is what let a crossfade-blended value leak back in
// as the next frame's "current" value and get stuck forever for any field
// not touched by every single idle behavior).
// resetPose's only remaining job is bookkeeping for the crossfade: snapshot
// the pose about to be discarded (transitionFrom) and restart the crossfade
// clock (transitionElapsed) - see applyPoseCrossfade, called from update()
// every frame afterward to blend from this snapshot toward whatever the
// new behavior computes, instead of an instant pop (see CLAUDE.md - 포즈
// 전환이 뚝뚝 끊기는 문제). If a transition happens again before the
// previous crossfade finished, this just re-snapshots the CURRENT (still
// mid-blend) anim.pose and restarts the timer - the blend naturally chains
// from wherever it already was, no discontinuity.
function resetPose(anim) {
  anim.transitionFrom = anim.pose;
  anim.transitionElapsed = 0;
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
// same ordering updateTailFlavor already uses for tailPhase/tailAmp.
// pose.lookDX/lookDY are in POSE_CONTINUITY_FIELDS (seeded from the
// previous displayed pose by update() before this runs, see its comment)
// specifically so THIS read-and-ease-toward-target line has a real
// previous value to ease from every frame, transition or not - lookDX/
// lookDY are the one pose field with no idle behavior of their own at
// all, driven purely by this always-running easer.
function applyCursorLookEasing(anim, pose, dt) {
  const suppressed = anim.pinnedSleep || anim.pinnedHeld;
  const hint = suppressed ? null : anim.cursorHint;
  const targetX = hint ? clamp(hint.dx, -1, 1) * LOOK_MAX : 0;
  const targetY = hint ? clamp(hint.dy, -1, 1) * LOOK_MAX : 0;
  const ease = 1 - Math.exp(-dt * LOOK_EASE_RATE);
  pose.lookDX = lerp(pose.lookDX, targetX, ease);
  pose.lookDY = lerp(pose.lookDY, targetY, ease);
}

// Crossfades the DISPLAYED pose (anim.pose) over the first
// POSE_TRANSITION_DURATION seconds after a behavior transition, instead of
// the instant pop a bare pose swap would produce (see CLAUDE.md - 포즈
// 전환이 뚝뚝 끊기는 문제). `raw` is this frame's freshly computed target -
// see update()'s own comment for why it has to be a separate object from
// anim.pose rather than the same one mutated in place.
//
// BUG FIXED (round 5, issue 1 - "그루밍 후 발이 든 채로 고정됨"): the
// previous version blended `anim.pose` toward ITSELF in place
// (`anim.pose[key] = lerp(from[key], anim.pose[key], t)`), reading its own
// `target` off the very same object it had just written the previous
// frame's blended result into. For a field EVERY idle behavior sets every
// frame (bodyBob, tailPhase - see updateContinuousGait/updateTailFlavor,
// both unconditional every frame) this was invisible, since that fresh
// write always overwrote whatever the crossfade left there. But for a
// field only SOME idle behaviors set (frontLegRaise/groomWipe: groom
// only; legsTuckedFront/Back: sit/sleep only, and only self-correcting via
// gait decay for HOP-gait species - see POSE_CONTINUITY_FIELDS; cheekPuff,
// noseTwitch, bellyUp, frontLegExtend, eyesClosed for idles that don't
// explicitly clear it): once crossfade wrote it non-zero on the first
// post-transition frame, the NEXT idle's apply() (not caring about that
// field at all) left it untouched, so crossfade's own `target` on frame 2
// read back its OWN frame-1 output instead of the true default (0) - both
// `start` and `target` converged to the same stale non-zero value and
// lerp produced that same value forever, for every transition from then on
// (confirmed empirically: frontLegRaise stayed pinned at exactly 1.000
// through 20+ subsequent idle changes in a driven simulation once groom
// played even once). Once POSE_TRANSITION_DURATION elapsed, this function
// stops touching the field at all (see the early return below), freezing
// it at that stuck value permanently - "stops after some time and stays
// stuck" is exactly the reported symptom.
//
// Fixed by never letting the crossfade write feed back into what a LATER
// frame treats as "the target": `raw` (built fresh from defaultPose() every
// single frame by update(), see its comment) is always the TRUE current
// intent - 0 for any field the active idle doesn't touch, whatever the
// idle explicitly sets otherwise - and this function only ever READS it,
// writing the blended result into anim.pose (a plain snapshot object,
// reassigned wholesale each call) instead of mutating raw. So frame 2's
// `target` is always genuinely fresh, never contaminated by frame 1's
// blend output, and any field the current idle doesn't set reliably
// crossfades to 0 exactly once and stays there - the "next behavior still
// has its foot up" bug can't recur for this or any future pose field
// without the same self-poisoning mistake being reintroduced.
const POSE_TRANSITION_DURATION = 0.25;
export function applyPoseCrossfade(anim, raw, dt) {
  // Round 10 issue 4 - spinAngle is deliberately unwrapped/multi-lap (see
  // its own defaultPose comment: a single chasetail activation can leave it
  // 15+ radians from zero), so a plain lerp between two spinAngle values
  // from different behaviors (or the same behavior restarting at its own
  // t=0) can sweep through many radians even though they represent nearby
  // facings - that sweep, whether spread across this function's 0.25s blend
  // window or (worse) landing in a single frame, is exactly the "snaps/
  // whirls back" bug. Fixed with a PERSISTENT per-transition lap offset
  // (not just a one-off blend-loop correction) added onto raw.spinAngle
  // itself, computed once at the instant a transition begins (transitionElapsed
  // is exactly 0 only on that first call) FROM a state that was also
  // spin-driven (anim.transitionFrom.spinOverride) INTO a state that still
  // is (raw.spinOverride) - the only combination where two different
  // spinAngle continuums need reconciling at all. Doing it here, once, and
  // baking it into `raw` itself (not just the blended output) means BOTH
  // this function's own blend loop below AND its early-return path a few
  // lines down (`anim.pose = raw` once the 0.25s window has elapsed) see
  // the aligned value - an earlier version only special-cased the blend
  // loop and left the early-return path assigning the raw, unaligned value
  // verbatim the instant the crossfade finished, which just moved the same
  // multi-radian snap from "spread over 0.25s" to "a single frame at
  // t=0.25s" instead of actually fixing it (caught by
  // test/diag-crossfade-spinangle-direct.mjs, which traces every frame
  // including the one where the early-return first triggers).
  if (anim.transitionElapsed === 0) {
    anim.spinAngleLapOffset = (anim.transitionFrom.spinOverride && raw.spinOverride)
      ? Math.PI * 2 * Math.round((anim.transitionFrom.spinAngle - raw.spinAngle) / (Math.PI * 2))
      : 0; // no active spin idle on at least one side of the boundary - nothing to reconcile, and clearing here stops a stale offset from a much earlier spin idle leaking into some later, unrelated one
  }
  if (anim.spinAngleLapOffset) raw.spinAngle += anim.spinAngleLapOffset;

  if (anim.transitionElapsed >= POSE_TRANSITION_DURATION) {
    anim.pose = raw;
    return;
  }
  const t = clamp01(anim.transitionElapsed / POSE_TRANSITION_DURATION);
  const from = anim.transitionFrom;
  const blended = { ...raw }; // covers boolean/non-numeric fields (tailOverride) as a direct snap, no blending needed for those
  for (const key in raw) {
    const target = raw[key];
    const start = from[key];
    if (typeof target !== 'number' || typeof start !== 'number') continue;
    // spinAngle needs no special-casing here anymore - the offset above
    // already re-anchored raw.spinAngle to the nearest lap-equivalent of
    // `start`, so a plain lerp between them is already the shortest path.
    blended[key] = lerp(start, target, t);
  }
  anim.pose = blended;
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
// Exported (in addition to being used internally) so the 3D voxel
// prototype (windows/shared/voxel-engine.js, feature/3d-space branch)
// can reuse the exact same per-species geometry/color data instead of
// duplicating it - see CLAUDE.md's "3D 복셀 공간 실험" note. Purely
// additive; nothing about the existing 2D engine's own use of this table
// changes.
export const SPECIES = {
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
    whiskers: true, // round 8 issue 2 - 3 fanned-out whisker boxes per cheek, see voxel-engine.js's buildWhiskers
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#d9824a',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#e8935a' }, { x: 0, y: 12, w: 2, h: 2, color: '#e8935a' }, { x: 1, y: 10, w: 2, h: 2, color: '#e8935a' }],
    gait: 'walk', speed: 26,
    walkMin: 3.5, walkMax: 7.5,
    // Cat signature moves per real behavior: loaf-sitting, grooming,
    // tail-tip flicking, stretching - see CLAUDE.md for the research this
    // roster's idlePools are based on. cat_a leans groom-heavy (a
    // fastidious tabby).
    idlePool: [{ name: 'groom', weight: 3 }, { name: 'sit', weight: 2.5 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'prowlcircle', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    // Round 17 issue 3 ("정면에서 V자 모양 흰 털... 옆모습에서도 자연스럽게") -
    //
    // Discovered while building this: the ORIGINAL (pre-round-17) belly -
    // { x:6,y:16,w:10,h:3 } - was ALREADY invisible at the front pose,
    // unrelated to anything new (confirmed by temporarily reverting to
    // that exact literal object and re-rendering - still invisible). Root
    // cause: at front pose local X becomes camera-DEPTH (round 16's own
    // module comment), so a decal is only visible there if its OWN front
    // (+X) edge reaches or exceeds whatever's directly in front of it -
    // exactly the margin buildVoxelCreature's nose positioning already
    // relies on (`Math.max(cfg.nose.x, snoutFrontX) + 0.05`). The old
    // belly's front edge (x+w=16) fell a full unit short of the body's own
    // front edge (bodyX+bodyW=17), so the body's own (black) front face
    // won the depth test at every point - belly was rendering, just
    // permanently hidden behind the body's own surface from this one
    // angle. `w` below is widened so its front edge reaches (not just
    // approaches) the body's own front edge - addSkinBoxRel's existing
    // SKIN margin (~0.075/side, already relied on elsewhere in this file)
    // supplies the small extra needed to actually win the tie. This part
    // of round 17 is a genuine, still-valid fix - kept.
    //
    // Round 17 ALSO tried two ways to make this taper into an actual V
    // shape when viewed from the front, both abandoned by round 18:
    // (1) a genuine Z-taper (narrower Z-depth near the chin) turned out
    // geometrically incompatible with staying visible from PROFILE at all
    // (at profile pose local Z becomes the camera-depth axis instead, so a
    // segment needs its OWN Z half-width to reach/exceed the part's own
    // half-depth (~3 units) to be visible from the side - directly
    // contradicting "narrow in Z near the chin"). (2) a depthTest:false
    // front-cap "V-mask" (bodyColor planes painted back over the patch's
    // outer edges, same plane technique as the neck seam) avoided that by
    // never touching the underlying geometry - but round 18 found this
    // created a visible ghosting/misalignment artifact ("흰 부분이 투명하게
    // 비치는 것처럼") at the intermediate angles (225/315deg) where the
    // mask is only partially visible: a flat PLANE's apparent width
    // shrinks with a pure cosine falloff as it rotates away from face-on,
    // but a BOX's apparent width (the decal underneath) grows differently
    // at the same angles (its depth face starts showing too) - the two
    // don't foreshorten the same way, so the mask's coverage silently
    // stops lining up with the decal's actual edges anywhere off the exact
    // front pose. Confirmed structural, not a settings/blend/render-order
    // issue (screenshots at 225/315deg showed the same jumbled look with
    // no overlap-with-neck-seam involved) - rolled back per round 18's own
    // request rather than chasing a deeper fix. `snout`/`belly` stay at
    // their round-17 full-width/full-depth shape (a plain rectangular
    // white patch, not tapered) - correct and stable from every angle.
    snout: [
      { x: 20, y: 12, w: 2, h: 2, color: '#ffffff' },
      { x: 19, y: 14, w: 3, h: 2, color: '#ffffff' },
    ],
    belly: { x: 6, y: 16, w: 11, h: 3, color: '#ffffff' },
    // No `pattern` field (round 4 issue 5) - the back/upper-body used to
    // have a white patch here (y:13-16, above the chest), but the
    // reference photo (see comment above) is explicit that the back is
    // solid black with white confined to the chest/belly (still `belly`,
    // untouched) and paw tips (still `pawColor`, untouched). A black
    // patch would render identically to just leaving the body's own
    // bodyColor (#161616) showing through, so this omits the field
    // entirely rather than adding a same-color no-op patch on top.
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#161616' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1, color: '#d99a9e' },
    whiskers: true,
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
    idlePool: [{ name: 'groom', weight: 3 }, { name: 'sit', weight: 2.5 }, { name: 'tailtwitch', weight: 2 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'prowlcircle', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    whiskers: true,
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#faf3e6',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#faf3e6' }, { x: 0, y: 12, w: 2, h: 2, color: '#242320' }, { x: 1, y: 10, w: 2, h: 2, color: '#d97a34' }],
    gait: 'walk', speed: 24,
    walkMin: 3.5, walkMax: 7.5,
    idlePool: [{ name: 'stretch', weight: 3 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'groom', weight: 2 }, { name: 'sit', weight: 2.5 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'prowlcircle', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    //
    // Contrast/radius retuned (round 6 - "여전히 단색 진한 갈색 블록으로
    //보임", the 3rd report of this exact complaint despite the 3D
    // vertex-color gradient rendering correctly each time it was checked
    // - see CLAUDE.md). The rendering pipeline was never the problem
    // (confirmed yet again this round via full-canvas real-screenshot
    // pixel scan: 54 distinct in-between shades genuinely present) - the
    // OLD radius (6.5) is wider than the head's own diagonal (~9.9 units,
    // but the farthest actual corner from the eye focus is only ~7.2
    // units away), so the falloff never fully completes anywhere on the
    // head - every pixel sits somewhere in a very gradual, low-contrast
    // middle ground (neighboring grid cells differing by only 1-3 RGB
    // units - each individual step is real but imperceptible, and the
    // OLD highlight (#a9825f, only 77/60/41 RGB above headColor) capped
    // the total available contrast even at full saturation). Retuned to
    // a smaller radius (4, well under the corner distance) so the
    // lightest area actually REACHES pure highlight over a real portion
    // of the head instead of asymptotically approaching it, and a
    // notably brighter highlight (bigger jump from headColor) so that
    // saturated area reads as clearly lighter at a glance, not just
    // "slightly less dark".
    // Round 7 rewrite: this whole gradient is now painted as a canvas
    // texture (voxel-engine.js's buildFaceShadeTexture), not interpolated
    // from box vertices - see that function's own comment for why (a
    // BoxGeometry, even heavily subdivided, structurally can't show a full
    // 2D radial field on 4 of its 6 faces). `stripe` (new field, read only
    // by the 3D texture painter - the 2D pxDitherRadial path ignores it,
    // see drawCreature) is the cream forehead stripe between the ears,
    // authored against assets/reference/siamese-real-photo.webp: centered
    // horizontally, pinned to the very top of the head.
    faceShade: { highlight: '#cdac7c', radius: 5.5, stripe: { color: '#e8d9bb', w: 2.2, h: 1.6 } },
    bodyX: 4, bodyY: 13, bodyW: 13, bodyH: 6,
    headX: 15, headY: 9, headW: 7, headH: 7,
    snout: null,
    belly: null,
    pattern: null,
    earStyle: 'pointy', ear: { gap: 3, w: 3, h: 4, tipDX: 1, color: '#5c4636' },
    eye: { x: 20, y: 11, w: 2, h: 2 }, nose: { x: 22, y: 13, w: 1, h: 1 },
    whiskers: true,
    legFrontX: 15, legBackX: 6, legY: 19, legH: 3, legFrontW: 2, legBackW: 2, legColor: '#5c4636',
    hasTail: true, swishTail: true,
    tail: [{ x: 2, y: 14, w: 2, h: 2, color: '#e8d9bb' }, { x: 0, y: 12, w: 2, h: 2, color: '#5c4636' }, { x: 1, y: 10, w: 2, h: 2, color: '#5c4636' }],
    gait: 'walk', speed: 27,
    walkMin: 3.5, walkMax: 7.5,
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'tailtwitch', weight: 2.5 }, { name: 'groom', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 1.5 }, { name: 'sleep', weight: 1 }, { name: 'prowlcircle', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    noseDetail: 'nostrils', // round 8 issue 2 - two small dark dots on the nose, see voxel-engine.js
    legFrontX: 17, legBackX: 4, legY: 21, legH: 2, legFrontW: 2, legBackW: 2, legColor: '#a8562e',
    hasTail: true, wagTail: true,
    tail: [{ x: 0, y: 17, w: 2, h: 2, color: '#a8562e' }],
    // "낮은 자세로 스윽 이동" - a long low dog reads as gliding when the
    // usual trot bounce (bob:1.3) is flattened way down, not when it's
    // bouncing like everything else.
    gait: 'trot', speed: 30, gaitTuning: { bob: 0.35 },
    walkMin: 2.8, walkMax: 6,
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'earflick', weight: 2 }, { name: 'sleep', weight: 1.5 }, { name: 'stretch', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'chasetail', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    noseDetail: 'nostrils',
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
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'stretch', weight: 2 }, { name: 'earflick', weight: 2.5 }, { name: 'sleep', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'chasetail', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    noseDetail: 'nostrils',
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
    idlePool: [{ name: 'earflick', weight: 3.5 }, { name: 'sit', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'sleep', weight: 1 }, { name: 'bellyUp', weight: 1 }, { name: 'chasetail', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    // Round 17 issue 2 added a white belly patch here, round 18 replaced
    // it with a lighter bodyColor tint instead - round 19 rolled BOTH
    // attempts back out entirely per request (keep NECK_SEAM_SPECIES's
    // addition, revert the chest back to having no belly field at all,
    // its original pre-round-17 state).
    belly: null,
    pattern: [{ x: 13, y: 11, w: 4, h: 5, color: '#f7ecd5' }],
    earStyle: 'pointy', ear: { gap: 3, w: 2.5, h: 3, tipDX: 0.5, color: '#e8c896' },
    eye: { x: 20, y: 10, w: 2, h: 2 }, nose: { x: 22, y: 12, w: 1, h: 1 },
    noseDetail: 'nostrils',
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
    idlePool: [{ name: 'sit', weight: 3 }, { name: 'earflick', weight: 2.5 }, { name: 'stretch', weight: 2 }, { name: 'sleep', weight: 1.5 }, { name: 'bellyUp', weight: 1 }, { name: 'chasetail', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    noseDetail: 'philtrum', // round 8 issue 2 - vertical groove below the nose, see voxel-engine.js
    legFrontX: 14, legBackX: 6, legY: 20, legH: 4, legFrontW: 2, legBackW: 3, legColor: '#f5efe4',
    hasTail: true, swishTail: false,
    tail: [{ x: 3, y: 15, w: 2, h: 2, color: '#ffffff' }],
    gait: 'hop', speed: 32,
    walkMin: 2, walkMax: 4.5,
    // "귀 방향 바꾸기(경계), 코 씰룩거리기" - earalert (a held swivel, as if
    // orienting toward a sound - distinct from the sharper earflick
    // startle) and nosetwitch (rapid sniffing) are this species' two
    // signature moves, weighted above the generic earflick/sit.
    idlePool: [{ name: 'earalert', weight: 3 }, { name: 'nosetwitch', weight: 2.5 }, { name: 'sit', weight: 2 }, { name: 'earflick', weight: 1 }, { name: 'sleep', weight: 1 }, { name: 'hopspin', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    idlePool: [{ name: 'cheekpuff', weight: 3 }, { name: 'sit', weight: 2 }, { name: 'earflick', weight: 2 }, { name: 'sleep', weight: 1 }, { name: 'wheelrun', weight: 1 }, { name: 'breathe', weight: 12 }],
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
    // See applyPoseCrossfade's spinAngle comment - persists across frames
    // (not reset every transition, only recomputed at the START of one),
    // 0 here matches transitionElapsed already being "no transition
    // pending" at construction.
    spinAngleLapOffset: 0,
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
    // External walk control (pet.js's "좌우 이동" pacing mode) - reuses the
    // dormant enterWalk()/'walk' behaviorState substrate described above
    // enterWalk's own comment, but with an EXTERNALLY-decided end point
    // instead of enterWalk's own randomized walkMin/walkMax duration (that
    // duration model was designed for the old "occasional short burst"
    // patrol, not "walk continuously until the caller says stop, however
    // long that takes at this species' speed"). duration:1e9 mirrors
    // updateBehaviorState's own pinnedSleep idiom exactly (`{ name:'sleep',
    // ..., duration: 1e9 }`) - "large enough that the internal timer-based
    // cutoff never fires on its own; some external, explicit signal is the
    // only thing that ends this" is already an established pattern here,
    // not a new one.
    //
    // startWalking() is idempotent (no-ops if already in the 'walk' state)
    // specifically so pet.js can call it unconditionally every frame it
    // wants "currently walking" to be true, rather than needing to track
    // whether it already issued the call - important because
    // updateBehaviorState forces behaviorState back to 'idle' out from
    // under a walk whenever allowedToMove is false (a reminder bubble
    // showing) or pinnedSleep/pinnedHeld engage (system-idle doze, drag) -
    // none of those paths know or care that pet.js considers itself
    // "mid-walk", so once the interruption ends, pet.js just calls
    // startWalking() again on the next qualifying frame and this resumes
    // the SAME leg exactly where the gait left off, instead of pet.js
    // needing to detect the desync and react. A non-idempotent version
    // would call enterWalk()->resetPose() every such frame and pop the
    // pose crossfade constantly while walking normally, breaking the very
    // animation this exists to drive.
    startWalking() {
      if (anim.behaviorState === 'walk') return;
      enterWalk(anim);
      anim.walkDuration = 1e9;
    },
    // Ends an externally-driven walk leg (see startWalking) by handing off
    // to the normal idle pool, exactly like a real walkDuration timeout
    // would - the species' idlePool (including the Z-axis circular idles,
    // prowlcircle/chasetail/hopspin/wheelrun - WALKING_IDLE_NAMES) is
    // untouched by any of this and keeps getting picked from normally.
    // No-op if not currently walking (e.g. an interruption already forced
    // idle - see startWalking's own comment).
    stopWalking() {
      if (anim.behaviorState !== 'walk') return;
      enterIdle(anim, pickIdleBehavior(anim.spec));
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

      // This frame's raw/intended pose, built fresh from defaultPose()
      // every single call - NOT anim.pose mutated in place. Only the
      // continuity fields this species' own gait function actually decays
      // (plus lookDX/lookDY, every species) are seeded from the current
      // DISPLAYED pose first, so their own read-and-decay/ease logic below
      // has real continuity to work with; every other field starts at 0
      // and stays there unless the code below (gaitFn or the current
      // idle's apply()) explicitly sets it THIS frame. This is what makes
      // "a behavior that doesn't touch a field" reliably mean "that field
      // is 0", every frame, not just on the transition frame - see
      // applyPoseCrossfade's comment for the bug this fixes (round 5,
      // issue 1), and LOOK_CONTINUITY_FIELDS's comment for why the gait
      // half of this has to be species-specific, not a single fixed list.
      const raw = defaultPose();
      for (const key of LOOK_CONTINUITY_FIELDS) raw[key] = anim.pose[key];
      for (const key of (spec.gait === 'hop' ? HOP_GAIT_FIELDS : CONTINUOUS_GAIT_FIELDS)) raw[key] = anim.pose[key];

      // Round 9 issue 2 - the circular-path idles (prowlcircle/chasetail/
      // hopspin/wheelrun) drive REAL leg motion via this species' own
      // gaitFn (moving=true), same as the dormant 'walk' state does -
      // WALKING_IDLE_NAMES is the only thing distinguishing them from
      // every other idle, whose legs stay planted (moving=false, gaitFn's
      // own decay branch). The returned advance is deliberately NOT
      // assigned to the outer `advance` (which stays 0 here, same as any
      // other idle) - these behaviors move through depthZ/lateralX
      // (see their own apply()), not the old 2D x/direction patrol path,
      // so there's nothing for a world-space stride distance to drive.
      const isWalkingIdle = anim.currentIdle && WALKING_IDLE_NAMES.has(anim.currentIdle.name);
      if (state === 'walk') {
        advance = gaitFn(anim, raw, dt, true);
      } else {
        gaitFn(anim, raw, dt, isWalkingIdle);
        if (anim.currentIdle) anim.currentIdle.apply(raw, anim.behaviorTimer, anim.currentIdle.duration, anim.spec);
      }
      updateTailFlavor(raw, anim.spec, elapsed, state === 'walk');
      applyCursorLookEasing(anim, raw, dt);
      applyPoseCrossfade(anim, raw, dt); // last - blends transitionFrom -> raw, writes the result into anim.pose (see its comment)
      recordRotationDebug(anim, elapsed); // no-op unless setRotationDebug() was called - see its comment above
      return { advance };
    },
    draw(ctx) {
      drawShadow(ctx, spec);
      drawCreature(ctx, spec, anim.pose);
    },
    // getPose(): a LIVE reference (not a copy, unlike inspect() below) to
    // anim.pose - added for the 3D voxel prototype (feature/3d-space
    // branch, see CLAUDE.md's "관절/idle 시스템 3D 이식" note), whose own
    // per-frame renderer reads this every frame and needs it fast/cheap,
    // not a fresh object allocation each tick. createAnimal()/update() is
    // otherwise 100% canvas-agnostic already - draw(ctx) above is the ONLY
    // 2D-specific method on this returned object, so a 3D renderer can
    // reuse the entire state machine/idle-behavior/cursor-tracking/pose-
    // crossfade system unchanged and just read the pose it computes each
    // frame via this instead of draw(ctx).
    getPose() {
      return anim.pose;
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
