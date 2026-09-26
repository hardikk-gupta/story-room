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
import { Sfx, Music } from './audio.js';
import { ui } from './ui.js';
import { SparkFx } from './world/props.js';
import { Story } from './game/story.js';
import { Bulb } from './game/companion.js';
import { PitchOS } from './game/pitchos.js';
import {
  Stations,
  TreadmillStation,
  RecordStation,
  KaraokeStation,
  SketchStation,
  CoffeeStation,
  DeskStation,
  DumbbellStation,
  NapStation,
  PlantStation,
  PartyStation,
  BookStation,
} from './game/stations.js';

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
const BASE = import.meta.env.BASE_URL; // './' so the build works from any host path

// Canvas textures (covers, labels, screens) need the web fonts loaded before they're painted.
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
await Promise.all(['700 64px "Space Grotesk"', '600 32px Inter'].map((f) => document.fonts.load(f).catch(() => {})));

const sfx = new Sfx();
const room = new Room(scene, { quality });
room.setDark();
room.onEvent = (name, arg) => sfx.event(name, arg);
const music = new Music(sfx);
room.music = music;
try {
  const doodle = localStorage.getItem('studio-doodle');
  if (doodle) room.pinDoodle(doodle);
} catch {
  /* storage blocked */
}

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
  loader.loadAsync(`${BASE}models/avatar.glb`),
  loader.loadAsync(`${BASE}anims/idle.glb`),
  ...Object.values(CLIPS).map((f) => fbx.loadAsync(`${BASE}anims/${f}`).catch(() => null)),
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
interactor.sfx = sfx;
player.floor = (x, z) => room.floorHeight(x, z);

// ---------- Night Shift: story, companion, stations ----------
const ctx = { scene, camera, avatar, player, follow, room, input, sfx, music, interactor };
ctx.sparkFx = new SparkFx(scene);
ctx.bulb = new Bulb(scene, sfx);
ctx.stations = new Stations(ctx);
ctx.story = new Story(ctx);
ctx.pitchos = new PitchOS(ctx);
const { stations, story, bulb, pitchos, sparkFx } = ctx;
[
  new TreadmillStation(),
  new RecordStation(room),
  new KaraokeStation(room),
  new SketchStation(),
  new CoffeeStation(room),
  new DeskStation(),
  new DumbbellStation(room),
  new NapStation(),
  new PlantStation(room),
  new PartyStation(),
  new BookStation(),
].forEach((st) => stations.add(st));
// the gallery spark: pick up three different frames
const inspected = new Set();
ctx.galleryAnchor = { id: 'gallery', title: 'Gallery · pick up 3', pos: new THREE.Vector3(-6.4, 1.4, 0), isFocus: () => !!interactor.focus };
stations.initBeacons([ctx.galleryAnchor]);
ctx.galleryCount = () => inspected.size;
interactor.onInspect = (i) => {
  inspected.add(i);
  story.render();
  if (inspected.size >= 3 && !story.has('gallery')) story.complete('gallery', room.frames[i].wallPos);
};
avatar.onStep = (k) => sfx.event('step', k);

const soundBtn = $('sound');
const paintSound = () => {
  soundBtn.setAttribute('aria-pressed', String(!sfx.muted));
  soundBtn.querySelector('span').textContent = sfx.muted ? 'Sound off' : 'Sound on';
};
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  paintSound();
});
paintSound();

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
addEventListener('touchstart', (e) => (touchStartY = e.target.closest('button') ? null : e.touches[0].clientY), { passive: true });
addEventListener('touchend', (e) => {
  if (mode !== 'intro' || touchStartY === null) return;
  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
  if (dy < 8) introCtl.skip();
});

input.on('action', () => {
  if (mode !== 'play' || pitchos.isOpen) return;
  if (stations.busy) stations.action();
  else if (interactor.busy) interactor.action();
  else if (stations.focus) stations.start(stations.focus);
  else if (interactor.focus) interactor.action();
  else if (bulb.current) bulb.skip();
});
input.on('release', () => mode === 'play' && stations.release());
input.on('cancel', () => {
  if (mode !== 'play' || pitchos.isOpen) return;
  if (interactor.state === 'inspect') interactor.putBack();
  else stations.cancel();
});
$('sh-leave').addEventListener('click', () => stations.active && stations.active.cancellable && stations.leave());
$('q-portfolio').addEventListener('click', () => {
  if (!stations.busy && !interactor.busy) pitchos.open(null);
});

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
  // Bulb pops out of the light switch and the story begins
  bulb.spawn(new THREE.Vector3(-1.9, 1.45, -5.7));
  setTimeout(() => story.start(), 700);
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
    const busy = stations.busy || interactor.busy;
    if (!interactor.busy || interactor.state === 'approach') follow.addLook(look.x, look.y);
    const owned = stations.update(dt);
    if (!owned) {
      const move = paused || busy ? { x: 0, y: 0 } : input.move;
      player.update(dt, move, input.run, follow.yaw);
    }
    interactor.update(dt);
    follow.update(dt, player.pos);
    stations.applyCamera(camera);

    // what's in front of us: a station or a frame (whichever is a better match)
    if (!busy) {
      const s = stations.best();
      const f = interactor.findFocus();
      const useStation = s.station && (!f || s.score <= interactor.bestScore);
      stations.focus = useStation ? s.station : null;
      interactor.setFocus(useStation ? null : f);
      ui.prompt(useStation ? s.station.promptText() : f ? 'Pick up' : null);
      ui.actionButton(useStation ? s.station.verb : 'Grab', !!(useStation || f));
      // head follows the camera a little, like the character is looking around
      let rel = follow.yaw + Math.PI - player.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      avatar.lookYaw = Math.abs(rel) < 1.9 ? rel * 0.6 : 0;
      avatar.lookPitch = -follow.pitch * 0.5 - 0.05;
    } else {
      stations.focus = null;
      if (stations.busy) ui.prompt(null);
      avatar.lookYaw = 0;
    }
    document.body.classList.toggle('in-station', stations.busy && stations.phase !== 'approach');
    stations.updateBeacons(camera, player, story, story.started && !pitchos.isOpen && !(stations.busy && stations.phase !== 'approach') && !interactor.busy);
    story.update(dt);
    bulb.update(dt, player, camera);
    sparkFx.update(dt);
  }

  avatar.update(dt);
  room.update(dt, elapsed);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for tests
window.__studio = { scene, camera, avatar, player, room, introCtl, follow, interactor, sfx, renderer, music, stations, story, bulb, pitchos, get mode() { return mode; } };
