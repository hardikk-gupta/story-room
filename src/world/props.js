import * as THREE from 'three';
import { std, mesh, box, rbox, cyl, M, ROOM } from './kit.js';

// Interactive props for the Night Shift stations. Each builder returns handles the stations
// animate; anything that moves is flagged dynamic so Room.optimize() leaves it alone.
const HX = ROOM.w / 2;
const HZ = ROOM.d / 2;
const dyn = (o) => ((o.userData.dynamic = true), o);

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d'), t };
}

// ---------------- treadmill: faces the window so you run toward the sunrise ----------------
export function buildTreadmill(room) {
  const g = new THREE.Group();
  g.position.set(5.25, 0, 2.9);
  g.rotation.y = Math.PI / 2; // local +Z → world +X
  room.group.add(g);
  const L = 1.8;
  const W = 0.78;
  rbox(W, 0.14, L, 0.03, std('#1b1c20', 0.5, 0.3), g, 0, 0.07, 0);
  // belt with a scrolling stripe texture
  const { c, g: bg, t } = canvasTex(64, 256);
  bg.fillStyle = '#26272c';
  bg.fillRect(0, 0, 64, 256);
  bg.fillStyle = '#34363c';
  for (let y = 0; y < 256; y += 16) bg.fillRect(0, y, 64, 3);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 5);
  const belt = mesh(new THREE.PlaneGeometry(W - 0.12, L - 0.1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), g, 0, 0.142, 0, { cast: false });
  belt.rotation.x = -Math.PI / 2;
  // side rails, uprights, handlebars
  for (const s of [-1, 1]) {
    box(0.06, 0.05, L, std('#ff7a45', 0.5, 0.2), g, s * (W / 2 - 0.02), 0.15, 0);
    const up = cyl(0.03, 0.03, 1.15, M.darkMetal, g, s * (W / 2 - 0.05), 0.72, L / 2 - 0.12);
    up.rotation.x = -0.12;
    const bar = cyl(0.022, 0.022, 0.55, std('#1b1c20', 0.6), g, s * (W / 2 - 0.02), 1.02, L / 2 - 0.42);
    bar.rotation.x = Math.PI / 2;
  }
  // console with a live display
  const con = new THREE.Group();
  con.position.set(0, 1.3, L / 2 - 0.2);
  con.rotation.x = -0.55;
  g.add(con);
  rbox(W - 0.06, 0.3, 0.06, 0.02, std('#1b1c20', 0.4, 0.3), con, 0, 0, 0);
  const disp = canvasTex(256, 96);
  const dispMat = new THREE.MeshBasicMaterial({ map: disp.t, toneMapped: false });
  mesh(new THREE.PlaneGeometry(0.44, 0.165), dispMat, con, 0, 0.02, 0.031, { cast: false });
  const draw = (dist, speed, goal) => {
    const x = disp.g;
    x.fillStyle = '#07120c';
    x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#6dff9a';
    x.font = '700 40px ui-monospace, Menlo, monospace';
    x.fillText(`${Math.floor(dist)}m`, 12, 46);
    x.font = '600 18px ui-monospace, Menlo, monospace';
    x.fillText(`${(speed * 3.6).toFixed(1)} km/h`, 150, 40);
    x.fillStyle = 'rgba(109,255,154,0.25)';
    x.fillRect(12, 66, 232, 12);
    x.fillStyle = '#6dff9a';
    x.fillRect(12, 66, 232 * Math.min(1, dist / goal), 12);
    disp.t.needsUpdate = true;
  };
  draw(0, 0, 100);
  room.collider(5.25, 2.9, L + 0.05, W + 0.05);
  const collider = room.colliders[room.colliders.length - 1];
  return { group: g, beltTex: t, draw, collider, deckY: 0.145 };
}

// ---------------- dumbbell rack ----------------
export function buildDumbbells(room) {
  const g = new THREE.Group();
  g.position.set(3.7, 0, 1.7);
  room.group.add(g);
  for (const s of [-1, 1]) {
    const leg = box(0.05, 0.75, 0.05, M.darkMetal, g, s * 0.38, 0.37, 0.1);
    leg.rotation.x = 0.25;
    const leg2 = box(0.05, 0.75, 0.05, M.darkMetal, g, s * 0.38, 0.37, -0.1);
    leg2.rotation.x = -0.25;
  }
  const bells = [];
  const make = (x, y, r, col) => {
    const d = new THREE.Group();
    d.position.set(x, y, 0);
    g.add(d);
    cyl(0.016, 0.016, 0.22, M.metal, d, 0, 0, 0).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) cyl(r, r, 0.06, std(col, 0.6), d, s * 0.09, 0, 0, 6).rotation.z = Math.PI / 2;
    return d;
  };
  box(0.8, 0.03, 0.22, M.darkMetal, g, 0, 0.72, 0);
  box(0.8, 0.03, 0.22, M.darkMetal, g, 0, 0.42, 0);
  bells.push(make(-0.2, 0.79, 0.05, '#c8553d'), make(0.2, 0.79, 0.05, '#c8553d'));
  make(-0.2, 0.5, 0.06, '#2d3142');
  make(0.2, 0.5, 0.06, '#2d3142');
  // the pair that gets picked up is dynamic
  bells.forEach(dyn);
  room.collider(3.7, 1.7, 0.85, 0.45);
  return { group: g, bells };
}

// ---------------- karaoke stage under the neon sign ----------------
export function buildStage(room) {
  const g = new THREE.Group();
  const cx = 0.4;
  const cz = 4.7;
  g.position.set(cx, 0, cz);
  room.group.add(g);
  cyl(1.0, 1.02, 0.08, std('#1b1c20', 0.4, 0.2), g, 0, 0.04, 0, 48);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
  const ring = mesh(new THREE.TorusGeometry(1.0, 0.012, 6, 64), ringMat, g, 0, 0.08, 0, { cast: false });
  ring.rotation.x = Math.PI / 2;
  // mic stand + boom + mic
  cyl(0.12, 0.14, 0.02, M.black, g, 0, 0.09, -0.32, 20);
  cyl(0.012, 0.012, 1.3, M.black, g, 0, 0.74, -0.32);
  const boom = cyl(0.009, 0.009, 0.24, M.black, g, 0, 1.44, -0.23);
  boom.rotation.x = 1.0;
  const mic = new THREE.Group();
  mic.position.set(0, 1.52, -0.12);
  mic.rotation.x = 1.0;
  g.add(mic);
  cyl(0.016, 0.012, 0.16, std('#1b1c20', 0.35, 0.5), mic, 0, -0.06, 0);
  mesh(new THREE.SphereGeometry(0.03, 16, 12), std('#9aa0a8', 0.35, 0.9), mic, 0, 0.035, 0);
  // PA speakers
  const cones = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.Group();
    sp.position.set(s * 0.8, 0.08, -0.15);
    sp.rotation.y = Math.PI + s * 0.35;
    g.add(sp);
    rbox(0.36, 0.62, 0.3, 0.02, std('#15161a', 0.6), sp, 0, 0.31, 0);
    const cone = mesh(new THREE.CircleGeometry(0.11, 24), std('#2b2d33', 0.5, 0.3), sp, 0, 0.24, 0.152, { cast: false });
    const tw = mesh(new THREE.CircleGeometry(0.04, 16), std('#2b2d33', 0.5, 0.3), sp, 0, 0.47, 0.152, { cast: false });
    cones.push(dyn(cone), dyn(tw));
  }
  // ring light on a tripod, pointed at the singer
  const rl = new THREE.Group();
  rl.position.set(cx - 0.9, 0, cz - 1.3);
  rl.lookAt(cx, 0, cz);
  room.group.add(rl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.008, 0.01, 0.9, M.black, rl, Math.cos(a) * 0.14, 0.42, Math.sin(a) * 0.14);
    leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
  }
  cyl(0.012, 0.012, 1.0, M.black, rl, 0, 1.2, 0);
  const ringLightMat = new THREE.MeshBasicMaterial({ color: '#111', toneMapped: false });
  mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 40), ringLightMat, rl, 0, 1.72, 0.02, { cast: false });
  const singerLight = new THREE.PointLight('#ffe8d0', 0, 3.5, 1.5);
  singerLight.position.set(cx - 0.5, 1.8, cz - 0.9);
  if (room.quality === 'high') room.scene.add(singerLight);
  room.collider(cx - 0.9, cz - 1.3, 0.35, 0.35);
  for (const s of [-1, 1]) room.collider(cx + s * 0.8, cz - 0.15, 0.4, 0.36);
  return { group: g, ringMat, ringLightMat, singerLight, cones, center: new THREE.Vector3(cx, 0.08, cz), mic, micTip: new THREE.Vector3(cx, 1.55, cz - 0.1), radius: 1.0 };
}

// ---------------- disco ball ----------------
export function buildDisco(room) {
  const holder = new THREE.Group();
  holder.position.set(-0.4, ROOM.h, 0.4);
  room.group.add(holder);
  const wire = mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 4), M.darkMetal, holder, 0, -0.5, 0, { cast: false });
  const ball = mesh(
    new THREE.IcosahedronGeometry(0.24, 3),
    new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 1, roughness: 0.12, flatShading: true }),
    holder,
    0,
    -0.2,
    0,
  );
  dyn(holder);
  // one colour-cycling spot (every extra light costs shader time on every surface)
  const l = new THREE.SpotLight('#ff4fa3', 0, 9, 0.3, 0.5, 1.2);
  l.position.set(-0.4, ROOM.h - 0.9, 0.4);
  room.scene.add(l.target);
  if (room.quality === 'high') room.scene.add(l);
  const lights = [l];
  return { holder, wire, ball, lights, drop: 0 };
}

// ---------------- espresso bar in the back-left corner ----------------
export function buildCoffeeBar(room) {
  const g = new THREE.Group();
  const cx = -5.75;
  const cz = -HZ + 0.3;
  g.position.set(cx, 0, cz);
  room.group.add(g);
  rbox(2.0, 0.9, 0.56, 0.01, std('#2d3142', 0.6), g, 0, 0.45, 0);
  rbox(2.06, 0.04, 0.6, 0.01, M.oak, g, 0, 0.92, 0);
  for (let i = 0; i < 3; i++) box(0.01, 0.8, 0.5, std('#3a3f4b', 0.6), g, -0.66 + i * 0.66, 0.45, 0.281);
  // espresso machine
  const em = new THREE.Group();
  em.position.set(0.15, 0.94, -0.04);
  g.add(em);
  rbox(0.5, 0.42, 0.36, 0.03, std('#c9ccd2', 0.25, 0.9), em, 0, 0.21, 0);
  rbox(0.46, 0.06, 0.3, 0.01, std('#ff7a45', 0.5), em, 0, 0.45, 0);
  const head = cyl(0.045, 0.05, 0.05, M.metal, em, 0, 0.2, 0.2);
  head.rotation.x = 0;
  const handle = new THREE.Group();
  handle.position.set(0, 0.17, 0.22);
  em.add(handle);
  cyl(0.05, 0.045, 0.04, M.metal, handle, 0, 0, 0);
  box(0.03, 0.025, 0.18, std('#1b1c20', 0.5), handle, 0, 0, 0.1);
  box(0.36, 0.015, 0.2, M.darkMetal, em, 0, 0.005, 0.24); // drip tray
  // gauge that lights up
  const gaugeMat = new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false });
  mesh(new THREE.CircleGeometry(0.04, 20), gaugeMat, em, 0.15, 0.33, 0.181, { cast: false });
  // cup + coffee inside
  const cup = new THREE.Group();
  cup.position.set(0, 0.035, 0.24);
  em.add(cup);
  const cupMat = std('#f4f1ea', 0.35);
  const cupMesh = mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.07, 20, 1, true), cupMat, cup, 0, 0.035, 0);
  cupMesh.material = std('#f4f1ea', 0.35, 0, { side: THREE.DoubleSide });
  cyl(0.03, 0.03, 0.004, cupMat, cup, 0, 0.002, 0);
  const coffee = cyl(0.033, 0.03, 0.06, std('#3b2416', 0.3), cup, 0, 0.004, 0);
  coffee.geometry.translate(0, 0.03, 0);
  coffee.position.y = 0.004;
  coffee.scale.y = 0.001;
  dyn(cup);
  // grinder + beans + mugs
  const gr = new THREE.Group();
  gr.position.set(-0.55, 0.94, -0.05);
  g.add(gr);
  rbox(0.16, 0.28, 0.2, 0.02, std('#1b1c20', 0.4, 0.3), gr, 0, 0.14, 0);
  cyl(0.07, 0.04, 0.16, M.glass, gr, 0, 0.36, 0);
  cyl(0.06, 0.06, 0.08, std('#3b2416', 0.8), gr, 0, 0.34, 0);
  for (let i = 0; i < 3; i++) {
    cyl(0.04, 0.036, 0.09, std(['#c8553d', '#2ec4b6', '#ffd166'][i], 0.5), g, 0.62 + i * 0.1, 0.985, 0.1);
  }
  cyl(0.06, 0.06, 0.16, M.glass, g, -0.85, 1.02, 0);
  cyl(0.055, 0.055, 0.12, std('#3b2416', 0.8), g, -0.85, 1.0, 0);
  // neon BREW sign
  const { c, g: sg, t } = canvasTex(512, 160);
  sg.font = 'italic 700 110px "Space Grotesk", Inter, sans-serif';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.shadowColor = '#4fd1ff';
  sg.shadowBlur = 24;
  sg.fillStyle = '#c9f3ff';
  sg.fillText('brew', 256, 80);
  const signMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false });
  signMat.color.setScalar(0);
  mesh(new THREE.PlaneGeometry(0.9, 0.28), signMat, room.group, cx, 1.95, -HZ + 0.03, { cast: false });
  // steam sprites
  const steamTex = (() => {
    const s = canvasTex(64, 64);
    const grd = s.g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    s.g.fillStyle = grd;
    s.g.fillRect(0, 0, 64, 64);
    s.t.needsUpdate = true;
    return s.t;
  })();
  const steam = [];
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.setScalar(0.08);
    room.group.add(sp);
    steam.push({ sp, t: i / 10 });
  }
  room.collider(cx, cz, 2.06, 0.6);
  const cupWorld = new THREE.Vector3(cx + 0.15, 0.975, cz + 0.2);
  return { group: g, coffee, gaugeMat, signMat, steam, cupWorld, lever: new THREE.Vector3(cx + 0.15, 1.12, cz + 0.28) };
}

// ---------------- watering can next to the monstera ----------------
export function buildWateringCan(room) {
  const g = new THREE.Group();
  g.position.set(HX - 1.15, 0, -3.7);
  room.group.add(g);
  cyl(0.08, 0.09, 0.2, std('#2ec4b6', 0.5, 0.2), g, 0, 0.1, 0);
  const spout = cyl(0.01, 0.018, 0.22, std('#2ec4b6', 0.5, 0.2), g, 0.12, 0.17, 0);
  spout.rotation.z = -0.9;
  const h = mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 16, Math.PI), std('#2ec4b6', 0.5, 0.2), g, -0.02, 0.2, 0);
  h.rotation.y = Math.PI / 2;
  // water droplets (dynamic, hidden until used)
  const drops = [];
  const dropMat = new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.8 });
  for (let i = 0; i < 14; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), dropMat);
    d.visible = false;
    room.group.add(d);
    drops.push({ m: d, t: i / 14 });
  }
  return { group: g, drops };
}

// A spark: a little comet that flies from a station to the desk monitor when a quest completes.
export class SparkFx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,200,120,0.9)');
    grd.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
  }

  launch(from, to, onArrive) {
    const trail = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(0.35 - i * 0.03);
      this.scene.add(s);
      trail.push(s);
    }
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 2.0;
    this.items.push({ curve: new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone()), t: 0, trail, onArrive });
  }

  update(dt) {
    for (const it of this.items) {
      it.t += dt / 1.6;
      it.trail.forEach((s, i) => {
        const k = Math.max(0, Math.min(1, it.t - i * 0.025));
        const e = 1 - Math.pow(1 - k, 2);
        s.position.copy(it.curve.getPoint(e));
        s.material.opacity = it.t < 1 ? 1 - i / 8 : Math.max(0, 1 - (it.t - 1) * 4);
      });
      if (it.t >= 1 && !it.arrived) {
        it.arrived = true;
        it.onArrive && it.onArrive();
      }
    }
    this.items = this.items.filter((it) => {
      if (it.t < 1.3) return true;
      it.trail.forEach((s) => s.removeFromParent());
      return false;
    });
  }
}
