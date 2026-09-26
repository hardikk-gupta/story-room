// All sound is synthesised with WebAudio: no files to download.
// Browsers only allow audio after a user gesture (click / key / touch), so the context is
// created lazily on the first one. Scrolling with a wheel does not count, which is fine:
// the room is silent until the visitor interacts.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('studio-muted') === '1';
    } catch {
      /* storage unavailable */
    }
    const unlock = () => this.unlock();
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => addEventListener(e, unlock, { passive: true }));
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.startRoomTone();
    if (this.powered) this.startHum();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('studio-muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // slightly pink noise
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = b * 3 + w * 0.3;
    }
    return buf;
  }

  noise({ dur = 0.1, freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.002, when = 0, sweepTo = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, dur = 0.3, gain = 0.1, type = 'sine', when = 0, attack = 0.01, slideTo = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  startRoomTone() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  startHum() {
    if (!this.ctx || this.humGain) return;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
    for (const [f, a] of [[100, 0.5], [200, 0.25], [300, 0.1]]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.humGain);
      o.start();
    }
    this.humGain.gain.setTargetAtTime(0.012, this.ctx.currentTime, 1.2);
  }

  // ---- events ----
  event(name, i = 0) {
    switch (name) {
      case 'switch':
        this.noise({ dur: 0.035, freq: 3200, q: 2, gain: 0.5 });
        this.tone({ freq: 180, dur: 0.06, gain: 0.25, type: 'triangle' });
        this.powered = true;
        break;
      case 'studio':
        // relay clunk + a little ballast buzz
        this.noise({ dur: 0.12, freq: 220 + i * 30, q: 0.8, type: 'lowpass', gain: 0.35 });
        this.tone({ freq: 70 + i * 6, dur: 0.18, gain: 0.18, type: 'sine' });
        this.noise({ dur: 0.25, freq: 2400, q: 8, gain: 0.03, when: 0.03 });
        break;
      case 'hum':
        this.startHum();
        break;
      case 'boot':
        this.tone({ freq: 523.25, dur: 1.4, gain: 0.05, attack: 0.05 });
        this.tone({ freq: 659.25, dur: 1.4, gain: 0.04, attack: 0.05, when: 0.08 });
        this.tone({ freq: 783.99, dur: 1.6, gain: 0.035, attack: 0.05, when: 0.16 });
        break;
      case 'neon':
        for (let k = 0; k < 5; k++) this.noise({ dur: 0.04, freq: 5000, q: 6, gain: 0.05, when: k * 0.09 + Math.random() * 0.05 });
        break;
      case 'step':
        this.noise({ dur: 0.09, freq: 520 + Math.random() * 180, q: 1.2, type: 'lowpass', gain: 0.1 * i });
        break;
      case 'lift':
        this.noise({ dur: 0.45, freq: 600, sweepTo: 2600, q: 1.5, gain: 0.09, attack: 0.15 });
        break;
      case 'open':
        this.tone({ freq: 880, dur: 0.35, gain: 0.03, attack: 0.02 });
        break;
      case 'hang':
        this.noise({ dur: 0.08, freq: 900, q: 1, type: 'lowpass', gain: 0.22 });
        this.tone({ freq: 140, dur: 0.1, gain: 0.1, type: 'triangle' });
        break;
    }
  }
}
