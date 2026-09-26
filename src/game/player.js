import * as THREE from 'three';
import { ROOM } from '../world/room.js';

const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const RADIUS = 0.28;

// Character movement: camera-relative input, eased acceleration, facing that turns toward the
// direction of travel, and circle-vs-box collision against the room furniture.
export class Player {
  constructor(avatar, colliders) {
    this.avatar = avatar;
    this.colliders = colliders;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0; // 0 = facing +Z
    this.turnRate = 0;
    this.walk = 1.45;
    this.runSpeed = 3.9;
    this.auto = null; // autopilot target for scripted moves
    this.backpedal = false;
  }

  place(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.vel.set(0, 0);
    this.sync();
  }

  sync() {
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
  }

  // input: {x, y} in camera space; camYaw: camera yaw (radians).
  update(dt, input, run, camYaw) {
    let wx = 0;
    let wz = 0;
    let speed = run ? this.runSpeed : this.walk;
    let faceYaw = null;
    if (this.auto || !(input.x || input.y)) this.backpedal = false;

    if (this.auto) {
      const dx = this.auto.x - this.pos.x;
      const dz = this.auto.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.04) {
        wx = dx / d;
        wz = dz / d;
        speed = Math.min(this.walk, d * 3.2 + 0.25);
      } else {
        faceYaw = this.auto.yaw;
        if (Math.abs(wrap(faceYaw - this.yaw)) < 0.03 && this.vel.length() < 0.05) {
          const cb = this.auto.done;
          this.auto = null;
          cb && cb();
        }
      }
    } else if (input.x || input.y) {
      // pulling straight back at walking pace = backpedal while still facing forward
      this.backpedal = !run && input.y < -0.3 && Math.abs(input.x) < 0.55;
      // forward is the camera's look direction on the ground plane
      const fx = -Math.sin(camYaw);
      const fz = -Math.cos(camYaw);
      const rx = -fz;
      const rz = fx;
      wx = fx * input.y + rx * input.x;
      wz = fz * input.y + rz * input.x;
      const m = Math.hypot(input.x, input.y);
      speed *= Math.min(1, m) * (this.backpedal ? 0.72 : 1);
      const l = Math.hypot(wx, wz) || 1;
      wx /= l;
      wz /= l;
    }

    // eased acceleration (snappier to start than to stop, like most third-person games)
    const tx = wx * speed;
    const tz = wz * speed;
    const accel = tx || tz ? 9 : 11;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.y = damp(this.vel.y, tz, accel, dt);

    if (!this.pinned) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.y * dt;
      this.collide();
      const fy = this.floor ? this.floor(this.pos.x, this.pos.z) : 0;
      this.pos.y += (fy - this.pos.y) * (1 - Math.exp(-14 * dt));
    }

    const v = this.vel.length();
    const prevYaw = this.yaw;
    if (this.backpedal) faceYaw = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
    else if (v > 0.12 && faceYaw === null) faceYaw = Math.atan2(this.vel.x, this.vel.y);
    this.avatar.backpedal = damp(this.avatar.backpedal, this.backpedal ? 1 : 0, 8, dt);
    if (faceYaw !== null) {
      const diff = wrap(faceYaw - this.yaw);
      this.yaw = wrap(this.yaw + diff * (1 - Math.exp(-(this.auto ? 8 : 12) * dt)));
    }
    this.turnRate = damp(this.turnRate, wrap(this.yaw - prevYaw) / Math.max(dt, 1e-4), 10, dt);
    this.sync();
    this.avatar.locomotion(v, this.turnRate, dt);
    this.avatar.turnShuffle = faceYaw !== null && v < 0.2 ? Math.min(1, Math.abs(this.turnRate) * 0.6) : 0;
  }

  collide() {
    const p = this.pos;
    const hx = ROOM.w / 2 - RADIUS - 0.05;
    const hz = ROOM.d / 2 - RADIUS - 0.05;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.colliders) {
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        let dx = p.x - cx;
        let dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 < 1e-8) {
          // centre inside the box: push out along the shallowest side
          const l = p.x - b.minX;
          const r = b.maxX - p.x;
          const f = p.z - b.minZ;
          const k = b.maxZ - p.z;
          const m = Math.min(l, r, f, k);
          if (m === l) p.x = b.minX - RADIUS;
          else if (m === r) p.x = b.maxX + RADIUS;
          else if (m === f) p.z = b.minZ - RADIUS;
          else p.z = b.maxZ + RADIUS;
          continue;
        }
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        p.x = cx + dx * RADIUS;
        p.z = cz + dz * RADIUS;
        // kill velocity into the surface so we slide along it
        const vn = this.vel.x * dx + this.vel.y * dz;
        if (vn < 0) {
          this.vel.x -= vn * dx;
          this.vel.y -= vn * dz;
        }
      }
      p.x = Math.max(-hx, Math.min(hx, p.x));
      p.z = Math.max(-hz, Math.min(hz, p.z));
    }
  }
}

// Third-person camera: over-the-shoulder spring arm with raw (unsmoothed) mouse look for
// responsiveness and a damped follow for smoothness. The arm shortens when a wall is behind.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; // camera looks toward -Z at yaw 0
    this.pitch = -0.12;
    this.dist = 2.7;
    this.shoulder = 0.42;
    this.height = 1.62;
    this.sens = 0.0023;
    this.pos = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.zoom = 1; // 0..1 multiplier, used when inspecting
    this.inited = false;
  }

  addLook(dx, dy) {
    this.yaw -= dx * this.sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.sens, -1.0, 0.55);
  }

  desired(target, out = new THREE.Vector3(), look = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.pivot.set(target.x, target.y + this.height, target.z).addScaledVector(right, this.shoulder * this.zoom);
    let dist = this.dist * THREE.MathUtils.lerp(0.55, 1, this.zoom);
    // shorten the arm if it would leave the room
    const hx = ROOM.w / 2 - 0.2;
    const hz = ROOM.d / 2 - 0.2;
    const lim = (p, d, h) => (d > 1e-5 ? (h - p) / d : d < -1e-5 ? (-h - p) / d : Infinity);
    dist = Math.min(dist, lim(pivot.x, back.x, hx), lim(pivot.z, back.z, hz), back.y > 0 ? (ROOM.h - 0.2 - pivot.y) / back.y : back.y < 0 ? (0.25 - pivot.y) / back.y : Infinity);
    dist = Math.max(0.5, dist);
    out.copy(pivot).addScaledVector(back, dist);
    look.copy(pivot).addScaledVector(back, -4);
    return out;
  }

  update(dt, target) {
    const des = this.desired(target, new THREE.Vector3(), this.lookAt);
    if (!this.inited) {
      this.pos.copy(des);
      this.inited = true;
    }
    const k = 1 - Math.exp(-14 * dt);
    this.pos.lerp(des, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.lookAt);
  }

  // Match yaw/pitch to an existing camera pose so the handover from the intro is seamless.
  syncFrom(camera, target) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = THREE.MathUtils.clamp(Math.asin(dir.y), -1.0, 0.55);
    this.pos.copy(camera.position);
    this.inited = true;
  }
}
