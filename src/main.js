import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { profile } from './content.js';
import { Room } from './world/room.js';
import { Avatar } from './character/avatar.js';
import { Player, FollowCamera } from './game/player.js';
import { Input } from './game/input.js';
import { Intro } from './game/intro.js';
import { Interactor } from './game/interact.js';

const $ = (id) => document.getElementById(id);
history.scrollRestoration = 'manual';
scrollTo(0, 0);

// ---------- quality tier ----------
const isTouch = matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);
const quality = params.get('q') || (isTouch || navigator.hardwareConcurrency <= 4 ? 'low' : 'high');

// ---------- renderer ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1.3));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050507');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.03;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 60);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.35, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  // widen the view on narrow portrait screens so the character still fits
  camera.fov = w / h < 0.8 ? 62 : 50;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w / 2, h / 2);
}
addEventListener('resize', resize);
resize();

// ---------- intro copy ----------
const intro = $('intro');
intro.querySelector('.eyebrow').textContent = profile.eyebrow;
intro.querySelector('h1').textContent = profile.name;
intro.querySelector('.role').textContent = profile.role;
intro.querySelector('.lede').textContent = profile.lede;
intro.querySelector('.welcome').textContent = profile.welcome;
document.title = `${profile.name} — Studio`;

// ---------- loading ----------
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => setProgress(loaded / total);
let shown = 0;
function setProgress(p) {
  shown = Math.max(shown, p);
  $('loader-fill').style.width = `${(shown * 100).toFixed(0)}%`;
  $('loader-pct').textContent = (shown * 100).toFixed(0);
}
const loader = new GLTFLoader(manager);

const room = new Room(scene, { quality });
room.setDark();

const fbx = new FBXLoader(manager);
const CLIPS = {
  walk: 'walk.fbx',
  run: 'run.fbx',
  walkBack: 'walk-back.fbx',
  turn: 'turn-180.fbx',
  push: 'button-push.fbx',
  hold: 'holding-idle.fbx',
};
const [avatarGltf, idleGltf, ...fbxClips] = await Promise.all([
  loader.loadAsync('/models/avatar.glb'),
  loader.loadAsync('/anims/Soldier.glb'),
  ...Object.values(CLIPS).map((f) => fbx.loadAsync(`/anims/${f}`).catch(() => null)),
]);
setProgress(1);

const byName = (g, n) => g.animations.find((a) => a.name.toLowerCase() === n);
const sources = { idle: { root: idleGltf.scene, clip: byName(idleGltf, 'idle'), rest: byName(idleGltf, 'tpose') } };
Object.keys(CLIPS).forEach((k, i) => {
  const obj = fbxClips[i];
  if (obj && obj.animations[0]) sources[k] = { root: obj, clip: obj.animations[0] };
});
const avatar = new Avatar(avatarGltf, sources);
scene.add(avatar.root);

const input = new Input(canvas);
const player = new Player(avatar, room.colliders);
const follow = new FollowCamera(camera);
const interactor = new Interactor({ avatar, player, followCam: follow, camera, room, input });

let mode = 'intro';
const introCtl = new Intro({
  avatar,
  player,
  room,
  camera,
  onDone: startGame,
});

// compile shaders up front so the first lights-on frame doesn't hitch
renderer.compile(scene, camera);

// reveal: loader fades, copy staggers in
$('loader').classList.add('done');
document.body.classList.remove('is-loading');
document.querySelectorAll('#intro [data-reveal]').forEach((el, i) => {
  setTimeout(() => el.classList.add('in'), 500 + i * 160);
});

// skipping the intro: arrows / space / tap
input.on('anyKey', (code) => {
  if (mode === 'intro' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(code)) {
    introCtl.skip();
  }
});
let touchStartY = null;
addEventListener('touchstart', (e) => (touchStartY = e.touches[0].clientY), { passive: true });
addEventListener('touchend', (e) => {
  if (mode !== 'intro' || touchStartY === null) return;
  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
  if (dy < 8) introCtl.skip();
});

input.on('action', () => mode === 'play' && interactor.action());

// ---------- game start ----------
const hud = $('hud');
const touchUi = $('touch-ui');
const rotate = $('rotate');
const lockHint = $('lock-hint');

function startGame() {
  mode = 'handover';
  handover.t = 0;
  handover.from = { pos: camera.position.clone(), q: camera.quaternion.clone() };
  // turn around and take a couple of steps into the now-lit studio; the follow camera
  // settles behind him looking into the room
  player.auto = { x: player.pos.x + 0.55, z: player.pos.z + 1.25, yaw: 0.3, done: null };
  follow.yaw = Math.PI + 0.3;
  follow.pitch = -0.14;
  follow.inited = false;
}
const handover = { t: 0, from: null };

function enterPlay() {
  mode = 'play';
  document.body.classList.add('is-playing');
  scrollTo(0, 0);
  input.enabled = true;
  hud.hidden = false;
  if (input.touch) touchUi.hidden = false;
  setTimeout(() => $('controls-hint').classList.add('fade'), 9000);
}

input.on('lock', (locked) => {
  lockHint.hidden = locked || input.touch;
});
lockHint.addEventListener('click', () => input.requestLock());

function checkOrientation() {
  const portrait = innerHeight > innerWidth;
  const needRotate = input.touch && mode === 'play' && portrait;
  rotate.hidden = !needRotate;
  touchUi.hidden = !(input.touch && mode === 'play') || needRotate;
  return needRotate;
}

// ---------- loop ----------
const clock = new THREE.Clock();
const MAX_DT = +(params.get('maxdt') || 1 / 20); // tests on slow software GL raise this
let elapsed = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), MAX_DT);
  elapsed += dt;

  if (mode === 'intro') {
    introCtl.update(dt);
  } else if (mode === 'handover') {
    // blend from the intro's final shot into the follow camera over 1.4s
    handover.t += dt;
    const k = Math.min(1, handover.t / 2.2);
    const e = k * k * (3 - 2 * k);
    player.update(dt, { x: 0, y: 0 }, false, follow.yaw);
    follow.update(dt, player.pos);
    const toPos = camera.position.clone();
    const toQ = camera.quaternion.clone();
    camera.position.lerpVectors(handover.from.pos, toPos, e);
    camera.quaternion.slerpQuaternions(handover.from.q, toQ, e);
    if (k >= 1) {
      player.auto = null;
      enterPlay();
    }
  } else {
    const paused = checkOrientation();
    input.poll();
    const look = input.consumeLook();
    if (!interactor.busy || interactor.state === 'approach') follow.addLook(look.x, look.y);
    const move = paused || interactor.busy ? { x: 0, y: 0 } : input.move;
    player.update(dt, move, input.run, follow.yaw);
    interactor.update(dt);
    follow.update(dt, player.pos);
    // head follows the camera a little, like the character is looking around
    if (!interactor.busy) {
      let rel = follow.yaw + Math.PI - player.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      avatar.lookYaw = Math.abs(rel) < 1.9 ? rel * 0.6 : 0;
      avatar.lookPitch = -follow.pitch * 0.5 - 0.05;
    }
  }

  avatar.update(dt);
  room.update(dt, elapsed);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for tests
window.__studio = { scene, camera, avatar, player, room, introCtl, follow, interactor, get mode() { return mode; } };
