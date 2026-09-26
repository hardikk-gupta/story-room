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
      case 'spark':
        [0, 4, 7, 12, 16].forEach((n, k) => this.tone({ freq: 523.25 * Math.pow(2, n / 12), dur: 0.5, gain: 0.05, when: k * 0.06, type: 'triangle' }));
        break;
      case 'arrive':
        this.tone({ freq: 1046.5, dur: 0.8, gain: 0.05, type: 'sine' });
        this.tone({ freq: 1568, dur: 0.9, gain: 0.03, type: 'sine', when: 0.05 });
        break;
      case 'secret':
        [0, 3, 7, 10, 14].forEach((n, k) => this.tone({ freq: 392 * Math.pow(2, n / 12), dur: 0.35, gain: 0.045, when: k * 0.07, type: 'square' }));
        break;
      case 'talk':
        this.tone({ freq: 520 + Math.random() * 260, dur: 0.045, gain: 0.018, type: 'square' });
        break;
      case 'pour':
        this.noise({ dur: 0.12, freq: 900 + Math.random() * 400, q: 3, gain: 0.05 });
        break;
      case 'water':
        this.noise({ dur: 0.08, freq: 2500 + Math.random() * 1500, q: 6, gain: 0.04 });
        break;
      case 'curl':
        this.tone({ freq: 140 + i * 6, dur: 0.18, gain: 0.07, type: 'sawtooth', slideTo: 110 });
        break;
      case 'hang':
        this.noise({ dur: 0.08, freq: 900, q: 1, type: 'lowpass', gain: 0.22 });
        this.tone({ freq: 140, dur: 0.1, gain: 0.1, type: 'triangle' });
        break;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Music: a tiny step sequencer that generates three tracks live, plus a formant "robot
// singer" for karaoke. Everything is scheduled ahead on the audio clock so timing is tight.
// ---------------------------------------------------------------------------------------
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const TRACKS = {
  lofi: {
    name: 'lo-fi · 2 AM tapes',
    bpm: 84,
    swing: 0.12,
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    bass: [41, 40, 38, 36],
    kick: [0, 7, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    chordWave: 'triangle',
    cutoff: 1100,
    arp: false,
  },
  synthwave: {
    name: 'synthwave · sunrise drive',
    bpm: 104,
    swing: 0,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    bass: [45, 41, 36, 43],
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    chordWave: 'sawtooth',
    cutoff: 1800,
    arp: true,
  },
  karaoke: {
    name: 'Kerning in the Moonlight (backing)',
    bpm: 96,
    swing: 0,
    chords: [[50, 54, 57], [49, 52, 57], [50, 54, 59], [50, 55, 59]],
    bass: [38, 45, 47, 43],
    kick: [0, 8, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    chordWave: 'triangle',
    cutoff: 1500,
    arp: false,
  },
};

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.track = null;
    this.playing = false;
    this.lastKick = -10;
    this.level = 0;
  }

  get ctx() {
    return this.sfx.ctx;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  // beats elapsed since the current track started
  beat() {
    if (!this.playing) return 0;
    return (this.now() - this.t0) * (this.track.bpm / 60);
  }

  // 0..1 pulse that spikes on each kick drum, for visuals
  pulse() {
    if (!this.playing) return 0;
    return Math.exp(-(this.now() - this.lastKick) * 7);
  }

  play(id, { loop = true, bars = Infinity } = {}) {
    this.sfx.unlock();
    this.stop();
    this.track = TRACKS[id];
    this.trackId = id;
    this.loop = loop;
    this.bars = bars;
    this.playing = true;
    if (!this.ctx) {
      this.t0 = this.now();
      return;
    }
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.55;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.out.connect(this.analyser);
    this.out.connect(this.sfx.master);
    this.t0 = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.nextTime = this.t0;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.out) {
      const o = this.out;
      o.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      setTimeout(() => o.disconnect(), 600);
    }
    this.out = null;
    this.playing = false;
  }

  schedule() {
    const tr = this.track;
    const sixteenth = 60 / tr.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      if (bar >= this.bars) {
        this.stop();
        return;
      }
      const t = this.nextTime + (s % 2 === 1 ? tr.swing * sixteenth : 0);
      const ci = bar % tr.chords.length;
      if (tr.kick.includes(s)) this.kick(t);
      if (tr.snare.includes(s)) this.snare(t);
      if (tr.hat.includes(s)) this.hat(t, s % 4 === 2 ? 0.05 : 0.03);
      if (s === 0) this.pad(tr.chords[ci], t, sixteenth * 16, tr);
      if (s % 4 === 0 || (tr.arp && s % 2 === 0)) this.bass(tr.bass[ci], t, sixteenth * (tr.arp ? 1.8 : 3.5));
      if (tr.arp) this.pluck(tr.chords[ci][s % tr.chords[ci].length] + 12, t, sixteenth * 0.9);
      this.nextTime += sixteenth;
      this.step++;
    }
    // level meter for visuals
    if (this.analyser) {
      const d = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(d);
      let sum = 0;
      for (const v of d) sum += ((v - 128) / 128) ** 2;
      this.level = Math.min(1, Math.sqrt(sum / d.length) * 4);
    }
  }

  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    this.env(g, t, 0.003, 0.9, 0.42);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.45);
    const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
    setTimeout(() => (this.lastKick = this.now()), delay);
  }

  snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.45, 0.2);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.25);
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.frequency.value = 185;
    this.env(og, t, 0.002, 0.25, 0.1);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  hat(t, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7200;
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, gain * 3, 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.07);
  }

  pad(notes, t, dur, tr) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = tr.cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.25);
    g.gain.setValueAtTime(0.09, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g).connect(this.out);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = tr.chordWave;
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  bass(n, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(n);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, 0.32, dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pluck(n, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(n);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, 0.05, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Robot singer: a sawtooth with vibrato through two vowel formants.
  sing(semisFromA3, dur = 0.5, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 220 * Math.pow(2, semisFromA3 / 12);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.6;
    const vibG = this.ctx.createGain();
    vibG.gain.value = 9;
    vib.connect(vibG).connect(o.detune);
    const g = this.ctx.createGain();
    this.env(g, t, 0.04, 0.22, dur);
    const mix = this.ctx.createGain();
    mix.gain.value = 1;
    for (const [fq, q, amp] of [[760, 8, 1], [1180, 10, 0.7], [2600, 12, 0.25]]) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const a = this.ctx.createGain();
      a.gain.value = amp;
      o.connect(bp).connect(a).connect(mix);
    }
    mix.connect(g).connect(this.sfx.master);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  trackName() {
    return this.playing ? this.track.name : '';
  }
}
