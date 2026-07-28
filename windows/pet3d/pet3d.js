// PROTOTYPE test harness (feature/3d-space branch) - not wired into the
// real app. Loads one voxel-extruded creature (see voxel-engine.js) and
// either renders one static frame (matching the existing 2D side view,
// for silhouette comparison) or spins it continuously around Y (for the
// rotation smoothness check) depending on URL query params. Driven
// externally by test/launch-voxel-proto.js, which reads
// window.focusPet3D.ready / .frameCount for screenshot timing.
import * as THREE from 'three';
import { buildVoxelCreature, HALF_DEPTH } from '../shared/voxel-engine.js';
import { createAnimal, SPECIES } from '../shared/animal-engine.js';

const params = new URLSearchParams(location.search);
const speciesKey = params.get('species') || 'cat_a';
const spin = params.get('spin') === '1';
// live=1: round 4 issue 4 verification mode - runs the REAL idle state
// machine (createAnimal/update, same code the real pet window drives)
// instead of the manually-injected setBodyPose() poses everything else on
// this page uses, so a launcher script can fast-forward through many
// actual idle transitions (not just a hand-picked groom pose) and check
// each one for the kind of real-time-driven flicker GROOM_WOBBLE used to
// cause - see stepIdle()/getIdleDebug() below.
const live = params.get('live') === '1';
// perspective=1: PROTOTYPE toggle (feature/3d-space branch, "does
// perspective actually look more 3D than orthographic" investigation -
// see CLAUDE.md's rotation-feels-flat note) - not used by the real pet
// window, which stays orthographic (see that note for why). camDist lets
// a comparison script move the camera closer (more perspective
// distortion, at the cost of needing a wider FOV to keep the same
// framing) without editing this file each time.
const usePerspective = params.get('perspective') === '1';
const camDist = parseFloat(params.get('camDist')) || 60;

// RENDER_SIZE matches the real pet sprite's actual on-screen size (96x96)
// - the whole point of this check is "does it still read clearly at the
// size it'll actually be used at", not at some larger, easier-to-judge
// size. DISPLAY_SIZE upscales that via CSS (image-rendering:pixelated,
// no smoothing) purely so a human/screenshot-viewer can inspect it
// without squinting - the actual judged resolution is RENDER_SIZE.
const RENDER_SIZE = 96;
const DISPLAY_SIZE = 480;

const canvas = document.getElementById('stage');
canvas.width = RENDER_SIZE;
canvas.height = RENDER_SIZE;
canvas.style.width = `${DISPLAY_SIZE}px`;
canvas.style.height = `${DISPLAY_SIZE}px`;

// preserveDrawingBuffer:true - needed for getFaceShadeSample()'s
// gl.readPixels below to reliably read back what was actually just
// rendered (matches pet.js's own click-through hit-test renderer, which
// documents the same requirement); harmless for the rest of this
// prototype viewer, which never relied on the drawing buffer being
// cleared between frames.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); // no device-pixel upscaling - RENDER_SIZE is the true pixel count, matching the existing engine's "no scale step" convention
renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a6b3a'); // same test/debug background color the 2D render scripts use, so transparent/background elements are never mistaken for "not drawn"

// Orthographic, not perspective, for this first check - a straight-on
// (rotation=0) orthographic render has NO perspective distortion, making
// it a fair apples-to-apples comparison against the existing flat 2D
// side-view screenshots. Perspective (for camera dolly/depth cues) is a
// later, separate experiment once the basic silhouette/rotation checks
// pass - see CLAUDE.md.
const FRUSTUM = 26; // a bit larger than the 24x24 grid for padding
const CENTER_Y = 11; // roughly the creature's own vertical center across the roster - see voxel-engine.js's Y-flip math
let camera;
if (usePerspective) {
  // FOV chosen so the vertical extent at z=0 (roughly the creature's own
  // depth center) matches FRUSTUM, same framing the orthographic version
  // uses at whatever camDist is passed - vertFovRad = 2*atan((FRUSTUM/2)/camDist).
  const vertFovDeg = 2 * Math.atan((FRUSTUM / 2) / camDist) * (180 / Math.PI);
  camera = new THREE.PerspectiveCamera(vertFovDeg, 1, 0.1, 200);
} else {
  camera = new THREE.OrthographicCamera(-FRUSTUM / 2, FRUSTUM / 2, FRUSTUM / 2, -FRUSTUM / 2, 0.1, 200);
}
camera.position.set(0, CENTER_Y, camDist);
camera.lookAt(0, CENTER_Y, 0);

const group = buildVoxelCreature(speciesKey);
scene.add(group);
const liveAnimal = live ? createAnimal(speciesKey) : null;
let liveElapsed = 0;

let frameCount = 0;

function renderFrame() {
  renderer.render(scene, camera);
  frameCount++;
  window.focusPet3D.frameCount = frameCount;
  window.focusPet3D.ready = true;
}

// setAngle: lets an external driver (test/launch-voxel-proto.js, via
// executeJavaScript) step through specific rotation angles and capture
// each one - more useful for judging "does this angle still read clearly"
// than sampling an auto-spin at arbitrary wall-clock moments.
window.focusPet3D = {
  ready: false,
  frameCount: 0,
  setAngle(radians) {
    group.rotation.y = radians;
    renderFrame();
  },
  // setLegPose: thin alias over setBodyPose (below) kept for existing test
  // scripts (launch-voxel-legtest.js) that only care about leg fields -
  // setBodyPose fully supersedes this (same field names, just also
  // updates body/head/tail so the leg's own bodyBob/squash corrections are
  // consistent with the rest of the pose instead of assuming 0).
  setLegPose(partialPose) {
    this.setBodyPose(partialPose);
  },
  // getLegDebug: reads back the rotation actually applied to the near-side
  // (+Z) front/back pivots, in degrees - lets a test script confirm
  // setLegPose() had a real effect numerically instead of relying on
  // eyeballing a screenshot (this codebase's established convention -
  // see CLAUDE.md's many "checked numerically, not just by eye" notes).
  getLegDebug() {
    const rig = group.userData.legs;
    const deg = (rad) => (rad * 180) / Math.PI;
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const pos = (obj) => { if (!obj) return null; obj.getWorldPosition(v); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; };
    const hexColor = (mesh) => mesh && mesh.material ? '#' + mesh.material.color.getHexString() : null;
    // localYRange (round 11 issue 2 verification): lowerMesh/pawMesh's own
    // LOCAL Y extent (position.y +- half the geometry's own height) - a
    // WORLD-space Box3 (as getBBoxDebug uses) inflates once the leg is
    // rotated (an axis-aligned box enclosing a tilted box is necessarily
    // bigger than the tilted box itself), which makes two non-overlapping
    // LOCAL boxes look like they overlap in world-Y even though they don't
    // actually share any volume - checking in the shared parent's own
    // local frame (both meshes are direct children of the same kneePivot,
    // with no rotation between THEM specifically) avoids that false
    // positive entirely.
    const localYRange = (mesh) => {
      if (!mesh) return null;
      const h = mesh.geometry.parameters.height;
      return [+(mesh.position.y - h / 2).toFixed(3), +(mesh.position.y + h / 2).toFixed(3)];
    };
    return {
      front: rig.front[0] && {
        hip: deg(rig.front[0].hipPivot.rotation.z), knee: deg(rig.front[0].kneePivot.rotation.z),
        upperPos: pos(rig.front[0].upperMesh), lowerPos: pos(rig.front[0].lowerMesh), pawPos: pos(rig.front[0].pawMesh),
        upperColor: hexColor(rig.front[0].upperMesh), lowerColor: hexColor(rig.front[0].lowerMesh),
        lowerLocalYRange: localYRange(rig.front[0].lowerMesh), pawLocalYRange: localYRange(rig.front[0].pawMesh),
      },
      back: rig.back[0] && { hip: deg(rig.back[0].hipPivot.rotation.z), knee: deg(rig.back[0].kneePivot.rotation.z) },
    };
  },
  // setBodyPose: full-pose prototype driver (see voxel-engine.js's
  // applyPose) - takes a partial pose object, fills defaults, applies it.
  setBodyPose(partialPose) {
    const pose = {
      legPhase: 0, legsTuckedFront: 0, legsTuckedBack: 0, bodyBob: 0, bodySquash: 0,
      headDX: 0, headDY: 0, earFlick: 0, tailPhase: 0, tailAmp: 0, eyesClosed: 0,
      cheekPuff: 0, frontLegRaise: 0, frontLegExtend: 0, rollAngle: 0, waddleTilt: 0,
      hopY: 0, dangle: 0, dangleSway: 0, tailOverride: false, noseTwitch: 0, bellyUp: 0,
      lookDX: 0, lookDY: 0,
      // Round 8 issue 1 fields (depthZ/lateralX/spinOverride/spinAngle) -
      // added to animal-engine.js's OWN defaultPose() last round, but this
      // hardcoded prototype-viewer default object was never updated to
      // match, so any partialPose that didn't explicitly set depthZ/
      // lateralX left them `undefined` here - voxel-engine.js's applyPose
      // does `pose.depthZ * UNIT` unconditionally, so `undefined * UNIT`
      // (NaN) propagated into outer.position/outer.scale and silently
      // blanked the ENTIRE model (NaN transforms render nothing, no
      // thrown error to point at the cause). Found via round 9's outline
      // work - render scripts that call setBodyPose({}) (an empty/
      // all-defaults pose) came back as a plain background color with no
      // creature at all; getRawPixels() confirmed the WebGL pipeline
      // itself was fine and the scene graph had no NaN positions BEFORE
      // any applyPose call, which narrowed it to this default object
      // specifically being stale.
      depthZ: 0, lateralX: 0, spinOverride: false, spinAngle: 0,
      ...partialPose,
    };
    group.userData.applyPose(pose);
    renderFrame();
  },
  // getBodyDebug: world positions of a few key meshes (head/ears/nose/eye)
  // - lets a test script numerically confirm they're where they should be
  // relative to each other, instead of relying on eyeballing a screenshot
  // (this codebase's established convention).
  getBodyDebug() {
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const pos = (obj) => { if (!obj) return null; obj.getWorldPosition(v); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; };
    const d = group.userData.debug || {};
    return {
      head: pos(d.headMesh),
      earLeft: pos(d.earLeft),
      earRight: pos(d.earRight),
      nose: pos(d.noseGroup),
      eye: pos(d.eyeOpenGroup),
    };
  },
  // getCfgColors (round 10 issue 1 verification): exposes the species cfg's
  // own color fields directly, so a test script can compute expected
  // derived colors (e.g. darkenColor(headColor, SEAM_COLOR_DARKEN) for the
  // seam collar) without needing its own copy of the SPECIES table.
  getCfgColors() {
    const cfg = group.userData.cfg || {};
    return { headColor: cfg.headColor || null, bodyColor: cfg.bodyColor, legColor: cfg.legColor };
  },
  // getSeamCollarColors (round 10 issue 1 verification): reads back each
  // seam collar mesh's ACTUAL material color directly from the real
  // rendering scene graph (traversing for voxel-engine.js's
  // mesh.userData.isSeamCollar marker) - a ground-truth value straight from
  // the same code path that renders it, sidestepping the cross-context
  // color-prediction mismatch a Node-side darkenColor() replication hit
  // (Node's require('three') and the browser's imported three module can
  // disagree on THREE.ColorManagement's linear/sRGB handling).
  getSeamCollarColors() {
    const out = [];
    group.traverse((obj) => {
      if (obj.userData && obj.userData.isSeamCollar) {
        const wp = new THREE.Vector3();
        obj.getWorldPosition(wp);
        // seamPart ('neck'|'shoulder', round 14 issue 2) - the neck collar
        // can now be 1-3 meshes instead of always exactly 1 (see voxel-
        // engine.js's addNeckSeamCollar), so callers should filter by this
        // instead of assuming array position 0 is always the neck.
        out.push({ hex: '#' + obj.material.color.getHexString(), seamPart: obj.userData.seamPart || null, worldPos: { x: +wp.x.toFixed(3), y: +wp.y.toFixed(3), z: +wp.z.toFixed(3) } });
      }
    });
    return out;
  },
  // getMeshesByColor (round 14 issue 2 - "턱시도 목 칼라가 흰 배 무늬 위에
  // 튀어나와 보임"): generic world-space AABB lookup for every mesh whose
  // OWN material color matches the given hex, so a test script can compare
  // a seam collar's own bbox (isSeamCollar:true) against e.g. the white
  // belly decal's bbox directly, instead of hand-deriving both from
  // SPECIES x/y/w/h fields (error-prone once addBoxRel's refY2D/zOffset
  // math is involved, same reasoning as getBBoxDebug's own comment).
  getMeshesByColor(hex) {
    group.updateMatrixWorld(true);
    const out = [];
    const target = hex.toLowerCase();
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.material || !obj.material.color) return;
      if ('#' + obj.material.color.getHexString() !== target) return;
      const b = new THREE.Box3().setFromObject(obj);
      out.push({
        isSeamCollar: !!(obj.userData && obj.userData.isSeamCollar),
        min: { x: +b.min.x.toFixed(3), y: +b.min.y.toFixed(3), z: +b.min.z.toFixed(3) },
        max: { x: +b.max.x.toFixed(3), y: +b.max.y.toFixed(3), z: +b.max.z.toFixed(3) },
      });
    });
    return out;
  },
  // getNoseDetailDebug (round 8 issue 2 verification): dumps every child
  // of noseGroup (the base nose mesh plus whatever cfg.noseDetail added -
  // nostril dots or the philtrum line) with world position, box size, and
  // resolved color - a crop screenshot at a 1x1-grid-unit part was too
  // ambiguous to tell "is the detail there and just same-colored" from "is
  // it actually missing/embedded" by eye alone, this settles it exactly.
  getNoseDetailDebug() {
    group.updateMatrixWorld(true);
    const d = group.userData.debug || {};
    if (!d.noseGroup) return null;
    const v = new THREE.Vector3();
    return d.noseGroup.children.map((child) => {
      child.getWorldPosition(v);
      const geo = child.geometry.parameters;
      return {
        pos: { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) },
        size: { w: +geo.width.toFixed(3), h: +geo.height.toFixed(3), d: +geo.depth.toFixed(3) },
        color: '#' + child.material.color.getHexString(),
      };
    });
  },
  // getBBoxDebug: world-space AABBs for the head mesh and the front leg's
  // upper/lower/paw segments, so a test script can check overlap/occlusion
  // numerically (does the raised paw's box actually intersect the head's
  // box, vs. just sit somewhere else - round 5 issue 4; does lowerMesh
  // still overlap pawMesh - round 11 issue 2) instead of guessing from a
  // screenshot.
  getBBoxDebug() {
    group.updateMatrixWorld(true);
    const box = (obj) => {
      if (!obj) return null;
      const b = new THREE.Box3().setFromObject(obj);
      return { min: { x: +b.min.x.toFixed(2), y: +b.min.y.toFixed(2), z: +b.min.z.toFixed(2) }, max: { x: +b.max.x.toFixed(2), y: +b.max.y.toFixed(2), z: +b.max.z.toFixed(2) } };
    };
    const d = group.userData.debug || {};
    const rig = group.userData.legs;
    return {
      head: box(d.headMesh),
      frontUpper: rig.front[0] && box(rig.front[0].upperMesh),
      frontLower: rig.front[0] && box(rig.front[0].lowerMesh),
      frontPaw: rig.front[0] && box(rig.front[0].pawMesh),
    };
  },
  // stepIdle/getIdleDebug: live=1 mode only (see the module comment above)
  // - advances the REAL idle state machine by `dt` simulated seconds,
  // applies the resulting pose, and renders. A launcher script drives
  // this in a loop with a fixed dt (not tied to real wall-clock time) to
  // fast-forward through many idle transitions quickly, matching this
  // codebase's established "run a driven simulation, don't wait on real
  // idle-pool RNG timing" pattern (see test/sim-invariants.mjs).
  stepIdle(dt) {
    if (!liveAnimal) throw new Error('stepIdle requires ?live=1');
    liveElapsed += dt;
    liveAnimal.update(dt, true, liveElapsed);
    const pose = liveAnimal.getPose();
    // Round 8 issue 1 verification - mirrors pet.js's own render() spin-
    // override handling (see its comment) so this viewer actually shows
    // what the real pet window will for prowlcircle/chasetail/hopspin,
    // instead of applying their depthZ/lateralX position+scale but
    // silently ignoring the body-facing spin that's supposed to go with
    // it. No cursor-tracked ease to hand off to here (this harness has no
    // cursor), so just follow spinAngle directly when set and hold still
    // otherwise - setAngle() remains available for manual override in
    // non-live use.
    if (pose.spinOverride) group.rotation.y = pose.spinAngle;
    group.userData.applyPose(pose);
    renderFrame();
  },
  getIdleDebug() {
    if (!liveAnimal) return null;
    return liveAnimal.inspect();
  },
  // getRawPixels: dumps the ENTIRE backing framebuffer (RENDER_SIZE x
  // RENDER_SIZE, true render resolution, not the CSS-upscaled display
  // size) as flat RGBA bytes - lets a test script inspect exactly what
  // was rendered pixel-by-pixel without going through capturePage()'s PNG
  // encoding/DOM compositing (round 5, issues 3/4 re-investigation).
  getRawPixels() {
    const gl = renderer.getContext();
    const w = canvas.width, h = canvas.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { w, h, buf: Array.from(buf) };
  },
  // getFaceShadeVertexColors: raw per-vertex color-attribute dump for the
  // head mesh, with each vertex's own computed (x2d,y2d) alongside it - no
  // rendering/occlusion ambiguity (unlike a screenshot, where the eye mesh
  // sits ON TOP of the focus point and the ear may sit right next to the
  // far end, making "which region is actually the gradient vs. a separate
  // opaque part" hard to judge by eye). Debug-only, added to verify
  // addFaceShadedHeadBox's direction (dark near focus, light far) numerically.
  getFaceShadeVertexColors() {
    const headMesh = group.userData.debug && group.userData.debug.headMesh;
    if (!headMesh || !headMesh.geometry.attributes.color) return null;
    const pos = headMesh.geometry.attributes.position;
    const col = headMesh.geometry.attributes.color;
    const cfg = SPECIES[speciesKey];
    const out = [];
    for (let i = 0; i < pos.count; i++) {
      out.push({
        x2d: +(cfg.headX + cfg.headW / 2 + pos.getX(i)).toFixed(2),
        y2d: +(cfg.headY + cfg.headH / 2 - pos.getY(i)).toFixed(2),
        rgb: [Math.round(col.getX(i) * 255), Math.round(col.getY(i) * 255), Math.round(col.getZ(i) * 255)],
      });
    }
    return out;
  },
  // getFaceShadeSample: round 4 issue 4 verification - numerically confirms
  // addFaceShadedHeadBox's gradient (voxel-engine.js) actually varies
  // instead of being flat, without relying on eyeballing a screenshot
  // (this codebase's established convention - see CLAUDE.md's many "checked
  // numerically, not just by eye" notes). Reads real rendered pixels via
  // gl.readPixels at the WebGL backing resolution (not a capturePage()
  // screenshot, which is DOM-composited/DPI-scaled and awkward to map back
  // to an exact 3D point) - projects two known head-surface points (the
  // face-shade focus itself, and the head-rect corner farthest from it)
  // through the camera with THREE's own Vector3.project() so the pixel
  // coordinates are exactly right for whatever camera/frustum this page
  // happens to be using, not hand-derived/hardcoded.
  getFaceShadeSample() {
    const cfg = SPECIES[speciesKey] || SPECIES.cat_a;
    if (!cfg.faceShade) return null;
    const fs = cfg.faceShade;
    const focusX2D = fs.focusX ?? (cfg.eye.x + cfg.eye.w / 2);
    const focusY2D = fs.focusY ?? (cfg.eye.y + cfg.eye.h / 2);
    const corners = [
      [cfg.headX, cfg.headY], [cfg.headX + cfg.headW, cfg.headY],
      [cfg.headX, cfg.headY + cfg.headH], [cfg.headX + cfg.headW, cfg.headY + cfg.headH],
    ];
    let far = corners[0], farDist = -1;
    for (const c of corners) {
      const d = Math.hypot(c[0] - focusX2D, c[1] - focusY2D);
      if (d > farDist) { farDist = d; far = c; }
    }
    // Sample ALONG the focus->far-corner line at two insets, not at the
    // endpoints themselves - the focus point itself sits inside the eye
    // box's own footprint (eye is a separate, closer mesh at EYE_Z, so it
    // occludes the head surface directly behind it), and the exact corner
    // sits right on the box's silhouette edge (risks landing a pixel off
    // the shape entirely, onto background/an adjacent part). t=0.35 clears
    // the eye's ~1-unit half-extent from its center; t=0.8 stays solidly
    // inside the head face without touching the corner edge.
    const dx = far[0] - focusX2D, dy = far[1] - focusY2D;
    const nearPoint = [focusX2D + dx * 0.35, focusY2D + dy * 0.35];
    const farPoint = [focusX2D + dx * 0.8, focusY2D + dy * 0.8];
    group.updateMatrixWorld(true);
    const headMesh = group.userData.debug && group.userData.debug.headMesh;
    const v = new THREE.Vector3();
    function readPixelAt(x2d, y2d) {
      // Point in headMesh's own LOCAL space (relative to its center, since
      // BoxGeometry is centered at its mesh's local origin - see makeBox),
      // on the front face (local Z = +HALF_DEPTH). Converted to world space
      // via localToWorld(), which threads through every ancestor transform
      // automatically (headSquashGroup's squash scale, the whole-creature
      // recentering shift buildVoxelCreature applies via rollPivot.position.x
      // -= bbox center, etc.) - a hand-rolled world-space formula missed
      // that recentering shift entirely on the first attempt (every sample
      // came back as pure background, i.e. genuinely off-screen - the
      // creature's own build-time recentering was silently unaccounted for).
      v.set(x2d - (cfg.headX + cfg.headW / 2), (cfg.headY + cfg.headH / 2) - y2d, HALF_DEPTH);
      headMesh.localToWorld(v);
      v.project(camera); // NDC, [-1,1] on each axis
      const px = Math.round(((v.x + 1) / 2) * canvas.width);
      const py = Math.round(((1 - v.y) / 2) * canvas.height); // NDC Y+ is up, pixel Y+ is down
      const buf = new Uint8Array(4);
      const gl = renderer.getContext();
      gl.readPixels(px, canvas.height - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { px, py, rgb: [buf[0], buf[1], buf[2]] };
    }
    return {
      nearFocus: readPixelAt(nearPoint[0], nearPoint[1]), // should read close to expectedDark
      farFromFocus: readPixelAt(farPoint[0], farPoint[1]), // should read noticeably lighter, toward expectedLight
      expectedDark: cfg.headColor || cfg.bodyColor,
      expectedLight: fs.highlight,
    };
  },
};

if (spin) {
  function tick() {
    group.rotation.y += 0.025; // steady spin - smoothness itself is what's being checked, not a particular speed
    renderFrame();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
} else {
  renderFrame();
}
