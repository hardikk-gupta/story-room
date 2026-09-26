import * as THREE from 'three';
import { Retargeter } from './retarget.js';
import { TwoBoneIK, HandAim } from './ik.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const _wq = new THREE.Quaternion();
// Rotate a bone about a world-space axis (Object3D.rotateOnWorldAxis assumes an unrotated parent).
function rotateWorld(bone, axisW, angle) {
  bone.getWorldQuaternion(_wq).invert();
  bone.rotateOnAxis(axisW.clone().applyQuaternion(_wq).normalize(), angle);
  bone.updateMatrixWorld(true);
}
const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

// The player character: the Avaturn model + retargeted Mixamo locomotion + procedural layers
// (arm IK for reaching, hand aiming, finger poses, head look, lean).
export class Avatar {
  constructor(gltf, sources) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);

    this.bones = new Map();
    this.model.traverse((o) => {
      if (o.isBone) this.bones.set(o.name, o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const m = o.material;
        if (m && m.map) m.map.anisotropy = 4;
      }
    });

    // --- rest-pose measurements (model is still at the origin, in T-pose) ---
    this.model.updateMatrixWorld(true);
    const wp = (n) => this.bones.get(n).getWorldPosition(new THREE.Vector3());
    this.height = wp('Head').y + 0.12;
    this.shoulderY = wp('RightArm').y;
    this.handLen = wp('RightHandMiddle1').distanceTo(wp('RightHand')) + 0.09;
    this.restFingers = new Map();
    for (const side of ['Left', 'Right']) {
      const palm = new THREE.Vector3(0, -1, 0); // T-pose: palms face down
      for (const f of FINGERS) {
        for (let i = 1; i <= 3; i++) {
          const b = this.bones.get(`${side}Hand${f}${i}`);
          if (!b) continue;
          const next = this.bones.get(`${side}Hand${f}${i + 1}`) || null;
          const from = b.getWorldPosition(new THREE.Vector3());
          const to = next ? next.getWorldPosition(new THREE.Vector3()) : from.clone().add(from.clone().sub(b.parent.getWorldPosition(new THREE.Vector3())));
          const dir = to.sub(from).normalize();
          const n = f === 'Thumb' ? new THREE.Vector3(0, -1, side === 'Left' ? -0.6 : -0.6).normalize() : palm;
          const axisW = new THREE.Vector3().crossVectors(dir, n).normalize();
          const restW = b.getWorldQuaternion(new THREE.Quaternion());
          this.restFingers.set(b.name, {
            bone: b,
            rest: b.quaternion.clone(),
            axis: axisW.applyQuaternion(restW.invert()),
            finger: f,
            side,
          });
        }
      }
    }

    // --- IK chains. Poles: elbows point down and slightly back. ---
    const b = (n) => this.bones.get(n);
    this.ik = {
      Right: new TwoBoneIK(b('RightArm'), b('RightForeArm'), b('RightHand'), new THREE.Vector3(0, -1, -0.4)),
      Left: new TwoBoneIK(b('LeftArm'), b('LeftForeArm'), b('LeftHand'), new THREE.Vector3(0, -1, -0.4)),
    };
    const handRest = (side) => {
      const fwd = wp(`${side}HandMiddle1`).sub(wp(`${side}Hand`)).normalize();
      return new HandAim(b(`${side}Hand`), fwd, new THREE.Vector3(0, 1, 0));
    };
    this.aim = { Right: handRest('Right'), Left: handRest('Left') };
    // finger pose weights: curl = fist amount, point = keep index straight
    this.hand = {
      Right: { weight: 0, curl: 0.2, point: 0 },
      Left: { weight: 0, curl: 0.2, point: 0 },
    };

    // --- animation clips ---
    // sources: { name: { root, clip, rest? } } on the Mixamo rig; baked onto this skeleton once.
    const rt = new Retargeter(this.model);
    this.clips = {};
    for (const [k, s] of Object.entries(sources)) {
      if (!s || !s.clip) continue;
      this.clips[k] = rt.retarget(s.root, s.clip, { restClip: s.rest || null, name: k });
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      a.timeScale = 0; // every clip's time is driven explicitly (foot sync, scroll scrubbing)
      this.actions[k] = a;
    }
    // Stride = metres per loop. In-place exports carry no travel, so fall back to typical values.
    const stride = (k, fallbackSpeed) => {
      const c = this.clips[k];
      if (!c) return 1;
      return c.userData.stride > 0.3 ? c.userData.stride : fallbackSpeed * c.duration;
    };
    this.walkStride = stride('walk', 1.5);
    this.runStride = stride('run', 4.2);
    this.backStride = stride('walkBack', 1.1);
    this.walkSpeed = this.walkStride / this.clips.walk.duration;
    this.runSpeed = this.runStride / this.clips.run.duration;
    this.phase = 0;
    this.idleTime = 0;
    this.overlay = { name: null, time: 0, weight: 0 };
    this.measureClips();

    this.speed = 0;
    this.backpedal = 0; // 0..1: walking backwards while facing forward
    this.lean = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.lookYaw = 0; // desired, relative to body
    this.lookPitch = 0;
    this.turnShuffle = 0; // 0..1 extra step blend while turning in place
  }

  // Find the key moments inside one-off clips by sampling them on this skeleton.
  measureClips() {
    const hips = this.bones.get('Hips');
    const hand = this.bones.get('RightHand');
    const sample = (name, fn) => {
      const a = this.actions[name];
      if (!a) return;
      for (const other of Object.values(this.actions)) other.setEffectiveWeight(0);
      a.setEffectiveWeight(1);
      const n = 60;
      for (let i = 0; i <= n; i++) {
        a.time = (i / n) * this.clips[name].duration;
        this.mixer.update(0);
        this.model.updateMatrixWorld(true);
        fn(a.time, i === n);
      }
      a.setEffectiveWeight(0);
    };
    // Button push: the moment the right hand is furthest forward.
    let best = -Infinity;
    this.pushTime = 0;
    sample('push', (t) => {
      const h = hand.getWorldPosition(new THREE.Vector3());
      const c = hips.getWorldPosition(new THREE.Vector3());
      if (h.z - c.z > best) {
        best = h.z - c.z;
        this.pushTime = t;
      }
    });
    // Turn: which way the hips face at the end of the clip.
    this.turnEndYaw = Math.PI;
    sample('turn', (t, last) => {
      if (!last) return;
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
      this.turnEndYaw = Math.atan2(f.x, f.z);
    });
    // Reset every action's time so the mixer's first real update starts from frame 0.
    for (const a of Object.values(this.actions)) a.time = 0;
    this.actions.idle.setEffectiveWeight(1);
  }

  // Play a one-off clip at an explicit time with a weight (0 = locomotion only).
  setOverlay(name, time, weight) {
    const o = this.overlay;
    if (o.name && o.name !== name && this.actions[o.name]) this.actions[o.name].setEffectiveWeight(0);
    o.name = this.actions[name] ? name : null;
    o.time = time;
    o.weight = o.name ? weight : 0;
  }

  // v: current ground speed (m/s). turnRate: body yaw change per second (for lean).
  locomotion(v, turnRate, dt) {
    this.speed = v;
    const { walkSpeed, runSpeed } = this;
    let wIdle = 0;
    let wWalk = 0;
    let wRun = 0;
    if (v < walkSpeed) {
      const k = v / walkSpeed;
      wWalk = Math.max(k, this.turnShuffle * 0.6);
      wIdle = 1 - wWalk;
    } else {
      const k = Math.min(1, (v - walkSpeed) / (runSpeed - walkSpeed));
      wRun = k;
      wWalk = 1 - k;
    }
    // backpedal replaces the forward walk
    const back = this.actions.walkBack ? this.backpedal : 0;
    const wBack = wWalk * back;
    wWalk *= 1 - back;

    // stride-locked phase so feet don't slide at any speed
    const stride = back > 0.5 ? this.backStride : THREE.MathUtils.lerp(this.walkStride, this.runStride, wRun);
    const rate = Math.max(v, this.turnShuffle * 0.9) / stride;
    this.phase = (this.phase + rate * dt) % 1;
    this.idleTime += dt;
    this.actions.idle.time = this.idleTime % this.clips.idle.duration;
    this.actions.walk.time = this.phase * this.clips.walk.duration;
    this.actions.run.time = this.phase * this.clips.run.duration;
    if (this.actions.walkBack) this.actions.walkBack.time = this.phase * this.clips.walkBack.duration;

    // one-off overlay takes over the whole body by its weight
    const ow = this.overlay.weight;
    const keep = 1 - ow;
    this.actions.idle.setEffectiveWeight(wIdle * keep);
    this.actions.walk.setEffectiveWeight(wWalk * keep);
    this.actions.run.setEffectiveWeight(wRun * keep);
    if (this.actions.walkBack) this.actions.walkBack.setEffectiveWeight(wBack * keep);
    if (this.overlay.name) {
      const a = this.actions[this.overlay.name];
      a.time = Math.min(this.overlay.time, this.clips[this.overlay.name].duration - 1e-3);
      a.setEffectiveWeight(ow);
    }

    // lean into turns, a touch forward when running
    const targetLean = THREE.MathUtils.clamp(-turnRate * v * 0.035, -0.22, 0.22);
    this.lean = damp(this.lean, targetLean, 6, dt);
    this.forwardLean = damp(this.forwardLean || 0, wRun * 0.06, 4, dt);
  }

  update(dt) {
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);

    const hips = this.bones.get('Hips');
    const spine = this.bones.get('Spine');
    this.root.updateMatrixWorld(true);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    if (this.lean) rotateWorld(hips, this.forwardAxis(), this.lean);
    if (this.forwardLean) rotateWorld(spine, right, this.forwardLean);

    // head look (limited, eased)
    this.headYaw = damp(this.headYaw, THREE.MathUtils.clamp(this.lookYaw, -0.9, 0.9), 5, dt);
    this.headPitch = damp(this.headPitch, THREE.MathUtils.clamp(this.lookPitch, -0.5, 0.4), 5, dt);
    const neck = this.bones.get('Neck');
    const head = this.bones.get('Head');
    const up = new THREE.Vector3(0, 1, 0);
    rotateWorld(neck, up, this.headYaw * 0.4);
    rotateWorld(head, up, this.headYaw * 0.6);
    rotateWorld(head, right, this.headPitch * 0.6);

    this.root.updateMatrixWorld(true);
    for (const side of ['Right', 'Left']) {
      this.ik[side].solve();
      this.aim[side].apply();
      this.fingers(side);
    }
  }

  forwardAxis() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
  }

  fingers(side) {
    const h = this.hand[side];
    if (h.weight <= 0.001) return;
    const q = new THREE.Quaternion();
    for (const f of this.restFingers.values()) {
      if (f.side !== side) continue;
      let c = h.curl;
      if (f.finger === 'Index') c *= 1 - h.point;
      if (f.finger === 'Thumb') c *= 0.5;
      const target = f.rest.clone().multiply(q.setFromAxisAngle(f.axis, c * 1.35));
      f.bone.quaternion.slerp(target, h.weight);
    }
  }

  worldPos(name, v = new THREE.Vector3()) {
    return this.bones.get(name).getWorldPosition(v);
  }
}
