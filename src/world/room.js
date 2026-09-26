import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { Screen } from './screens.js';
import { projects } from '../content.js';

// Room extents (meters). x: left(-) → right(+), z: back wall(-) → front wall(+).
export const ROOM = { w: 14, d: 12, h: 4.2 };
const HX = ROOM.w / 2;
const HZ = ROOM.d / 2;

export const START = { x: -2.2, z: -4.35 };
export const SWITCH_POS = new THREE.Vector3(-1.9, 1.28, -HZ + 0.02);

const WARM = new THREE.Color('#ffc58a');
const HERO_KEY = 14;
const HERO_RIM = 9;

// ---------- small builders ----------
// Plain materials are cached by colour/finish so identical props can be merged into one draw call.
const stdCache = new Map();
const std = (color, rough = 0.7, metal = 0, extra = null) => {
  if (extra) return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const key = `${color}|${rough}|${metal}`;
  if (!stdCache.has(key)) stdCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return stdCache.get(key);
};

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}
const box = (w, h, d, mat, parent, x, y, z, opts) => mesh(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z, opts);
const rbox = (w, h, d, r, mat, parent, x, y, z, opts) =>
  mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat, parent, x, y, z, opts);
const cyl = (rt, rb, h, mat, parent, x, y, z, seg = 20, opts) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, parent, x, y, z, opts);

// Materials shared across the room.
const M = {};
function initMaterials() {
  M.floor = std('#ffffff', 0.55, 0, { map: TX.woodFloor() });
  // Each wall its own colour: deep green behind the setup, terracotta around the window,
  // navy at the front, charcoal for the gallery so the artwork pops.
  M.wallBack = std('#ffffff', 0.9, 0, { map: TX.plaster([38, 74, 64], 3) });
  M.wallRight = std('#ffffff', 0.9, 0, { map: TX.plaster([168, 84, 52], 8) });
  M.wallFront = std('#ffffff', 0.9, 0, { map: TX.plaster([40, 54, 84], 9) });
  M.wallAccent = std('#ffffff', 0.92, 0, { map: TX.plaster([46, 47, 53], 4) });
  M.ceiling = std('#1c1d22', 0.95);
  M.trim = std('#16171b', 0.6);
  M.oak = std('#b98a5e', 0.55);
  M.walnut = std('#5a3b27', 0.5);
  M.black = std('#141418', 0.45, 0.2);
  M.blackMatte = std('#1b1c20', 0.85);
  M.metal = std('#9aa0a8', 0.3, 0.9);
  M.darkMetal = std('#2b2d33', 0.35, 0.8);
  M.white = std('#e9e6df', 0.5);
  M.fabric = std('#ffffff', 0.95, 0, { map: TX.fabric('#3c4252', 5) });
  M.fabricWarm = std('#ffffff', 0.95, 0, { map: TX.fabric('#8a5a44', 6) });
  M.rug = std('#ffffff', 1, 0, { map: TX.rug() });
  M.leaf = std('#3e6b3a', 0.7, 0, { side: THREE.DoubleSide });
  M.pot = std('#c9b8a3', 0.8);
  M.glass = new THREE.MeshPhysicalMaterial({
    color: '#aab4c0',
    roughness: 0.05,
    metalness: 0,
    transmission: 0,
    transparent: true,
    opacity: 0.18,
  });
  M.cable = std('#101012', 0.6);
  M.bezel = std('#0c0c0e', 0.4, 0.3);
}

// ---------- the room ----------
export class Room {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    initMaterials();

    this.colliders = []; // axis-aligned XZ boxes {minX,maxX,minZ,maxZ}
    this.frames = []; // grabbable project frames
    this.screens = [];
    this.spin = []; // things that rotate once powered (fans, record)
    this.sway = []; // hanging cards
    this.power = 0; // 0..1 overall
    this.powered = false;
    this.events = [];
    this.clock = 0;

    this.buildShell();
    this.buildLights();
    this.buildBackWall();
    this.buildDesk();
    this.buildSetupWall();
    this.buildGallery();
    this.buildWindowWall();
    this.buildLounge();
    this.buildWorktable();
    this.buildStudioLights();
    this.buildLedStrip();
    this.buildHangingCards();
    this.buildNeon();
    this.optimize();
  }

  // Merge every static mesh that shares a material into one draw call. Anything that moves
  // (frames, fans, records, cards, clock hands, the switch) is flagged dynamic and left alone.
  optimize() {
    const dynamic = [
      this.switchRocker,
      this.sculpture,
      ...this.frames.map((f) => f.group),
      ...this.spin.map((s) => s.obj),
      ...this.sway.map((s) => s.holder),
      ...(this.clockHands || []),
    ];
    dynamic.forEach((o) => o && (o.userData.dynamic = true));
    this.group.updateMatrixWorld(true);
    const buckets = new Map();
    const victims = [];
    const walk = (o) => {
      if (o.userData.dynamic) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) {
        const geo = o.geometry;
        const key = [o.material.uuid, o.castShadow, o.receiveShadow, geo.index ? 1 : 0, Object.keys(geo.attributes).sort().join()].join('|');
        if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
        buckets.get(key).geos.push(geo.clone().applyMatrix4(o.matrixWorld));
        victims.push(o);
      }
      o.children.forEach(walk);
    };
    walk(this.group);
    let merged = 0;
    for (const b of buckets.values()) {
      if (b.geos.length < 2) {
        b.geos.forEach((g) => g.dispose());
        continue;
      }
      const geo = mergeGeometries(b.geos, false);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = b.receive;
      m.userData.merged = true;
      this.group.add(m);
      merged += b.geos.length;
      b.geos.forEach((g) => g.dispose());
      b.done = true;
    }
    // remove originals whose bucket actually merged
    for (const o of victims) {
      const geo = o.geometry;
      const key = [o.material.uuid, o.castShadow, o.receiveShadow, geo.index ? 1 : 0, Object.keys(geo.attributes).sort().join()].join('|');
      if (buckets.get(key).done) o.removeFromParent();
    }
    this.mergedCount = merged;
  }

  collider(cx, cz, w, d, pad = 0) {
    this.colliders.push({ minX: cx - w / 2 - pad, maxX: cx + w / 2 + pad, minZ: cz - d / 2 - pad, maxZ: cz + d / 2 + pad });
  }

  // ---------------- shell ----------------
  buildShell() {
    const g = this.group;
    const floor = mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), M.floor, g, 0, 0, 0, { cast: false });
    floor.rotation.x = -Math.PI / 2;
    M.floor.map.repeat.set(ROOM.w / 4, ROOM.d / 4);

    const ceil = mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), M.ceiling, g, 0, ROOM.h, 0, { cast: false });
    ceil.rotation.x = Math.PI / 2;

    const wall = (w, mat, x, z, ry) => {
      const m = mesh(new THREE.PlaneGeometry(w, ROOM.h), mat, g, x, ROOM.h / 2, z, { cast: false });
      m.rotation.y = ry;
      return m;
    };
    this.walls = [
      wall(ROOM.w, M.wallBack, 0, -HZ, 0), // back: the setup wall
      wall(ROOM.w, M.wallFront, 0, HZ, Math.PI), // front
      wall(ROOM.d, M.wallAccent, -HX, 0, Math.PI / 2), // left: gallery
      wall(ROOM.d, M.wallRight, HX, 0, -Math.PI / 2), // right: window
    ];
    M.wallAccent.map.repeat.set(3, 1);

    // skirting boards
    box(ROOM.w, 0.1, 0.02, M.trim, g, 0, 0.05, -HZ + 0.01);
    box(ROOM.w, 0.1, 0.02, M.trim, g, 0, 0.05, HZ - 0.01);
    box(0.02, 0.1, ROOM.d, M.trim, g, -HX + 0.01, 0.05, 0);
    box(0.02, 0.1, ROOM.d, M.trim, g, HX - 0.01, 0.05, 0);

    // ceiling cove that hides the LED strip
    const cove = std('#101114', 0.9);
    box(ROOM.w, 0.08, 0.3, cove, g, 0, ROOM.h - 0.28, -HZ + 0.15);
    box(ROOM.w, 0.08, 0.3, cove, g, 0, ROOM.h - 0.28, HZ - 0.15);
    box(0.3, 0.08, ROOM.d, cove, g, -HX + 0.15, ROOM.h - 0.28, 0);
    box(0.3, 0.08, ROOM.d, cove, g, HX - 0.15, ROOM.h - 0.28, 0);

    // big center rug
    const rug = mesh(new THREE.PlaneGeometry(4.6, 3.2), M.rug, g, -0.6, 0.006, 0.4, { cast: false });
    rug.rotation.x = -Math.PI / 2;
  }

  // ---------------- lights ----------------
  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight('#ffe2c4', '#2a2230', 0);
    s.add(this.hemi);

    // Warm dusk light spilling in from the window side. The one shadow caster.
    this.sun = new THREE.DirectionalLight('#ffb38a', 0);
    this.sun.position.set(9, 6, -1.5);
    this.sun.target.position.set(-2, 0, 0.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    const cam = this.sun.shadow.camera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 7;
    cam.bottom = -5;
    cam.near = 1;
    cam.far = 25;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    s.add(this.sun, this.sun.target);

    // Gallery wash on the left wall.
    this.galleryLight = new THREE.SpotLight('#ffd7a8', 0, 12, 0.7, 0.6, 1.2);
    this.galleryLight.position.set(-3.6, 3.9, 0);
    this.galleryLight.target.position.set(-HX, 1.5, 0);
    s.add(this.galleryLight, this.galleryLight.target);

    // Monitor glow on the desk / face.
    this.screenGlow = new THREE.PointLight('#8fb4ff', 0, 4, 1.6);
    this.screenGlow.position.set(2.1, 1.2, -4.95);
    s.add(this.screenGlow);

    // Faint top light so the character reads in the dark before the switch.
    this.heroLight = new THREE.SpotLight('#c9d4ff', 0, 7, 0.42, 0.75, 1.1);
    this.heroLight.position.set(START.x + 0.4, 4.0, START.z + 1.6);
    this.heroLight.target.position.set(START.x, 1.0, START.z);
    s.add(this.heroLight, this.heroLight.target);
    // Cool rim from behind so the silhouette separates from the black room.
    this.heroRim = new THREE.SpotLight('#8fa8ff', 0, 6, 0.5, 0.9, 1.1);
    this.heroRim.target = this.heroLight.target;
    s.add(this.heroRim);
  }

  // ---------------- back wall: door, switchboard, bookshelf ----------------
  buildBackWall() {
    const g = this.group;
    // door
    const dz = -HZ + 0.03;
    box(1.12, 2.24, 0.06, M.trim, g, -2.9 - 0.4, 1.12, dz);
    box(0.96, 2.14, 0.05, M.walnut, g, -2.9 - 0.4, 1.07, dz + 0.02);
    cyl(0.025, 0.025, 0.14, M.metal, g, -2.9 - 0.4 + 0.36, 1.02, dz + 0.1).rotation.x = Math.PI / 2;

    // switchboard
    const plate = rbox(0.26, 0.16, 0.02, 0.01, M.white, g, SWITCH_POS.x, SWITCH_POS.y, -HZ + 0.012);
    plate.castShadow = false;
    this.switchRocker = new THREE.Group();
    this.switchRocker.position.set(SWITCH_POS.x - 0.05, SWITCH_POS.y, -HZ + 0.026);
    rbox(0.07, 0.1, 0.018, 0.006, std('#f2efe8', 0.4), this.switchRocker, 0, 0, 0);
    this.switchRocker.rotation.x = 0.16;
    g.add(this.switchRocker);
    const rocker2 = rbox(0.07, 0.1, 0.018, 0.006, std('#f2efe8', 0.4), g, SWITCH_POS.x + 0.05, SWITCH_POS.y, -HZ + 0.026);
    rocker2.rotation.x = 0.16;
    // tiny indicator LED that glows in the dark, so the switch is findable
    this.switchLed = new THREE.MeshBasicMaterial({ color: '#ff7a3d', toneMapped: false });
    mesh(new THREE.SphereGeometry(0.006, 8, 8), this.switchLed, g, SWITCH_POS.x - 0.05, SWITCH_POS.y + 0.068, -HZ + 0.03, { cast: false });

    // bookshelf
    const bx = 5.7;
    const bz = -HZ + 0.22;
    const shelf = new THREE.Group();
    shelf.position.set(bx, 0, bz);
    g.add(shelf);
    box(0.04, 2.4, 0.42, M.walnut, shelf, -0.9, 1.2, 0);
    box(0.04, 2.4, 0.42, M.walnut, shelf, 0.9, 1.2, 0);
    box(0.04, 2.4, 0.42, M.walnut, shelf, 0, 1.2, 0);
    for (let i = 0; i < 6; i++) box(1.84, 0.03, 0.42, M.walnut, shelf, 0, 0.05 + i * 0.47, 0);
    const r = TX.rng(42);
    const bookCols = ['#c8553d', '#2d3142', '#e0a458', '#4f6d7a', '#e9e6df', '#8a9a5b', '#333'];
    for (let s = 0; s < 5; s++) {
      for (const side of [-1, 1]) {
        let x = side * 0.86 * (side > 0 ? 0.03 : 1);
        x = side < 0 ? -0.86 : 0.04;
        const end = side < 0 ? -0.04 : 0.86;
        while (x < end - 0.05) {
          if (r() < 0.12) {
            x += 0.14;
            continue;
          }
          const w = 0.025 + r() * 0.035;
          const h = 0.24 + r() * 0.14;
          box(w, h, 0.26 + r() * 0.06, std(bookCols[Math.floor(r() * bookCols.length)], 0.8), shelf, x + w / 2, 0.08 + s * 0.47 + h / 2, 0.02, { cast: false });
          x += w + 0.004;
        }
      }
    }
    // a few objects on shelves
    mesh(new THREE.IcosahedronGeometry(0.1, 0), std('#ffb46b', 0.3, 0.5), shelf, 0.45, 2.48, 0);
    mesh(new THREE.TorusKnotGeometry(0.07, 0.022, 80, 10), std('#e9e6df', 0.3), shelf, -0.4, 2.46, 0);
    this.collider(bx, bz, 1.9, 0.44);
  }

  // ---------------- main desk setup ----------------
  buildDesk() {
    const g = this.group;
    const desk = new THREE.Group();
    const DX = 2.2;
    const DZ = -HZ + 0.45;
    desk.position.set(DX, 0, DZ);
    g.add(desk);
    const topY = 0.75;

    rbox(2.6, 0.045, 0.85, 0.01, M.oak, desk, 0, topY - 0.022, 0);
    for (const sx of [-1.2, 1.2]) box(0.06, topY - 0.05, 0.7, M.black, desk, sx, (topY - 0.05) / 2, 0);
    box(2.3, 0.04, 0.04, M.black, desk, 0, 0.12, -0.3);
    // drawer unit under the left side
    rbox(0.42, 0.56, 0.6, 0.01, std('#e9e6df', 0.5), desk, -0.9, 0.29, 0.02);
    for (let i = 0; i < 3; i++) box(0.1, 0.012, 0.012, M.darkMetal, desk, -0.9, 0.46 - i * 0.17, 0.33);
    // desk mat
    rbox(1.2, 0.004, 0.42, 0.01, std('#23242a', 0.95), desk, -0.1, topY + 0.002, 0.14, { cast: false });
    this.collider(DX, DZ, 2.65, 0.9);

    // monitor arm + screens
    const screenAt = (parent, w, h, variant, delay, cw, ch) => {
      rbox(w + 0.022, h + 0.022, 0.03, 0.008, M.bezel, parent, 0, 0, 0);
      const screen = new Screen({ variant, bootDelay: delay, w: cw, h: ch });
      mesh(new THREE.PlaneGeometry(w, h), screen.material, parent, 0, 0, 0.0155, { cast: false, receive: false });
      this.screens.push(screen);
    };
    // main horizontal monitor on a stand
    const main = new THREE.Group();
    main.position.set(-0.2, topY, -0.14);
    desk.add(main);
    rbox(0.26, 0.012, 0.2, 0.004, M.darkMetal, main, 0, 0.006, 0);
    box(0.045, 0.34, 0.03, M.darkMetal, main, 0, 0.18, -0.05);
    const mainScreen = new THREE.Group();
    mainScreen.position.set(0, 0.25 + 0.2, 0);
    main.add(mainScreen);
    screenAt(mainScreen, 0.68, 0.39, 0, 0.1, 1024, 588);
    // vertical monitor on an arm, angled in
    const vert = new THREE.Group();
    vert.position.set(0.52, topY, -0.2);
    vert.rotation.y = -0.38;
    desk.add(vert);
    cyl(0.018, 0.018, 0.5, M.darkMetal, vert, 0, 0.25, -0.08);
    box(0.04, 0.03, 0.1, M.darkMetal, vert, 0, 0.5, -0.04);
    const vScreen = new THREE.Group();
    vScreen.position.set(0, 0.62, 0);
    vert.add(vScreen);
    screenAt(vScreen, 0.33, 0.58, 1, 0.45, 576, 1010);

    // keyboard with instanced keycaps
    const kb = new THREE.Group();
    kb.position.set(-0.18, topY + 0.006, 0.18);
    desk.add(kb);
    rbox(0.42, 0.02, 0.14, 0.006, std('#2a2b31', 0.5, 0.3), kb, 0, 0.01, 0);
    const keyGeo = new RoundedBoxGeometry(0.016, 0.01, 0.016, 1, 0.003);
    const keys = new THREE.InstancedMesh(keyGeo, std('#e9e6df', 0.6), 6 * 21);
    const dummy = new THREE.Object3D();
    const accentKeys = new Set([0, 20, 105, 125, 60]);
    const keyCol = new THREE.Color();
    let k = 0;
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 21; col++) {
        dummy.position.set(-0.19 + col * 0.019, 0.025, -0.055 + row * 0.021);
        dummy.updateMatrix();
        keys.setMatrixAt(k, dummy.matrix);
        keys.setColorAt(k, keyCol.set(accentKeys.has(k) ? '#ff7a45' : '#e9e6df'));
        k++;
      }
    kb.add(keys);
    this.kbGlow = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false });
    box(0.42, 0.002, 0.004, this.kbGlow, kb, 0, 0.002, 0.072, { cast: false });

    const mouse = mesh(new THREE.CapsuleGeometry(0.028, 0.04, 6, 12), std('#e9e6df', 0.4), desk, 0.2, topY + 0.018, 0.2);
    mouse.rotation.x = Math.PI / 2;
    mouse.scale.set(1, 1, 0.55);

    // laptop on a stand (left)
    const lap = new THREE.Group();
    lap.position.set(-0.85, topY, 0.02);
    lap.rotation.y = 0.35;
    desk.add(lap);
    const standPlate = box(0.26, 0.008, 0.24, M.metal, lap, 0, 0.12, 0);
    standPlate.rotation.x = -0.32;
    box(0.02, 0.14, 0.02, M.metal, lap, -0.1, 0.06, -0.08);
    box(0.02, 0.14, 0.02, M.metal, lap, 0.1, 0.06, -0.08);
    const base = new THREE.Group();
    base.position.set(0, 0.13, 0);
    base.rotation.x = -0.32;
    lap.add(base);
    rbox(0.3, 0.012, 0.21, 0.006, std('#b8bcc4', 0.3, 0.8), base, 0, 0.008, 0);
    const lid = new THREE.Group();
    lid.position.set(0, 0.014, -0.105);
    lid.rotation.x = -1.4;
    base.add(lid);
    rbox(0.3, 0.2, 0.008, 0.006, std('#b8bcc4', 0.3, 0.8), lid, 0, 0.1, -0.003);
    const lapScreen = new Screen({ w: 768, h: 480, variant: 3, bootDelay: 1.1 });
    mesh(new THREE.PlaneGeometry(0.28, 0.18), lapScreen.material, lid, 0, 0.1, 0.0015, { cast: false });
    this.screens.push(lapScreen);

    // desk lamp (right): base, two arms, shade, glowing bulb
    const lamp = new THREE.Group();
    lamp.position.set(1.05, topY, -0.22);
    lamp.rotation.y = Math.PI;
    desk.add(lamp);
    cyl(0.07, 0.08, 0.02, M.black, lamp, 0, 0.01, 0);
    const arm1 = cyl(0.008, 0.008, 0.42, M.black, lamp, 0.05, 0.2, 0.04);
    arm1.rotation.z = -0.28;
    const arm2 = cyl(0.008, 0.008, 0.36, M.black, lamp, 0.22, 0.46, 0.08);
    arm2.rotation.z = -1.25;
    const shade = cyl(0.03, 0.085, 0.12, std('#ff7a45', 0.5), lamp, 0.38, 0.47, 0.1);
    shade.rotation.z = -0.5;
    this.lampBulb = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    mesh(new THREE.SphereGeometry(0.03, 12, 12), this.lampBulb, lamp, 0.4, 0.43, 0.1, { cast: false });
    this.lampLight = new THREE.PointLight('#ffb870', 0, 3.2, 1.6);
    this.lampLight.position.set(DX + 1.05 - 0.4, topY + 0.36, DZ - 0.3);
    this.scene.add(this.lampLight);

    // headphones on a stand
    const hp = new THREE.Group();
    hp.position.set(0.95, topY, 0.2);
    desk.add(hp);
    cyl(0.05, 0.06, 0.012, M.black, hp, 0, 0.006, 0);
    cyl(0.008, 0.008, 0.26, M.black, hp, 0, 0.13, 0);
    mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24, Math.PI), std('#1d1e22', 0.5), hp, 0, 0.2, 0);
    for (const s of [-1, 1]) {
      const cup = cyl(0.045, 0.045, 0.03, std('#2a2b31', 0.6), hp, s * 0.088, 0.19, 0);
      cup.rotation.z = Math.PI / 2;
    }

    // phone on a wireless charger with a screen that lights on power
    const phone = new THREE.Group();
    phone.position.set(0.5, topY + 0.005, 0.25);
    phone.rotation.y = -0.3;
    desk.add(phone);
    rbox(0.075, 0.009, 0.155, 0.006, M.bezel, phone, 0, 0, 0);
    this.phoneScreen = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    const ps = mesh(new THREE.PlaneGeometry(0.068, 0.145), this.phoneScreen, phone, 0, 0.0051, 0, { cast: false });
    ps.rotation.x = -Math.PI / 2;

    // mug, notebook, a tiny figure, a stream deck
    cyl(0.04, 0.036, 0.1, std('#2ec4b6', 0.5), desk, 0.72, topY + 0.05, -0.02);
    mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16), std('#2ec4b6', 0.5), desk, 0.765, topY + 0.05, -0.02).rotation.y = Math.PI / 2;
    rbox(0.16, 0.012, 0.22, 0.004, std('#c8553d', 0.8), desk, -0.52, topY + 0.008, 0.22).rotation.y = 0.2;
    const deck = rbox(0.12, 0.02, 0.08, 0.006, M.black, desk, 0.33, topY + 0.012, 0.05);
    deck.rotation.x = -0.25;
    this.deckKeys = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    for (let i = 0; i < 6; i++) box(0.022, 0.004, 0.022, this.deckKeys, deck, -0.035 + (i % 3) * 0.035, 0.012, -0.015 + Math.floor(i / 3) * 0.03, { cast: false });
    const fig = new THREE.Group();
    fig.position.set(-0.6, topY, -0.3);
    desk.add(fig);
    cyl(0.03, 0.035, 0.06, std('#ffd166', 0.5), fig, 0, 0.03, 0);
    mesh(new THREE.SphereGeometry(0.03, 16, 12), std('#ffd166', 0.5), fig, 0, 0.09, 0);

    // speakers
    for (const sx of [-0.62, 0.3]) {
      const sp = rbox(0.11, 0.18, 0.13, 0.01, std('#2d3142', 0.55), desk, sx, topY + 0.09, -0.3);
      mesh(new THREE.CircleGeometry(0.032, 20), M.blackMatte, sp, 0, -0.03, 0.066, { cast: false });
    }
    this.plant(desk, 1.18, topY, 0.26, 0.45);

    // PC tower on the floor with RGB fans behind glass
    const pc = new THREE.Group();
    pc.position.set(1.52, 0, 0.02);
    desk.add(pc);
    rbox(0.22, 0.48, 0.46, 0.01, M.black, pc, 0, 0.26, 0);
    mesh(new THREE.PlaneGeometry(0.44, 0.44), M.glass, pc, -0.111, 0.27, 0, { cast: false }).rotation.y = -Math.PI / 2;
    this.rgbMat = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    for (let i = 0; i < 3; i++) {
      const fan = new THREE.Group();
      fan.position.set(-0.08, 0.1 + i * 0.14, 0.18);
      pc.add(fan);
      mesh(new THREE.TorusGeometry(0.055, 0.006, 8, 28), this.rgbMat, fan, 0, 0, 0, { cast: false }).rotation.y = Math.PI / 2;
      const blades = new THREE.Group();
      fan.add(blades);
      for (let b = 0; b < 5; b++) {
        const bl = box(0.004, 0.045, 0.02, std('#222', 0.5), blades, 0, 0, 0, { cast: false });
        bl.position.set(0, Math.cos((b / 5) * Math.PI * 2) * 0.025, Math.sin((b / 5) * Math.PI * 2) * 0.025);
        bl.rotation.x = (b / 5) * Math.PI * 2;
      }
      this.spin.push({ obj: blades, axis: 'x', speed: 18 });
    }
    this.collider(DX + 1.52, DZ + 0.02, 0.26, 0.5);

    this.chair(desk, -0.1, 0.9, Math.PI + 0.15);
    this.collider(DX - 0.1, DZ + 0.9, 0.62, 0.62);

    const cable = (pts, mat = M.cable) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      mesh(new THREE.TubeGeometry(curve, 40, 0.006, 6), mat, desk, 0, 0, 0, { cast: false });
    };
    cable([[-0.2, 0.95, -0.2], [-0.2, 0.76, -0.36], [0.2, 0.4, -0.41], [1.0, 0.02, -0.35], [1.52, 0.1, -0.2]]);
    cable([[0.52, 1.0, -0.3], [0.5, 0.76, -0.38], [0.9, 0.3, -0.41], [1.46, 0.12, -0.2]]);
    cable([[-0.85, 0.85, -0.05], [-0.9, 0.76, -0.38], [-0.4, 0.3, -0.42], [0.8, 0.02, -0.3], [1.44, 0.2, -0.22]]);
    cable([[1.05, 0.76, -0.22], [1.1, 0.76, -0.4], [1.2, 0.3, -0.42], [1.3, 0.02, -0.2]]);
    cable([[0.5, 0.76, 0.2], [0.45, 0.76, -0.2], [0.4, 0.76, -0.38], [0.2, 0.3, -0.42], [0.0, 0.004, -0.2]], std('#e9e6df', 0.6));

    // RGB bias light behind the monitors, washing the wall
    this.biasMat = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    box(1.3, 0.012, 0.01, this.biasMat, g, DX + 0.05, 1.02, -HZ + 0.012, { cast: false });
    this.biasLight = new THREE.PointLight('#7b61ff', 0, 2.6, 1.4);
    this.biasLight.position.set(DX + 0.05, 1.15, -HZ + 0.18);
    this.scene.add(this.biasLight);
  }

  // ---------------- the setup wall: pegboard, kallax, floating shelves, string lights ----------------
  buildSetupWall() {
    const g = this.group;
    const wz = -HZ;
    const r = TX.rng(909);
    const bookCols = ['#c8553d', '#2d3142', '#e0a458', '#4f6d7a', '#e9e6df', '#8a9a5b', '#1b1c20', '#ff7a45', '#7b61ff', '#2ec4b6'];
    const books = (parent, x0, x1, y, depth, z, maxH = 0.3) => {
      let x = x0;
      while (x < x1 - 0.03) {
        if (r() < 0.08) {
          // a leaning book or gap
          x += 0.06;
          continue;
        }
        const w = 0.022 + r() * 0.03;
        const h = maxH * (0.65 + r() * 0.35);
        const b = box(w, h, depth * (0.75 + r() * 0.2), std(bookCols[Math.floor(r() * bookCols.length)], 0.8), parent, x + w / 2, y + h / 2, z, { cast: false });
        if (r() < 0.05) b.rotation.z = 0.2;
        x += w + 0.003;
      }
    };

    // Pegboard above the desk, with tools, pinned prints and tiny shelves.
    const pb = new THREE.Group();
    pb.position.set(2.25, 1.9, wz + 0.02);
    g.add(pb);
    const pegTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#d9a44e';
      x.fillRect(0, 0, 256, 256);
      x.fillStyle = '#5a3f1a';
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        x.beginPath();
        x.arc(16 + i * 32, 16 + j * 32, 5, 0, Math.PI * 2);
        x.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(9, 4.5);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    box(2.5, 1.2, 0.02, std('#ffffff', 0.8, 0, { map: pegTex }), pb, 0, 0, 0);
    // tools
    const tool = (w, h, col, x, y, rz = 0) => {
      const m = rbox(w, h, 0.012, Math.min(w, h) * 0.3, std(col, 0.5, 0.3), pb, x, y, 0.025);
      m.rotation.z = rz;
      return m;
    };
    tool(0.03, 0.34, '#1b1c20', -1.05, 0.2); // ruler
    tool(0.04, 0.26, '#ff7a45', -0.98, 0.18, 0.1); // cutter
    mesh(new THREE.TorusGeometry(0.04, 0.01, 8, 20), std('#ff7a45', 0.5), pb, -0.88, 0.3, 0.03);
    mesh(new THREE.TorusGeometry(0.04, 0.01, 8, 20), std('#ff7a45', 0.5), pb, -0.8, 0.3, 0.03);
    tool(0.012, 0.2, '#9aa0a8', -0.84, 0.14, 0.05); // scissor blades
    tool(0.3, 0.3, '#e9e6df', -0.65, -0.28, 0).material = std('#2f6d4f', 0.9); // cutting mat
    // tiny shelves with jars and figures
    for (const [sx, sy] of [[-0.35, 0.22], [0.75, -0.18], [0.95, 0.32]]) {
      box(0.34, 0.015, 0.1, M.oak, pb, sx, sy, 0.06);
      cyl(0.03, 0.03, 0.08, M.glass, pb, sx - 0.1, sy + 0.048, 0.06);
      cyl(0.025, 0.025, 0.06, std(bookCols[Math.floor(r() * 10)], 0.5), pb, sx + 0.02, sy + 0.038, 0.06);
      mesh(new THREE.IcosahedronGeometry(0.035, 0), std('#ffd166', 0.3, 0.4), pb, sx + 0.11, sy + 0.045, 0.06);
    }
    // pinned prints
    const prints = [['#1b1b2f', '#ff6b3d', '#ffd166'], ['#0b3954', '#2ec4b6', '#e8f1f2'], ['#10002b', '#f72585', '#4cc9f0'], ['#386641', '#a7c957', '#f2e8cf']];
    prints.forEach((c, i) => {
      const w = 0.2 + r() * 0.1;
      const h = w * 1.3;
      const m = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: TX.posterArt(500 + i, c, ''), roughness: 0.9 }), pb, 0.05 + i * 0.26 - 0.2, 0.22 + (r() - 0.5) * 0.1, 0.022, { cast: false });
      m.rotation.z = (r() - 0.5) * 0.14;
    });
    // headphones hanging on a hook
    cyl(0.005, 0.005, 0.08, M.darkMetal, pb, 1.12, -0.05, 0.05).rotation.x = Math.PI / 2;
    mesh(new THREE.TorusGeometry(0.08, 0.011, 8, 24, Math.PI), std('#ff7a45', 0.5), pb, 1.12, -0.13, 0.08).rotation.z = Math.PI;

    // Floating shelves high above, loaded with books and trailing plants.
    for (const [sx, sy, w] of [[1.4, 2.78, 1.6], [3.15, 3.05, 1.3]]) {
      box(w, 0.03, 0.24, M.walnut, g, sx, sy, wz + 0.12);
      books(g, sx - w / 2 + 0.05, sx + w / 2 - 0.35, sy + 0.015, 0.18, wz + 0.12, 0.26);
      this.trailingPlant(g, sx + w / 2 - 0.16, sy + 0.015, wz + 0.12);
    }

    // IKEA Kallax-style 4×4 cube shelf between the switch and the desk.
    const kx = -0.45;
    const kal = new THREE.Group();
    kal.position.set(kx, 0, wz + 0.2);
    g.add(kal);
    const cube = 0.335;
    const t = 0.035;
    const W = cube * 4 + t * 5;
    const kalMat = std('#c49a6c', 0.6);
    box(W, t, 0.39, kalMat, kal, 0, t / 2 + 0.02, 0);
    for (let i = 1; i <= 4; i++) box(W, t, 0.39, kalMat, kal, 0, 0.02 + t / 2 + i * (cube + t), 0);
    for (let i = 0; i <= 4; i++) box(t, W, 0.39, kalMat, kal, -W / 2 + t / 2 + i * (cube + t), 0.02 + W / 2, 0);
    const inserts = ['#c8553d', '#2d3142', '#e0a458', '#4f6d7a'];
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) {
        const cx = -W / 2 + t + cube / 2 + col * (cube + t);
        const cy = 0.02 + t + row * (cube + t);
        const kind = (row * 4 + col * 3) % 6;
        if (kind === 0 || kind === 3) books(kal, cx - cube / 2 + 0.01, cx + cube / 2 - 0.01, cy, 0.28, 0, cube - 0.03);
        else if (kind === 1) rbox(cube - 0.02, cube - 0.02, 0.33, 0.01, std(inserts[(row + col) % 4], 0.85), kal, cx, cy + cube / 2, 0.02); // fabric bin
        else if (kind === 2) {
          // vinyl records
          for (let v = 0; v < 9; v++) box(0.006, 0.31, 0.31, std(bookCols[(v + row) % 10], 0.6), kal, cx - 0.13 + v * 0.03, cy + 0.155, 0);
        } else if (kind === 4) this.plant(kal, cx, cy, 0, 0.55);
        else {
          mesh(new THREE.TorusKnotGeometry(0.06, 0.02, 60, 8), std(inserts[col], 0.3, 0.5), kal, cx, cy + 0.1, 0);
          cyl(0.05, 0.05, 0.12, std('#1b1c20', 0.4), kal, cx + 0.09, cy + 0.06, 0.05);
        }
      }
    // things on top of the Kallax: record player, camera, plant, lava lamp
    rbox(0.36, 0.08, 0.3, 0.01, M.oak, kal, -0.4, W + 0.06, 0);
    const record = new THREE.Group();
    record.position.set(-0.4, W + 0.105, 0);
    kal.add(record);
    cyl(0.14, 0.14, 0.006, std('#111', 0.3, 0.3), record, 0, 0, 0, 40);
    cyl(0.045, 0.045, 0.008, std('#f72585', 0.6), record, 0, 0.001, 0, 20);
    this.spin.push({ obj: record, axis: 'y', speed: 3.5 });
    this.plant(kal, 0.55, W + 0.02, 0, 0.6);
    this.lava = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    cyl(0.05, 0.08, 0.1, M.darkMetal, kal, 0.12, W + 0.07, 0);
    mesh(new THREE.CapsuleGeometry(0.05, 0.14, 8, 16), this.lava, kal, 0.12, W + 0.22, 0, { cast: false });
    this.collider(kx, wz + 0.2, W, 0.4);

    // skateboard deck + clock on the wall above the Kallax
    const sk = new THREE.Group();
    sk.position.set(kx - 0.25, 2.35, wz + 0.03);
    sk.rotation.z = 0.35;
    g.add(sk);
    rbox(0.2, 0.8, 0.02, 0.09, std('#ffd166', 0.6), sk, 0, 0, 0);
    mesh(new THREE.PlaneGeometry(0.16, 0.6), new THREE.MeshStandardMaterial({ map: TX.posterArt(77, ['#ffd166', '#f72585', '#2d3142'], ''), roughness: 0.7 }), sk, 0, 0, 0.011, { cast: false });
    const clk = new THREE.Group();
    clk.position.set(kx + 0.45, 2.45, wz + 0.02);
    g.add(clk);
    cyl(0.17, 0.17, 0.03, M.black, clk, 0, 0, 0, 40).rotation.x = Math.PI / 2;
    cyl(0.155, 0.155, 0.032, std('#f4f1ea', 0.6), clk, 0, 0, 0.001, 40).rotation.x = Math.PI / 2;
    this.clockHands = [];
    for (const [len, wid] of [[0.09, 0.012], [0.13, 0.008]]) {
      const h = new THREE.Group();
      h.position.z = 0.02;
      clk.add(h);
      box(wid, len, 0.004, M.black, h, 0, len / 2 - 0.01, 0, { cast: false });
      this.clockHands.push(h);
    }

    // String lights draped across the top of the wall (turn on with the room).
    const pts = [];
    const segs = 5;
    const x0 = -2.0;
    const x1 = 6.6;
    for (let sgm = 0; sgm < segs; sgm++) {
      const a = x0 + ((x1 - x0) / segs) * sgm;
      const b = a + (x1 - x0) / segs;
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        pts.push(new THREE.Vector3(a + (b - a) * u, 3.55 - Math.sin(u * Math.PI) * 0.28, wz + 0.05));
      }
    }
    const wire = new THREE.CatmullRomCurve3(pts);
    mesh(new THREE.TubeGeometry(wire, 200, 0.003, 4), M.cable, g, 0, 0, 0, { cast: false });
    const n = 44;
    this.fairy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 8), new THREE.MeshBasicMaterial({ color: '#fff', toneMapped: false }), n);
    const dmy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      dmy.position.copy(wire.getPointAt((i + 0.5) / n));
      dmy.position.y -= 0.02;
      dmy.updateMatrix();
      this.fairy.setMatrixAt(i, dmy.matrix);
      this.fairy.setColorAt(i, new THREE.Color(0));
    }
    this.fairyCount = n;
    g.add(this.fairy);
  }

  trailingPlant(parent, x, y, z) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    parent.add(p);
    cyl(0.08, 0.06, 0.14, std('#c8553d', 0.8), p, 0, 0.07, 0);
    const leafGeo = new THREE.SphereGeometry(0.03, 6, 4);
    leafGeo.scale(1, 0.4, 1.4);
    const r = TX.rng(Math.floor(x * 1000));
    for (let v = 0; v < 5; v++) {
      const a = (v / 5) * Math.PI * 2;
      const len = 0.4 + r() * 0.7;
      for (let i = 0; i < 14; i++) {
        const u = i / 13;
        const lx = Math.cos(a) * (0.07 + u * 0.05);
        const lz = Math.sin(a) * 0.06 + Math.max(0, Math.sin(a)) * 0.04;
        const l = mesh(leafGeo, M.leaf, p, lx, 0.12 - u * len, lz, { receive: false });
        l.rotation.set(r() * 3, r() * 3, r() * 3);
      }
    }
  }

  plant(parent, x, y, z, s = 1) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.scale.setScalar(s);
    parent.add(p);
    cyl(0.11, 0.08, 0.22, M.pot, p, 0, 0.11, 0);
    const r = TX.rng(Math.floor((x + 10) * 100));
    const leafGeo = new THREE.PlaneGeometry(0.09, 0.34);
    leafGeo.translate(0, 0.17, 0);
    for (let i = 0; i < 11; i++) {
      const l = mesh(leafGeo, M.leaf, p, 0, 0.2, 0, { receive: false });
      l.rotation.y = r() * Math.PI * 2;
      l.rotation.z = 0.2 + r() * 0.7;
      l.scale.setScalar(0.7 + r() * 0.6);
    }
    return p;
  }

  chair(parent, x, z, ry) {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    parent.add(c);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = box(0.3, 0.03, 0.04, M.darkMetal, c, Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15);
      leg.rotation.y = -a;
      mesh(new THREE.SphereGeometry(0.025, 8, 8), M.blackMatte, c, Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29);
    }
    cyl(0.03, 0.03, 0.36, M.metal, c, 0, 0.24, 0);
    rbox(0.52, 0.08, 0.5, 0.04, M.fabric, c, 0, 0.46, 0);
    const back = rbox(0.5, 0.62, 0.07, 0.04, M.fabric, c, 0, 0.84, -0.24);
    back.rotation.x = -0.12;
    for (const s of [-1, 1]) {
      box(0.04, 0.2, 0.04, M.darkMetal, c, s * 0.26, 0.56, -0.02);
      rbox(0.06, 0.03, 0.26, 0.01, M.blackMatte, c, s * 0.26, 0.67, 0.0);
    }
  }

  // ---------------- left wall: project gallery ----------------
  buildGallery() {
    const g = this.group;
    const n = projects.length;
    const span = 8.4;
    const fw = 0.6;
    const fh = 0.76;
    projects.forEach((p, i) => {
      const z = -span / 2 + (span / (n - 1)) * i;
      const y = 1.55;
      const cover = TX.projectCover(p, i);
      const coverUrl = p.image || cover.toDataURL('image/jpeg', 0.9);
      const tex = new THREE.CanvasTexture(cover);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      if (p.image) {
        new THREE.TextureLoader().load(p.image, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          art.material.map = t;
          art.material.needsUpdate = true;
        });
      }

      const frame = new THREE.Group();
      const frameMat = std('#bdb4a6', 0.55, 0.1, { emissive: new THREE.Color('#ffb46b'), emissiveIntensity: 0 });
      rbox(fw + 0.08, fh + 0.08, 0.045, 0.008, frameMat, frame, 0, 0, 0);
      box(fw, fh, 0.01, std('#f4f1ea', 0.9), frame, 0, 0, 0.02, { cast: false });
      const art = mesh(
        new THREE.PlaneGeometry(fw - 0.1, fh - 0.1),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
        frame,
        0,
        0,
        0.026,
        { cast: false },
      );
      // hanging hook on the wall so the empty spot reads when a frame is taken
      const hook = cyl(0.008, 0.008, 0.03, M.darkMetal, g, -HX + 0.015, y + fh / 2 - 0.08, z);
      hook.rotation.z = Math.PI / 2;

      const wallPos = new THREE.Vector3(-HX + 0.035, y, z);
      const wallQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      frame.position.copy(wallPos);
      frame.quaternion.copy(wallQuat);
      g.add(frame);

      // picture light bar above each frame
      const bar = new THREE.Group();
      bar.position.set(-HX + 0.12, y + fh / 2 + 0.16, z);
      g.add(bar);
      box(0.2, 0.02, 0.02, M.darkMetal, bar, -0.08, 0.02, 0);
      const lightMat = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
      const tube = cyl(0.018, 0.018, 0.5, M.darkMetal, bar, 0.02, 0, 0);
      tube.rotation.x = Math.PI / 2;
      const glow = box(0.012, 0.004, 0.46, lightMat, bar, 0.02, -0.018, 0, { cast: false });
      glow.castShadow = false;

      this.frames.push({
        index: i,
        project: p,
        coverUrl,
        group: frame,
        frameMat,
        barMat: lightMat,
        wallPos,
        wallQuat,
        normal: new THREE.Vector3(1, 0, 0),
        size: [fw + 0.08, fh + 0.08],
      });
    });

    // label strip under the gallery
    const lab = mesh(
      new THREE.PlaneGeometry(2.4, 0.3),
      new THREE.MeshBasicMaterial({ map: TX.labelTexture('SELECTED WORK — PRESS SPACE TO PICK ONE UP', { w: 2048, h: 256, color: '#f4f1ea', font: "600 70px Inter, 'Helvetica Neue', Arial, sans-serif" }), transparent: true, opacity: 0.55 }),
      g,
      -HX + 0.02,
      0.62,
      0,
      { cast: false },
    );
    lab.rotation.y = Math.PI / 2;
    this.galleryLabel = lab.material;
  }

  // ---------------- right wall: scenery window + credenza ----------------
  buildWindowWall() {
    const g = this.group;
    const x = HX - 0.02;
    const W = 7.4;
    const H = 2.5;
    this.sceneryMat = new THREE.MeshBasicMaterial({ map: TX.scenery(), toneMapped: true });
    this.sceneryMat.color.setScalar(0.04);
    const view = mesh(new THREE.PlaneGeometry(W, H), this.sceneryMat, g, x, 2.05, 0, { cast: false, receive: false });
    view.rotation.y = -Math.PI / 2;
    // window frame + mullions
    const fm = M.black;
    box(0.08, 0.08, W + 0.1, fm, g, x - 0.04, 2.05 + H / 2, 0);
    box(0.08, 0.08, W + 0.1, fm, g, x - 0.04, 2.05 - H / 2, 0);
    for (let i = 0; i <= 4; i++) box(0.08, H, 0.05, fm, g, x - 0.04, 2.05, -W / 2 + (W / 4) * i);
    box(0.05, 0.03, W, fm, g, x - 0.04, 2.05 + 0.35, 0);
    box(0.22, 0.04, W + 0.2, M.white, g, x - 0.1, 2.05 - H / 2 - 0.04, 0); // sill

    // credenza under the window
    const cz = 0;
    const cred = new THREE.Group();
    cred.position.set(HX - 0.3, 0, cz);
    g.add(cred);
    rbox(0.46, 0.5, 3.0, 0.01, M.walnut, cred, 0, 0.35, 0);
    for (let i = 0; i < 4; i++) box(0.01, 0.42, 0.7, M.oak, cred, -0.235, 0.35, -1.1 + i * 0.735);
    for (const s of [-1.35, 1.35]) for (const t of [-0.15, 0.15]) cyl(0.015, 0.012, 0.1, M.metal, cred, t, 0.05, s);
    this.collider(HX - 0.3, cz, 0.5, 3.05);
    // record player
    rbox(0.36, 0.08, 0.32, 0.01, M.oak, cred, 0, 0.64, -0.7);
    const record = new THREE.Group();
    record.position.set(0, 0.69, -0.7);
    cred.add(record);
    cyl(0.14, 0.14, 0.006, std('#111', 0.3, 0.3), record, 0, 0, 0, 40);
    cyl(0.045, 0.045, 0.008, std('#c8553d', 0.6), record, 0, 0.001, 0, 20);
    box(0.02, 0.006, 0.07, std('#eee', 0.5), record, 0.08, 0.004, 0);
    this.spin.push({ obj: record, axis: 'y', speed: 3.5 });
    // speaker + plants + sculpture on the credenza
    rbox(0.22, 0.32, 0.22, 0.02, std('#e9e6df', 0.6), cred, 0, 0.76, 0.1);
    this.plant(cred, 0, 0.6, 1.1, 0.8);
    mesh(new THREE.TorusGeometry(0.1, 0.03, 16, 40), std('#ffb46b', 0.25, 0.8), cred, 0, 0.73, 0.55).rotation.y = Math.PI / 2;

    // tall floor plants on both sides of the window
    this.plant(g, HX - 0.45, 0, -4.4, 2.2);
    this.plant(g, HX - 0.45, 0, 4.2, 2.0);
    this.collider(HX - 0.45, -4.4, 0.5, 0.5);
    this.collider(HX - 0.45, 4.2, 0.5, 0.5);
  }

  // ---------------- front-right: lounge ----------------
  buildLounge() {
    const g = this.group;
    const sofa = new THREE.Group();
    const sx = 3.4;
    const sz = HZ - 0.55;
    sofa.position.set(sx, 0, sz);
    sofa.rotation.y = Math.PI;
    g.add(sofa);
    rbox(2.4, 0.22, 0.9, 0.06, M.fabricWarm, sofa, 0, 0.2, 0);
    rbox(2.4, 0.5, 0.2, 0.08, M.fabricWarm, sofa, 0, 0.52, -0.36);
    for (const s of [-1, 1]) rbox(0.2, 0.36, 0.9, 0.08, M.fabricWarm, sofa, s * 1.12, 0.38, 0);
    for (const s of [-0.55, 0.55]) rbox(1.08, 0.14, 0.72, 0.06, M.fabricWarm, sofa, s, 0.37, 0.06);
    rbox(0.42, 0.36, 0.14, 0.07, std('#e0a458', 0.95), sofa, -0.7, 0.58, -0.2).rotation.z = 0.15;
    rbox(0.42, 0.36, 0.14, 0.07, std('#2d3142', 0.95), sofa, 0.75, 0.58, -0.2).rotation.z = -0.12;
    this.collider(sx, sz, 2.45, 0.95);

    // coffee table
    const tx = sx;
    const tz = HZ - 1.75;
    cyl(0.5, 0.5, 0.04, M.oak, g, tx, 0.38, tz, 40);
    cyl(0.04, 0.04, 0.36, M.black, g, tx, 0.18, tz);
    cyl(0.25, 0.25, 0.02, M.black, g, tx, 0.01, tz, 30);
    rbox(0.26, 0.03, 0.2, 0.004, std('#c8553d', 0.8), g, tx - 0.15, 0.415, tz + 0.05);
    rbox(0.24, 0.02, 0.18, 0.004, std('#e9e6df', 0.8), g, tx - 0.14, 0.44, tz + 0.04).rotation.y = 0.3;
    this.collider(tx, tz, 1.0, 1.0);

    // floor lamp (arc)
    const fl = new THREE.Group();
    fl.position.set(sx + 1.6, 0, sz - 0.1);
    g.add(fl);
    cyl(0.18, 0.2, 0.05, M.black, fl, 0, 0.025, 0);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(0, 2.6, 0),
      new THREE.Vector3(-1.0, 1.9, -0.6),
    );
    mesh(new THREE.TubeGeometry(curve, 30, 0.012, 8), M.metal, fl, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.black, fl, -1.0, 1.9, -0.6);
    this.floorLampBulb = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    mesh(new THREE.SphereGeometry(0.06, 12, 12), this.floorLampBulb, fl, -1.0, 1.84, -0.6, { cast: false });
    this.floorLampLight = new THREE.PointLight('#ffb070', 0, 4.5, 1.5);
    this.floorLampLight.position.set(sx + 0.6, 1.7, sz - 0.7);
    this.scene.add(this.floorLampLight);
    this.collider(sx + 1.6, sz - 0.1, 0.42, 0.42);
  }

  // ---------------- front-left: craft / drawing table + camera ----------------
  buildWorktable() {
    const g = this.group;
    const wt = new THREE.Group();
    const wx = -4.2;
    const wz = HZ - 1.6;
    wt.position.set(wx, 0, wz);
    g.add(wt);
    rbox(2.0, 0.05, 1.0, 0.01, M.oak, wt, 0, 0.9, 0);
    for (const [x, z] of [[-0.92, -0.42], [0.92, -0.42], [-0.92, 0.42], [0.92, 0.42]]) box(0.05, 0.88, 0.05, M.black, wt, x, 0.44, z);
    rbox(0.9, 0.004, 0.6, 0.004, std('#2f6d4f', 0.9), wt, -0.35, 0.927, 0.05, { cast: false });
    // tablet + pen
    rbox(0.34, 0.01, 0.24, 0.01, M.bezel, wt, 0.5, 0.93, 0.05);
    this.tabletScreen = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    const ts = mesh(new THREE.PlaneGeometry(0.31, 0.21), this.tabletScreen, wt, 0.5, 0.936, 0.05, { cast: false });
    ts.rotation.x = -Math.PI / 2;
    const pen = cyl(0.005, 0.005, 0.16, std('#e9e6df', 0.4), wt, 0.5, 0.94, 0.22);
    pen.rotation.z = Math.PI / 2;
    // sketchbooks
    const r = TX.rng(77);
    for (let i = 0; i < 4; i++) {
      const b = rbox(0.24, 0.02, 0.32, 0.004, std(['#1b1c20', '#c8553d', '#e9e6df', '#4f6d7a'][i], 0.8), wt, -0.7 + r() * 0.1, 0.94 + i * 0.021, -0.25 + r() * 0.05);
      b.rotation.y = (r() - 0.5) * 0.4;
    }
    // pencils cup
    cyl(0.04, 0.04, 0.1, M.darkMetal, wt, 0.85, 0.975, -0.3);
    for (let i = 0; i < 6; i++) {
      const p = cyl(0.004, 0.004, 0.18, std(['#ffb46b', '#c8553d', '#4f6d7a'][i % 3], 0.5), wt, 0.85 + (r() - 0.5) * 0.04, 1.04, -0.3 + (r() - 0.5) * 0.04);
      p.rotation.set((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
    }
    this.chair(wt, 0, -0.8, 0.1);
    this.collider(wx, wz, 2.05, 1.05);
    this.collider(wx, wz - 0.8, 0.6, 0.6);

    // pinboard on the front wall
    const pb = new THREE.Group();
    pb.position.set(wx, 2.0, HZ - 0.03);
    pb.rotation.y = Math.PI;
    g.add(pb);
    box(2.2, 1.2, 0.03, std('#b99b73', 1), pb, 0, 0, 0);
    const cols = [['#1b1b2f', '#ff6b3d', '#ffd166'], ['#0b3954', '#2ec4b6', '#e8f1f2'], ['#12002f', '#7b61ff', '#f5f3ff'], ['#10002b', '#f72585', '#4cc9f0'], ['#386641', '#a7c957', '#f2e8cf'], ['#2d1e2f', '#c8553d', '#f28f3b']];
    for (let i = 0; i < 9; i++) {
      const c = cols[i % cols.length];
      const w = 0.3 + r() * 0.18;
      const h = 0.22 + r() * 0.2;
      const px = -0.85 + (i % 5) * 0.42 + (r() - 0.5) * 0.08;
      const py = (i < 5 ? 0.24 : -0.26) + (r() - 0.5) * 0.08;
      const pm = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: TX.posterArt(300 + i, c, ''), roughness: 0.9 }), pb, px, py, 0.02, { cast: false });
      pm.rotation.z = (r() - 0.5) * 0.12;
      mesh(new THREE.SphereGeometry(0.012, 8, 8), std('#c8553d', 0.4), pb, px, py + h / 2 - 0.03, 0.028, { cast: false });
    }

    // camera on tripod, pointed into the room
    const tp = new THREE.Group();
    tp.position.set(-1.6, 0, HZ - 1.3);
    tp.rotation.y = Math.PI + 0.5;
    g.add(tp);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = cyl(0.01, 0.012, 1.45, M.black, tp, Math.cos(a) * 0.2, 0.7, Math.sin(a) * 0.2);
      leg.rotation.set(Math.sin(a) * 0.27, 0, -Math.cos(a) * 0.27);
    }
    rbox(0.14, 0.09, 0.08, 0.01, M.black, tp, 0, 1.46, 0);
    cyl(0.035, 0.035, 0.08, M.bezel, tp, 0, 1.46, 0.08).rotation.x = Math.PI / 2;
    this.camRec = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
    mesh(new THREE.SphereGeometry(0.006, 8, 8), this.camRec, tp, 0.05, 1.5, 0.04, { cast: false });
    this.collider(-1.6, HZ - 1.3, 0.5, 0.5);

    // sculpture plinth left of the rug
    const px = 1.3;
    const pz = 2.2;
    rbox(0.5, 1.0, 0.5, 0.01, M.white, g, px, 0.5, pz);
    this.sculpture = mesh(new THREE.TorusKnotGeometry(0.16, 0.05, 140, 16, 2, 3), std('#ffb46b', 0.2, 0.9), g, px, 1.3, pz);
    this.collider(px, pz, 0.55, 0.55);
  }

  // ---------------- studio lights (softboxes on stands) ----------------
  buildStudioLights() {
    const g = this.group;
    this.studio = [];
    const spots = [
      [-6.1, -5.1],
      [6.3, -4.4],
      [-6.2, 5.2],
      [6.0, 4.9],
    ];
    const aim = new THREE.Vector3(0, 0.9, 0);
    spots.forEach(([x, z], i) => {
      const st = new THREE.Group();
      st.position.set(x, 0, z);
      g.add(st);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        const leg = cyl(0.008, 0.01, 0.62, M.black, st, Math.cos(a) * 0.2, 0.28, Math.sin(a) * 0.2);
        leg.rotation.set(Math.sin(a) * 0.72, 0, -Math.cos(a) * 0.72);
      }
      cyl(0.014, 0.014, 2.2, M.black, st, 0, 1.4, 0);
      const head = new THREE.Group();
      head.position.set(0, 2.5, 0);
      st.add(head);
      const dir = aim.clone().sub(new THREE.Vector3(x, 2.5, z));
      head.lookAt(head.getWorldPosition(new THREE.Vector3()).add(dir));
      // softbox pyramid: open cone with 4 sides
      const box4 = new THREE.CylinderGeometry(0.42, 0.1, 0.34, 4, 1, true);
      box4.rotateX(Math.PI / 2);
      box4.rotateZ(Math.PI / 4);
      const shell = mesh(box4, std('#1a1a1d', 0.8, 0, { side: THREE.DoubleSide }), head, 0, 0, 0.12);
      shell.castShadow = false;
      const faceMat = new THREE.MeshBasicMaterial({ color: '#111', toneMapped: false });
      const face = mesh(new THREE.PlaneGeometry(0.58, 0.58), faceMat, head, 0, 0, 0.29, { cast: false });
      face.rotation.z = 0;

      const light = new THREE.SpotLight(WARM, 0, 16, 0.75, 0.75, 1.3);
      light.position.set(x, 2.5, z);
      light.target.position.copy(aim);
      if (i === 0 && this.quality === 'high') {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = 0.03;
      }
      this.scene.add(light, light.target);
      this.studio.push({ light, faceMat, level: 0 });
      this.collider(x, z, 0.46, 0.46);
    });
  }

  // ---------------- LED strip in the ceiling cove (instanced so it can sweep on) ----------------
  buildLedStrip() {
    const seg = 0.35;
    const y = ROOM.h - 0.22;
    const pts = [];
    // walk the perimeter clockwise starting at the switch corner
    const inset = 0.22;
    const path = [
      [-HX + inset, -HZ + inset],
      [HX - inset, -HZ + inset],
      [HX - inset, HZ - inset],
      [-HX + inset, HZ - inset],
      [-HX + inset, -HZ + inset],
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.round(len / seg);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        pts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, Math.abs(x1 - x0) > 0.01]);
      }
    }
    const geo = new THREE.BoxGeometry(seg * 0.98, 0.012, 0.02);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.led = new THREE.InstancedMesh(geo, mat, pts.length);
    const d = new THREE.Object3D();
    const off = new THREE.Color(0x000000);
    pts.forEach(([x, z, alongX], i) => {
      d.position.set(x, y, z);
      d.rotation.y = alongX ? 0 : Math.PI / 2;
      d.updateMatrix();
      this.led.setMatrixAt(i, d.matrix);
      this.led.setColorAt(i, off);
    });
    this.ledCount = pts.length;
    this.ledColor = new THREE.Color('#ffb870').multiplyScalar(2.2);
    this.group.add(this.led);
  }

  // ---------------- hanging 3D cards from the ceiling ----------------
  buildHangingCards() {
    const g = this.group;
    const r = TX.rng(55);
    const spots = [
      [-0.6, 0.6, 2.9],
      [0.5, -0.2, 3.1],
      [-1.5, -0.3, 3.2],
      [1.6, 1.4, 3.0],
      [-2.6, 1.8, 3.15],
      [2.6, -1.8, 3.2],
      [-0.3, 2.4, 3.25],
      [0.9, -2.6, 3.05],
      [-2.2, -2.4, 3.0],
    ];
    this.cardMats = [];
    spots.forEach(([x, z, y], i) => {
      const p = projects[i % projects.length];
      const holder = new THREE.Group();
      holder.position.set(x, ROOM.h, z);
      g.add(holder);
      const len = ROOM.h - y;
      mesh(new THREE.CylinderGeometry(0.002, 0.002, len, 4), M.darkMetal, holder, 0, -len / 2, 0, { cast: false });
      const card = new THREE.Group();
      card.position.y = -len - 0.23;
      holder.add(card);
      const tex = new THREE.CanvasTexture(TX.projectCover(p, i));
      tex.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0 });
      this.cardMats.push(face);
      const body = rbox(0.34, 0.44, 0.012, 0.012, std('#f4f1ea', 0.4), card, 0, 0, 0);
      body.castShadow = true;
      const front = mesh(new THREE.PlaneGeometry(0.31, 0.41), face, card, 0, 0, 0.0065, { cast: false });
      const back = mesh(new THREE.PlaneGeometry(0.31, 0.41), face, card, 0, 0, -0.0065, { cast: false });
      back.rotation.y = Math.PI;
      front.renderOrder = 1;
      card.rotation.y = r() * Math.PI * 2;
      this.sway.push({ holder, card, phase: r() * 10, speed: 0.25 + r() * 0.25 });
    });
  }

  // ---------------- neon sign on the front wall ----------------
  buildNeon() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d');
    g.font = 'italic 700 150px "Space Grotesk", Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff5fa2';
    g.shadowBlur = 30;
    g.fillStyle = '#ffd1e6';
    g.fillText('make things', 512, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.neonMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
    this.neonMat.color.setScalar(0);
    const m = mesh(new THREE.PlaneGeometry(2.6, 0.65), this.neonMat, this.group, 0.4, 2.7, HZ - 0.03, { cast: false });
    m.rotation.y = Math.PI;
  }

  // ---------------- power ----------------
  flipSwitch() {
    this.switchRocker.rotation.x = -0.16;
  }

  powerOn() {
    if (this.powered) return;
    this.powered = true;
    this.powerT = 0;
    this.flipSwitch();
    this.emit('switch');
    // one-shot cues for the sound layer, keyed to the same timeline as the visuals
    this.cues = [
      ...this.studio.map((_, i) => [0.35 + i * 0.32, 'studio', i]),
      [0.6, 'hum'],
      [1.4, 'boot'],
      [2.3, 'neon'],
    ];
  }

  emit(name, arg) {
    this.onEvent && this.onEvent(name, arg);
  }

  // Everything that happens after the switch, keyed off seconds since the click.
  updatePower(dt) {
    if (!this.powered) return;
    const t = (this.powerT += dt);
    const ease = (a, b) => smooth(clamp01((t - a) / (b - a)));
    while (this.cues.length && this.cues[0][0] <= t) {
      const [, name, arg] = this.cues.shift();
      this.emit(name, arg);
    }

    // LED strip sweeps around the ceiling.
    const sweep = clamp01((t - 0.05) / 1.6);
    const lit = Math.floor(sweep * this.ledCount);
    if (lit !== this._ledLit) {
      const c = new THREE.Color();
      for (let i = 0; i < this.ledCount; i++) {
        const k = i < lit ? 1 : i === lit ? 0.5 : 0;
        c.copy(this.ledColor).multiplyScalar(k);
        this.led.setColorAt(i, c);
      }
      this.led.instanceColor.needsUpdate = true;
      this._ledLit = lit;
    }

    // Studio lights click on one after another, each with a short flicker.
    this.studio.forEach((s, i) => {
      const start = 0.35 + i * 0.32;
      let v = ease(start, start + 0.25);
      if (t > start && t < start + 0.45) v *= flicker(t * 40 + i * 7);
      s.light.intensity = v * 26;
      s.faceMat.color.copy(WARM).multiplyScalar(0.15 + v * 1.6);
    });

    const amb = ease(0.3, 2.4);
    this.hemi.intensity = amb * 0.55;
    this.scene.environmentIntensity = amb * 0.32;
    this.sun.intensity = ease(0.8, 3.0) * 1.6;
    this.sceneryMat.color.setScalar(0.04 + ease(0.4, 2.6) * 0.96);

    const gal = ease(1.2, 1.9) * flickerOnce(t, 1.2);
    this.galleryLight.intensity = gal * 11;
    this.frames.forEach((f, i) => {
      const v = ease(1.2 + i * 0.08, 1.5 + i * 0.08);
      f.barMat.color.set('#ffe0b8').multiplyScalar(v * 1.05);
    });
    this.galleryLabel.opacity = 0.55 * ease(1.8, 2.6);

    // Desk: lamp, monitors boot, RGB fans spin up, keyboard glow, phone notification.
    const lampV = ease(0.9, 1.0) * flickerOnce(t, 0.9);
    this.lampLight.intensity = lampV * 1.6;
    this.lampBulb.color.set('#ffcf99').multiplyScalar(lampV * 3);
    if (t > 1.4 && !this._screensOn) {
      this._screensOn = true;
      this.screens.forEach((s) => s.powerOn());
    }
    this.screenGlow.intensity = ease(1.6, 3.2) * 1.4;
    const rgb = ease(1.5, 2.2);
    this.rgbMat.color.setHSL((t * 0.08) % 1, 0.9, 0.55).multiplyScalar(rgb * 2);
    this.kbGlow.color.setHSL((t * 0.08 + 0.3) % 1, 0.9, 0.55).multiplyScalar(rgb * 1.6);
    this.spinSpeed = rgb;
    const hue = (t * 0.05) % 1;
    this.biasMat.color.setHSL(hue, 0.85, 0.55).multiplyScalar(rgb * 2.2);
    this.biasLight.color.setHSL(hue, 0.85, 0.55);
    this.biasLight.intensity = rgb * 2.2;
    this.deckKeys.color.setHSL((hue + 0.5) % 1, 0.8, 0.55).multiplyScalar(rgb * 1.6);
    this.lava.color.setHSL(0.02 + Math.sin(t * 0.7) * 0.02, 0.95, 0.5).multiplyScalar(ease(1.9, 2.6) * 1.8);
    // string lights pop on bulb by bulb, then twinkle
    const fairyOn = clamp01((t - 1.7) / 1.1);
    const fc = new THREE.Color();
    for (let i = 0; i < this.fairyCount; i++) {
      const on = i / this.fairyCount < fairyOn ? 1 : 0;
      const tw = 0.75 + 0.25 * Math.sin(t * 2.3 + i * 1.7);
      this.fairy.setColorAt(i, fc.set('#ffc27a').multiplyScalar(on * tw * 2.4));
    }
    this.fairy.instanceColor.needsUpdate = true;
    const ph = t > 2.6 && t < 5.2 ? 1 : 0.25 * ease(2.6, 3);
    this.phoneScreen.color.set('#9fc3ff').multiplyScalar(ph * ease(2.6, 2.7));
    this.tabletScreen.color.set('#2c3e50').multiplyScalar(ease(2.2, 2.8) * 1.4);
    this.camRec.color.set('#ff2b2b').multiplyScalar(t > 2.4 ? (Math.sin(t * 4) > 0 ? 2 : 0.2) : 0);

    // Lounge + neon + cards come last.
    const lounge = ease(2.0, 2.4) * flickerOnce(t, 2.0);
    this.floorLampLight.intensity = lounge * 3.2;
    this.floorLampBulb.color.set('#ffcf99').multiplyScalar(lounge * 3);
    const neon = ease(2.3, 2.5) * (t < 3.1 ? flicker(t * 23) : 1);
    this.neonMat.color.setScalar(neon * 1.4);
    this.cardMats.forEach((m, i) => (m.emissiveIntensity = ease(2.2 + i * 0.07, 2.8 + i * 0.07) * 0.12));

    this.heroLight.intensity = HERO_KEY * (1 - ease(0.4, 2.0));
    this.heroRim.intensity = HERO_RIM * (1 - ease(0.4, 1.6));
    if (this.scene.fog) {
      const f = ease(0.2, 2.6);
      this.scene.fog.near = 2.6 + f * 60;
      this.scene.fog.far = 5.2 + f * 80;
      if (f >= 1) this.scene.fog = null;
    }
    this.switchLed.color.set('#6dff9a');
  }

  update(dt, time) {
    this.updatePower(dt);
    for (const s of this.screens) s.update(dt);
    const sp = this.spinSpeed || 0;
    for (const s of this.spin) s.obj.rotation[s.axis] += dt * s.speed * sp;
    for (const c of this.sway) {
      const t = time * c.speed + c.phase;
      c.holder.rotation.z = Math.sin(t) * 0.025;
      c.holder.rotation.x = Math.cos(t * 0.8) * 0.02;
      c.card.rotation.y += dt * 0.18;
    }
    if (this.sculpture) this.sculpture.rotation.y += dt * 0.3;
    if (this.clockHands) {
      const d = new Date();
      const m = d.getMinutes() + d.getSeconds() / 60;
      this.clockHands[0].rotation.z = -(((d.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
      this.clockHands[1].rotation.z = -(m / 60) * Math.PI * 2;
    }
  }

  // Before power: the room is black except the character's top light and the switch LED.
  setDark() {
    this.hemi.intensity = 0;
    this.scene.environmentIntensity = 0.0;
    this.heroLight.intensity = HERO_KEY;
    this.heroRim.intensity = HERO_RIM;
    // Black fog swallows everything a few metres past the character until the lights come on.
    this.scene.fog = new THREE.Fog('#050507', 2.6, 5.2);
  }
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const flicker = (x) => 0.35 + 0.65 * (Math.sin(x) * Math.sin(x * 2.3 + 1.1) > -0.2 ? 1 : 0);
const flickerOnce = (t, start) => (t > start && t < start + 0.12 ? 0.2 : 1);
