import * as THREE from 'three';
import { ui } from '../ui.js';

// Bulb: a lightbulb that gained consciousness when the switch was flipped. Floats at your
// shoulder, looks at the camera, blinks, glows brighter while it talks, and narrates the
// story through a speech bubble pinned to it on screen.
export class Bulb {
  constructor(scene, sfx) {
    this.sfx = sfx;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    const glassMat = new THREE.MeshStandardMaterial({
      color: '#fff3dc',
      emissive: '#ffcf8a',
      emissiveIntensity: 1.2,
      roughness: 0.15,
      transparent: true,
      opacity: 0.92,
    });
    this.glassMat = glassMat;
    const body = new THREE.Group();
    this.root.add(body);
    this.body = body;
    // bulb shape: sphere + tapered neck
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), glassMat);
    glass.position.y = 0.04;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.08, 20), glassMat);
    neck.position.y = -0.06;
    body.add(glass, neck);
    const metal = new THREE.MeshStandardMaterial({ color: '#b9bcc4', metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.018, 16), metal);
      ring.position.y = -0.11 - i * 0.022;
      body.add(ring);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: '#333', roughness: 0.5 }));
    tip.position.y = -0.18;
    body.add(tip);
    // face
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#2a1a0a' });
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 10), eyeMat);
      e.position.set(s * 0.038, 0.06, 0.1);
      e.scale.set(1, 1.3, 0.5);
      body.add(e);
      return e;
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 16, Math.PI), eyeMat);
    mouth.position.set(0, 0.025, 0.105);
    mouth.rotation.z = Math.PI;
    body.add(mouth);
    this.mouth = mouth;
    this.light = { intensity: 0 }; // glow comes from the emissive glass + bloom, no real light

    this.pos = new THREE.Vector3();
    this.queue = [];
    this.current = null;
    this.blinkT = 2;
    this.time = 0;
    this.bubble = ui.$('bubble');
    this.text = ui.$('bubble-text');
    this.bubble.addEventListener('click', () => this.skip());
    this.appear = 0;
  }

  spawn(at) {
    this.root.visible = true;
    this.pos.copy(at);
    this.root.position.copy(at);
    this.appear = 0.001;
  }

  // now: interrupt whatever Bulb is rambling about (story beats shouldn't wait in line)
  say(lines, { now = false } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
    if (now) {
      this.queue = [...arr];
      this.next();
      return;
    }
    arr.forEach((l) => this.queue.push(l));
    if (!this.current) this.next();
  }

  next() {
    const line = this.queue.shift();
    if (!line) {
      this.current = null;
      this.bubble.hidden = true;
      return;
    }
    this.current = { line, shown: 0, hold: 2.4 + line.length * 0.045 };
    this.text.textContent = '';
    this.bubble.hidden = false;
    this.bubble.style.animation = 'none';
    void this.bubble.offsetWidth;
    this.bubble.style.animation = '';
  }

  skip() {
    const c = this.current;
    if (!c) return;
    if (c.shown < c.line.length) c.shown = c.line.length;
    else this.next();
  }

  get talking() {
    return !!this.current && this.current.shown < this.current.line.length;
  }

  update(dt, player, camera) {
    if (!this.root.visible) return;
    this.time += dt;
    this.appear = Math.min(1, this.appear + dt * 1.5);
    // float beside the player's shoulder, on the camera's side
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const target = player.pos.clone().addScaledVector(camRight, 0.78).add(new THREE.Vector3(0, 1.95 + Math.sin(this.time * 2) * 0.05, 0));
    this.pos.lerp(target, 1 - Math.exp(-3 * dt));
    this.root.position.copy(this.pos);
    const s = this.appear < 1 ? 1 - Math.pow(1 - this.appear, 3) * Math.cos(this.appear * 9) : 1;
    this.root.scale.setScalar(Math.max(0.01, s));
    // face the camera
    const look = camera.position.clone();
    look.y = this.pos.y;
    this.root.lookAt(look);
    this.body.rotation.z = Math.sin(this.time * 1.3) * 0.12;

    // blink
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    this.eyes.forEach((e) => (e.scale.y = 1.3 * blink));

    // talking: typewriter + glow + mouth
    const c = this.current;
    if (c) {
      if (c.shown < c.line.length) {
        const before = Math.floor(c.shown);
        c.shown = Math.min(c.line.length, c.shown + dt * 42);
        const after = Math.floor(c.shown);
        this.text.textContent = c.line.slice(0, after);
        if (after !== before && after % 3 === 0) this.sfx.event('talk');
      } else if ((c.hold -= dt) <= 0) this.next();
    }
    const talk = this.talking ? 0.5 + 0.5 * Math.sin(this.time * 22) : 0;
    this.mouth.scale.set(1, 0.6 + talk * 1.2, 1);
    this.glassMat.emissiveIntensity = 1.1 + talk * 0.8;
    this.light.intensity = 0.6 + talk * 0.6;

    // pin the bubble to Bulb on screen
    if (!this.bubble.hidden) {
      const p = this.pos.clone().add(new THREE.Vector3(0, 0.12, 0)).project(camera);
      const w = innerWidth;
      const h = innerHeight;
      const bw = this.bubble.offsetWidth;
      const bh = this.bubble.offsetHeight;
      let x = (p.x * 0.5 + 0.5) * w + 22;
      let y = (-p.y * 0.5 + 0.5) * h - bh - 8;
      if (p.z > 1 || x > w - bw - 12 || x < -bw) x = Math.min(Math.max(12, x), w - bw - 12);
      y = Math.min(Math.max(64, y), h - bh - 110); // below the sound button / toasts
      // keep clear of the quest panel
      const q = document.getElementById('quest').getBoundingClientRect();
      if (x < q.right + 10 && y < q.bottom + 10) x = q.right + 12;
      this.bubble.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}
