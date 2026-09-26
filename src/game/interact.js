import * as THREE from 'three';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Pick-up-and-inspect for the gallery frames.
//   aim at a frame nearby → Space → walk up to it → both hands reach for the edges →
//   lift it off the hook and bring it in front of the chest → the artwork opens full screen.
//   Space again → overlay closes → frame goes back on its hook → hands let go.
export class Interactor {
  constructor({ avatar, player, followCam, camera, room, input }) {
    Object.assign(this, { avatar, player, followCam, camera, room, input });
    this.state = 'free';
    this.focus = null;
    this.active = null;
    this.t = 0;
    this.els = {
      prompt: document.getElementById('prompt'),
      crosshair: document.getElementById('crosshair'),
      overlay: document.getElementById('inspect'),
      img: document.getElementById('inspect-img'),
      title: document.getElementById('inspect-title'),
      desc: document.getElementById('inspect-desc'),
      action: document.getElementById('btn-action'),
    };
    this.els.overlay.addEventListener('click', () => this.state === 'inspect' && this.putBack());
  }

  get busy() {
    return this.state !== 'free';
  }

  action() {
    if (this.state === 'free' && this.focus) this.pickUp(this.focus);
    else if (this.state === 'inspect') this.putBack();
  }

  findFocus() {
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    let best = null;
    let bestScore = Infinity;
    for (const f of this.room.frames) {
      const dx = f.wallPos.x - this.player.pos.x;
      const dz = f.wallPos.z - this.player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.4) continue;
      const toFrame = new THREE.Vector3(f.wallPos.x - this.camera.position.x, 0, f.wallPos.z - this.camera.position.z).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(toFrame.dot(camDir), -1, 1));
      if (ang > 0.5) continue;
      const score = ang * 2 + d * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  pickUp(frame) {
    this.active = frame;
    this.state = 'approach';
    this.setFocus(null);
    const n = frame.normal;
    const stand = frame.wallPos.clone().addScaledVector(n, 0.6);
    const yaw = Math.atan2(-n.x, -n.z);
    this.player.auto = {
      x: stand.x,
      z: stand.z,
      yaw,
      done: () => {
        this.state = 'reach';
        this.t = 0;
      },
    };
  }

  putBack() {
    this.hideOverlay();
    this.state = 'return';
    this.t = 0;
    this.from = { pos: this.active.group.position.clone(), q: this.active.group.quaternion.clone() };
  }

  // Where the frame sits when held: in front of the chest, facing the character.
  holdPose() {
    const a = this.avatar;
    const fwd = a.forwardAxis();
    const pos = this.player.pos.clone().addScaledVector(fwd, 0.44);
    pos.y = a.shoulderY - 0.2;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd.clone().negate());
    // tilt it slightly back toward the face
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18));
    return { pos, q };
  }

  // Hand targets: gripping the left/right edges of the frame at its current transform.
  gripHands(weight) {
    const f = this.active;
    const g = f.group;
    const a = this.avatar;
    const half = f.size[0] / 2;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion); // frame's local +X in world
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion); // frame front
    // Character's right hand grips the edge on the character's right. The frame faces the
    // character, so the character's right is the frame's local -X.
    const charRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.avatar.root.quaternion).negate();
    const sign = right.dot(charRight) > 0 ? 1 : -1;
    for (const side of ['Right', 'Left']) {
      const s = side === 'Right' ? sign : -sign;
      const edge = g.position.clone().addScaledVector(right, s * (half + 0.015)).addScaledVector(up, -0.05).addScaledVector(out, 0.0);
      const fingers = out.clone().negate().addScaledVector(right, -s * 0.6).normalize();
      const backOfHand = right.clone().multiplyScalar(s);
      const wrist = edge.clone().addScaledVector(fingers, -a.handLen * 0.75);
      a.ik[side].target.copy(wrist);
      a.ik[side].weight = weight;
      a.aim[side].fwd.copy(fingers);
      a.aim[side].back.copy(backOfHand);
      a.aim[side].weight = weight;
      a.hand[side].weight = weight;
      a.hand[side].curl = 0.55;
      a.hand[side].point = 0;
    }
  }

  showOverlay() {
    const { overlay, img, title, desc } = this.els;
    const p = this.active.project;
    img.src = this.active.coverUrl;
    img.alt = p.title;
    title.textContent = p.title;
    desc.textContent = p.desc;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
    this.sfx && this.sfx.event('open');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hideOverlay() {
    const { overlay } = this.els;
    overlay.classList.remove('open');
    setTimeout(() => {
      if (!overlay.classList.contains('open')) overlay.hidden = true;
    }, 450);
  }

  setFocus(f) {
    if (this.focus === f) return;
    this.focus = f;
    this.els.prompt.hidden = !f;
    this.els.crosshair.classList.toggle('active', !!f);
  }

  update(dt) {
    const { els } = this;
    // "Holding Idle" clip under the IK while the frame is off the wall
    const holding = ['lift', 'inspect', 'return'].includes(this.state);
    this.holdW = (this.holdW || 0) + ((holding ? 1 : 0) - (this.holdW || 0)) * (1 - Math.exp(-6 * dt));
    this.holdT = (this.holdT || 0) + dt;
    if (this.holdW > 0.005) this.avatar.setOverlay('hold', this.holdT % (this.avatar.clips.hold?.duration || 1), this.holdW);
    else if (this.avatar.overlay.name === 'hold') this.avatar.setOverlay(null, 0, 0);
    // highlight: a soft warm edge and a small lift off the wall on the focused frame
    for (const f of this.room.frames) {
      const on = f === this.focus ? 1 : 0;
      const k = 1 - Math.exp(-8 * dt);
      f.hl = (f.hl || 0) + (on - (f.hl || 0)) * k;
      f.frameMat.emissiveIntensity = f.hl * 0.14;
      if (f !== this.active) f.group.position.copy(f.wallPos).addScaledVector(f.normal, f.hl * 0.025);
    }

    if (this.state === 'free') {
      this.setFocus(this.findFocus());
      els.action.disabled = !this.focus;
      els.action.textContent = 'Grab';
      return;
    }
    els.action.disabled = this.state !== 'inspect';
    els.action.textContent = 'Put back';

    const f = this.active;
    this.t += dt;
    const g = f.group;

    if (this.state === 'reach') {
      const k = ease(clamp01(this.t / 0.5));
      this.gripHands(k);
      this.avatar.lookPitch = 0.05;
      if (this.t >= 0.5) {
        this.state = 'lift';
        this.t = 0;
        this.sfx && this.sfx.event('lift');
        this.from = { pos: g.position.clone(), q: g.quaternion.clone() };
      }
    } else if (this.state === 'lift') {
      const k = ease(clamp01(this.t / 0.8));
      const to = this.holdPose();
      // lift up off the hook first, then swing toward the chest
      g.position.lerpVectors(this.from.pos, to.pos, k);
      g.position.y += Math.sin(k * Math.PI) * 0.1;
      g.position.addScaledVector(f.normal, Math.sin(Math.min(1, k * 2) * Math.PI) * 0.06);
      g.quaternion.slerpQuaternions(this.from.q, to.q, k);
      this.gripHands(1);
      this.avatar.lookPitch = -0.35 * k;
      this.followCam.zoom = 1 - 0.35 * k;
      if (this.t >= 0.8) {
        this.state = 'inspect';
        this.t = 0;
        this.showOverlay();
      }
    } else if (this.state === 'inspect') {
      const to = this.holdPose();
      g.position.copy(to.pos);
      g.position.y += Math.sin(this.t * 1.6) * 0.006; // breathing
      g.quaternion.copy(to.q);
      this.gripHands(1);
    } else if (this.state === 'return') {
      const k = ease(clamp01(this.t / 0.8));
      g.position.lerpVectors(this.from.pos, f.wallPos, k);
      g.position.y += Math.sin(k * Math.PI) * 0.1;
      g.position.addScaledVector(f.normal, Math.sin(Math.max(0, k * 2 - 1) * Math.PI) * 0.06);
      g.quaternion.slerpQuaternions(this.from.q, f.wallQuat, k);
      this.gripHands(1);
      this.avatar.lookPitch = -0.35 * (1 - k);
      this.followCam.zoom = 0.65 + 0.35 * k;
      if (this.t >= 0.8) {
        g.position.copy(f.wallPos);
        g.quaternion.copy(f.wallQuat);
        this.state = 'release';
        this.t = 0;
        this.sfx && this.sfx.event('hang');
      }
    } else if (this.state === 'release') {
      const k = 1 - ease(clamp01(this.t / 0.4));
      this.gripHands(k);
      if (this.t >= 0.4) {
        this.gripHands(0);
        this.followCam.zoom = 1;
        this.avatar.lookPitch = 0;
        this.state = 'free';
        this.active = null;
      }
    }
  }
}
