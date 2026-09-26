import * as THREE from 'three';

// Analytic two-bone IK (shoulder → elbow → wrist), after Daniel Holden's formulation.
// Works on the animated pose and blends toward the solved pose by `weight`, so arms can
// ease in and out of reaching for things.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const angleBetween = (u, v) => Math.acos(clamp(u.dot(v), -1, 1));

export class TwoBoneIK {
  constructor(upper, lower, end, pole) {
    this.upper = upper;
    this.lower = lower;
    this.end = end;
    this.pole = pole.clone(); // world-space hint for where the elbow should point
    this.weight = 0;
    this.target = new THREE.Vector3();
  }

  solve() {
    if (this.weight <= 0.0001) return;
    const { upper, lower, end } = this;
    const origUpper = upper.quaternion.clone();
    const origLower = lower.quaternion.clone();

    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_a);
    lower.getWorldPosition(_b);
    end.getWorldPosition(_c);
    _t.copy(this.target);

    const lab = _b.distanceTo(_a);
    const lcb = _c.distanceTo(_b);
    const lat = clamp(_t.distanceTo(_a), 0.01, lab + lcb - 0.001);

    const ca = _c.clone().sub(_a).normalize();
    const ba = _b.clone().sub(_a).normalize();
    const ab = _a.clone().sub(_b).normalize();
    const cb = _c.clone().sub(_b).normalize();
    const ta = _t.clone().sub(_a).normalize();

    const ac_ab_0 = angleBetween(ca, ba);
    const ba_bc_0 = angleBetween(ab, cb);
    const ac_at_0 = angleBetween(ca, ta);
    const ac_ab_1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
    const ba_bc_1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));

    // bend plane: prefer current elbow bend, fall back to the pole when the arm is straight
    let axis0 = new THREE.Vector3().crossVectors(ca, ba);
    if (axis0.lengthSq() < 1e-6) axis0.crossVectors(ca, this.pole);
    axis0.normalize();
    const axis1 = new THREE.Vector3().crossVectors(ca, ta);
    if (axis1.lengthSq() < 1e-8) axis1.copy(axis0);
    axis1.normalize();

    const aGr = upper.getWorldQuaternion(new THREE.Quaternion());
    const bGr = lower.getWorldQuaternion(new THREE.Quaternion());
    const aInv = aGr.clone().invert();
    const bInv = bGr.clone().invert();

    const r0 = _qa.setFromAxisAngle(axis0.clone().applyQuaternion(aInv), ac_ab_1 - ac_ab_0);
    const r1 = _qb.setFromAxisAngle(axis0.clone().applyQuaternion(bInv), ba_bc_1 - ba_bc_0);
    const r2 = new THREE.Quaternion().setFromAxisAngle(axis1.clone().applyQuaternion(aInv), ac_at_0);

    upper.quaternion.multiply(r0.clone().multiply(r2));
    lower.quaternion.multiply(r1);

    // swing the elbow around the shoulder→target axis toward the pole
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(_a);
    lower.getWorldPosition(_b);
    const axis = _t.clone().sub(_a).normalize();
    const elbow = _b.clone().sub(_a);
    elbow.sub(axis.clone().multiplyScalar(elbow.dot(axis)));
    const pole = this.pole.clone().sub(axis.clone().multiplyScalar(this.pole.dot(axis)));
    if (elbow.lengthSq() > 1e-6 && pole.lengthSq() > 1e-6) {
      elbow.normalize();
      pole.normalize();
      let ang = angleBetween(elbow, pole);
      if (new THREE.Vector3().crossVectors(elbow, pole).dot(axis) < 0) ang = -ang;
      const swingW = _q.setFromAxisAngle(axis, ang);
      // world-space pre-rotation → local: q_local' = parentInv * swing * world
      const parentW = upper.parent.getWorldQuaternion(new THREE.Quaternion());
      const uW = upper.getWorldQuaternion(new THREE.Quaternion());
      upper.quaternion.copy(parentW.invert().multiply(swingW.clone().multiply(uW)));
    }

    if (this.weight < 0.999) {
      upper.quaternion.copy(origUpper.slerp(upper.quaternion, this.weight));
      lower.quaternion.copy(origLower.slerp(lower.quaternion, this.weight));
    }
    upper.updateWorldMatrix(false, true);
  }
}

// Orient a hand in world space from a "fingers point" direction and a "back of hand" direction,
// given the same two directions measured in the rest pose.
export class HandAim {
  constructor(hand, restFwd, restBack) {
    this.hand = hand;
    this.weight = 0;
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.back = new THREE.Vector3(0, 1, 0);
    this.restWorld = hand.getWorldQuaternion(new THREE.Quaternion());
    this.restBasisInv = basis(restFwd, restBack).invert();
  }

  apply() {
    if (this.weight <= 0.0001) return;
    const hand = this.hand;
    const desired = basis(this.fwd, this.back).multiply(this.restBasisInv).multiply(this.restWorld);
    const parentW = hand.parent.getWorldQuaternion(new THREE.Quaternion());
    const local = parentW.invert().multiply(desired);
    hand.quaternion.slerp(local, this.weight);
  }
}

function basis(fwd, back) {
  const z = fwd.clone().normalize();
  const x = new THREE.Vector3().crossVectors(back, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
