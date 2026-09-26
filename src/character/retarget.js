import * as THREE from 'three';

// Retargets Mixamo-rig animation clips onto the Avaturn avatar.
//
// Both rigs share Mixamo bone names, but their bones' rest orientations differ, so copying
// local rotations would twist the avatar. Instead, for every frame we take each source bone's
// world-space rotation *relative to its T-pose*, apply that same delta to the target bone's
// T-pose, and convert back into the target's local space. Hips translation is scaled by leg
// height. Clips are baked once at load; playback is a normal AnimationMixer.

const stripName = (n) => n.replace(/^mixamorig[:_]?/, '');

function bonesByName(root, strip = false) {
  const map = new Map();
  root.traverse((o) => {
    if (o.isBone) map.set(strip ? stripName(o.name) : o.name, o);
  });
  return map;
}

// Evaluate every track of `clip` at time t and write it onto `root`'s objects.
function applyClipAt(root, clip, t, cache) {
  for (const track of clip.tracks) {
    let entry = cache.get(track);
    if (!entry) {
      const dot = track.name.lastIndexOf('.');
      const obj = root.getObjectByName(track.name.slice(0, dot));
      entry = { obj, prop: track.name.slice(dot + 1), interp: track.createInterpolant() };
      cache.set(track, entry);
    }
    if (!entry.obj) continue;
    const v = entry.interp.evaluate(Math.min(t, clip.duration));
    if (entry.prop === 'quaternion') entry.obj.quaternion.fromArray(v).normalize();
    else if (entry.prop === 'position') entry.obj.position.fromArray(v);
    else if (entry.prop === 'scale') entry.obj.scale.fromArray(v);
  }
}

// Which way is the character's left in its own model space? (+1 = +X like glTF-facing-+Z)
function leftSign(bones) {
  const l = bones.get('LeftHand') || bones.get('LeftArm');
  const r = bones.get('RightHand') || bones.get('RightArm');
  const a = l.getWorldPosition(new THREE.Vector3());
  const b = r.getWorldPosition(new THREE.Vector3());
  return Math.sign(a.x - b.x) || 1;
}

export class Retargeter {
  // targetRoot must be at the origin with identity transform while retargeting.
  constructor(targetRoot) {
    this.target = targetRoot;
    this.tBones = bonesByName(targetRoot);
    targetRoot.updateMatrixWorld(true);
    this.tRestLocal = new Map();
    this.tRestWorld = new Map();
    for (const [name, b] of this.tBones) {
      this.tRestLocal.set(name, b.quaternion.clone());
      this.tRestWorld.set(name, b.getWorldQuaternion(new THREE.Quaternion()));
    }
    const hips = this.tBones.get('Hips');
    this.tHipsRestLocalPos = hips.position.clone();
    this.tHipsRestWorldPos = hips.getWorldPosition(new THREE.Vector3());
    this.tHipsParentInv = hips.parent.matrixWorld.clone().invert();
    this.tLeft = leftSign(this.tBones);
    // depth-first order so parents are solved before children
    this.order = [];
    hips.traverse((o) => o.isBone && this.order.push(o));
  }

  // source: a loaded glTF scene on the Mixamo rig. restClip: optional T-pose clip for it.
  retarget(sourceRoot, clip, { restClip = null, fps = 30, inPlace = true, name = clip.name } = {}) {
    const sBones = bonesByName(sourceRoot, true);
    const cache = new Map();
    sourceRoot.position.set(0, 0, 0);
    sourceRoot.quaternion.identity();

    // Source rest pose.
    const saved = new Map();
    for (const [n, b] of sBones) saved.set(n, [b.position.clone(), b.quaternion.clone()]);
    if (restClip) applyClipAt(sourceRoot, restClip, 0, new Map());
    sourceRoot.updateMatrixWorld(true);
    const sRestWorld = new Map();
    for (const [n, b] of sBones) sRestWorld.set(n, b.getWorldQuaternion(new THREE.Quaternion()));
    const sHips = sBones.get('Hips');
    const sHipsRest = sHips.getWorldPosition(new THREE.Vector3());
    const facing = leftSign(sBones) === this.tLeft ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const facingInv = facing.clone().invert();
    const scale = this.tHipsRestWorldPos.y / Math.max(1e-4, sHipsRest.y);

    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const quatData = new Map();
    for (const b of this.order) quatData.set(b.name, new Float32Array(frames * 4));
    const posData = new Float32Array(frames * 3);

    const world = new Map();
    const q = new THREE.Quaternion();
    const parentQ = new THREE.Quaternion();
    const prev = new Map();
    const sPos = new THREE.Vector3();
    let travel = 0;
    const firstHips = new THREE.Vector3();
    const lastHips = new THREE.Vector3();

    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps);
      times[f] = t;
      applyClipAt(sourceRoot, clip, t, cache);
      sourceRoot.updateMatrixWorld(true);
      world.clear();

      for (const b of this.order) {
        const sb = sBones.get(b.name);
        const pw = world.get(b.parent.name) || b.parent.getWorldQuaternion(parentQ).clone();
        if (sb) {
          // delta = facing * (S_t * S_rest^-1) * facing^-1 ; T_t = delta * T_rest
          const st = sb.getWorldQuaternion(new THREE.Quaternion());
          const delta = facing.clone().multiply(st.multiply(sRestWorld.get(b.name).clone().invert())).multiply(facingInv);
          const tw = delta.multiply(this.tRestWorld.get(b.name));
          world.set(b.name, tw);
          q.copy(pw).invert().multiply(tw);
        } else {
          q.copy(this.tRestLocal.get(b.name));
          world.set(b.name, pw.clone().multiply(q));
        }
        const p = prev.get(b.name);
        if (p && p.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        prev.set(b.name, q.clone());
        q.toArray(quatData.get(b.name), f * 4);
      }

      // hips translation, in target space
      sHips.getWorldPosition(sPos);
      if (f === 0) firstHips.copy(sPos);
      lastHips.copy(sPos);
      const d = sPos.clone().sub(sHipsRest).multiplyScalar(scale).applyQuaternion(facing);
      if (inPlace) d.x = d.z = 0;
      const wp = this.tHipsRestWorldPos.clone().add(d).applyMatrix4(this.tHipsParentInv);
      wp.toArray(posData, f * 3);
    }
    travel = Math.hypot(lastHips.x - firstHips.x, lastHips.z - firstHips.z) * scale;

    // restore the source rig
    for (const [n, b] of sBones) {
      const [p, qq] = saved.get(n);
      b.position.copy(p);
      b.quaternion.copy(qq);
    }

    const tracks = [];
    for (const b of this.order) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quatData.get(b.name)));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, posData));
    const out = new THREE.AnimationClip(name, clip.duration, tracks);
    // metres travelled per loop by the source character: used to lock feet to movement speed
    out.userData = { stride: travel, speed: travel / clip.duration };
    return out;
  }
}
