import * as THREE from 'three';
import { ui } from '../ui.js';
import { karaoke as SONG, story as STORY } from '../content.js';
import { SWITCH_POS } from '../world/room.js';

// ---------------------------------------------------------------------------------------
// Stations: everything in the studio you can walk up to and *do*.
// The manager handles the choreography every station shares: pick the best one in view,
// walk there (collision-aware autopilot), glide onto the exact spot, hand control to the
// station, then glide back out. Stations only implement what makes them unique.
// ---------------------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

export class Stations {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.focus = null;
    this.active = null;
    this.phase = null; // approach → enter → active → exit
    this.camW = 0;
  }

  add(st) {
    st.ctx = this.ctx;
    st.mgr = this;
    this.list.push(st);
    return st;
  }

  // Floating labels over everything you can use, visible from across the room.
  initBeacons(extra = []) {
    this.beaconRoot = ui.$('beacons');
    this.beacons = [...this.list, ...extra].map((st) => {
      const el = document.createElement('div');
      el.className = 'beacon';
      this.beaconRoot.appendChild(el);
      return { st, el, html: '' };
    });
  }

  updateBeacons(camera, player, story, show) {
    if (!this.beacons) return;
    const w = innerWidth;
    const h = innerHeight;
    const v = new THREE.Vector3();
    for (const b of this.beacons) {
      const { st, el } = b;
      const d = Math.hypot(st.pos.x - player.pos.x, st.pos.z - player.pos.z);
      v.set(st.pos.x, Math.max(st.pos.y + 0.55, 1.5), st.pos.z).project(camera);
      const visible = show && d < 12 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const secret = story.secretIds.includes(st.id);
      const done = secret ? story.hasSecret(st.id) : story.has(st.id) || (st.id === 'ship' && story.shipped);
      const focus = this.focus === st || (st.isFocus && st.isFocus());
      const icon = done ? '✓' : secret ? '★' : '✦';
      const label = secret && !done && d > 3.2 ? '?' : st.title;
      const html = `<i>${icon}</i><span>${label}</span>${focus ? '<kbd>Space</kbd>' : ''}`;
      if (html !== b.html) {
        el.innerHTML = html;
        b.html = html;
      }
      el.classList.toggle('focus', !!focus);
      el.classList.toggle('done', !!done);
      el.classList.toggle('secret', secret);
      el.style.opacity = focus ? 1 : Math.max(0.45, Math.min(1, 1.5 - d / 10));
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
  }

  byId(id) {
    return this.list.find((s) => s.id === id);
  }

  get busy() {
    return !!this.active;
  }

  // Best station in front of the camera and within reach, with a score (lower = better).
  best() {
    const { camera, player } = this.ctx;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    let best = null;
    let bestScore = Infinity;
    for (const st of this.list) {
      if (!st.visible()) continue;
      const d = Math.hypot(st.pos.x - player.pos.x, st.pos.z - player.pos.z);
      if (d > st.reach) continue;
      const to = new THREE.Vector3(st.pos.x - camera.position.x, 0, st.pos.z - camera.position.z).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(to.dot(dir), -1, 1));
      // in front of the camera, or right next to us whatever the camera is doing
      if (ang > 0.95 && d > 1.5) continue;
      const score = Math.min(ang, 0.95) * 2 + d * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = st;
      }
    }
    return { station: best, score: bestScore };
  }

  start(st) {
    if (this.active || !st.canStart()) return;
    const { player } = this.ctx;
    this.active = st;
    this.focus = null;
    ui.prompt(null);
    const enter = () => {
      if (st.use) {
        this.phase = 'enter';
        this.t = 0;
        this.from = { pos: player.pos.clone(), yaw: player.yaw };
        player.pinned = true;
      } else {
        this.phase = 'active';
        st.begin();
      }
    };
    const a = st.approach || st.use;
    if (a) {
      this.phase = 'approach';
      // arrive facing the spot we're about to step onto
      const far = st.use && Math.hypot(st.use.x - a.x, st.use.z - a.z) > 0.05;
      const yaw = far ? Math.atan2(st.use.x - a.x, st.use.z - a.z) : st.use ? st.use.yaw : player.yaw;
      player.auto = { x: a.x, z: a.z, yaw, done: enter };
    } else enter();
  }

  leave() {
    const st = this.active;
    if (!st || this.phase !== 'active') return;
    st.end();
    st.cam = null;
    ui.hideHud();
    if (st.use) {
      this.phase = 'exit';
      this.t = 0;
      this.from = { pos: this.ctx.player.pos.clone(), yaw: this.ctx.player.yaw };
    } else this.finish();
  }

  finish() {
    const { player, avatar } = this.ctx;
    player.pinned = false;
    player.auto = null;
    avatar.sit = 0;
    avatar.groove = 0;
    this.active = null;
    this.phase = null;
  }

  action() {
    if (this.phase === 'active') this.active.onAction();
  }

  release() {
    if (this.phase === 'active') this.active.onRelease();
  }

  cancel() {
    if (this.phase === 'active' && this.active.cancellable) this.leave();
    else if (this.phase === 'approach') {
      this.ctx.player.auto = null;
      this.active = null;
      this.phase = null;
    }
  }

  // Returns true while a station owns the character (main loop skips normal movement).
  update(dt) {
    const st = this.active;
    const { player, avatar } = this.ctx;
    this.camW = damp(this.camW, st && st.cam ? 1 : 0, 3.5, dt);
    if (!st || this.phase === 'approach') return false;

    if (this.phase === 'enter' || this.phase === 'exit') {
      this.t += dt / 0.55;
      const k = smooth(clamp01(this.t));
      const to =
        this.phase === 'enter'
          ? { x: st.use.x, z: st.use.z, y: st.use.y || 0, yaw: st.use.yaw }
          : { x: (st.approach || st.use).x, z: (st.approach || st.use).z, y: player.floor ? player.floor(st.approach.x, st.approach.z) : 0, yaw: this.from.yaw + Math.PI };
      const from = this.from;
      player.pos.set(
        THREE.MathUtils.lerp(from.pos.x, to.x, k),
        THREE.MathUtils.lerp(from.pos.y, to.y, k),
        THREE.MathUtils.lerp(from.pos.z, to.z, k),
      );
      player.yaw = from.yaw + wrap(to.yaw - from.yaw) * k;
      player.sync();
      const dist = Math.hypot(to.x - from.pos.x, to.z - from.pos.z);
      avatar.locomotion(this.t < 1 ? (dist / 0.55) * 1.2 * (1 - k) : 0, 0, dt);
      if (this.phase === 'exit') {
        avatar.sit = Math.max(0, avatar.sit - dt * 2.4);
        avatar.groove = 0;
      }
      if (this.t >= 1) {
        if (this.phase === 'enter') {
          this.phase = 'active';
          st.begin();
        } else this.finish();
      }
      return true;
    }

    // active
    st.update(dt);
    if (!st.drivesLocomotion) avatar.locomotion(0, 0, dt);
    return true;
  }

  // Blend the camera toward the station's framing (after the follow camera has run).
  applyCamera(camera) {
    const st = this.active;
    if (this.camW < 0.002 || !st) {
      this.lastCam = null;
      return;
    }
    const cam = st.cam || this.lastCam;
    if (!cam) return;
    this.lastCam = cam;
    const q0 = camera.quaternion.clone();
    const p0 = camera.position.clone();
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    const q1 = camera.quaternion.clone();
    const w = smooth(this.camW);
    camera.position.lerpVectors(p0, cam.pos, w);
    camera.quaternion.slerpQuaternions(q0, q1, w);
  }
}

// ---------------------------------------------------------------------------------------
class Station {
  constructor(o) {
    Object.assign(this, { reach: 2.8, verb: 'Use', cancellable: true, drivesLocomotion: false, cam: null }, o);
  }
  visible() {
    return true;
  }
  canStart() {
    return true;
  }
  promptText() {
    return this.prompt;
  }
  begin() {}
  update() {}
  onAction() {
    this.mgr.leave();
  }
  onRelease() {}
  end() {}

  // helpers
  arm(side, target, fwd, back, w, curl = 0.5, point = 0) {
    const a = this.ctx.avatar;
    a.ik[side].target.copy(target);
    a.ik[side].weight = w;
    a.aim[side].fwd.copy(fwd).normalize();
    a.aim[side].back.copy(back).normalize();
    a.aim[side].weight = w;
    a.hand[side].weight = w;
    a.hand[side].curl = curl;
    a.hand[side].point = point;
  }
  armsOff() {
    for (const s of ['Left', 'Right']) this.arm(s, new THREE.Vector3(), V(0, 0, 1), V(0, 1, 0), 0);
  }
  // wrist target so the fingertips land on `tip`
  wrist(tip, fwd) {
    return tip.clone().addScaledVector(fwd.clone().normalize(), -this.ctx.avatar.handLen);
  }
}

// ---------------- 1. Treadmill ----------------
export class TreadmillStation extends Station {
  constructor() {
    super({
      id: 'treadmill',
      title: 'Treadmill',
      prompt: 'Hop on the treadmill',
      verb: 'Run',
      pos: V(5.25, 1, 2.9),
      approach: { x: 3.9, z: 2.9 },
      use: { x: 4.8, z: 2.9, y: 0.145, yaw: Math.PI / 2 },
      drivesLocomotion: true,
    });
    this.dist = 0;
    this.speed = 0;
    this.goal = 100;
  }
  begin() {
    const t = this.ctx.room.treadmill;
    this.saved = { ...t.collider };
    Object.assign(t.collider, { minX: 1e3, maxX: 1e3, minZ: 1e3, maxZ: 1e3 });
    this.acc = 0;
    ui.hud('Treadmill', this.label(), 'Hold ↑ / W to run · Shift to sprint · Space to hop off');
    ui.actionButton('Hop off');
  }
  label() {
    return `${Math.floor(this.dist)} / ${this.goal} m · ${(this.speed * 3.6).toFixed(1)} km/h`;
  }
  update(dt) {
    const { input, avatar, room, story } = this.ctx;
    const go = input.move.y > 0.2;
    const target = go ? (input.run ? 5.6 : 3.4) * (this.ctx.player.caffeinated ? 1.2 : 1) : 0;
    this.speed = damp(this.speed, target, go ? 2.2 : 3, dt);
    this.dist += this.speed * dt;
    room.treadmill.beltTex.offset.y += (this.speed * dt * 5) / 1.8;
    avatar.locomotion(this.speed, 0, dt);
    this.acc += dt;
    if (this.acc > 0.12) {
      this.acc = 0;
      room.treadmill.draw(this.dist, this.speed, this.goal);
      ui.hudBody(this.label(), this.dist >= this.goal ? 'Spark earned! Keep going or press Space to hop off' : undefined);
    }
    if (this.dist >= this.goal && !story.has('treadmill')) story.complete('treadmill', this.pos);
  }
  end() {
    Object.assign(this.ctx.room.treadmill.collider, this.saved);
    this.speed = 0;
  }
}

// ---------------- 2. Record player ----------------
export class RecordStation extends Station {
  constructor(room) {
    super({
      id: 'record',
      title: 'Record player',
      verb: 'Play',
      pos: room.turntablePos.clone(),
      approach: { x: -0.85, z: -4.3 },
      use: { x: -0.85, z: -5.02, yaw: Math.PI },
      cancellable: false,
    });
  }
  promptText() {
    const m = this.ctx.music;
    if (!m.playing || this.ctx.room.party) return 'Drop the needle';
    return m.trackId === 'lofi' ? 'Flip to the other record' : 'Lift the needle';
  }
  begin() {
    const m = this.ctx.music;
    this.t = 0;
    this.fired = false;
    this.next = !m.playing || m.trackId === 'karaoke' ? 'lofi' : m.trackId === 'lofi' ? 'synthwave' : null;
    this.armFrom = this.ctx.room.tonearm.rotation.y;
    this.armTo = this.next ? -0.2 : 0.5;
  }
  update(dt) {
    const { room, music, story } = this.ctx;
    this.t += dt;
    const t = this.t;
    const w = t < 0.5 ? smooth(t / 0.5) : t < 1.3 ? 1 : 1 - smooth(clamp01((t - 1.3) / 0.5));
    const fwd = V(0.1, -0.45, -1);
    const tip = V(-0.72, 1.66, -5.7);
    this.arm('Right', this.wrist(tip, fwd), fwd, V(0.3, 1, 0), w, 0.7, 0.5);
    room.tonearm.rotation.y = THREE.MathUtils.lerp(this.armFrom, this.armTo, smooth(clamp01((t - 0.55) / 0.5)));
    if (t >= 1.05 && !this.fired) {
      this.fired = true;
      if (this.next) {
        music.play(this.next);
        ui.toast(`♪ Now playing <b>${music.trackName()}</b>`);
        if (!story.has('record')) story.complete('record', this.pos);
        else if (this.next === 'synthwave') story.say('Synthwave at 4 AM? Bold. I respect it.');
      } else {
        music.stop();
        room.party = false;
      }
    }
    if (t >= 1.9) this.mgr.leave();
  }
  onAction() {}
  end() {
    this.armsOff();
  }
}

// ---------------- 3. Karaoke ----------------
const LEAD = 4; // count-in beats
export class KaraokeStation extends Station {
  constructor(room) {
    const c = room.stage.center;
    super({
      id: 'karaoke',
      title: 'Karaoke stage',
      prompt: 'Step up to the mic',
      verb: 'Sing',
      pos: V(c.x, 1.3, c.z),
      approach: { x: c.x + 0.25, z: c.z - 1.35 },
      use: { x: c.x, z: c.z + 0.22, y: 0.08, yaw: Math.PI },
      cancellable: true,
    });
    this.els = {
      root: ui.$('karaoke'),
      lane: ui.$('k-lane'),
      lyrics: ui.$('k-lyrics'),
      judge: ui.$('k-judge'),
      score: ui.$('k-score'),
      combo: ui.$('k-combo'),
      result: ui.$('k-result'),
      song: ui.$('k-song'),
    };
  }
  begin() {
    const { music, room, avatar } = this.ctx;
    this.prevTrack = music.playing && music.trackId !== 'karaoke' ? music.trackId : null;
    music.play('karaoke', { bars: Math.ceil((LEAD + 32 + 6) / 4) });
    const spb = 60 / SONG.bpm;
    this.notes = SONG.lines.flatMap((line, li) =>
      line.map(([word, beat, pitch], wi) => ({ word, pitch, li, wi, time: music.t0 + (beat + LEAD) * spb, state: 'pending' })),
    );
    this.els.lane.querySelectorAll('.k-note').forEach((n) => n.remove());
    for (const n of this.notes) {
      n.el = document.createElement('span');
      n.el.className = 'k-note';
      n.el.textContent = n.word;
      this.els.lane.appendChild(n.el);
    }
    this.line = -1;
    this.score = 0;
    this.combo = 0;
    this.best = 0;
    this.points = 0;
    this.finished = false;
    this.els.song.textContent = `♪ ${SONG.song}`;
    this.els.result.hidden = true;
    this.els.judge.textContent = 'Get ready…';
    this.els.root.hidden = false;
    this.paint();
    const c = room.stage.center;
    this.cam = { pos: V(c.x + 0.95, 1.55, c.z - 2.25), look: V(c.x, 1.35, c.z + 0.1) };
    room.stage.singerLight.intensity = 3.2;
    room.stage.ringLightMat.color.setScalar(3);
    avatar.groove = 1;
    ui.actionButton('Sing!');
    ui.hud('Karaoke', SONG.song, 'Esc to bail', { leave: true });
    ui.$('station-hud').hidden = true;
  }
  paint() {
    this.els.score.textContent = this.score;
    this.els.combo.textContent = this.combo;
  }
  showLine(li) {
    if (li === this.line) return;
    this.line = li;
    const line = SONG.lines[li] || [];
    this.els.lyrics.innerHTML = line.map(([w], wi) => `<span class="w" data-wi="${wi}">${w}</span>`).join(' ');
    for (const n of this.notes) if (n.li === li && n.state !== 'pending') this.markWord(n);
  }
  markWord(n) {
    if (n.li !== this.line) return;
    const el = this.els.lyrics.querySelector(`[data-wi="${n.wi}"]`);
    if (el) el.classList.add(n.state);
  }
  judge(text) {
    this.els.judge.textContent = text;
    this.els.judge.animate([{ transform: 'translateX(-50%) scale(1.4)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 220 });
  }
  update(dt) {
    const { music, avatar, room } = this.ctx;
    const now = music.now();
    avatar.beatPhase = music.playing ? music.beat() : 0;
    // hand on the mic, singing into it
    const mic = V(room.stage.center.x + 0.02, 1.43, room.stage.center.z - 0.13);
    this.arm('Right', mic, V(-0.4, 0.5, -1), V(1, 0.2, 0.2), 1, 0.85, 0);
    avatar.lookPitch = -0.1;
    const HIT = 14;
    const SPAN = 2.6; // seconds of lookahead shown in the lane
    let upcoming = null;
    for (const n of this.notes) {
      const dtN = n.time - now;
      if (n.state === 'pending' && dtN < -0.22) {
        n.state = 'miss';
        n.el.classList.add('miss');
        this.combo = 0;
        this.judge('Miss');
        this.markWord(n);
        this.paint();
      }
      const x = HIT + (dtN / SPAN) * (100 - HIT);
      n.el.style.left = `${x}%`;
      n.el.style.display = x > 108 || x < -10 ? 'none' : '';
      if (!upcoming && (n.state === 'pending' || dtN > -0.3)) upcoming = n;
    }
    if (upcoming) this.showLine(upcoming.li);
    const last = this.notes[this.notes.length - 1];
    if (!this.finished && now > last.time + 1.2) this.results();
    if (this.finished && (this.resultT += dt) > 4.2) this.mgr.leave();
  }
  onAction() {
    if (this.finished) return;
    const now = this.ctx.music.now();
    let best = null;
    let bestD = Infinity;
    for (const n of this.notes) {
      if (n.state !== 'pending') continue;
      const d = Math.abs(n.time - now);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best && bestD < 0.2) {
      best.state = 'hit';
      best.el.classList.add('hit');
      const perfect = bestD < 0.085;
      this.points += perfect ? 1 : 0.7;
      this.score += perfect ? 100 : 60;
      this.combo++;
      this.best = Math.max(this.best, this.combo);
      this.judge(perfect ? 'Perfect!' : 'Good');
      this.ctx.music.sing(best.pitch, 0.42);
      this.markWord(best);
    } else {
      this.combo = 0;
      this.judge('Off beat');
    }
    this.paint();
  }
  results() {
    this.finished = true;
    this.resultT = 0;
    const acc = this.points / this.notes.length;
    const rank = acc >= 0.9 ? 'S' : acc >= 0.75 ? 'A' : acc >= 0.6 ? 'B' : 'C';
    const pass = acc >= 0.6;
    this.els.result.innerHTML = `<p class="rank">${rank}</p><p>${Math.round(acc * 100)}% · best combo ${this.best}</p><p>${pass ? 'The neon approves.' : 'Tough crowd. Step up again to retry.'}</p>`;
    this.els.result.hidden = false;
    const { story } = this.ctx;
    if (pass && !story.has('karaoke')) story.complete('karaoke', this.pos, { note: `sang “${SONG.song}” to the neon. Rank ${rank}.` });
    else if (!pass) story.say('Okay that was… experimental. Try again? I believe in you. Mostly.');
  }
  end() {
    const { music, room, avatar } = this.ctx;
    this.els.root.hidden = true;
    if (music.trackId === 'karaoke') music.stop();
    if (this.prevTrack) music.play(this.prevTrack);
    room.stage.singerLight.intensity = 0;
    room.stage.ringLightMat.color.setScalar(0.07);
    avatar.groove = 0;
    avatar.lookPitch = 0;
    this.armsOff();
  }
}

// ---------------- 4. Sketch pad ----------------
export class SketchStation extends Station {
  constructor() {
    super({
      id: 'sketch',
      title: 'Drawing table',
      prompt: 'Sketch at the worktable',
      verb: 'Draw',
      pos: V(-4.2, 1.0, 4.4),
      approach: { x: -3.55, z: 3.05 },
      use: { x: -3.55, z: 3.7, yaw: 0 },
    });
    this.pad = null;
  }
  begin() {
    if (!this.pad) this.pad = new SketchPad(this);
    this.pad.open();
    this.cam = { pos: V(-2.85, 1.95, 3.0), look: V(-3.85, 0.95, 4.45) };
    this.stroke = new THREE.Vector2(0.5, 0.5);
    ui.actionButton('Draw', false);
  }
  update() {
    // the drawing hand follows the pen on the tablet
    const s = this.stroke;
    const tip = V(-3.85 + (s.x - 0.5) * 0.26, 0.955, 4.42 + (s.y - 0.5) * 0.16);
    const fwd = V(0.1, -0.9, 0.5);
    this.arm('Right', this.wrist(tip, fwd), fwd, V(0, 0.4, 1), 1, 0.8, 0);
    this.ctx.avatar.lookPitch = -0.5;
  }
  pin(url) {
    const { room, story } = this.ctx;
    room.pinDoodle(url);
    try {
      localStorage.setItem('studio-doodle', url);
    } catch {
      /* storage full or blocked */
    }
    if (!story.has('sketch')) story.complete('sketch', this.pos, { img: url });
    else story.say('Another one for the board. Honestly the board is getting crowded. I love it.');
    this.mgr.leave();
  }
  onAction() {}
  end() {
    this.pad && this.pad.close();
    this.ctx.avatar.lookPitch = 0;
    this.armsOff();
  }
}

class SketchPad {
  constructor(station) {
    this.st = station;
    this.cv = ui.$('sk-canvas');
    this.g = this.cv.getContext('2d');
    this.strokes = [];
    this.color = '#1a1a1a';
    this.size = 6;
    const colors = ['#1a1a1a', '#ff5f3d', '#2d6cdf', '#2ec4b6', '#ffb400', '#b14aed'];
    const cWrap = ui.$('sk-colors');
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sk-swatch${i === 0 ? ' on' : ''}`;
      b.style.background = c;
      b.onclick = () => {
        this.color = c;
        cWrap.querySelectorAll('.sk-swatch').forEach((x) => x.classList.toggle('on', x === b));
      };
      cWrap.appendChild(b);
    });
    const sWrap = ui.$('sk-sizes');
    [3, 6, 14].forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sk-size${i === 1 ? ' on' : ''}`;
      b.innerHTML = `<i style="width:${s + 2}px;height:${s + 2}px"></i>`;
      b.onclick = () => {
        this.size = s;
        sWrap.querySelectorAll('.sk-size').forEach((x) => x.classList.toggle('on', x === b));
      };
      sWrap.appendChild(b);
    });
    ui.$('sk-undo').onclick = () => {
      this.strokes.pop();
      this.redraw();
    };
    ui.$('sk-clear').onclick = () => {
      this.strokes = [];
      this.redraw();
    };
    ui.$('sk-cancel').onclick = () => this.st.mgr.leave();
    ui.$('sk-pin').onclick = () => {
      if (!this.strokes.length) {
        ui.$('sk-pin').animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 240 });
        return;
      }
      const out = document.createElement('canvas');
      out.width = 440;
      out.height = 310;
      out.getContext('2d').drawImage(this.cv, 0, 0, 440, 310);
      this.st.pin(out.toDataURL('image/png'));
    };
    const pos = (e) => {
      const r = this.cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * this.cv.width, ((e.clientY - r.top) / r.height) * this.cv.height];
    };
    this.cv.addEventListener('pointerdown', (e) => {
      this.cv.setPointerCapture(e.pointerId);
      this.cur = { color: this.color, size: this.size, pts: [pos(e)] };
      this.strokes.push(this.cur);
      this.redraw();
    });
    this.cv.addEventListener('pointermove', (e) => {
      if (!this.cur) return;
      const p = pos(e);
      this.cur.pts.push(p);
      this.st.stroke.set(p[0] / this.cv.width, p[1] / this.cv.height);
      this.drawStroke(this.cur, true);
    });
    const up = () => (this.cur = null);
    this.cv.addEventListener('pointerup', up);
    this.cv.addEventListener('pointercancel', up);
  }
  paper() {
    const g = this.g;
    g.fillStyle = '#f6f1e6';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.strokeStyle = 'rgba(90,120,200,0.12)';
    g.lineWidth = 1;
    for (let y = 40; y < this.cv.height; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(this.cv.width, y);
      g.stroke();
    }
  }
  drawStroke(s, lastOnly = false) {
    const g = this.g;
    g.strokeStyle = s.color;
    g.lineWidth = s.size;
    g.lineCap = g.lineJoin = 'round';
    const pts = s.pts;
    g.beginPath();
    const start = lastOnly ? Math.max(0, pts.length - 2) : 0;
    g.moveTo(pts[start][0], pts[start][1]);
    for (let i = start + 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (pts.length === 1) g.lineTo(pts[0][0] + 0.1, pts[0][1]);
    g.stroke();
  }
  redraw() {
    this.paper();
    this.strokes.forEach((s) => this.drawStroke(s));
  }
  open() {
    this.strokes = [];
    this.redraw();
    ui.show('sketch', true);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  close() {
    ui.show('sketch', false);
  }
}

// ---------------- 5. Espresso ----------------
export class CoffeeStation extends Station {
  constructor(room) {
    super({
      id: 'coffee',
      title: 'Espresso bar',
      prompt: 'Pull an espresso',
      verb: 'Brew',
      pos: room.coffeeBar.cupWorld.clone(),
      approach: { x: -5.6, z: -4.25 },
      use: { x: -5.6, z: -4.95, yaw: Math.PI },
    });
    this.fill = 0;
  }
  begin() {
    const { room } = this.ctx;
    this.state = 'ready';
    this.armed = false; // needs a fresh press (the one that started the station doesn't count)
    this.fill = 0;
    room.coffeeBar.coffee.scale.y = 0.001;
    ui.show('brew', true);
    this.msg('Hold <kbd>Space</kbd> to pour. Let go in the gold zone.');
    ui.actionButton('Hold to pour');
    this.cam = { pos: V(-4.35, 1.5, -5.05), look: V(-5.7, 1.05, -5.62) };
    room.coffeeBar.gaugeMat.color.set('#6dff9a');
  }
  msg(html) {
    ui.$('brew-msg').innerHTML = html;
  }
  update(dt) {
    const { input, room, sfx } = this.ctx;
    const cb = room.coffeeBar;
    const fwd = V(0.1, -0.3, -1);
    this.arm('Right', this.wrist(cb.lever, fwd), fwd, V(0, 1, 0), 1, 0.7, 0);
    if (!input.actionHeld) this.armed = true;
    if (this.state === 'ready' && this.armed && input.actionHeld) this.state = 'pouring';
    if (this.state === 'pouring') {
      this.fill += dt * 0.45;
      if (Math.random() < dt * 14) sfx.event('pour');
      if (this.fill > 1.06) this.fail('Overflow! Espresso everywhere. The floor is caffeinated now.');
    }
    cb.coffee.scale.y = Math.max(0.001, Math.min(1, this.fill));
    ui.$('brew-fill').style.height = `${Math.min(100, this.fill * 100)}%`;
    // steam
    const hot = this.state === 'pouring' || this.state === 'done';
    for (const s of cb.steam) {
      s.t = (s.t + dt * 0.5) % 1;
      s.sp.position.set(cb.cupWorld.x + Math.sin(s.t * 9 + s.sp.id) * 0.03, cb.cupWorld.y + 0.06 + s.t * 0.45, cb.cupWorld.z);
      s.sp.material.opacity = hot ? Math.sin(s.t * Math.PI) * 0.35 : 0;
      s.sp.scale.setScalar(0.06 + s.t * 0.14);
    }
    if (this.state === 'wait' && (this.waitT -= dt) <= 0) {
      this.state = 'ready';
      this.fill = 0;
      this.msg('Again! Hold <kbd>Space</kbd>, let go in the gold.');
    }
    if (this.state === 'done' && (this.waitT -= dt) <= 0) this.mgr.leave();
  }
  fail(text) {
    this.state = 'wait';
    this.waitT = 1.6;
    this.msg(text);
  }
  onAction() {}
  onRelease() {
    if (this.state !== 'pouring') return;
    const f = this.fill;
    if (f >= 0.72 && f <= 0.88) {
      this.state = 'done';
      this.waitT = 1.8;
      this.msg('<b>Perfect shot.</b> ☕ Caffeine online.');
      const { story, player, avatar } = this.ctx;
      if (!player.caffeinated) {
        player.caffeinated = true;
        player.runSpeed *= 1.4;
        player.walk *= 1.15;
        avatar.jitter = 0.5;
      }
      if (!story.has('coffee')) story.complete('coffee', this.pos);
      else story.say('Another one? Your heart is doing a drum solo.');
    } else if (f < 0.72) this.fail('Too short. That’s a sad little ristretto. Again!');
    else this.fail('Too long. That’s basically a latte. Again!');
  }
  end() {
    ui.show('brew', false);
    this.ctx.room.coffeeBar.gaugeMat.color.set('#000');
    for (const s of this.ctx.room.coffeeBar.steam) s.sp.material.opacity = 0;
    if (this.state !== 'done') this.ctx.room.coffeeBar.coffee.scale.y = 0.001;
    this.armsOff();
  }
}

// ---------------- 7. Desk: ship the pitch (final) ----------------
export class DeskStation extends Station {
  constructor() {
    super({
      id: 'ship',
      title: 'Desk · ship it',
      verb: 'Sit',
      pos: V(2.05, 1.15, -5.65),
      approach: { x: 2.1, z: -3.8 },
      use: { x: 2.1, z: -4.5, yaw: Math.PI },
      reach: 2.6,
    });
  }
  promptText() {
    const s = this.ctx.story;
    return s.shipped ? 'Open PitchOS' : s.ready ? 'Sit down & ship the pitch' : 'Sit at the desk';
  }
  canStart() {
    const s = this.ctx.story;
    if (!s.ready && !s.shipped) {
      s.say(STORY.final.locked);
      return false;
    }
    return true;
  }
  begin() {
    const { room, avatar } = this.ctx;
    this.t = 0;
    this.opened = false;
    const ch = room.deskChair;
    this.chairFrom = { pos: ch.position.clone(), rot: ch.rotation.y };
    avatar.seatHeight = 0.5;
    avatar.sitLean = 1;
    this.cam = { pos: V(2.85, 1.55, -3.95), look: V(2.05, 1.12, -5.6) };
    ui.actionButton('Stand up');
  }
  update(dt) {
    const { room, avatar, pitchos } = this.ctx;
    this.t += dt;
    const k = smooth(clamp01(this.t / 0.7));
    avatar.sit = k;
    const ch = room.deskChair;
    ch.position.lerpVectors(this.chairFrom.pos, V(-0.1, 0, 1.08), k);
    ch.rotation.y = THREE.MathUtils.lerp(this.chairFrom.rot, Math.PI, k);
    const hw = smooth(clamp01((this.t - 0.5) / 0.6));
    const fwdK = V(0, -0.6, -1);
    this.arm('Left', this.wrist(V(1.95, 0.79, -5.36), fwdK), fwdK, V(0, 1, 0.3), hw, 0.35, 0);
    this.arm('Right', this.wrist(V(2.4, 0.79, -5.34), fwdK), fwdK, V(0, 1, 0.3), hw, 0.45, 0);
    avatar.lookPitch = -0.2;
    if (this.t > 1.3 && !this.opened) {
      this.opened = true;
      pitchos.open(() => this.mgr.leave());
    }
  }
  onAction() {
    if (!this.ctx.pitchos.isOpen) this.mgr.leave();
  }
  end() {
    const { room, avatar, pitchos } = this.ctx;
    if (pitchos.isOpen) pitchos.close(true);
    const ch = room.deskChair;
    ch.position.copy(this.chairFrom.pos);
    ch.rotation.y = this.chairFrom.rot;
    avatar.lookPitch = 0;
    this.armsOff();
  }
}

// ---------------- secrets ----------------
export class DumbbellStation extends Station {
  constructor(room) {
    super({ id: 'gains', title: 'Dumbbells', prompt: 'Do some curls', verb: 'Lift', pos: V(3.7, 0.8, 1.7), approach: { x: 3.7, z: 2.95 }, use: { x: 3.7, z: 2.3, yaw: Math.PI } });
    this.bell = room.dumbbells.bells[1];
    this.home = this.bell.position.clone();
  }
  begin() {
    this.reps = 0;
    this.t = 0;
    this.curlT = -1;
    ui.hud('Curls', '0 / 10', 'Tap Space to curl');
    ui.actionButton('Curl');
  }
  update(dt) {
    const { avatar, story, sfx } = this.ctx;
    this.t += dt;
    const sh = avatar.worldPos('RightArm');
    const fwd = avatar.forwardAxis();
    const pick = smooth(clamp01(this.t / 0.5));
    let k = 0;
    if (this.curlT >= 0) {
      this.curlT += dt / 0.55;
      k = Math.sin(Math.min(1, this.curlT) * Math.PI);
      if (this.curlT >= 1) {
        this.curlT = -1;
        this.reps++;
        sfx.event('curl', this.reps);
        ui.hudBody(`${this.reps} / 10`);
        if (this.reps === 10) {
          story.secret('gains');
          this.doneT = 0.8;
        }
      }
    }
    const down = sh.clone().addScaledVector(fwd, 0.1).add(V(0, -0.55, 0));
    const up = sh.clone().addScaledVector(fwd, 0.25).add(V(0, -0.08, 0));
    const target = this.t < 0.5 ? this.bell.getWorldPosition(new THREE.Vector3()) : down.lerp(up, k);
    const hf = V(0, -1, 0).lerp(V(0, 1, 0), k).addScaledVector(fwd, 0.4);
    this.arm('Right', target, hf, fwd.clone(), pick, 1, 0);
    if (this.t >= 0.5) {
      const hand = avatar.worldPos('RightHand').addScaledVector(hf.normalize(), 0.08);
      this.bell.position.copy(this.bell.parent.worldToLocal(hand));
    }
    if (this.doneT !== undefined && (this.doneT -= dt) <= 0) {
      this.doneT = undefined;
      this.mgr.leave();
    }
  }
  onAction() {
    if (this.t > 0.5 && this.curlT < 0 && this.reps < 10) this.curlT = 0;
  }
  end() {
    this.bell.position.copy(this.home);
    this.armsOff();
  }
}

export class NapStation extends Station {
  constructor() {
    super({ id: 'nap', title: 'Sofa', prompt: 'Take a power nap', verb: 'Nap', pos: V(3.4, 0.6, 5.45), approach: { x: 2.05, z: 4.72 }, use: { x: 3.1, z: 5.3, yaw: Math.PI }, cancellable: false });
  }
  begin() {
    const { avatar } = this.ctx;
    this.t = 0;
    avatar.seatHeight = 0.44;
    avatar.sitLean = -1.6;
  }
  update(dt) {
    const { avatar, story } = this.ctx;
    this.t += dt;
    avatar.sit = smooth(clamp01(this.t / 0.7));
    avatar.lookPitch = 0.25;
    if (this.t > 1.2 && !this.dark) {
      this.dark = true;
      ui.show('nap', true);
      story.addMinutes(8);
    }
    if (this.t > 4.2 && this.dark) {
      this.dark = false;
      ui.show('nap', false);
      story.secret('nap');
    }
    if (this.t > 5) this.mgr.leave();
  }
  onAction() {}
  end() {
    ui.show('nap', false);
    this.dark = false;
    this.ctx.avatar.lookPitch = 0;
    this.ctx.avatar.sitLean = 1;
  }
}

export class PlantStation extends Station {
  constructor(room) {
    super({ id: 'monstera', title: 'Monstera', prompt: 'Water the monstera', verb: 'Water', pos: V(6.55, 1.2, -4.4), approach: { x: 5.3, z: -3.4 }, use: { x: 5.72, z: -4.12, yaw: Math.PI / 2 }, cancellable: false });
    this.can = room.wateringCan;
    this.home = this.can.group.position.clone();
    this.plant = room.monstera;
    this.baseScale = this.plant.scale.x;
    this.times = 0;
  }
  begin() {
    this.t = 0;
    this.from = this.plant.scale.x;
    this.to = Math.min(this.baseScale * 1.4, this.from * 1.12);
  }
  update(dt) {
    const { avatar, story, sfx } = this.ctx;
    this.t += dt;
    const t = this.t;
    const can = this.can.group;
    const reachW = t < 0.5 ? smooth(t / 0.5) : t < 3.0 ? 1 : 1 - smooth(clamp01((t - 3.0) / 0.4));
    const fwd = avatar.forwardAxis();
    const canPos = can.getWorldPosition(new THREE.Vector3()).add(V(0, 0.2, 0));
    const pour = V(6.2, 1.25, -4.3);
    const target = t < 0.55 ? canPos : t < 2.9 ? canPos.clone().lerp(pour, smooth(clamp01((t - 0.55) / 0.5))) : pour;
    this.arm('Right', target, fwd.clone().add(V(0, -0.4, 0)), V(0, 1, 0), reachW, 1, 0);
    if (t >= 0.55 && t < 2.95) {
      const hand = avatar.worldPos('RightHand');
      can.position.copy(can.parent.worldToLocal(hand.add(V(0, -0.2, 0))));
      can.rotation.z = -smooth(clamp01((t - 1.0) / 0.4)) * 0.7 * (t < 2.6 ? 1 : 1 - (t - 2.6) / 0.35);
      can.rotation.y = -Math.PI / 2 + 0;
    }
    const watering = t > 1.2 && t < 2.6;
    for (const d of this.can.drops) {
      d.m.visible = watering;
      if (!watering) continue;
      d.t = (d.t + dt * 1.6) % 1;
      const spout = can.getWorldPosition(new THREE.Vector3()).add(V(0.18, 0.12, 0));
      d.m.position.set(spout.x + d.t * 0.1, spout.y - d.t * d.t * 0.9, spout.z + Math.sin(d.t * 20) * 0.01);
    }
    if (watering && Math.random() < dt * 10) sfx.event('water');
    if (t > 1.2) this.plant.scale.setScalar(THREE.MathUtils.lerp(this.from, this.to, smooth(clamp01((t - 1.2) / 1.6))));
    if (t > 3.5) {
      can.position.copy(this.home);
      can.rotation.set(0, 0, 0);
      this.times++;
      if (this.times === 1) story.secret('monstera');
      else story.say(this.times > 3 ? 'It’s… it’s getting big. Should we be worried?' : 'Look at her GO.');
      this.mgr.leave();
    }
  }
  onAction() {}
  end() {
    for (const d of this.can.drops) d.m.visible = false;
    this.armsOff();
  }
}

export class PartyStation extends Station {
  constructor() {
    super({ id: 'party', title: 'Other switch', verb: 'Flip', pos: V(SWITCH_POS.x + 0.05, 1.28, SWITCH_POS.z), approach: { x: SWITCH_POS.x - 0.1, z: SWITCH_POS.z + 1.3 }, use: { x: SWITCH_POS.x - 0.1, z: SWITCH_POS.z + 0.55, yaw: Math.PI }, cancellable: false, reach: 1.9 });
  }
  promptText() {
    return this.ctx.room.party ? 'Flip the other switch (calm down)' : 'Flip the other switch';
  }
  begin() {
    this.t = 0;
    this.fired = false;
  }
  update(dt) {
    const { room, music, story } = this.ctx;
    this.t += dt;
    const t = this.t;
    const w = t < 0.45 ? smooth(t / 0.45) : t < 0.8 ? 1 : 1 - smooth(clamp01((t - 0.8) / 0.4));
    const fwd = V(-0.1, 0.05, -1);
    const tip = V(SWITCH_POS.x + 0.05, SWITCH_POS.y - 0.01, SWITCH_POS.z + 0.045);
    this.arm('Right', this.wrist(tip, fwd), fwd, V(0, 1, 0.2), w, 0.95, 1);
    if (t > 0.55 && !this.fired) {
      this.fired = true;
      room.party = !room.party;
      room.partySwitch.rotation.x = room.party ? -0.16 : 0.16;
      this.ctx.sfx.event('switch');
      if (room.party) {
        music.play('synthwave');
        ui.toast('🪩 <b>Party mode</b>');
        if (!story.hasSecret('party')) story.secret('party');
      } else music.stop();
    }
    if (t > 1.25) this.mgr.leave();
  }
  onAction() {}
  end() {
    this.armsOff();
  }
}

export class BookStation extends Station {
  constructor() {
    super({ id: 'bookworm', title: 'Bookshelf', prompt: 'Read something', verb: 'Read', pos: V(5.7, 1.3, -5.78), approach: { x: 5.45, z: -4.35 }, use: { x: 5.45, z: -5.08, yaw: Math.PI } });
    this.i = Math.floor(Math.random() * STORY.quotes.length);
  }
  begin() {
    this.t = 0;
    this.shown = false;
    ui.actionButton('Close');
  }
  update(dt) {
    this.t += dt;
    const w = smooth(clamp01(this.t / 0.5));
    const fwd = V(-0.2, 0.1, -1);
    this.arm('Right', this.wrist(V(5.25, 1.46, -5.72), fwd), fwd, V(1, 0.3, 0), w, 0.6, 0);
    if (this.t > 0.55 && !this.shown) {
      this.shown = true;
      ui.$('quote-text').textContent = STORY.quotes[this.i++ % STORY.quotes.length];
      ui.show('quote', true);
      if (!this.ctx.story.hasSecret('bookworm')) this.ctx.story.secret('bookworm');
    }
  }
  onAction() {
    if (this.shown) this.mgr.leave();
  }
  end() {
    ui.show('quote', false);
    this.armsOff();
  }
}
