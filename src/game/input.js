// Unified input: keyboard + pointer-lock mouse/trackpad on desktop, joystick + look-drag on touch.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 }; // x: strafe right, y: forward. Length ≤ 1.
    this.look = { x: 0, y: 0 }; // accumulated pixels since last read
    this.run = false;
    this.runToggle = false;
    this.enabled = false;
    this.locked = false;
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.handlers = { action: [], anyKey: [], lock: [], cancel: [], release: [] };
    this.actionHeld = false;
    this.joy = { id: null, x: 0, y: 0 };

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());

    // Mouse / trackpad look. Pointer lock gives FPS-style unlimited look; drag works as a fallback.
    canvas.addEventListener('click', () => this.enabled && !this.touch && this.requestLock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.handlers.lock.forEach((f) => f(this.locked));
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      } else if (this.dragging) {
        this.look.x += e.movementX * 1.4;
        this.look.y += e.movementY * 1.4;
      }
    });
    canvas.addEventListener('mousedown', () => (this.dragging = true));
    addEventListener('mouseup', () => (this.dragging = false));

    if (this.touch) this.initTouch();
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      /* drag-to-look fallback */
    }
  }

  on(evt, fn) {
    this.handlers[evt].push(fn);
  }

  onKey(e, down) {
    const k = e.code;
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE'];
    // typing into a form field (e.g. none today, but future-proof) shouldn't drive the game
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (down) {
      this.handlers.anyKey.forEach((f) => f(k, e));
      if ((k === 'Space' || k === 'KeyE' || k === 'Enter') && !e.repeat) {
        this.actionHeld = true;
        this.handlers.action.forEach((f) => f());
      }
      if ((k === 'Escape' || k === 'KeyQ') && !e.repeat) this.handlers.cancel.forEach((f) => f());
    } else if (k === 'Space' || k === 'KeyE' || k === 'Enter') {
      this.actionHeld = false;
      this.handlers.release.forEach((f) => f());
    }
    if (!this.enabled) return;
    if (gameKeys.includes(k)) e.preventDefault();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  initTouch() {
    document.body.classList.add('touch');
    const joy = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    const R = 50;
    const setKnob = (x, y) => (knob.style.transform = `translate(${x}px, ${y}px)`);
    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.joy.id = t.identifier;
      const r = joy.getBoundingClientRect();
      this.joy.cx = r.left + r.width / 2;
      this.joy.cy = r.top + r.height / 2;
      this.updateJoy(t, R, setKnob);
      tryFullscreen();
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) this.updateJoy(t, R, setKnob);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null;
          this.joy.x = this.joy.y = 0;
          setKnob(0, 0);
        }
      }
    };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);

    const zone = document.getElementById('look-zone');
    const last = new Map();
    zone.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) last.set(t.identifier, [t.clientX, t.clientY]);
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const p = last.get(t.identifier);
        if (!p) continue;
        this.look.x += (t.clientX - p[0]) * 2.2;
        this.look.y += (t.clientY - p[1]) * 2.2;
        last.set(t.identifier, [t.clientX, t.clientY]);
      }
    }, { passive: false });
    const zend = (e) => {
      for (const t of e.changedTouches) last.delete(t.identifier);
    };
    zone.addEventListener('touchend', zend);
    zone.addEventListener('touchcancel', zend);

    const runBtn = document.getElementById('btn-run');
    runBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.runToggle = !this.runToggle;
      runBtn.setAttribute('aria-pressed', String(this.runToggle));
    }, { passive: false });
    const act = document.getElementById('btn-action');
    act.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.actionHeld = true;
      this.handlers.action.forEach((f) => f());
    }, { passive: false });
    const rel = (e) => {
      e.preventDefault();
      this.actionHeld = false;
      this.handlers.release.forEach((f) => f());
    };
    act.addEventListener('touchend', rel, { passive: false });
    act.addEventListener('touchcancel', rel, { passive: false });
  }

  updateJoy(t, R, setKnob) {
    let dx = t.clientX - this.joy.cx;
    let dy = t.clientY - this.joy.cy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob(dx, dy);
    this.joy.x = dx / R;
    this.joy.y = -dy / R;
  }

  // Called once per frame.
  poll() {
    let x = 0;
    let y = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('ArrowUp') || k.has('KeyW')) y += 1;
      if (k.has('ArrowDown') || k.has('KeyS')) y -= 1;
      if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
      if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
      if (this.joy.id !== null) {
        x = this.joy.x;
        y = this.joy.y;
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
    const joyFar = this.joy.id !== null && Math.hypot(this.joy.x, this.joy.y) > 0.97;
    this.run = this.enabled && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.runToggle || joyFar);
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = this.look.y = 0;
    return l;
  }
}

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
