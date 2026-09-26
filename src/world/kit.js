import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

// Room extents (meters). x: left(-) → right(+), z: back wall(-) → front wall(+).
export const ROOM = { w: 14, d: 12, h: 4.2 };

// ---------- small builders ----------
// Plain materials are cached by colour/finish so identical props can be merged into one draw call.
const stdCache = new Map();
export const std = (color, rough = 0.7, metal = 0, extra = null) => {
  if (extra) return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const key = `${color}|${rough}|${metal}`;
  if (!stdCache.has(key)) stdCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return stdCache.get(key);
};

export function mesh(geo, mat, parent, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}
export const box = (w, h, d, mat, parent, x, y, z, opts) => mesh(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z, opts);
export const rbox = (w, h, d, r, mat, parent, x, y, z, opts) =>
  mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat, parent, x, y, z, opts);
export const cyl = (rt, rb, h, mat, parent, x, y, z, seg = 20, opts) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, parent, x, y, z, opts);

// Materials shared across the room.
export const M = {};
export function initMaterials() {
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

