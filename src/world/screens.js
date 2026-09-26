import * as THREE from 'three';
import { profile, projects } from '../content.js';

// A monitor/laptop display backed by a canvas. Off → boot (logo + progress) → live desktop.
// Redraws are throttled because canvas uploads are the expensive part.
export class Screen {
  constructor({ w = 1024, h = 576, variant = 0, bootDelay = 0 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.variant = variant;
    this.bootDelay = bootDelay;
    this.state = 'off';
    this.t = 0;
    this.acc = 1;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.material.color.setScalar(0);
    this.drawOff();
  }

  powerOn() {
    if (this.state !== 'off') return;
    this.state = 'wait';
    this.t = 0;
  }

  update(dt) {
    if (this.state === 'off') return;
    this.t += dt;
    if (this.state === 'wait') {
      if (this.t < this.bootDelay) return;
      this.state = 'boot';
      this.t = 0;
    }
    // brightness ramps like a panel backlight warming up
    const target = this.state === 'boot' ? Math.min(1, this.t * 3) : 1;
    this.material.color.setScalar(target * 1.15);

    this.acc += dt;
    const fps = this.state === 'boot' ? 30 : 8;
    if (this.acc < 1 / fps) return;
    this.acc = 0;
    if (this.state === 'boot') {
      this.drawBoot(this.t);
      if (this.t > 2.6) {
        this.state = 'desktop';
        this.t = 0;
      }
    } else {
      this.drawDesktop(this.t);
    }
    this.texture.needsUpdate = true;
  }

  drawOff() {
    const { g, canvas: c } = this;
    g.fillStyle = '#050506';
    g.fillRect(0, 0, c.width, c.height);
    this.texture.needsUpdate = true;
  }

  drawBoot(t) {
    const { g, canvas: c } = this;
    const W = c.width;
    const H = c.height;
    g.fillStyle = '#060608';
    g.fillRect(0, 0, W, H);
    if (t < 0.25) return;
    const a = Math.min(1, (t - 0.25) * 3);
    g.globalAlpha = a;
    // logo: two offset rounded squares
    const s = H * 0.12;
    g.fillStyle = '#ffb46b';
    roundRect(g, W / 2 - s * 0.7, H * 0.4 - s * 0.7, s, s, s * 0.25);
    g.fill();
    g.fillStyle = '#f4f1ea';
    roundRect(g, W / 2 - s * 0.3, H * 0.4 - s * 0.3, s, s, s * 0.25);
    g.fill();
    // progress bar
    const p = Math.min(1, Math.max(0, (t - 0.5) / 1.9));
    const eased = 1 - Math.pow(1 - p, 2.2);
    const bw = W * 0.28;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, W / 2 - bw / 2, H * 0.66, bw, 6, 3);
    g.fill();
    g.fillStyle = '#f4f1ea';
    roundRect(g, W / 2 - bw / 2, H * 0.66, bw * eased, 6, 3);
    g.fill();
    g.globalAlpha = 1;
  }

  drawDesktop(t) {
    const { g, canvas: c } = this;
    const W = c.width;
    const H = c.height;
    const v = this.variant;
    const grad = g.createLinearGradient(0, 0, W, H);
    const pal = [
      ['#1a1033', '#ff7a45'],
      ['#0d1b2a', '#3fa7d6'],
      ['#1b1b1b', '#a7c957'],
      ['#231419', '#f72585'],
    ][v % 4];
    grad.addColorStop(0, pal[0]);
    grad.addColorStop(1, shade(pal[1], 0.35));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // soft animated blob wallpaper
    const bx = W * (0.65 + Math.sin(t * 0.4 + v) * 0.08);
    const by = H * (0.45 + Math.cos(t * 0.3 + v) * 0.1);
    const blob = g.createRadialGradient(bx, by, 10, bx, by, H * 0.7);
    blob.addColorStop(0, `${pal[1]}cc`);
    blob.addColorStop(1, `${pal[1]}00`);
    g.fillStyle = blob;
    g.fillRect(0, 0, W, H);

    // menu bar
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, 26);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '600 15px Inter, sans-serif';
    g.fillText(profile.name, 14, 18);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    g.textAlign = 'right';
    g.fillText(`${hh}:${mm}`, W - 14, 18);
    g.textAlign = 'left';

    if (v === 0) {
      // design tool: canvas + layers panel + an artboard
      panel(g, 0, 26, 170, H - 26);
      for (let i = 0; i < 9; i++) {
        g.fillStyle = i === 2 ? 'rgba(255,180,107,0.35)' : 'rgba(255,255,255,0.08)';
        roundRect(g, 12, 44 + i * 30, 146, 22, 5);
        g.fill();
      }
      const p = projects[Math.floor(t / 4) % projects.length];
      g.fillStyle = p.palette[2];
      roundRect(g, 220, 70, W - 290, H - 120, 10);
      g.fill();
      g.fillStyle = p.palette[0];
      g.beginPath();
      g.arc(220 + (W - 290) * 0.7, 70 + (H - 120) * 0.45, 90 + Math.sin(t * 1.3) * 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.palette[1];
      g.font = '700 54px "Space Grotesk", Inter, sans-serif';
      g.fillText(p.title, 250, H - 110);
      // cursor
      const cx = 420 + Math.sin(t * 0.9) * 180;
      const cy = 260 + Math.cos(t * 1.2) * 90;
      cursor(g, cx, cy);
    } else if (v === 1) {
      // code editor
      panel(g, 0, 26, W, H - 26, 'rgba(10,12,20,0.78)');
      const lines = Math.floor(t * 6) % 40;
      const r = seeded(9);
      g.font = '15px ui-monospace, Menlo, monospace';
      for (let i = 0; i < Math.min(lines, 24); i++) {
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillText(String(i + 1).padStart(2, ' '), 14, 56 + i * 21);
        let x = 52 + (i % 5 === 0 ? 0 : 24) + (i % 7 === 3 ? 24 : 0);
        const tokens = 2 + Math.floor(r() * 5);
        for (let k = 0; k < tokens; k++) {
          const w = 24 + r() * 90;
          g.fillStyle = ['#ff9e64', '#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68'][Math.floor(r() * 5)];
          roundRect(g, x, 46 + i * 21, w, 11, 3);
          g.fill();
          x += w + 10;
        }
      }
      if (Math.floor(t * 2) % 2 === 0) {
        g.fillStyle = '#fff';
        g.fillRect(52, 46 + Math.min(lines, 23) * 21, 8, 14);
      }
    } else if (v === 2) {
      // moodboard grid of project swatches
      const cols = 3;
      const cw = (W - 80) / cols;
      projects.forEach((p, i) => {
        const x = 30 + (i % cols) * (cw + 10);
        const y = 50 + Math.floor(i / cols) * ((H - 80) / 2 + 6);
        const h = (H - 90) / 2;
        const lift = Math.max(0, Math.sin(t * 1.2 - i * 0.7)) * 6;
        g.fillStyle = p.palette[2];
        roundRect(g, x, y - lift, cw, h, 10);
        g.fill();
        g.fillStyle = p.palette[0];
        roundRect(g, x + 14, y + 14 - lift, cw * 0.45, h * 0.5, 8);
        g.fill();
        g.fillStyle = p.palette[1];
        g.font = '600 18px Inter, sans-serif';
        g.fillText(p.title, x + 14, y + h - 18 - lift);
      });
    } else {
      // laptop: big name + tagline + music bars
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.font = '700 64px "Space Grotesk", Inter, sans-serif';
      g.fillText(profile.name, 40, H * 0.52);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = '500 22px Inter, sans-serif';
      g.fillText(profile.desktopTagline, 42, H * 0.52 + 40);
      for (let i = 0; i < 28; i++) {
        const h = 10 + Math.abs(Math.sin(t * 3 + i * 0.6) * Math.cos(t * 1.7 + i)) * 60;
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(40 + i * 12, H - 50 - h, 7, h);
      }
    }
  }
}

function panel(g, x, y, w, h, color = 'rgba(15,15,20,0.6)') {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function cursor(g, x, y) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y + 22);
  g.lineTo(x + 6, y + 16);
  g.lineTo(x + 15, y + 16);
  g.closePath();
  g.fill();
  g.stroke();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}

function seeded(s) {
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
