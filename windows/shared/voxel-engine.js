// PROTOTYPE (feature/3d-space branch) - converts the existing 2D SPECIES
// table (windows/shared/animal-engine.js, imported directly rather than
// duplicated - see its `export const SPECIES` comment) into a Three.js
// group of flat-shaded boxes, one per existing 2D rect (body/head/ear/
// snout/eye/nose/belly/pattern/leg/tail). This is a literal "extrude each
// existing flat rect into a cuboid" mapping, not a from-scratch 3D
// character - the same silhouette/color decisions already tuned in the
// 2D engine carry over directly. See CLAUDE.md's "3D 복셀 공간 실험" note
// for why this approach (vs. the earlier smooth-low-poly attempt) is
// being tried.
//
// COORDINATE CONVENTION (settled while adding front/back detail - see
// CLAUDE.md's "정면/후면 디테일" note): X = nose-to-tail (matches the 2D
// engine's own horizontal axis directly), Y = up-down (flipped from the
// 2D engine's top-down convention, see addBox), Z = LEFT-RIGHT (lateral)
// - this is the axis that's entirely new versus the 2D engine, since a
// flat side-view sprite has no lateral extent at all. Paired anatomical
// features (eyes, ears, legs) are placed as two boxes mirrored across
// Z=0 rather than at different X positions the way the 2D engine's
// near/far "depth cue" offsets worked - mirroring across Z means they
// collapse into one visible feature from a 0°/180° (side) view, exactly
// matching the existing 2D silhouette, while separating correctly
// left-right once rotated toward 90°/270° (front/back).
//
// POSE PORT (see CLAUDE.md's "관절/idle 시스템 3D 이식" note): the whole
// idle-behavior/state-machine/cursor-tracking/pose-crossfade system in
// animal-engine.js is reused UNCHANGED via createAnimal()/getPose() - this
// file's only job is turning that same per-frame `pose` object into 3D
// transforms, the exact role drawCreature() plays for 2D canvas. Legs
// (addLegChain/applyLegPose) use nested THREE.Group nesting where a
// child's rotation composes additively with its parent's - correct there
// because the 2D engine's hip/knee angles are already authored as a
// cumulative pair (lowerAngle = hipAngle+kneeAngle). The tail
// (buildTailChain/applyTailChain) does NOT use nested rotation for the
// same reason drawCreature's own tail loop avoids it (see pxJoint's own
// comment): each segment's rest angle is independently absolute (derived
// from that segment's own authored rest position, not a delta from the
// previous segment's), so nesting would need an extra cancel-then-set
// term at every level - instead each segment's hinge position/rotation is
// computed directly in 2D-space (mirroring pxJoint's own math exactly)
// and converted to world space, same spirit as pxJoint's own "fresh
// absolute call per bone" approach.
import * as THREE from 'three';
import { SPECIES, GROUND_Y, legJointAngles } from './animal-engine.js';

const UNIT = 1; // 1 grid unit (same units SPECIES coordinates are authored in) = 1 three.js scene unit
// Uniform trunk depth (body/head) for every species in this pass - true
// Minecraft-mob voxel art actually varies depth per part, but a single
// flat constant per creature is the simplest thing that tests the core
// hypothesis - per-part/per-species depth tuning is a refinement for
// later, only worth doing once the basic approach is confirmed to work.
const DEPTH = 6;
export const HALF_DEPTH = DEPTH / 2; // exported for test tooling that needs to project a screen-space sample point onto a part's front face (see pet3d.js's getFaceShadeSample) - same additive-export spirit as SPECIES/legJointAngles in animal-engine.js
// Lateral (Z) half-separation for paired features. EYE_Z must EXCEED
// HALF_DEPTH (the head's own lateral half-extent) - a box positioned
// anywhere inside that range is fully embedded within the opaque head
// box and invisible from every angle, which is exactly the bug the first
// version of this file had (eyes silently vanished entirely - confirmed
// by rendering, see CLAUDE.md - not just "hard to see", genuinely not
// there in any screenshot at any angle). EAR_Z doesn't have this
// constraint (ears sit above the head's own Y-range, nothing else
// occupies that space to hide behind), so it can stay inside the head's
// nominal width for a more proportionate front-view look. LEG_Z is
// unconstrained the same way (legs hang below the body, no shared Y-range
// with anything else) and is kept noticeably more inboard than the head
// features - real legs don't attach at the torso's very outer edge.
const EYE_Z = HALF_DEPTH + 0.35;
const EAR_Z = HALF_DEPTH * 0.7;
const LEG_Z = HALF_DEPTH * 0.55;
// Small uniform inflation applied to decorative surface boxes (pattern/
// belly/face markings) so they sit just outside whatever's underneath in
// every direction the camera might view them from, instead of z-fighting
// or (see the bug this replaced) being entirely embedded and invisible -
// see addSkinBox.
const SKIN = 0.15;

// Round 5 issue 5 fix ("회전할 때 목 주변이 지지직거림"): there is no neck-
// bridging geometry anywhere in this file (confirmed by grep - unlike the
// 2D engine's own pxJoint-based neck) - the head and body boxes are simply
// two independent, unconnected boxes positioned per their own authored 2D
// rects. For every species, those rects genuinely overlap in X/Y (e.g.
// cat_a: bodyX/W=4/13 spans [4,17], headX/W=15/7 spans [15,22] - a 2-unit
// overlap; confirmed for the full roster) AND both boxes share the exact
// same Z depth (both centered at Z=0, both DEPTH=6 - see makeBox), so
// their FRONT faces sit at the identical Z=+HALF_DEPTH. Coincident-depth
// opaque triangles are the textbook z-fighting setup: the GPU has no
// reliable way to pick a winner, so it flickers between the two colors as
// floating-point rounding shifts with even a fraction of a degree of
// rotation or a sub-pixel pose change - confirmed empirically (a
// diagnostic script rendering the SAME static pose at 0.1 degree rotation
// steps found dozens of pixels jumping between fully different flat
// colors in the head/body junction, for both cat_siamese and dog_husky).
// This was invisible for 8 of the 10 roster species purely by
// coincidence: headColor defaults to bodyColor when a species doesn't set
// it explicitly, so z-fighting between two IDENTICAL colors produces no
// visible artifact at all - only cat_siamese and dog_husky set a
// headColor genuinely different from bodyColor, which is exactly the two
// species z-fighting was actually visible on.
// Fixed with a standard z-fighting remedy (polygon offset): nudge the
// head box very slightly toward the camera (+Z) so its front face is
// UNAMBIGUOUSLY closer than the body's, giving the depth buffer a
// consistent winner instead of a coin-flip. 0.08 world units is small
// enough to be visually imperceptible (HALF_DEPTH is 3 - this is under
// 3% of it) while being far larger than the floating-point precision
// this GPU/orthographic-camera combination actually needs to resolve the
// ambiguity (confirmed - see this fix's own verification in CLAUDE.md).
const HEAD_Z_NUDGE = 0.08;

// Round 10 issue 2 - see addSkinBoxRel's own comment for the full
// investigation. Same "small polygon offset" remedy as HEAD_Z_NUDGE.
// Two tiers, found empirically rather than assumed: the belly-vs-pattern
// TIE (both decals sharing the exact same depth with no differentiation
// at all) was the most obviously-diagnosable cause and a small (0.06)
// PATTERN_OVER_BODY_NUDGE was the first value tried - but a diagnostic
// re-check afterward found flips at pixels OUTSIDE the belly/pattern
// overlap region entirely (still flickering between plain body color and
// plain pattern color, unchanged before/after that first fix), meaning
// the existing SKIN-based margin pattern already had against the body
// underneath (same mechanism belly/snout/etc. all share) just wasn't
// quite enough on its own for this specific case either. Tried 0.3 next
// (5x bigger) specifically to distinguish "still genuine z-fighting,
// needs more margin" from "this residual is unrelated antialiasing-off
// edge jitter, no nudge will touch it" - most checkpoints dropped
// sharply or to exactly 0 (confirming real z-fighting there), while one
// single-pixel-column flip at the 0deg checkpoint stayed at an IDENTICAL
// count with 0.06 and with 0.3, meaning it isn't governed by this nudge
// at all - consistent with an ordinary hard, non-antialiased ("antialias:
// false", this file's own established crisp-pixel-art choice) pattern
// edge landing on a different rasterized pixel at a sub-degree rotation,
// not two competing depth surfaces. Left at 0.3 since it measurably
// helps everywhere it CAN help and is still a small, safe value (5% of
// DEPTH). belly's nudge is layered ON TOP
// of this (not simply a bigger flat number) so the body < pattern <
// belly ordering established by the 2D engine's own draw order (pattern
// first, belly second - see addSkinBoxRel's comment) still holds.
const PATTERN_OVER_BODY_NUDGE = 0.3;
const BELLY_OVER_PATTERN_NUDGE = PATTERN_OVER_BODY_NUDGE + 0.06;

// Round 8 issue 1 - how much bigger/smaller the creature reads per grid
// unit of pose.depthZ (see applyPose below). Tuned so prowlcircle's orbit
// radius (2.6 units, the largest depthZ swing any current idle produces)
// gives a clearly-visible but not cartoonish size change (+-31%ish) -
// checked by rendering, not just picked from the formula.
const DEPTH_SCALE_FACTOR = 0.12;

const lerpNum = (a, b, t) => a + (b - a) * t;

// Round 8 issue 2 helper - a reasonable-looking default "lighter shade of
// this color" for parts that want a two-tone look (currently just inner-
// ear shading) without needing every species to hand-author a second
// color. Blends toward white in THREE.Color's own internal (linear)
// space - not pixel-precise against a naive sRGB lerp, but this is a
// purely decorative default (species can still override with an exact
// authored color via cfg.ear.inner - already hand-authored for 3 species
// from earlier work that never got wired up to any renderer, 2D or 3D;
// this reuses that existing field name/data instead of introducing a
// second, differently-named one), so "looks lighter" is all that's
// needed for the other 7 species that don't set it.
const _lightenTmp = new THREE.Color();
const _lightenWhite = new THREE.Color(0xffffff);
function lightenColor(hex, amount) {
  _lightenTmp.set(hex);
  _lightenTmp.lerp(_lightenWhite, amount);
  return '#' + _lightenTmp.getHexString();
}
// Same idea toward black - needed because MeshBasicMaterial ignores all
// lighting, so a same-color decal sitting on top of (or protruding past)
// a part painted in that same color is 100% invisible regardless of
// depth/angle - there's no shading to reveal the seam the way real light
// would. Found this the hard way: nostril dots were speced as
// cfg.darkColor (matching "nose defaults to darkColor when unset"), which
// for every species without an explicit cfg.nose.color made the dots
// exactly the same flat color as the nose box they sit on - passed the
// earlier Z-protrusion check (they DO clear the surface) but were still
// invisible in a rendered screenshot because color, not depth, was hiding
// them this time. Nose/philtrum details use this to guarantee contrast
// against whatever the nose color actually resolves to.
const _darkenTmp = new THREE.Color();
const _darkenBlack = new THREE.Color(0x000000);
function darkenColor(hex, amount) {
  _darkenTmp.set(hex);
  _darkenTmp.lerp(_darkenBlack, amount);
  return '#' + _darkenTmp.getHexString();
}
// Round 10 issue 3 - "얼굴 색의 밝기(luminance)를 계산해서... 자동으로
// 대비되게" (whisker auto-contrast, see buildWhiskers). Standard Rec.709
// relative-luminance weights (0.2126/0.7152/0.0722), applied directly to
// the 0-255 sRGB channel values rather than THREE.Color's own internal
// LINEAR r/g/b (which lightenColor/darkenColor above deliberately use FOR
// blending, but linear-space values would need their own separate
// threshold calibration to mean the same thing - simpler to just parse
// the hex channels directly here, since this only ever needs a light/dark
// classification, not a blend). Verified against the actual 4 cat faces
// this feeds (cat_a/calico read light at ~0.63/0.96, tuxedo/siamese read
// dark at ~0.09/0.29 - see this feature's own verification in CLAUDE.md),
// not just picked from the formula.
function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Round 12 issue 1 - seam collars (see addSeamCollar below) need a base
// color that references BOTH sides of the junction it sits on, so the
// collar can never come out visibly LIGHTER than one of the two parts it's
// separating. FIRST ATTEMPT (kept as a comment - the failure is worth
// keeping next to the fix): a straight 50/50 blend of the two colors, then
// darken THAT. Broke badly for cat_siamese (dark #5c4636 head vs light
// #e8d9bb body) - averaging a dark and a light color lands on a MEDIUM
// tone, and darkening that medium tone by only 18% (this round's new,
// much gentler amount - see SEAM_COLOR_DARKEN) still left it lighter than
// the head color alone, i.e. the "seam" rendered LIGHTER than the darker
// side it touches - confirmed by reading the live material color back
// (getSeamCollarColors) and computing relative luminance: a -107% "drop"
// from the head color (negative = got brighter, not darker). The blend
// step itself was the bug - it's exactly the wrong tool once the two
// sides' brightness differs a lot, which is precisely the case (a
// distinct headColor) this collar exists to make visible in the first
// place.
//
// FIX: instead of averaging, pick whichever of the two colors is already
// darker (by relativeLuminance) and darken THAT further - guarantees the
// result is darker than the darker side, and therefore darker than BOTH
// sides, by construction. For the common case (8/10 species have no
// distinct headColor, most legColors reuse bodyColor) both inputs are the
// same color, so "pick the darker one" trivially returns that color,
// identical to how this used to work before this round.
function seamBaseColor(colorA, colorB) {
  return relativeLuminance(colorA) <= relativeLuminance(colorB) ? colorA : colorB;
}

function makeBox(w2d, h2d, depth, color) {
  const geo = new THREE.BoxGeometry(w2d * UNIT, h2d * UNIT, depth * UNIT);
  const mat = new THREE.MeshBasicMaterial({ color }); // ignores all lights - every face is flat, solid color, exactly the "no smooth shading" look requested
  return new THREE.Mesh(geo, mat);
}

// Round 9 issue 1 - universal thin part-boundary seam ("태비 고양이,
// 허스키처럼 머리와 몸통 색이 같은 종들은 정면에서 목 경계가 아예 안
// 보여서 실루엣이 뭉개짐"). MeshBasicMaterial ignores lighting entirely
// (this file's established flat-pixel-art choice), so two touching parts
// in the exact same color - cat_a's headColor falls back to bodyColor,
// dog_husky's ears/tail match bodyColor, etc. - render as one unbroken
// block with zero visual seam at ANY angle, since there's no shading
// gradient a smoother renderer would give away the boundary. A per-
// species/per-color-pair patch would need revisiting every time the
// roster changes; this instead marks every major structural junction with
// its own thin dark band regardless of what color either side resolves to.
//
// FIRST ATTEMPT (kept as a comment, not code, since the reasoning for why
// it fails is worth keeping next to the fix): a classic "inverted hull"
// toon outline - a slightly-enlarged, back-face-only (side:THREE.BackSide)
// duplicate of a part's own box. This reliably outlines a part's OUTER
// silhouette (confirmed by rendering - a clean dark edge against the
// background from every angle), but is STRUCTURALLY incapable of showing
// up at an INTERNAL junction between two independently-solid neighboring
// parts, no matter how much the shell is grown: BackSide culls the
// shell's NEAR face and renders only its FAR face, which is by
// construction farther from the camera than the shell's own solid fill -
// so any neighboring part's ordinary (front-facing) near face beats it
// every time they overlap, regardless of any Z-nudge advantage the
// parent mesh has (that advantage only ever helps the PARENT's own
// front-facing fill win, never a BackSide child's back face). Confirmed
// by a per-pixel color scan of the exact neck-seam pixels (see this
// fix's own verification in CLAUDE.md) - the outline color was reliably
// present around every part's outer edge and reliably ABSENT at the
// actual head/body overlap column, no matter how large the growth amount
// was made.
//
// WORKING APPROACH: an explicit, ordinary FRONT-facing thin band (a
// "collar") placed directly at the seam's own 2D coordinate, added as a
// CHILD of whichever part already has (or is given) the Z-advantage over
// its neighbor there - inheriting that part's own position/rotation/
// squash for free, and its own depth-win margin for free too, since a
// front-facing collar's NEAR face is what's compared against the
// neighbor's near face (an apples-to-apples comparison the BackSide shell
// could never make). This is the same "give the part that should win a
// small Z-nudge" precedent HEAD_Z_NUDGE already established, just applied
// to a purpose-built thin marker instead of the whole part.
// Round 12 issue 1 fix ("칼라 자체가 완전히 새까만 선으로 보임, 은은한
// 느낌이 없어짐"): this was 0.55 (darkened over HALF way to pure black) -
// nowhere near "hardcoded black" (darkenColor still scales the ACTUAL part
// color, confirmed by reading the live rendered material back via
// getSeamCollarColors() - dog_pomeranian's neck collar came back as the
// mathematically exact `darkenColor('#e8c896', 0.55)` result, #a28b68, not
// #000000), but 55% is a much more aggressive darken than "1px 살짝 어두운
// 선, 은은하게" calls for, and reads as a harsh near-black line against a
// pale body color at this render size - confirmed against the reported
// screenshot by rendering dog_pomeranian at the same angle and comparing.
// 0.55 was originally tuned back when this collar's only job was "be
// legible enough to break a dead tie between two IDENTICAL colors" (round
// 9) - a different, stricter bar than "look like a subtle natural seam",
// which is what's being asked for now.
//
// Picking the new value needed one extra step, not just "try 0.15-0.2":
// darkenColor's `amount` is a lerp fraction in THREE.Color's own internal
// LINEAR color space (see darkenColor's own comment), but "how dark does
// this look" is a perceptual/sRGB-gamma judgment - the two don't move
// together 1:1. Checked numerically rather than assumed: amount=0.18 (a
// literal reading of "15-20%") only produces an ~8-9% drop in Rec.709
// sRGB relative luminance for a representative sample of this roster's
// body colors - noticeably subtler than what "15-20% darker" was actually
// asking for, just in the other direction from the original bug (too
// faint instead of too harsh). amount=0.32 is what actually lands the
// PERCEIVED drop in the requested 15-20% band (~15-16% across the sample,
// verified per-species in CLAUDE.md) - that's the value used below, even
// though it looks like a bigger number than "15-20%" would suggest at a
// glance.
// Round 14 issue 1 ("목/다리 경계선을 전체적으로 더 연하게") - 0.32 (round
// 12's own value, tuned to land a ~15-17% PERCEIVED/sRGB luminance drop,
// see that round's own comment above) read as more prominent than wanted
// this round. "Less noticeable than now, but parts must still stay
// distinguishable" is a narrower ask than round 12's "15-20%" one, so this
// reuses round 12's own measurement method (check the LIVE material colors
// via getSeamCollarColors/diag-seam-color-subtlety.js, not a Node-side
// darkenColor replication - linear-vs-sRGB and cross-context
// ColorManagement drift are exactly why a lower `amount` doesn't move the
// perceived drop proportionally, see round 12's comment above) rather than
// assuming a lower number in the same units means a proportionally lower
// perceived result. amount=0.2 measured out to a ~9-14% drop across the
// roster's same-color junctions (down from 0.32's ~15-17%, roughly half
// again as subtle, and never near 0% - see this round's own verification
// in CLAUDE.md for the exact per-species numbers).
const SEAM_COLOR_DARKEN = 0.2; // toward black, relative to whichever side's color the collar is tinted from (see darkenColor) - a neutral per-junction shade rather than one flat color, so warm vs cool fur tones each get a seam that still reads as "a darker version of this area"
const SEAM_THICKNESS = 0.5; // grid units tall (2D-Y) - thick enough to read clearly as a band, not just a hairline, matching this file's other "must clear the surface with a comfortable margin, not a hairline" fixes (nostril dots, groom-paw protrusion)

// Round 11 issue 1 fix ("정면에서 보면 다리-몸통/몸통-얼굴 경계에 이상한
// 선이 삐죽 튀어나와 보임", a regression from an earlier round's own fix):
// this collar used to win its z-fight against a deeply-overlapping
// neighbor (see e.g. dachshund: body spans local X [1,20], head's own
// center sits at X=20 - nearly coincident) by growing its own depth
// (local Z, the axis that becomes on-screen WIDTH at 90deg - see the
// module comment) well past that neighbor's own depth. But "past the
// neighbor's depth" and "past the neighbor's own on-screen silhouette
// width at 90deg" are the SAME quantity here (every major part shares the
// same DEPTH constant - see makeBox) - any nudge large enough to win the
// z-test at the seam's center was, by that same arithmetic, guaranteed to
// make the collar's own edges stick out past the neighbor's silhouette on
// both sides. That's not an unlucky side effect, it WAS the winning
// mechanism ("the collar's own edges poke out past whatever's occluding
// its center") - so no nudge value could have ever won the z-test at
// 90deg without also poking out there.
//
// Fixed by dropping the z-test competition entirely rather than re-tuning
// it - a seam collar only needs to mark a boundary line, it never actually
// needed to out-compete a neighboring part for the same depth-buffer
// pixels. `depthTest:false` + a high `renderOrder` makes it always draw on
// top of whatever rendered before it regardless of Z, so its own geometry
// can go back to matching the boundary exactly (depthSpan = the
// neighboring part's own real depth, no added nudge) - which is also what
// stops the poke-out: at 90deg its on-screen width now equals, rather than
// exceeds, the part it sits on. Verified across all 10 species at all 8
// rotation checkpoints (0-315deg in 45deg steps) - see CLAUDE.md.
//
// Adds a thin front-facing band as a child of `parentMesh`, centered at
// `localY` in the parent's OWN local frame (so squash/position math stays
// the parent's problem, not the collar's) and spanning `w2d`/`depthSpan`
// in the other two axes. `depthSpan` defaults to this file's normal
// per-part DEPTH so the collar is exactly as "thick" (front-to-back) as
// the parts it's separating - visible as a real band from every angle,
// not just a sliver at 0/180deg.
// Round 15 issue 1 removed the shoulder/hip leg collar entirely (this used
// to be shared by a now-deleted addSeamCollar helper and addNeckSeamCollar
// below - only the latter remains, so this is only ever called with
// seamPart:'neck' now, but the parameter stays since test tooling (e.g.
// test/diag-seam-color-subtlety.js) already filters on it rather than
// array position - removing it would just be churn for no benefit).
function finalizeSeamCollarMesh(mesh, parentMesh, seamPart) {
  mesh.material.depthTest = false; // always draw on top - see the module comment above (round 11 issue 1) for why winning a real z-test was the wrong mechanism
  mesh.material.depthWrite = false; // this purely-cosmetic band shouldn't punch a hole in the depth buffer for anything rendered after it
  mesh.renderOrder = 999; // after all normal (default renderOrder 0) opaque geometry, so depthTest:false means "on top of everything" rather than just "on top of whatever the scene graph happened to add earlier"
  mesh.userData.isSeamCollar = true; // debug marker only (test tooling traverses for this) - zero cost/behavior change in the real app
  mesh.userData.seamPart = seamPart; // 'neck' always, as of round 15 - see this function's own comment
  parentMesh.add(mesh);
  return mesh;
}

// Round 14 issue 2 ("턱시도 목 칼라가 흰 배/가슴 무늬 위에 튀어나와 보임") -
// the neck collar's tint used to come from seamBaseColor(headColor||
// bodyColor, bodyColor) unconditionally, i.e. "whatever's darker between
// the head and body's OWN base colors" - but at several species (checked
// all 10, see this round's own verification in CLAUDE.md) the collar's own
// 2D footprint (headX..headX+headW at Y=headBottomY2D) actually overlaps a
// belly/pattern DECAL that's a very different color from bodyColor - most
// visibly cat_tuxedo's white chest patch (bodyColor is near-black, so the
// old tint darkened black -> still-near-black, rendering as a stark dark
// bar wherever the collar crossed onto the white decal instead of the
// body's own black). cat_calico/dog_corgi/dog_husky/dog_pomeranian all
// have a lighter belly/pattern patch that reaches into the same X/Y
// footprint too, just less dramatically (their base bodyColor is already
// lighter, so the old behavior was a smaller mismatch there, not zero).
//
// decalColorAt: what's actually painted at this (x2d,y2d) SPECIES-space
// point - checks belly first, then pattern (matching this file's own
// belly-over-pattern Z-priority, BELLY_OVER_PATTERN_NUDGE > PATTERN_OVER_
// BODY_NUDGE, so where both would cover the same spot this returns
// whichever one the renderer actually shows on top) - null if neither
// covers it, so the caller falls back to the old bodyColor/headColor-based
// tint exactly as before.
function decalColorAt(cfg, x2d, y2d) {
  // cfg.belly can now be a single object OR an array (round 17 issue 3,
  // "턱시도... V자" - see buildVoxelCreature's own comment) - same
  // Array.isArray branch cfg.pattern/cfg.snout already use.
  if (cfg.belly) {
    const bellies = Array.isArray(cfg.belly) ? cfg.belly : [cfg.belly];
    for (const b of bellies) {
      if (x2d >= b.x && x2d <= b.x + b.w && y2d >= b.y && y2d <= b.y + b.h) return b.color;
    }
  }
  if (cfg.pattern) {
    for (const p of cfg.pattern) {
      if (x2d >= p.x && x2d <= p.x + p.w && y2d >= p.y && y2d <= p.y + p.h) return p.color;
    }
  }
  return null;
}

// Round 16 issue 1 ("목 경계선 적용 종을 명시적으로 지정") - replaces round
// 15's automatic headColor/bodyColor comparison (headBodyColorsMatch,
// removed) with a directly-authored list, per this round's own request.
// Round 15's rule ("keep the collar only where headColor genuinely equals
// bodyColor") produced a split that didn't match what round 16 actually
// wants for this roster (most visibly dog_husky, whose headColor is
// genuinely different from bodyColor and would've been auto-excluded, but
// is explicitly INCLUDED here) - an explicit list sidesteps needing the
// automatic rule to agree with a case-by-case editorial call at all.
// Round 17 issue 1 adds dog_pomeranian to this list - the front-cap
// mechanism itself (addNeckSeamCollar below) is unchanged, this is purely
// an editorial addition to the explicit roster.
const NECK_SEAM_SPECIES = new Set(['cat_a', 'cat_tuxedo', 'cat_calico', 'dog_dachshund', 'dog_husky', 'dog_pomeranian', 'rabbit_b', 'hamster']);

// Round 16 issue 2 ("경계선은 정면 한 각도에서만 보이게") - the neck collar
// used to be a BOX with real extent along BOTH the head's local X axis
// (front-to-back/nose direction, ~headW wide - what made it read as a
// horizontal band at PROFILE view, 0/180deg) and local Z (what made it
// read as a horizontal band at FRONT/BACK view, 90/270deg - see the
// module comment on why Z becomes on-screen width there). Real extent on
// BOTH axes plus depthTest:false (round 11) meant it always won the depth
// fight and always presented SOME horizontal cross-section - a ring around
// the neck, visible from every angle. This round wants it to mark the
// boundary ONLY when viewed from directly in front (nose pointing at the
// camera - rotation.y=-90deg/270deg; camera sits on the world +Z axis
// looking toward the origin, see camera.position.set/lookAt near the top
// of pet.js/pet3d.js), and to be genuinely invisible from profile (0/
// 180deg - where the face-in-front-of-body silhouette is already natural
// on its own and shouldn't get an extra line following behind it) and
// from directly behind (90deg).
//
// Standard GPU face culling gives this for free once the collar becomes a
// flat PLANE (zero thickness, THREE.PlaneGeometry - not a thin box) with
// its face normal along the head's own local +X (the species-authored
// "nose" direction - every SPECIES entry's headX sits to the +X side of
// bodyX, confirmed by inspection). Working through THREE's standard Y-axis
// rotation matrix: rotating the whole model by -90deg (the front pose)
// sends local +X to world +Z, i.e. straight at the camera - a plane facing
// the camera head-on renders at full size. At profile (0/180deg) that same
// local +X normal ends up along world +-X, perpendicular to the camera's
// view direction (camera looks along Z) - a plane seen exactly edge-on has
// exactly zero screen-space area (a true zero-thickness PlaneGeometry, not
// an approximation), so it rasterizes to zero pixels. At the back pose
// (90deg) local +X maps to world -Z, pointing AWAY from the camera -
// MeshBasicMaterial's default single-sided (THREE.FrontSide) culling drops
// back-facing polygons entirely, so nothing draws there either. All three
// cases fall out of the geometry alone, continuously across every angle in
// between (not just the 8 sweep checkpoints) - no manual angle-detection
// code needed, and depthTest:false/renderOrder (finalizeSeamCollarMesh,
// unchanged) still make the visible front-pose case win against the head's
// own geometry sitting partway in front of it along the (now depth-facing)
// local X axis.
//
// The plane's in-plane extent spans local Y (thin, SEAM_THICKNESS - stays
// vertical at every rotation, unaffected by spinning around Y) and local Z
// (capWidth, sized to the SAME "match the head's own actual depth, don't
// exceed it" value round 11 established for the old box's depthSpan - so
// this doesn't poke out past the head's own silhouette at the front pose
// either).
//
// Tint: round 14's per-X-position decal segmentation doesn't have
// anything left to segment along now that the cap has zero X-extent (a
// flat plane, not a box spanning headW) - checks decalColorAt ONCE, at
// cfg.headX (the head's body-facing edge - the closest this engine's 2D-
// authored coordinates get to "the actual neck junction point") and
// headBottomY2D, falling back to the same bodyColor-based tint as before
// wherever no decal covers that point.
function addNeckSeamCollar(headMesh, cfg, headBottomY2D, capWidth) {
  const fallbackTint = seamBaseColor(cfg.headColor || cfg.bodyColor, cfg.bodyColor);
  const tint = decalColorAt(cfg, cfg.headX, headBottomY2D) || fallbackTint;
  const geo = new THREE.PlaneGeometry(capWidth * UNIT, SEAM_THICKNESS * UNIT);
  const mat = new THREE.MeshBasicMaterial({ color: darkenColor(tint, SEAM_COLOR_DARKEN) }); // default side:THREE.FrontSide - the back-face culling this whole fix depends on
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 2; // reorients PlaneGeometry's default +Z-facing normal to local +X (nose direction) - see this function's own comment
  mesh.position.set(0, -cfg.headH / 2, 0); // head's own bottom edge, in headMesh's local frame (box geometry centered at the mesh's own origin) - same anchor the old box used
  finalizeSeamCollarMesh(mesh, headMesh, 'neck');
}

// Round 17 issue 3 tried a front-cap-only MASK here (addFrontVMask - same
// plane/rotation/depthTest:false recipe as addNeckSeamCollar, painting
// bodyColor back over a decal's outer edges to carve a V shape when viewed
// close to the front pose) for cat_tuxedo's chest blaze. Round 18 removed
// it after finding a visible ghosting/misalignment artifact at the
// intermediate angles (225/315deg) where the mask is only partially
// visible: a flat plane's apparent width follows a pure cosine falloff as
// it rotates away from face-on, but the underlying BOX decal's apparent
// width doesn't foreshorten the same way (a box's depth face starts
// showing too as it rotates, unlike a zero-thickness plane) - so the
// mask's coverage silently stopped lining up with the decal's actual
// edges anywhere off the exact front pose. Confirmed structural (same
// artifact with no neck-seam overlap involved), not a settings/blend/
// render-order issue - no known fix within this file's plane-based
// technique, so this was rolled back rather than patched further. If a
// similar "mask part of a decal so it reads as a different shape from one
// specific angle" need comes up again, a same-primitive-type approach
// (e.g. a second decal box, not a flat plane) would need to be found
// first to avoid this same mismatch.

// Absolute-position placement (world-style coordinates within whatever
// group it's added to, assuming that group has no extra offset of its
// own) - used for every part that doesn't need to SCALE around a shared
// anchor (ears/eyes/nose/snout/cheeks/legs/tail - see the module comment
// on why those are handled differently from body/head).
function addBox(group, x2d, y2d, w2d, h2d, color, depth = DEPTH, zOffset = 0) {
  if (w2d <= 0 || h2d <= 0) return null;
  const mesh = makeBox(w2d, h2d, depth, color);
  mesh.position.set(
    (x2d + w2d / 2) * UNIT,
    (GROUND_Y - y2d - h2d / 2) * UNIT, // flips the 2D engine's top-down Y (increases downward, GROUND_Y near the bottom of the grid) into a bottom-up world Y (increases upward, matching three.js/OpenGL convention) - GROUND_Y itself becomes world Y=0, the floor
    zOffset * UNIT
  );
  group.add(mesh);
  return mesh;
}

// extraZNudge (default 0) - see addSkinBoxRel's own comment on why belly
// needs this and pattern/snout don't. Grows depth symmetrically (added to
// BOTH the +Z and -Z half-extents via the depth param, box stays centered
// at zOffset=0) rather than shifting the box's position - see
// addSkinBoxRel's comment for why a position shift was the wrong tool here.
// zWidth (round 17 issue 3, "턱시도... V자 모양" - see buildVoxelCreature's
// cfg.snout/cfg.belly comments): optional EXPLICIT depth override, for
// decal segments that need to be narrower than the part's own full depth
// (e.g. a chest blaze that tapers from a narrow chin-width strip to a
// full-chest-width one) instead of always wrapping the whole surface.
// Defaults to null (every pre-existing call site is unaffected, same
// formula as before).
function addSkinBox(group, x2d, y2d, w2d, h2d, color, extraZNudge = 0, zWidth = null) {
  const depth = zWidth != null ? zWidth : DEPTH + SKIN * 2 + extraZNudge * 2;
  return addBox(group, x2d - SKIN / 2, y2d, w2d + SKIN, h2d, color, depth, 0);
}

// Anchor-relative placement - identical to addBox, except Y is measured
// against a supplied reference 2D-Y (refY2D) instead of GROUND_Y directly.
// Used for parts that need to live inside a group whose OWN position
// already represents that reference point, so the group's `scale.y` (set
// per frame - see applyBodyPose) scales this part around that anchor for
// free via Three.js's normal parent-child transform composition, instead
// of each part needing its own hand-derived squash formula the way the 2D
// engine's toBodySquashed()/headTopY do.
function addBoxRel(group, x2d, y2d, w2d, h2d, color, refY2D, depth = DEPTH, zOffset = 0) {
  if (w2d <= 0 || h2d <= 0) return null;
  const mesh = makeBox(w2d, h2d, depth, color);
  mesh.position.set((x2d + w2d / 2) * UNIT, (refY2D - y2d - h2d / 2) * UNIT, zOffset * UNIT);
  group.add(mesh);
  return mesh;
}
// Round 10 issue 2 fix ("커서가 가까이 오면 줄무늬가 지지직거림") - found
// via the same tiny-angle-delta technique the original neck z-fighting
// bug used (test/diag-neck-zfight.js, adapted as test/diag-tabby-
// zfight.js): cat_a's tabby `pattern` stripes and its `belly` patch are
// BOTH skin-wrap decals added via this same function with the exact same
// depth (DEPTH+SKIN*2, centered at Z=0) and genuinely OVERLAPPING (x,y)
// footprints (belly x:6-15,y:17-19 fully contains the bottom of every
// stripe's x:7-8/10-11/13-14,y:13-19 range) - two coincident-depth
// surfaces in their shared region, the textbook z-fighting setup, same
// as the neck bug just between two DECALS instead of a part and its
// neighbor. This wasn't about insufficient margin against the BODY
// underneath (that part was already fine) - it's a tie between two
// SIBLING decals that never had any Z-priority relative to EACH OTHER.
// Confirmed empirically: interior pixels (excluding the silhouette edge)
// flipped between the pattern color and the belly color at every one of
// 8 rotation checkpoints spanning the full circle, across a rotation
// delta of well under 1 degree - nothing legitimate changes that fast,
// only two competing surfaces racing for the same depth.
//
// Fix mirrors HEAD_Z_NUDGE's own remedy (polygon offset) rather than
// inventing a new one: `extraZNudge`, applied ON TOP OF the existing
// SKIN-based margin these already share, defaulting to 0 (every other
// skin decal - snout, faceShade stripe, etc. - is unaffected). Only
// `belly` passes a nonzero value (see buildVoxelCreature) - not
// `pattern`, because the 2D engine (drawCreature) draws pattern FIRST
// and belly SECOND, so belly already visually wins their overlap there;
// giving belly the Z-priority in 3D too keeps the two renderers showing
// the same result instead of leaving it to chance which one the 3D
// engine's own (unrelated) add-order happens to favor.
//
// Round 10 REGRESSION fix (found right after the above shipped, "왼쪽
// 몸통 줄무늬가 사라짐"): the first implementation applied extraZNudge as
// a Z-POSITION shift (zOffset) on a box that's otherwise centered at
// Z=0 - moving the center by +0.3 toward +Z gains +0.3 margin on the +Z
// face but SPENDS that same 0.3 off the -Z face's margin. The pre-
// existing SKIN-only margin on each face was only +0.15 (that's what
// let this go unnoticed for head/snout/etc. at HEAD_Z_NUDGE's much
// smaller 0.08 - never enough to flip the sign), so pattern's own 0.3
// nudge overdrew it: -Z face went from a safe +0.15 margin against the
// body to a losing -0.15, meaning pattern's -Z face ended up BEHIND
// (inside) the body's own -Z face on that side - not a flicker, a
// stable, fully-invisible loss every frame, which is exactly why the
// original tiny-angle-delta z-fight diagnostic (built to catch
// INSTABILITY between adjacent angles) never flagged it: a consistently
// wrong answer produces zero flicker by that method's own definition.
// belly (nudge 0.36) had the identical bug, just with a slightly worse
// losing margin (-0.21) on its already-narrower far side.
//
// Fix: grow the box's own depth by extraZNudge on EACH side (passed as
// depth, not zOffset - keeping the box centered at Z=0 via addBoxRel's
// own zOffset=0 default) instead of shifting its center - this gives
// the +0.3 margin to BOTH faces at once, matching the working +Z side's
// outcome instead of trading one face's margin for the other's.
// zWidth - same explicit-depth-override escape hatch as addSkinBox's own
// (round 17 issue 3), for body-side (belly) segments of a tapered decal.
function addSkinBoxRel(group, x2d, y2d, w2d, h2d, color, refY2D, extraZNudge = 0, zWidth = null) {
  const depth = zWidth != null ? zWidth : DEPTH + SKIN * 2 + extraZNudge * 2;
  return addBoxRel(group, x2d - SKIN / 2, y2d, w2d + SKIN, h2d, color, refY2D, depth, 0);
}

// 3D counterpart of the 2D engine's pxDitherRadial-driven cfg.faceShade
// (round 4 issue 4 - see CLAUDE.md's "샴 고양이 얼굴 그라데이션" note).
// Builds the head box with a smooth PER-VERTEX radial color gradient
// (dark at the eyes/nose, lightening toward the radius) instead of the
// single flat MeshBasicMaterial color every other box in this file uses.
//
// This was never ported when the pose/rendering system moved to 3D - this
// file never referenced cfg.faceShade anywhere at all (confirmed by
// grep), so the siamese cat's colorpoint face has been rendering as a
// single flat headColor block since the 3D port, with no gradient of any
// kind - not a regression from something that broke, a feature that was
// simply never built.
//
// 2D's ordered (Bayer) dithering exists specifically to FAKE a smooth
// gradient using only flat, undithered per-pixel fills, because a 2D
// canvas rect has no interpolation of its own to lean on. A BoxGeometry's
// vertices, in contrast, interpolate their assigned colors smoothly
// across each face for free (standard Gouraud interpolation) - so
// reproducing the dither PATTERN itself isn't the goal here, just the
// same underlying radial falloff it approximates; a true smooth gradient
// is simpler to build and, for an actual cat coat, arguably more faithful
// than a checkerboard would be. This is a deliberate, narrow exception to
// the flat-shaded-box look used everywhere else in this file (real
// MeshBasicMaterial with vertexColors instead of a single solid color),
// scoped to exactly the species that opt in via cfg.faceShade (currently
// only cat_siamese) - every other species' head is untouched.
//
// Falloff is a function of (x2d,y2d) ALONE, never Z/depth - every vertex
// sharing the same grid (x,y), regardless of which of the box's 6 faces
// it belongs to (the two broad "face" Z-faces, the top/bottom, or the
// nose/tail-end X-faces), gets the identical color. This matters because
// it's what avoids a hard color seam at any box edge: 2D's own version is
// likewise a flat function of (x,y) alone with no depth component to
// begin with, so matching that keeps every edge seamless by construction
// rather than needing separate tuning per face.
const _faceShadeColorA = new THREE.Color();
const _faceShadeColorB = new THREE.Color();
const _faceShadeLerped = new THREE.Color();

// ---------------------------------------------------------------------
// Round 7 rewrite: canvas-texture face shading. Rounds 4-6 all used a
// per-vertex color gradient on the head BoxGeometry, and all three times
// the user reported it still didn't actually look right on screen despite
// the underlying math checking out every time. This round finally found
// the real root cause: a plain (unsubdivided) BoxGeometry has only 4
// UNIQUE (x2d,y2d) positions per face (confirmed by dumping
// getFaceShadeVertexColors() - 24 total vertex entries, but only 4
// distinct (x,y) pairs among them, one per corner) - per-vertex color on
// that is a 4-corner bilinear blend, not a real radial falloff, no matter
// how "correct" the math computing each corner's own color is.
// Subdividing the geometry (20x20 segments) DID fix this for the two
// "broad" faces (+z/-z, the ones a 0deg/180deg side view shows - see this
// file's own module comment on the coordinate convention) - rendered and
// confirmed genuinely smooth there. But the other 4 faces (+x/-x/+y/-y)
// each only vary along ONE of (x2d,y2d) at a time (the other coordinate
// is pinned to a single edge value on that face, by definition of it
// being a box edge) - no amount of subdivision can make a 1D slice show a
// full 2D radial field. +x in particular becomes the camera-facing "front
// of the face" at 90/270deg - an intentional, regularly-reached viewing
// angle per this file's own design (see the module comment on why
// bilateral features mirror across Z) - and rendering confirmed it still
// looked like a flat block there even after subdividing.
//
// Fix: canvas-drawn texture on the +z/-z faces (crisp, exact control,
// completely unaffected by vertex/GPU interpolation limits - draws the
// mask shape directly instead of asking a formula-plus-interpolation
// pipeline to approximate it), matching the reference photo
// (assets/reference/siamese-real-photo.webp) more precisely than a pure
// mathematical radial falloff could anyway - real fur mask edges are soft
// and organic, not a mathematically clean circle. The other 4 faces keep
// the vertex-color fallback (still smooth post-subdivision, just not as
// precisely shaped) since a full second texture-mapped treatment for
// those rarer angles wasn't worth the added complexity - see CLAUDE.md
// for the visual comparison this tradeoff was based on.
// ---------------------------------------------------------------------
const FACE_TEXTURE_PX_PER_UNIT = 24; // texture resolution, texture px per grid unit

// Paints the colorpoint mask directly: a headColor->highlight radial
// falloff centered on the eyes (same focus/radius formula the vertex
// fallback uses, just evaluated once per texture pixel instead of
// interpolated from a handful of vertices) plus an optional cream
// forehead stripe (cfg.faceShade.stripe) painted on top, between the
// ears - the ears themselves are separate flat-colored boxes (buildEars)
// entirely untouched by this, so they stay a fixed dark tone as intended
// (matching the reference photo's solid dark ears).
function buildFaceShadeTexture(cfg) {
  const { headX, headY, headW, headH } = cfg;
  const fs = cfg.faceShade;
  const w = Math.max(1, Math.round(headW * FACE_TEXTURE_PX_PER_UNIT));
  const h = Math.max(1, Math.round(headH * FACE_TEXTURE_PX_PER_UNIT));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const focusX = fs.focusX ?? (cfg.eye.x + cfg.eye.w / 2);
  const focusY = fs.focusY ?? (cfg.eye.y + cfg.eye.h / 2);
  const radius = Math.max(0.5, fs.radius ?? Math.max(headW, headH) * 0.95);
  const headColor = cfg.headColor || cfg.bodyColor;

  // (x2d,y2d) -> texture pixel - the exact inverse of the UV formula
  // addFaceShadedHeadBox assigns per-vertex (u=(x2d-headX)/headW,
  // v=(y2d-headY)/headH), with texture.flipY=false below so there's no
  // hidden extra flip on top of this - canvas row 0 (top) is authored
  // y2d=headY, column 0 (left) is authored x2d=headX, matching the 2D
  // engine's own top-down/left-right grid convention throughout this
  // file.
  const toPx = (x2d, y2d) => [(x2d - headX) * FACE_TEXTURE_PX_PER_UNIT, (y2d - headY) * FACE_TEXTURE_PX_PER_UNIT];

  const [fx, fy] = toPx(focusX, focusY);
  const rPx = radius * FACE_TEXTURE_PX_PER_UNIT;
  const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, rPx);
  grad.addColorStop(0, headColor);
  grad.addColorStop(1, fs.highlight);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // createRadialGradient clamps to the last color stop past rPx, so the
  // fillRect covering the whole canvas is already flat fs.highlight
  // outside the radius - matches the vertex fallback's own
  // clamp(dist/radius,0,1) saturation.

  if (fs.stripe) {
    const s = fs.stripe;
    const [sx, sy] = toPx(headX + headW / 2 - s.w / 2, headY);
    ctx.fillStyle = s.color;
    ctx.fillRect(sx, sy, s.w * FACE_TEXTURE_PX_PER_UNIT, s.h * FACE_TEXTURE_PX_PER_UNIT);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; // manual UVs below assume no implicit flip - see toPx's own comment
  // A CanvasTexture's own pixel data is sRGB-encoded (browsers always
  // produce canvas 2D output that way), but THREE.Texture's own default
  // colorSpace is NoColorSpace ("treat as already linear, don't convert")
  // - without this line the renderer's own sRGB output transform gets
  // applied ON TOP of already-sRGB data, double-brightening every color
  // (confirmed by rendering: the mask's darkest visible pixels came out
  // far lighter than either configured endpoint, headColor or highlight -
  // impossible from a plain 2-color gradient, only explainable by an
  // extra unwanted brightening pass). This is the same "which color
  // space is this number actually in" class of issue the per-vertex
  // version ran into with THREE.Color's own internal linear storage (see
  // CLAUDE.md) - textures have the identical pitfall, just via a
  // different property.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function addFaceShadedHeadBox(group, cfg, refY2D) {
  const { headX, headY, headW, headH } = cfg;
  const fs = cfg.faceShade;
  // Subdivided (20x20) so the vertex-color FALLBACK (the 4 faces the
  // texture below doesn't cover) is a smooth falloff, not a 4-corner
  // bilinear smear - see this function's own leading comment.
  // Depth grown by HEAD_Z_NUDGE*2 (both faces), NOT shifted - see this
  // function's own mesh.position comment below (round 10 issue 1 fix).
  const geo = new THREE.BoxGeometry(headW * UNIT, headH * UNIT, (DEPTH + HEAD_Z_NUDGE * 2) * UNIT, 20, 20, 1);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  const focusX = fs.focusX ?? (cfg.eye.x + cfg.eye.w / 2);
  const focusY = fs.focusY ?? (cfg.eye.y + cfg.eye.h / 2);
  const radius = Math.max(0.5, fs.radius ?? Math.max(headW, headH) * 0.95);
  _faceShadeColorA.set(fs.highlight);
  _faceShadeColorB.set(cfg.headColor || cfg.bodyColor);
  for (let i = 0; i < pos.count; i++) {
    // Local vertex coords are relative to the box's own center - undo
    // that the same way addBoxRel's own position.set math does, just per-
    // vertex instead of per-mesh, to land back in the same authored
    // (x2d,y2d) grid space cfg.eye/cfg.faceShade are defined in. Y is
    // negated (2D grid Y increases downward, local/world Y increases up -
    // same flip addBox's own comment documents).
    const x2d = headX + headW / 2 + pos.getX(i) / UNIT;
    const y2d = headY + headH / 2 - pos.getY(i) / UNIT;
    const dist = Math.hypot(x2d - focusX, y2d - focusY);
    const t = Math.max(0, Math.min(1, dist / radius));
    _faceShadeLerped.copy(_faceShadeColorB).lerp(_faceShadeColorA, t);
    colors[i * 3] = _faceShadeLerped.r;
    colors[i * 3 + 1] = _faceShadeLerped.g;
    colors[i * 3 + 2] = _faceShadeLerped.b;
    // Overrides BoxGeometry's own default UVs with an exact, known
    // mapping (the precise inverse of buildFaceShadeTexture's toPx)
    // instead of depending on BoxGeometry's own per-face UV convention,
    // which this file has no other reason to already know precisely.
    uv.setXY(i, (x2d - headX) / headW, (y2d - headY) / headH);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const vertexColorMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const texturedMat = new THREE.MeshBasicMaterial({ map: buildFaceShadeTexture(cfg) });
  // BoxGeometry always creates its 6 face groups in +x,-x,+y,-y,+z,-z
  // order - confirmed empirically (rendered with only the +z/-z slots
  // textured and checked which face lit up at rotation.y=0, this engine's
  // default resting orientation - see CLAUDE.md). +z/-z are the two
  // "broad" faces spanning the full authored (x2d,y2d) grid, so they get
  // the crisp texture; +x/-x/+y/-y (rarer angles - 90/270deg or top/
  // bottom, essentially never seen straight-on in normal use) keep the
  // vertex-color fallback.
  const mesh = new THREE.Mesh(geo, [vertexColorMat, vertexColorMat, vertexColorMat, vertexColorMat, texturedMat, texturedMat]);
  // Round 10 issue 1 fix: HEAD_Z_NUDGE used to be applied here as a
  // Z-POSITION shift (matching addBoxRel's own old mechanism before that
  // was ALSO fixed - see addSkinBoxRel's comment for the full asymmetric-
  // margin bug this class of fix addresses) - shifting this mesh's
  // position by +HEAD_Z_NUDGE gained margin on the +Z face but spent the
  // identical amount off the -Z face, which for siamese specifically (the
  // only species using this function - faceShade only exists on species
  // with a distinct headColor, the same condition that makes head/body
  // z-fighting visible) meant the head would lose to body outright on
  // one entire rotation half. Depth is grown symmetrically above instead
  // (both faces gain HEAD_Z_NUDGE), so position stays at Z=0 - the box is
  // simply centered right where addBoxRel's own default (zOffset=0) would
  // put it, with a larger depth doing the winning instead of a shift.
  mesh.position.set((headX + headW / 2) * UNIT, (refY2D - headY - headH / 2) * UNIT, 0);
  group.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------
// Leg joint chain (hip->knee->paw). Reuses the 2D engine's own
// legJointAngles(cfg, pose, isFront) for the hip/knee angle math verbatim
// (imported, not reimplemented) - only HOW those angles get drawn changes.
// THREE.Group nesting (kneePivot is a CHILD of hipPivot) makes "the knee
// stays attached to the hip" a structural guarantee, and Z-axis rotation
// composes additively across the nesting - see the module comment.
// Verified against 2D's exact per-species tuckHip/tuckKnee/swingAmp output
// for all 10 species (see CLAUDE.md's leg-joint-prototype note).
// ---------------------------------------------------------------------
function addLegChain(parent, cfg, isFront, zSide) {
  const j = isFront ? cfg.joints.front : cfg.joints.back;
  const legX = isFront ? cfg.legFrontX : cfg.legBackX;
  const legW = isFront ? cfg.legFrontW : cfg.legBackW;
  if (!(legW > 0) || !j) return null;
  const upperLen = j.upperLen;
  const lowerLen = j.lowerLen;
  const lowerW = Math.max(0.5, legW - 0.3); // slight taper, matching the 2D chain's own upperW/lowerW distinction

  const hipPivot = new THREE.Group();
  // Hinge at (legX + legW/2, legY) in 2D-data terms - same hip hinge point
  // every 2D species already authors (see the SPECIES table's own
  // "legY must equal bodyY+bodyH exactly" convention note). legY itself is
  // applied per-frame (bodyBob/squash) by applyBodyPose, not here.
  hipPivot.position.set((legX + legW / 2) * UNIT, (GROUND_Y - cfg.legY) * UNIT, zSide * UNIT);

  const upperMesh = makeBox(legW, upperLen, legW, cfg.legColor);
  upperMesh.position.set(0, (-upperLen / 2) * UNIT, 0); // hangs from the hinge (local Y=0) down to -upperLen, matching pxJoint's angle=0 "straight down"
  // Round 15 issue 1 ("다리 경계선은 색이 같든 다르든 상관없이 다 없애줘") -
  // this used to add a shoulder/hip seam collar here (addSeamCollar, round
  // 9-14) at every leg's top edge where it meets the body. Removed
  // outright per this round's request, for every species regardless of
  // whether legColor/bodyColor actually match - see CLAUDE.md's round 15
  // writeup for why (the neck collar's removal criterion this same round
  // is conditional on color match, but the leg collar's removal isn't -
  // this one is unconditional).
  hipPivot.add(upperMesh);

  const kneePivot = new THREE.Group();
  kneePivot.position.set(0, -upperLen * UNIT, 0); // the upper bone's own far end, in the hip's local (possibly rotated) frame - this is what makes the knee rigidly follow the hip
  hipPivot.add(kneePivot);

  // Round 11 issue 2 fix ("턱시도 고양이 발쪽이 지지직거림"): when a
  // species has a paw marking (cfg.pawColor, e.g. tuxedo's white socks),
  // the OLD code built lowerMesh at the full lowerLen height and THEN
  // stacked pawMesh on top spanning the same lowerW/lowerW footprint over
  // the tip fraction of that same range - i.e. lowerMesh and pawMesh were
  // two fully coincident boxes (identical X/Y/Z extents, not just close)
  // over the whole paw region, the most severe form of the belly/pattern-
  // style z-fighting this file has hit before (see addSkinBoxRel's own
  // comment for that lineage) - genuinely undefined which color wins each
  // pixel there, unlike a small-margin near-miss. No species other than
  // tuxedo sets cfg.pawColor (grep-confirmed), which is exactly why this
  // was reported as "tuxedo's paw flickers" and not a wider symptom.
  //
  // Fixed by tiling instead of stacking: lowerMesh only covers the NON-paw
  // portion of the bone (boneLen = lowerLen*(1-pawFraction) when a paw
  // color exists, else the full lowerLen as before), and pawMesh exactly
  // fills the remaining tip - the two boxes now share a boundary instead
  // of a volume, so there's nothing left to compete for the same pixels.
  const pawFraction = cfg.pawColor ? (cfg.pawFraction ?? 0.35) : 0;
  const boneLen = lowerLen * (1 - pawFraction);
  const lowerMesh = makeBox(lowerW, boneLen, lowerW, cfg.legColor);
  lowerMesh.position.set(0, (-boneLen / 2) * UNIT, 0);
  kneePivot.add(lowerMesh);

  // Paw color (e.g. cat_tuxedo's white sock on an otherwise black leg,
  // see drawLegChain's own pawColor/pawFraction) - a short extra segment
  // at the lower bone's own far end, same treatment as the 2D engine's
  // cap-on-top-of-the-lower-bone approach (2D can afford to literally draw
  // one over the other since a canvas has no z-fighting; 3D instead tiles
  // them edge-to-edge, see this block's leading comment).
  let pawMesh = null;
  if (cfg.pawColor) {
    const pawLen = lowerLen * pawFraction;
    pawMesh = makeBox(lowerW, pawLen, lowerW, cfg.pawColor);
    pawMesh.position.set(0, (-boneLen - pawLen / 2) * UNIT, 0);
    kneePivot.add(pawMesh);
  }

  parent.add(hipPivot);
  // upperMesh/lowerMesh/pawMesh/zSide exposed (not just the pivots) so
  // applyLegPose can highlight AND reposition the front paw during
  // grooming - see its own comment on why a same-colored raised paw is
  // not just hard to see but genuinely OCCLUDED in 3D even though the 2D
  // sprite reads fine without any of this.
  return { hipPivot, kneePivot, upperMesh, lowerMesh, pawMesh, zSide };
}

// Grooming visual-clarity fix (voxel-only - see CLAUDE.md's "그루밍 발-
// 얼굴 색 구분" note). Three stacked problems, found in this order while
// investigating the user's report that the raised paw "isn't visible":
// 1. OCCLUSION (the real root cause, found via getBBoxDebug world-space
//    AABBs - see CLAUDE.md): hip/knee rotation only moves the leg in its
//    own local X/Y plane - the hip pivot's own Z (LEG_Z, a fixed bilateral
//    offset set once at build time) never changes, so a "raised toward
//    the face" paw stays at the SAME lateral depth as a standing one,
//    still well within the head's own Z-extent ([-HALF_DEPTH,
//    +HALF_DEPTH]). The head's own front face sits closer to the camera
//    than the leg's, so the head's opaque geometry hides the raised paw
//    completely - not merely hard to see, genuinely behind an opaque
//    surface, confirmed via bounding-box overlap on all 3 axes. Same
//    underlying class of bug as the earlier EYE_Z/belly-pattern embedding
//    fixes (a part must protrude PAST whatever's in front of it in Z to
//    be visible at all) - just not caught earlier because a standing leg
//    never needs to protrude past the head. Fixed by pushing the raised
//    leg's own Z (in its own bilateral direction, so the "near" copy
//    pushes toward the camera and the "far" copy pushes away, matching
//    how a real paw lifted toward the face would come out toward whichever
//    side it's on) past GROOM_PROTRUDE_Z (just beyond the head's own
//    surface), scaled by frontLegRaise.
// 2. Once actually visible, a same-colored raised paw tip against the head
//    could still be hard to READ - GROOM_HIGHLIGHT blends it toward white.
//    Scoped to the paw mesh ONLY, and only for species that actually have
//    one (cfg.pawColor - see applyLegPose's own comment, round 5 issue 2:
//    this used to also blend the upper/lower leg BONES for every species
//    regardless of whether it has any paw marking, which just reads as an
//    unrelated gray leg for species like siamese/cat_a with no pawColor).
// Both scale with pose.frontLegRaise so they fade in/out with the gesture
// itself rather than popping.
//
// A third mechanism used to live here (GROOM_WOBBLE, a real-time
// performance.now()-driven knee wiggle meant to read as a scrubbing
// motion) - removed in round 4 (issue 3's "wiper" redesign) for two
// reasons: (a) the actual sweeping motion now comes for free through
// legJointAngles itself (pose.groomWipe, set by IDLE_BEHAVIORS.groom in
// animal-engine.js, rides on the shared hip-angle calculation this
// function already applies below - no separate 3D-only motion hack
// needed anymore), and (b) GROOM_WOBBLE was the confirmed root cause of a
// genuine flicker artifact reported on the siamese cat during grooming
// (diagnosed via a toggle-pixel detector: 0 flicker frames at rest, 448
// toggling pixel-frames specifically during groom) - being driven by
// wall-clock time instead of the pose's own animation time `t` meant its
// oscillation was never in sync with anything else in the pose/render
// pipeline (crossfade, dt-based easing, etc.), which is what produced the
// staticky look. The new groomWipe field has neither problem: it is
// computed once per frame from `t` alongside every other pose field, so
// it crossfades/resets exactly like frontLegRaise itself already does.
const GROOM_HIGHLIGHT_MAX = 0.4;
const GROOM_PROTRUDE_Z = HALF_DEPTH + 1.2; // past the head's own front/back face, same "must exceed the surface" margin EYE_Z uses
const _groomHighlightTarget = new THREE.Color('#ffffff');
const _groomBaseColor = new THREE.Color();
function applyGroomHighlight(mesh, baseColorHex, amount) {
  if (!mesh) return;
  _groomBaseColor.set(baseColorHex);
  mesh.material.color.copy(_groomBaseColor);
  if (amount > 0) mesh.material.color.lerp(_groomHighlightTarget, amount * GROOM_HIGHLIGHT_MAX);
}

// Applies a 2D-style pose object's leg fields to a built leg rig by
// running the SAME legJointAngles(cfg, pose, isFront) the 2D engine uses
// and mapping the resulting (hip, knee) degrees onto the two pivots' Z
// rotation. legYDelta (world units, see applyBodyPose) folds in the
// bodyBob/squash correction the 2D engine's own `legY = cfg.legY +
// pose.bodyBob - squashY*0.5` applies - the hipPivot's BUILD-time Y
// already encodes cfg.legY, so only the per-frame delta needs applying
// here (bodyBob itself is provided by this creature's shared bob group,
// see applyBodyPose - only the squash correction is leg-specific).
function applyLegPose(legs, cfg, pose, legYDelta) {
  for (const side of ['front', 'back']) {
    const rig = legs[side];
    if (!rig) continue;
    const isFront = side === 'front';
    // hip already carries pose.groomWipe's side-to-side sweep when raised
    // (see legJointAngles's frontLegRaise branch) - no extra 3D-only
    // motion needed here anymore, see GROOM_HIGHLIGHT_MAX's comment above.
    let { hip, knee } = legJointAngles(cfg, pose, isFront);
    const hipRad = (hip * Math.PI) / 180;
    const kneeRad = (knee * Math.PI) / 180;
    for (const pair of rig) {
      pair.hipPivot.rotation.z = -hipRad;
      pair.kneePivot.rotation.z = -kneeRad;
      pair.hipPivot.position.y = (GROUND_Y - cfg.legY) * UNIT + legYDelta;
      if (isFront) {
        // Push this leg's own Z outward past the head's surface while
        // raised - see GROOM_PROTRUDE_Z's comment above for why this is
        // the actual fix (not just a nicety) for the paw being invisible.
        // Sign preserved (pair.zSide's own sign) so the "near" copy comes
        // toward the camera and the "far" copy goes away from it, matching
        // which side of the face each physically belongs to.
        const targetZ = Math.sign(pair.zSide) * GROOM_PROTRUDE_Z;
        pair.hipPivot.position.z = lerpNum(pair.zSide, targetZ, pose.frontLegRaise) * UNIT;
        // Highlight ONLY the paw tip, and ONLY for species that actually
        // have a distinct paw color (cfg.pawColor - e.g. tuxedo's white
        // socks; pair.pawMesh only exists at all when a species sets this,
        // see addLegChain). BUG FIXED (round 5 issue 2 - "발을 들 때 발
        //색깔이 회색으로 변함"): this used to ALSO call
        // applyGroomHighlight on upperMesh/lowerMesh unconditionally, for
        // every species regardless of whether it has any paw-tip concept
        // at all - blending 40% toward white from a dark legColor (e.g.
        // tuxedo's near-black #161616, siamese's dark brown #5c4636)
        // produces a visibly gray leg, not a highlight. That blend was
        // only ever meant to make an existing white/light paw marking
        // easier to pick out against a similarly-colored face - a species
        // with no such marking has nothing that needs "highlighting" in
        // the first place, and the paw's own upper/lower leg BONES were
        // never supposed to change color at all (they don't in any other
        // pose). Species without pawColor (siamese, cat_a, ...) now get NO
        // color change whatsoever while grooming - visibility comes
        // entirely from GROOM_PROTRUDE_Z (the actual occlusion fix) and
        // the groomWipe sweep motion, same as it already does for every
        // other pose these legs render in.
        if (pair.pawMesh) applyGroomHighlight(pair.pawMesh, cfg.pawColor, pose.frontLegRaise);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Tail chain - see the module comment for why this uses per-frame
// absolute position/rotation per segment (mirroring pxJoint's own
// approach) instead of the leg chain's nested-rotation trick.
// ---------------------------------------------------------------------
function buildTailChain(parent, cfg) {
  if (!cfg.tail || !cfg.tail.length) return null;
  const segs = cfg.tail;
  const seg0 = segs[0];
  const root = makeBox(seg0.w, seg0.h, DEPTH * 0.6, seg0.color);
  parent.add(root);

  const segments = [];
  for (let i = 1; i < segs.length; i++) {
    const prevCX = segs[i - 1].x + segs[i - 1].w / 2, prevCY = segs[i - 1].y + segs[i - 1].h / 2;
    const curCX = segs[i].x + segs[i].w / 2, curCY = segs[i].y + segs[i].h / 2;
    const dx = curCX - prevCX, dy = curCY - prevCY;
    const boneLen = Math.hypot(dx, dy) || 1;
    const hinge = new THREE.Group();
    // width=segs[i].h (matches pxJoint's own "width" param for the tail -
    // see drawCreature's tail loop), length=boneLen along local Y, same
    // "hangs from local Y=0 to -boneLen" convention the leg chain uses.
    const mesh = makeBox(segs[i].h, boneLen, DEPTH * 0.6, segs[i].color);
    mesh.position.set(0, -boneLen / 2, 0);
    hinge.add(mesh);
    parent.add(hinge);
    segments.push(hinge);
  }
  return { root, segments };
}

// tailShift (world units): the tail-specific bodyBob/squash correction -
// 2D's `bodyShift = pose.bodyBob + squashY*0.5` added to the tail's origin
// (see drawCreature's tail comment on why this tracks the body's TOP edge,
// opposite sign from the leg hip's bottom-edge tracking). bodyBob itself
// comes from the shared bob group (see applyBodyPose) - only the squash
// portion needs applying here.
function applyTailChain(tailRig, cfg, pose, tailShiftWorld) {
  if (!tailRig) return;
  const segs = cfg.tail;
  const seg0 = segs[0];
  const cx0 = seg0.x + seg0.w / 2, cy0 = seg0.y + seg0.h / 2;
  tailRig.root.position.set(cx0 * UNIT, (GROUND_Y - cy0) * UNIT + tailShiftWorld, 0);

  let originX2D = cx0, originY2D = cy0;
  let cumAngle = 0;
  for (let i = 1; i < segs.length; i++) {
    const prevCX = segs[i - 1].x + segs[i - 1].w / 2, prevCY = segs[i - 1].y + segs[i - 1].h / 2;
    const curCX = segs[i].x + segs[i].w / 2, curCY = segs[i].y + segs[i].h / 2;
    const dx = curCX - prevCX, dy = curCY - prevCY;
    const boneLen = Math.hypot(dx, dy) || 1;
    const restAngleDeg = Math.atan2(-dx, dy) * (180 / Math.PI);
    const wave = Math.sin(pose.tailPhase - i * 0.8) * pose.tailAmp * (6 + i * 5);
    cumAngle += wave;
    const angleDeg = restAngleDeg + cumAngle;
    const rad = (angleDeg * Math.PI) / 180;

    const hinge = tailRig.segments[i - 1];
    hinge.position.set(originX2D * UNIT, (GROUND_Y - originY2D) * UNIT + tailShiftWorld, 0);
    hinge.rotation.z = -rad;

    // Next origin (tip), in 2D-space bookkeeping terms - same formula
    // pxJoint itself uses (tipX = hinge - sin(rad)*len, tipY = hinge +
    // cos(rad)*len) - this value is only ever fed back in as the NEXT
    // segment's hinge position, never itself rotated as a vector, so
    // computing it in plain 2D units and converting via the same Y-flip
    // each iteration is safe (mirrors drawCreature's own originX/Y
    // bookkeeping exactly).
    originX2D = originX2D - Math.sin(rad) * boneLen;
    originY2D = originY2D + Math.cos(rad) * boneLen;
  }
}

// ---------------------------------------------------------------------
// Ear drawers - simplified to a single box per side regardless of
// earStyle (pointy/long/round/floppy) - shape isn't reproduced, only
// placement/color, same simplification accepted in the front/back-detail
// round (see CLAUDE.md). earFlick (wiggle) approximated as a uniform X
// shift scaled by `side`, since a plain box can't distinguish "just the
// tip moves" the way the 2D triangle/round shapes do.
//
// Round 16 issue 3 ("닥스훈트 귀가... 토끼처럼 길고 뾰족한 모양으로 나와") -
// 'pointy'/'long'/'round' all share one thing this box-only simplification
// can still get right even without reproducing the actual outline: the ear
// STANDS UP from the top of the head. 'floppy' is the one style whose real
// shape does the opposite - it HANGS DOWN alongside the head - so building
// it with the exact same "base near the top, box extends further up"
// placement (just with a tall cfg.ear.h:7, taller than any other species')
// reads as exactly what was reported: a long ear pointing up, visually
// indistinguishable from rabbit_b's 'long' style (which uses the same
// upward placement, just a slightly shorter h:6). Fixed by branching the
// vertical anchor/direction on earStyle==='floppy': base sits near the TOP
// of the head (roughly where a real ear canal attaches) and the box grows
// DOWNWARD from there instead of upward - past the head's own bottom edge
// and toward the jaw/neck, which is what actually reads as "hanging"
// rather than "standing" once rendered. Left/right separation (EAR_Z) and
// the inner-ear decal/flick/squash logic below are unaffected either way.
//
// Ears also need a per-frame Y correction the head box itself doesn't:
// 2D's ear anchor is headTopY (the SQUASH-SHRUNK top edge, not the
// unsquashed cfg.headY - see drawCreature's own "ear-head gap" comment),
// specifically so ears keep tracking the head's rendered top edge as it
// compresses (bottom-anchored - see headSquashGroup) instead of floating
// above it with a growing gap. Confirmed via getBodyDebug() world-position
// dumps: without this correction, a full-sleep pose left the ears exactly
// `cfg.headH*bodySquash*0.25` world-units too high (visually read as the
// head disconnecting into a separate floating block above the face - see
// CLAUDE.md).
// ---------------------------------------------------------------------
function buildEars(parent, cfg) {
  if (!cfg.ear) return null;
  const earW = cfg.ear.w, earH = cfg.ear.h;
  const baseX = cfg.headX + cfg.headW / 2 - earW / 2;
  // floppy: base near the head's own top edge, growing DOWNWARD (hangs
  // alongside the head) - every other style: base above the head, growing
  // UPWARD with a small overlap into the head so there's no gap (same
  // spirit as the 2D engine's ear-base placement). See this function's
  // own header comment (round 16 issue 3) for why floppy needs the
  // opposite direction.
  const baseY = cfg.earStyle === 'floppy' ? cfg.headY + 1 : cfg.headY - earH + 1.5;
  const left = addBox(parent, baseX, baseY, earW, earH, cfg.ear.color || cfg.bodyColor, earW, EAR_Z);
  const right = addBox(parent, baseX, baseY, earW, earH, cfg.ear.color2 || cfg.ear.color || cfg.bodyColor, earW, -EAR_Z);
  // Inner-ear shading (round 8 issue 2 - "귀: 정면에서 볼 때 입체감/디테일이
  // 살도록") - a smaller, lighter inset decal on each ear's outward-facing
  // surface. Before this, an ear was a single flat-colored box with
  // nothing to distinguish its front face from a plain rectangle head-on -
  // real ears show a visibly different-toned inner pinna against the
  // outer fur, which is exactly the kind of two-tone cue that reads as
  // "this has depth" even on a flat-shaded box. Added as a CHILD of the
  // ear mesh itself (not a separate top-level part the way belly/pattern
  // skin decals are) so it automatically inherits every per-frame
  // position update applyEars makes to its parent (the flick shift, the
  // squash-driven Y correction) with no extra tracking needed - same
  // "let the scene graph do the position math" principle addBoxRel's own
  // comment describes for squash-anchored parts.
  //
  // Positioned on the OUTWARD Z face of each ear (the same side EAR_Z
  // itself already biases that ear toward - the "left" ear built at
  // +EAR_Z gets its inner decal pushed further toward +Z, "right" toward
  // -Z), past the parent box's own half-depth (earW/2) by a small margin
  // so it protrudes rather than embeds - same "must exceed the surface"
  // rule this file uses everywhere else (EYE_Z, the eye pupil/highlight
  // stack, GROOM_PROTRUDE_Z, ...).
  const innerW = earW * 0.5, innerH = earH * 0.55;
  const innerYOffset = -earH * 0.08; // slightly toward the ear's base, not dead-center, closer to how a real pinna's visible interior sits
  // Round 17 issue 4 ("닥스훈트 귀가 뒤집혀 보임 - 안쪽 면이 바깥으로 노출됨") -
  // this decal's Z-side was always the OUTWARD one (away from the head's
  // own center/the other ear) regardless of earStyle. That's the right
  // side for an erect ear (pointy/long/round): standing away from the head,
  // its forward-facing concave pinna reads fine on the outward Z face at
  // this abstraction level, and round 8 tuned it there without issue for
  // 9/10 species. But a FLOPPY ear hangs DOWN alongside the head instead of
  // standing away from it (round 16 issue 3), and a real hanging ear's
  // concave inner surface faces INWARD, toward the head/cheek, not outward
  // - keeping the OUTWARD placement put the lighter "inner pinna" color on
  // the side that's actually visible from a side view (the ear's true
  // outer, furry surface), reading exactly as reported: the ear looks
  // turned inside-out. Flipping the sign for floppy alone fixes this (the
  // decal now sits on the side facing the head, which is anatomically
  // correct AND naturally mostly hidden behind the head from a profile
  // view, matching how a real hound ear's inner surface isn't normally
  // visible from the side either) without touching any other style.
  const innerZSign = cfg.earStyle === 'floppy' ? -1 : 1;
  if (left) {
    const innerColor = cfg.ear.inner || lightenColor(cfg.ear.color || cfg.bodyColor, 0.45);
    const inner = makeBox(innerW, innerH, 0.5, innerColor);
    inner.position.set(0, innerYOffset * UNIT, innerZSign * (earW / 2 + 0.2) * UNIT);
    left.add(inner);
  }
  if (right) {
    const innerColor = cfg.ear.inner || lightenColor(cfg.ear.color2 || cfg.ear.color || cfg.bodyColor, 0.45);
    const inner = makeBox(innerW, innerH, 0.5, innerColor);
    inner.position.set(0, innerYOffset * UNIT, -innerZSign * (earW / 2 + 0.2) * UNIT);
    right.add(inner);
  }
  return { left, right, baseX, earW, baseWorldY: left ? left.position.y : 0 };
}
function applyEars(ears, cfg, flick, bodySquash) {
  if (!ears) return;
  const { left, right, baseX, earW, baseWorldY } = ears;
  const shift = flick * 0.4;
  // World-Y delta matching 2D's headTopY shift (cfg.headH - squashedHeadH
  // = cfg.headH*bodySquash*0.25), negated since increasing 2D-Y (moving
  // the anchor down the screen) decreases world-Y - same flip convention
  // every other part in this file uses.
  const squashDelta = -(cfg.headH * bodySquash * 0.25) * UNIT;
  if (left) { left.position.x = (baseX + earW / 2 + shift) * UNIT; left.position.y = baseWorldY + squashDelta; }
  if (right) { right.position.x = (baseX + earW / 2 - shift) * UNIT; right.position.y = baseWorldY + squashDelta; }
}

// Round 8 issue 2 ("고양이: 수염 추가") - cfg.whiskers (boolean, cats only
// in the current roster) gets 3 thin fanned-out boxes per cheek. Boxes,
// not THREE.Line - this file's whole aesthetic is flat-shaded boxes
// (makeBox's own comment), and WebGL line width beyond 1px is
// notoriously unreliable across GPU drivers (most desktop GL
// implementations silently clamp it to 1px regardless of what's
// requested), which would make a "thin cylinder or line" whisker either
// invisible-thin or platform-dependent - a very short, very thin BOX has
// neither problem and stays visually consistent with every other part in
// this file.
//
// Each whisker is a pivot group (positioned at the attachment point,
// rotated to the whisker's own angle) containing a box offset along its
// own local +/-Z by half its length, so the box extends OUTWARD from the
// pivot instead of being centered on it - same "rotate the hinge, not
// the part" structure legJointAngles/pxJoint already use for limbs, just
// with a fixed rest angle instead of a per-frame animated one.
//
// The rod's long axis is Z (lateral), NOT X (nose-to-tail) - a first
// version built it along X, which reads fine from the side (0/180 deg,
// where it's this file's already-established "own group at own center"
// idle-safe pattern) but is exactly backwards for what whiskers are
// actually for: real whiskers fan out SIDEWAYS from the snout, so they're
// most visible face-on and foreshorten toward a point from the side -
// this file's rotation convention (Z is the lateral/mirror axis, becomes
// on-screen width at a 90-degree view) means an X-long rod does the
// opposite, foreshortening exactly at the angle (270 deg, face-on) this
// feature was requested for. Confirmed empirically, not just reasoned
// through: a face-on render came back with no visible whiskers at all
// once the rod was this axis; swapping it to Z fixed that immediately.
const WHISKER_LENGTH = 4.5;
const WHISKER_THICKNESS = 0.12;
// Round 10 issue 3 - was a single fixed color (WHISKER_COLOR, the cream-
// white below) regardless of face color, so it disappeared entirely
// against light faces (calico's near-white #faf3e6) even though it was
// never actually invisible against the DARK faces it happened to have
// been eyeballed on originally (tuxedo, siamese) - a fixed choice tuned
// for a subset of the roster silently failing for the rest. Now picks
// whichever of two fixed whisker colors contrasts with THIS species' own
// face color (cfg.headColor||cfg.bodyColor, same "face color" cats/
// siamese/faceShade already resolve elsewhere in this file), via
// relativeLuminance rather than hardcoding a per-species answer - stays
// correct automatically if the roster's colors ever change.
const WHISKER_COLOR_LIGHT = '#f5f0e8'; // against dark faces (tuxedo, siamese's seal-brown mask)
const WHISKER_COLOR_DARK = '#241a12'; // against light faces (cat_a's orange, calico's cream) - dark brown-black rather than pure #000, consistent with this file's other "darkColor"-style near-blacks
const WHISKER_LUMINANCE_THRESHOLD = 0.5;
const WHISKER_TILTS_DEG = [-16, 0, 16]; // vertical fan (up/down), 3 per side
const WHISKER_SPLAY_DEG = 22; // how far FORWARD (toward the nose) each whisker angles as it extends outward
function buildWhiskers(parent, cfg, attachX2D, attachY2D) {
  if (!cfg.whiskers) return;
  const faceColor = cfg.headColor || cfg.bodyColor;
  const whiskerColor = relativeLuminance(faceColor) >= WHISKER_LUMINANCE_THRESHOLD ? WHISKER_COLOR_DARK : WHISKER_COLOR_LIGHT;
  for (const zSign of [1, -1]) {
    for (const tiltDeg of WHISKER_TILTS_DEG) {
      const pivot = new THREE.Group();
      pivot.position.set(attachX2D * UNIT, (GROUND_Y - attachY2D) * UNIT, zSign * EYE_Z * 0.5 * UNIT);
      pivot.rotation.x = (tiltDeg * Math.PI) / 180; // fans the Z-pointing rod up/down (rotates the YZ plane)
      pivot.rotation.y = (zSign * WHISKER_SPLAY_DEG * Math.PI) / 180; // swings the tip slightly toward the nose (rotates the XZ plane)
      const whisker = makeBox(WHISKER_THICKNESS, WHISKER_THICKNESS, WHISKER_LENGTH, whiskerColor);
      whisker.position.set(0, 0, zSign * (WHISKER_LENGTH / 2) * UNIT);
      pivot.add(whisker);
      parent.add(pivot);
    }
  }
}

export function buildVoxelCreature(speciesKey) {
  const cfg = SPECIES[speciesKey] || SPECIES.cat_a;
  const effectiveSpeciesKey = SPECIES[speciesKey] ? speciesKey : 'cat_a'; // matches cfg's own fallback, so NECK_SEAM_SPECIES membership is checked against whatever species actually got built, not a possibly-invalid caller-supplied key

  // ===== Body (scales around its own center - see addBoxRel's comment) =====
  const bodyCenterY2D = cfg.bodyY + cfg.bodyH / 2;
  const bodyGroup = new THREE.Group();
  const bodyMesh = addBoxRel(bodyGroup, cfg.bodyX, cfg.bodyY, cfg.bodyW, cfg.bodyH, cfg.bodyColor, bodyCenterY2D);
  // belly gets a small extra Z-nudge over pattern (BELLY_OVER_PATTERN_NUDGE)
  // so they don't tie in their overlapping region - see addSkinBoxRel's
  // own comment (round 10 issue 2) for the full z-fighting investigation.
  // cfg.belly can now be a single object OR an array of segments (round 17
  // issue 3 - see this function's own cfg.snout comment below for the full
  // V-taper explanation); each segment may set its own `zWidth` to
  // override the default full-body-depth wrap - a segment that does loses
  // BELLY_OVER_PATTERN_NUDGE's z-fight protection against `pattern` (zWidth
  // replaces the nudge-derived depth entirely), which is fine for every
  // current zWidth user (cat_tuxedo has no `pattern` field at all) but
  // would need revisiting if a future species combines both.
  if (cfg.belly) {
    const bellies = Array.isArray(cfg.belly) ? cfg.belly : [cfg.belly];
    for (const b of bellies) addSkinBoxRel(bodyGroup, b.x, b.y, b.w, b.h, b.color, bodyCenterY2D, BELLY_OVER_PATTERN_NUDGE, b.zWidth ?? null);
  }
  if (cfg.pattern) for (const p of cfg.pattern) addSkinBoxRel(bodyGroup, p.x, p.y, p.w, p.h, p.color, bodyCenterY2D, PATTERN_OVER_BODY_NUDGE);
  bodyGroup.position.y = (GROUND_Y - bodyCenterY2D) * UNIT; // build-time fixed Y anchor; bob applied by the parent bobGroup, see below

  // ===== Head (squash anchored at the BOTTOM edge - see 2D's headTopY
  // comment: the jaw stays put, only the top compresses down) =====
  const headBottomY2D = cfg.headY + cfg.headH;
  const headSquashGroup = new THREE.Group();
  const headMesh = cfg.faceShade
    ? addFaceShadedHeadBox(headSquashGroup, cfg, headBottomY2D)
    // Round 10 issue 1 fix: HEAD_Z_NUDGE grows depth on both faces (see
    // addFaceShadedHeadBox's identical fix and its comment) instead of
    // shifting position (old zOffset=HEAD_Z_NUDGE argument here) - keeps
    // the head symmetrically ahead of body from either rotation half
    // instead of winning one and losing the other.
    : addBoxRel(headSquashGroup, cfg.headX, cfg.headY, cfg.headW, cfg.headH, cfg.headColor || cfg.bodyColor, headBottomY2D, DEPTH + HEAD_Z_NUDGE * 2, 0);
  // Neck seam - a front-facing cap at the head's own BOTTOM edge (local
  // Y=-headH/2, box geometry centered at the mesh's own origin), a child
  // of headMesh, only built for the species listed in NECK_SEAM_SPECIES
  // (round 16 issue 1 - explicit list, see that constant's own comment)
  // and, thanks to addNeckSeamCollar's plane-based geometry (round 16
  // issue 2), only actually visible from the front pose regardless of
  // which species it's built for. capWidth matches the head's own actual
  // depth (DEPTH+HEAD_Z_NUDGE*2) exactly - see the module comment above
  // (round 11 issue 1, still applicable to the plane's Z-extent) on why
  // matching, not exceeding, is what keeps this from poking out past the
  // head's silhouette at the front pose.
  if (NECK_SEAM_SPECIES.has(effectiveSpeciesKey)) addNeckSeamCollar(headMesh, cfg, headBottomY2D, DEPTH + HEAD_Z_NUDGE * 2);
  // Round 17 added a `frontVMask` front-cap mask here (cat_tuxedo's V-
  // shaped chest blaze) - round 18 rolled it back after finding a visible
  // ghosting artifact at the intermediate angles the mask is only
  // partially visible at (a flat plane's foreshortening doesn't match the
  // underlying box decal's, see addFrontVMask's own comment - removed
  // below - for the full reasoning). No species uses cfg.frontVMask
  // anymore.
  headSquashGroup.position.set(0, (GROUND_Y - headBottomY2D) * UNIT, 0);

  // Snout(s), nose, eyes, cheeks - all FIXED position relative to the head
  // offset (hdx/hdy+bodyBob, applied by the parent headOffsetGroup, see
  // below), none of them track headSquash (matches 2D: none of these
  // reference headTopY/headH at all, only the head rectangle itself
  // shrinks - see drawCreature's comment on why eyes/nose/snout stay put).
  const headParts = new THREE.Group();
  let snoutFrontX = cfg.headX + cfg.headW;
  if (cfg.snout) {
    const snouts = Array.isArray(cfg.snout) ? cfg.snout : [cfg.snout];
    for (const s of snouts) {
      // Round 17 issue 3 - each snout segment may set its own `zWidth`
      // (see this function's cfg.belly comment above for the paired
      // chest-side half of the same feature) so a chin-area blaze can
      // taper narrower here than the belly patch it visually continues
      // into further down.
      addSkinBox(headParts, s.x + 0.1, s.y, s.w, s.h, s.color, 0, s.zWidth ?? null);
      snoutFrontX = Math.max(snoutFrontX, s.x + 0.1 + s.w);
    }
  }
  // Nose - wrapped in its own group, positioned AT the nose's own center,
  // with the mesh centered at that group's local origin - so noseTwitch's
  // grow-around-center scale (see applyPose) is a plain group.scale, no
  // manual recentering math needed (matches 2D's own noseW/noseH-vs-
  // top-left-corner recentering, just expressed via the scene graph).
  const noseX2D = Math.max(cfg.nose.x, snoutFrontX) + 0.05, noseY2D = cfg.nose.y;
  const noseGroup = new THREE.Group();
  noseGroup.position.set((noseX2D + cfg.nose.w / 2) * UNIT, (GROUND_Y - noseY2D - cfg.nose.h / 2) * UNIT, 0);
  const baseNoseColor = cfg.nose.color || cfg.darkColor;
  const noseMesh = makeBox(cfg.nose.w, cfg.nose.h, DEPTH * 0.5, baseNoseColor);
  noseGroup.add(noseMesh);
  // Detail color MUST contrast with baseNoseColor, not just cfg.darkColor -
  // most species leave cfg.nose.color unset, which makes the nose ITSELF
  // fall back to cfg.darkColor, so a detail also hardcoded to cfg.darkColor
  // would be flat-out invisible (found via screenshot: solid dark bar, no
  // nostrils, despite the Z-protrusion already being correct - see
  // darkenColor's own comment above for how this was diagnosed).
  const noseDetailColor = darkenColor(baseNoseColor, 0.55);
  // Round 8 issue 2 - species-appropriate front-facing nose detail
  // (cfg.noseDetail, data-driven like every other per-species knob in this
  // file rather than checking speciesKey directly). Both added as children
  // of noseGroup so noseTwitch's own scale pulse (see applyPose) carries
  // them along for free.
  if (cfg.noseDetail === 'nostrils') {
    // Dogs: two small dark dots, one per side of the nose's own center -
    // real canine noses have two visible nostril openings even from
    // straight ahead, which a single flat nose block can't suggest at all.
    // Z offset MUST exceed noseMesh's own half-depth (DEPTH*0.5 total, so
    // DEPTH*0.25 half) to actually protrude past its surface instead of
    // being embedded inside it and invisible from every angle - the same
    // "must exceed the surface" bug this file has hit (and fixed) several
    // times already for eyes/belly-pattern/grooming paws. A first attempt
    // here used a tiny nose.w-relative offset (0.24 units for cat_a's
    // nose.w=1) that was nowhere close to clearing DEPTH*0.25=1.5 -
    // caught by checking the actual numbers before rendering, not just
    // after.
    //
    // A SECOND, subtler bug on top of that one: the dots were first built
    // via makeBox(dotSize, dotSize, 0.12, ...) - a flat 0.12-thin wafer in
    // local Z. That's invisible from the front on its own terms: a Z
    // rotation of 90/270 degrees (this file's "Z is the lateral mirror
    // axis" convention, see the module comment) turns local Z into the
    // on-screen WIDTH at that angle - so a dot that's a normal dotSize x
    // dotSize square from the side becomes a sub-pixel 0.12-wide sliver
    // from straight ahead, at the exact angle this detail exists for.
    // Confirmed by a raw gl.readPixels scan (test/diag-nostril-pixels.js)
    // that found the debug-magenta dots in the scene graph at the right
    // world position but literally zero matching pixels anywhere on
    // canvas - not a color/occlusion issue, a "too thin to rasterize from
    // this angle" one. Fixed by making the dot a small cube (comparable
    // size on all 3 axes) so it reads as a dot from every 90-degree
    // viewing angle, not just the one it was eyeballed from originally.
    const dotSize = Math.max(0.35, cfg.nose.w * 0.28);
    const nostrilZ = DEPTH * 0.25 + dotSize / 2 + 0.15;
    for (const zSign of [1, -1]) {
      const dot = makeBox(dotSize, dotSize, dotSize, noseDetailColor);
      dot.position.set(cfg.nose.w * 0.1 * UNIT, -cfg.nose.h * 0.05 * UNIT, zSign * nostrilZ * UNIT);
      noseGroup.add(dot);
    }
  } else if (cfg.noseDetail === 'philtrum') {
    // Rabbit: the vertical groove splitting the upper lip beneath the
    // nose - the "twitchy" part of a rabbit's face the 2D engine's own
    // noseTwitch animation is named for, but the 3D nose alone had
    // nothing marking where that split actually is.
    // A single centerline feature (unlike the bilateral nostril dots
    // above), so it can't just be pushed off to one side - instead its OWN
    // depth is sized to clear the snout skin-wrap patch sitting behind it
    // on BOTH the near and far side at once (2*(DEPTH*0.25+0.15), the same
    // per-side clearance the nostril dots use), so it protrudes past
    // whichever face happens to be toward the camera at any viewing angle
    // rather than being embedded in the middle of it.
    const line = makeBox(0.3, cfg.nose.h * 1.7, 2 * (DEPTH * 0.25 + 0.15), noseDetailColor);
    line.position.set(-cfg.nose.w * 0.05 * UNIT, -cfg.nose.h * 1.15 * UNIT, 0);
    noseGroup.add(line);
  }
  headParts.add(noseGroup);
  // Round 8 issue 2 - whiskers (cats only, cfg.whiskers). Attached near
  // the nose/snout's own front edge, roughly muzzle height.
  buildWhiskers(headParts, cfg, Math.max(noseX2D + cfg.nose.w, snoutFrontX) - 0.3, noseY2D + cfg.nose.h * 0.4);

  // Cheeks (hamster) - same "own group at own center" treatment as the
  // nose, so cheekPuff's grow-around-center scale (see applyPose) just
  // works via group.scale.
  const cheekGroups = [];
  if (cfg.cheeks) {
    for (const c of cfg.cheeks) {
      const cx2D = c.x + c.w / 2, cy2D = c.y + c.h / 2;
      for (const zSide of [EYE_Z, -EYE_Z]) {
        const g = new THREE.Group();
        g.position.set(cx2D * UNIT, (GROUND_Y - cy2D) * UNIT, zSide * UNIT);
        g.add(makeBox(c.w, c.h, 0.6, c.color));
        headParts.add(g);
        cheekGroups.push(g);
      }
    }
  }

  // Eyes - open (rect + PUPIL + tiny highlight) vs closed (thin lid line),
  // toggled by visibility exactly matching 2D's binary `eyesClosed < 0.5`
  // branch (see applyBodyPose).
  //
  // Round 8 issue 2 ("눈: 정면에서 더 생동감 있게 - 홍채/동공 구분") - the
  // eye used to be just a flat iris-colored rect plus an offset highlight
  // fleck, with no pupil at all (a real eye's most legible front-on
  // feature - the dark center that gives eyes their "looking at you"
  // read). Added as a smaller dark box centered within the iris rect,
  // sized independent of species (works for every eye.w/h in the roster
  // without needing per-species tuning - same "10 species, author by
  // hand where it matters, share a formula where it doesn't" balance this
  // file already strikes elsewhere). Depth-layered strictly between the
  // iris and the highlight (iris front surface at EYE_Z+0.3, pupil at
  // EYE_Z+0.005 with depth 0.61 -> front surface EYE_Z+0.3095, highlight
  // at EYE_Z+0.01 with depth 0.62 -> front surface EYE_Z+0.32) so all
  // three protrude past whatever's behind them - same "must exceed the
  // surface it sits on" rule EYE_Z itself was introduced for.
  const eyeOpenGroup = new THREE.Group();
  addBox(eyeOpenGroup, cfg.eye.x, cfg.eye.y, cfg.eye.w, cfg.eye.h, cfg.eyeColor, 0.6, EYE_Z);
  addBox(eyeOpenGroup, cfg.eye.x, cfg.eye.y, cfg.eye.w, cfg.eye.h, cfg.eyeColor, 0.6, -EYE_Z);
  const pupilW = cfg.eye.w * 0.55, pupilH = cfg.eye.h * 0.6;
  const pupilX = cfg.eye.x + (cfg.eye.w - pupilW) / 2, pupilY = cfg.eye.y + (cfg.eye.h - pupilH) / 2;
  addBox(eyeOpenGroup, pupilX, pupilY, pupilW, pupilH, cfg.darkColor, 0.61, EYE_Z + 0.005);
  addBox(eyeOpenGroup, pupilX, pupilY, pupilW, pupilH, cfg.darkColor, 0.61, -(EYE_Z + 0.005));
  addBox(eyeOpenGroup, cfg.eye.x + cfg.eye.w * 0.4, cfg.eye.y, 1, 1, '#fff8ec', 0.62, EYE_Z + 0.01);
  addBox(eyeOpenGroup, cfg.eye.x + cfg.eye.w * 0.4, cfg.eye.y, 1, 1, '#fff8ec', 0.62, -EYE_Z - 0.01);
  const eyeClosedGroup = new THREE.Group();
  addBox(eyeClosedGroup, cfg.eye.x, cfg.eye.y + cfg.eye.h * 0.6, cfg.eye.w, Math.max(1, cfg.eye.h * 0.3), cfg.darkColor, 0.6, EYE_Z);
  addBox(eyeClosedGroup, cfg.eye.x, cfg.eye.y + cfg.eye.h * 0.6, cfg.eye.w, Math.max(1, cfg.eye.h * 0.3), cfg.darkColor, 0.6, -EYE_Z);
  eyeClosedGroup.visible = false;
  headParts.add(eyeOpenGroup, eyeClosedGroup);

  const ears = buildEars(headParts, cfg);

  const headOffsetGroup = new THREE.Group(); // per-frame hdx/hdy (headDX/DY+lookDX/DY)
  headOffsetGroup.add(headSquashGroup, headParts);

  // ===== Tail =====
  const tailParent = new THREE.Group();
  const tailRig = buildTailChain(tailParent, cfg);

  // ===== Legs (bilateral, 4 total) =====
  const legParent = new THREE.Group();
  const legs = {
    front: [addLegChain(legParent, cfg, true, LEG_Z), addLegChain(legParent, cfg, true, -LEG_Z)].filter(Boolean),
    back: [addLegChain(legParent, cfg, false, LEG_Z), addLegChain(legParent, cfg, false, -LEG_Z)].filter(Boolean),
  };

  // ===== Shared bob group (bodyBob - a single uniform Y shift covering
  // body/head/tail/legs/cheeks all at once, matching how 2D adds
  // `+pose.bodyBob` to nearly every part's Y - see applyBodyPose) =====
  const bobGroup = new THREE.Group();
  bobGroup.add(bodyGroup, headOffsetGroup, tailParent, legParent);

  // ===== Roll pivot (rollAngle+waddleTilt - a whole-body Z-rotation
  // around the SAME (cx,cyWorld) point drawCreature's ctx.rotate() uses) =====
  const cx = (cfg.bodyX + cfg.headX + cfg.headW) / 2;
  const cyWorld = GROUND_Y - (cfg.bodyY + cfg.bodyH / 2);
  bobGroup.position.set(-cx, -cyWorld, 0);
  const rollPivot = new THREE.Group();
  rollPivot.position.set(cx, cyWorld, 0);
  rollPivot.add(bobGroup);

  // ===== View pivot (lets an external caller rotate the WHOLE assembled
  // creature around its own bbox center, independent of pose-driven roll -
  // e.g. facing direction in the real pet window, or the interactive
  // viewer's orbit) =====
  const bbox = new THREE.Box3().setFromObject(rollPivot);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  rollPivot.position.x -= center.x;

  const outer = new THREE.Group();
  outer.add(rollPivot);

  outer.userData.cfg = cfg;
  outer.userData.legs = legs;
  // Debug-only mesh references (for test/*.js diagnostic scripts to read
  // world positions from - see pet3d.js's getBodyDebug) - not used by any
  // real rendering path, same opt-in-only spirit as animal-engine.js's
  // setGeometrySink.
  outer.userData.debug = { headMesh: headSquashGroup.children[0], earLeft: ears && ears.left, earRight: ears && ears.right, noseGroup, eyeOpenGroup };
  // applyPose(pose): the single per-frame entry point - mirrors
  // drawCreature(ctx,cfg,pose)'s role exactly, but MUTATES this already-
  // built scene graph in place instead of redrawing from scratch. See
  // CLAUDE.md's "관절/idle 시스템 3D 이식" note for the full derivation of
  // each term below (particularly the squash sign conventions, which
  // differ between body/head/legs/tail - each documented at its own
  // source of truth in animal-engine.js's drawCreature).
  outer.userData.applyPose = function applyPose(pose) {
    // Round 8 issue 1 - Z-axis motion (depthZ/lateralX, see animal-
    // engine.js's approach/prowlcircle/chasetail/hopspin/wheelrun idles).
    // Applied on `outer` itself - the SAME object pet.js sets
    // .rotation.y on externally - which is safe: position is applied
    // after rotation in Three.js's local TRS composition, so this offset
    // always reads as a WORLD-space drift (toward/away from the camera,
    // sideways) independent of whichever way the creature currently
    // faces, not a drift relative to its own facing direction.
    //
    // depthScale fakes the "closer looks bigger" perspective cue this
    // orthographic camera can't produce on its own (the branch's earlier
    // perspective-camera experiment gave a real depth cue but clipped the
    // longest species like dachshund at close camera distances - see
    // CLAUDE.md's known-limitations note - so this reuses the orthographic
    // camera and fakes the size cue manually instead of reopening that).
    outer.position.set(pose.lateralX * UNIT, 0, pose.depthZ * UNIT);
    const depthScale = 1 + pose.depthZ * DEPTH_SCALE_FACTOR;
    outer.scale.set(depthScale, depthScale, depthScale);

    rollPivot.rotation.z = -((pose.rollAngle + pose.waddleTilt) * Math.PI) / 180;

    // bobGroup's X stays fixed at -cx from build time (the roll-pivot
    // recentering); only Y is pose-driven (bodyBob), so it's set fresh
    // each frame rather than accumulated.
    bobGroup.position.set(-cx, -cyWorld - pose.bodyBob * UNIT, 0);

    const squashY = pose.bodySquash * cfg.bodyH * 0.35;
    bodyGroup.scale.y = 1 - pose.bodySquash * 0.35;

    const hdx = pose.headDX + pose.lookDX;
    const hdy = pose.headDY + pose.lookDY;
    headOffsetGroup.position.set(hdx * UNIT, -hdy * UNIT, 0);
    headSquashGroup.scale.y = 1 - pose.bodySquash * 0.25;

    applyEars(ears, cfg, pose.earFlick, pose.bodySquash);

    const eyesOpen = pose.eyesClosed < 0.5;
    eyeOpenGroup.visible = eyesOpen;
    eyeClosedGroup.visible = !eyesOpen;

    const noseScale = 1 + pose.noseTwitch * 0.6;
    noseGroup.scale.set(noseScale, noseScale, 1);

    const cheekScale = 1 + pose.cheekPuff * 0.7;
    for (const g of cheekGroups) g.scale.set(cheekScale, cheekScale, 1);

    applyTailChain(tailRig, cfg, pose, -squashY * 0.5 * UNIT);
    applyLegPose(legs, cfg, pose, squashY * 0.5 * UNIT);
  };

  return outer;
}
