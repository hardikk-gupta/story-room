import * as THREE from 'three';
import { START, SWITCH_POS } from '../world/room.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const seg = (p, a, b) => smooth(clamp01((p - a) / (b - a)));

// Scroll-mapped opening. Scroll progress p ∈ [0,1] scrubs a fixed timeline:
//   0.00–0.14  hero: the character faces the camera in a dark room, intro copy on both sides
//   0.14–0.40  he turns around to face the wall behind him
//   0.40–0.60  walks up to the switchboard
//   0.60–0.80  reaches for the switch (arm IK + pointing finger)
//   0.80–0.88  presses it → lights sequence starts (time-based, one-way)
//   0.88–1.00  hand drops, camera pulls back to reveal the studio
// Scrolling back rewinds everything before the click. Arrow keys / Space / tap skip ahead.
export class Intro {
  constructor({ avatar, player, room, camera, onDone }) {
    this.avatar = avatar;
    this.player = player;
    this.room = room;
    this.camera = camera;
    this.onDone = onDone;
    this.p = 0;
    this.target = 0;
    this.skipping = false;
    this.done = false;
    this.pressed = false;
    this.copyEl = document.getElementById('intro');

    const S = new THREE.Vector3(START.x, 0, START.z);
    const walkEnd = new THREE.Vector3(SWITCH_POS.x - 0.24, 0, SWITCH_POS.z + 0.52);
    this.S = S;
    this.walkEnd = walkEnd;

    // camera path (positions + look targets), sampled with Catmull-Rom for silky motion
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    this.camKeys = [0, 0.14, 0.4, 0.62, 0.84, 1.0];
    const E = walkEnd;
    this.camPos = new THREE.CatmullRomCurve3([
      v(S.x + 0.1, 1.5, S.z + 2.35),
      v(S.x + 0.3, 1.52, S.z + 2.2),
      v(S.x + 1.75, 1.58, S.z + 1.55),
      v(S.x + 1.35, 1.72, S.z + 1.2),
      v(E.x + 1.05, 1.66, E.z + 1.3),
      v(0.7, 2.05, -0.9),
    ], false, 'centripetal');
    this.camLook = new THREE.CatmullRomCurve3([
      v(S.x, 1.52, S.z),
      v(S.x, 1.5, S.z),
      v(S.x - 0.05, 1.35, S.z - 0.4),
      v(E.x - 0.05, 1.3, E.z - 0.35),
      v(SWITCH_POS.x - 0.2, 1.3, SWITCH_POS.z + 0.1),
      v(-0.5, 1.15, -5.3),
    ], false, 'centripetal');

    this.player.place(S.x, S.z, 0);
    this.readScroll = () => {
      if (this.skipping) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      this.target = max > 0 ? clamp01(scrollY / max) : 0;
      if (this.pressed) this.target = Math.max(this.target, 0.88);
    };
    addEventListener('scroll', this.readScroll, { passive: true });
  }

  skip() {
    if (this.done) return;
    this.skipping = true;
  }

  // piecewise camera param: map p onto the curve's uniform t so each key lands at its p
  curveT(p) {
    const k = this.camKeys;
    for (let i = 0; i < k.length - 1; i++) {
      if (p <= k[i + 1]) {
        const local = smooth((p - k[i]) / (k[i + 1] - k[i]));
        return (i + local) / (k.length - 1);
      }
    }
    return 1;
  }

  update(dt) {
    if (this.done) return;
    if (this.skipping) this.target = Math.min(1, this.target + dt * 0.42);
    // scroll smoothing (like a smooth-scroll library, but on the timeline itself)
    const prev = this.p;
    this.p += (this.target - this.p) * (1 - Math.exp(-5 * dt));
    if (Math.abs(this.target - this.p) < 1e-4) this.p = this.target;
    const p = this.p;
    const dp = p - prev;

    // copy fades out as the story starts
    const copy = 1 - seg(p, 0.04, 0.16);
    this.copyEl.style.opacity = copy.toFixed(3);

    const { avatar, player } = this;

    // turn: 0 (facing the camera, +Z) → π (facing the wall). With the Mixamo turn clip the
    // body rotation comes from the animation; the root only absorbs the clip's small end error
    // so that the character faces the wall exactly when control passes to the walk.
    const turn = seg(p, 0.14, 0.4);
    const hasTurn = !!avatar.actions.turn;
    const walking = p >= 0.4;
    let yaw;
    if (hasTurn) {
      const fix = Math.atan2(Math.sin(Math.PI - avatar.turnEndYaw), Math.cos(Math.PI - avatar.turnEndYaw));
      yaw = walking ? Math.PI : fix * seg(p, 0.14, 0.2);
    } else {
      yaw = turn * Math.PI;
    }
    // walk to the switch
    const w = clamp01((p - 0.4) / 0.2);
    const walkEase = smooth(w);
    const x = THREE.MathUtils.lerp(this.S.x, this.walkEnd.x, walkEase);
    const z = THREE.MathUtils.lerp(this.S.z, this.walkEnd.z, walkEase);
    player.place(x, z, yaw);

    // locomotion speed derived from how fast the timeline is moving
    const dist = this.S.distanceTo(this.walkEnd);
    const walkingNow = p > 0.4 && p < 0.6;
    const speed = walkingNow ? Math.min(2.0, ((Math.abs(dp) * dist) / (0.2 * Math.max(dt, 1e-4))) * (6 * walkEase * (1 - walkEase) + 0.4)) : 0;
    const turning = !hasTurn && p > 0.14 && p < 0.4 ? Math.min(1, (Math.abs(dp) / Math.max(dt, 1e-4)) * 6) : 0;
    avatar.turnShuffle = turning;

    // one-off clips scrubbed by scroll: turn, then the button push
    if (hasTurn && p > 0.14 && !walking) {
      const tt = clamp01((p - 0.14) / 0.26);
      avatar.setOverlay('turn', tt * avatar.clips.turn.duration, seg(p, 0.14, 0.16));
    } else if (avatar.actions.push && p > 0.56) {
      const pt = avatar.pushTime;
      const dur = avatar.clips.push.duration;
      const time = p < 0.845 ? THREE.MathUtils.lerp(0, pt, clamp01((p - 0.6) / 0.245)) : THREE.MathUtils.lerp(pt, dur * 0.8, clamp01((p - 0.845) / 0.14));
      avatar.setOverlay('push', time, seg(p, 0.56, 0.62) * (1 - seg(p, 0.9, 0.99)));
    } else {
      avatar.setOverlay(null, 0, 0);
    }
    avatar.locomotion(speed, 0, dt);

    // reach + press with the right hand
    const reach = seg(p, 0.6, 0.8);
    const press = seg(p, 0.8, 0.85) * (1 - seg(p, 0.85, 0.9));
    const release = seg(p, 0.88, 0.98);
    const weight = reach * (1 - release);
    const ik = avatar.ik.Right;
    const aim = avatar.aim.Right;
    const tip = new THREE.Vector3(SWITCH_POS.x - 0.05, SWITCH_POS.y - 0.01, SWITCH_POS.z + 0.045 - press * 0.022);
    const fwd = new THREE.Vector3(0.12, 0.05, -1).normalize();
    ik.target.copy(tip).addScaledVector(fwd, -avatar.handLen);
    ik.weight = weight;
    aim.fwd.copy(fwd);
    aim.back.set(0, 1, 0.2).normalize();
    aim.weight = weight;
    avatar.hand.Right.weight = weight;
    avatar.hand.Right.curl = 0.95;
    avatar.hand.Right.point = 1;
    avatar.lookYaw = 0;
    avatar.lookPitch = -0.15 * reach;

    if (!this.pressed && p >= 0.845) {
      this.pressed = true;
      this.room.powerOn();
      this.onPress && this.onPress();
    }

    // the cold top light follows the character through the dark
    const hl = this.room.heroLight;
    hl.position.set(x + 0.5, 4.0, z + 1.3);
    hl.target.position.set(x, 1.0, z);

    // camera
    const t = this.curveT(p);
    this.camera.position.copy(this.camPos.getPoint(t));
    this.camera.lookAt(this.camLook.getPoint(t));

    if (this.pressed && p > 0.985) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    removeEventListener('scroll', this.readScroll);
    const a = this.avatar;
    a.ik.Right.weight = 0;
    a.aim.Right.weight = 0;
    a.hand.Right.weight = 0;
    a.turnShuffle = 0;
    a.setOverlay(null, 0, 0);
    this.copyEl.style.display = 'none';
    this.onDone();
  }
}
