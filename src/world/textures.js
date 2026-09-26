import * as THREE from 'three';

// Seeded RNG so the generated textures look identical on every visit.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function woodFloor() {
  const [c, g] = canvas(1024, 1024);
  const r = rng(7);
  const rows = 8;
  const h = c.height / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 400;
    while (x < c.width) {
      const len = 380 + r() * 360;
      const base = 118 + r() * 30;
      g.fillStyle = `rgb(${base + 34},${base - 8},${base - 52})`;
      g.fillRect(x, i * h, len, h);
      // grain
      for (let k = 0; k < 26; k++) {
        const y = i * h + r() * h;
        g.strokeStyle = `rgba(${60 + r() * 40},${30 + r() * 20},10,${0.05 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 1.6;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 8, x + len * 0.7, y + (r() - 0.5) * 8, x + len, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(20,10,4,0.55)';
      g.fillRect(x, i * h, 2, h);
      x += len;
    }
    g.fillStyle = 'rgba(20,10,4,0.6)';
    g.fillRect(0, i * h, c.width, 2);
  }
  return toTexture(c, { repeat: [3, 3] });
}

export function plaster(tint = [226, 220, 210], seed = 3) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  g.fillStyle = `rgb(${tint.join(',')})`;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${r() * 0.018})`;
    const s = 1 + r() * 1.5;
    g.fillRect(r() * 512, r() * 512, s, s);
  }
  return toTexture(c, { repeat: [4, 2] });
}

export function fabric(color = '#3a3f4b', seed = 5) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
    g.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 2) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`;
    g.fillRect(x, 0, 1, 256);
  }
  return toTexture(c, { repeat: [3, 3] });
}

export function rug() {
  const [c, g] = canvas(1024, 640);
  const r = rng(11);
  g.fillStyle = '#d9cbb3';
  g.fillRect(0, 0, 1024, 640);
  g.strokeStyle = '#8b5e3c';
  g.lineWidth = 26;
  g.strokeRect(40, 40, 944, 560);
  g.lineWidth = 6;
  g.strokeRect(86, 86, 852, 468);
  const shapes = ['#c8553d', '#2d3142', '#e0a458', '#4f6d7a'];
  for (let i = 0; i < 38; i++) {
    g.fillStyle = shapes[i % shapes.length];
    g.globalAlpha = 0.85;
    const x = 130 + r() * 760;
    const y = 130 + r() * 380;
    const s = 18 + r() * 44;
    if (i % 3 === 0) {
      g.beginPath();
      g.arc(x, y, s / 2, 0, Math.PI * 2);
      g.fill();
    } else if (i % 3 === 1) g.fillRect(x, y, s, s * 0.4);
    else {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s, y);
      g.lineTo(x + s / 2, y - s);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 30000; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.06})`;
    g.fillRect(r() * 1024, r() * 640, 2, 2);
  }
  return toTexture(c, { repeat: [1, 1] });
}

// A generated project cover. Also used as the full-screen image when a frame is inspected.
export function projectCover(project, index) {
  const [c, g] = canvas(1200, 1500);
  const [a, b, dark] = project.palette;
  const r = rng(100 + index * 17);
  g.fillStyle = dark;
  g.fillRect(0, 0, 1200, 1500);
  const grad = g.createRadialGradient(300 + r() * 600, 400 + r() * 500, 60, 600, 750, 1100);
  grad.addColorStop(0, a);
  grad.addColorStop(0.55, `${a}33`);
  grad.addColorStop(1, `${dark}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1200, 1500);

  g.save();
  g.globalCompositeOperation = 'screen';
  const style = index % 3;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 2 ? `${b}cc` : `${a}aa`;
    g.strokeStyle = `${b}99`;
    g.lineWidth = 6;
    const x = 150 + r() * 900;
    const y = 250 + r() * 800;
    const s = 80 + r() * 260;
    if (style === 0) {
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      i % 3 === 0 ? g.fill() : g.stroke();
    } else if (style === 1) {
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI);
      i % 3 === 0 ? g.fillRect(-s / 2, -s / 2, s, s) : g.strokeRect(-s / 2, -s / 2, s, s);
      g.restore();
    } else {
      g.beginPath();
      g.moveTo(x - s, y + s * 0.5);
      g.quadraticCurveTo(x, y - s * 1.4, x + s, y + s * 0.5);
      g.stroke();
    }
  }
  g.restore();

  // grain
  for (let i = 0; i < 40000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
    g.fillRect(r() * 1200, r() * 1500, 2, 2);
  }

  g.fillStyle = b;
  g.font = '600 38px Inter, sans-serif';
  g.fillText(`${String(index + 1).padStart(2, '0')} — ${project.tag.toUpperCase()}`, 80, 120);
  g.font = '700 118px "Space Grotesk", Inter, sans-serif';
  const words = project.title.split(' ');
  words.forEach((w, i) => g.fillText(w, 76, 1290 - (words.length - 1 - i) * 120));
  g.fillRect(80, 1350, 160, 8);
  return c;
}

// The painted "window" scenery on the right wall: a warm valley at dusk.
export function scenery() {
  const [c, g] = canvas(2048, 1024);
  const r = rng(21);
  const sky = g.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#1d2b53');
  sky.addColorStop(0.45, '#7e4a7e');
  sky.addColorStop(0.75, '#f08a5d');
  sky.addColorStop(1, '#ffd9a0');
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 1024);
  // sun
  const sun = g.createRadialGradient(1300, 620, 10, 1300, 620, 260);
  sun.addColorStop(0, 'rgba(255,245,220,1)');
  sun.addColorStop(0.2, 'rgba(255,210,150,0.9)');
  sun.addColorStop(1, 'rgba(255,170,100,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 2048, 1024);
  // stars
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.7})`;
    g.fillRect(r() * 2048, r() * 260, 2, 2);
  }
  const layers = [
    ['#5b3a5e', 560, 120],
    ['#3f2a4a', 640, 90],
    ['#2a1d36', 720, 70],
    ['#170f22', 820, 50],
  ];
  layers.forEach(([col, base, amp], li) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 1024);
    for (let x = 0; x <= 2048; x += 16) {
      const y =
        base -
        Math.sin(x * 0.002 + li * 1.7) * amp -
        Math.sin(x * 0.007 + li) * amp * 0.35 -
        r() * 6;
      g.lineTo(x, y);
    }
    g.lineTo(2048, 1024);
    g.fill();
  });
  // city lights on the last ridge
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,${190 + r() * 60},${120 + r() * 60},${0.4 + r() * 0.6})`;
    g.fillRect(r() * 2048, 860 + r() * 160, 2 + r() * 2, 2);
  }
  return toTexture(c, { repeat: [1, 1] });
}

export function posterArt(seed, colors, label) {
  const [c, g] = canvas(512, 720);
  const r = rng(seed);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 512, 720);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = colors[1 + (i % (colors.length - 1))];
    g.globalAlpha = 0.9;
    const s = 40 + r() * 180;
    g.beginPath();
    g.arc(r() * 512, r() * 560, s / 2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#fff';
  g.font = '700 64px "Space Grotesk", Inter, sans-serif';
  g.fillText(label, 36, 660);
  return toTexture(c);
}

export function labelTexture(text, { w = 512, h = 128, color = '#fff', bg = null, font = "600 64px Inter, 'Helvetica Neue', Arial, sans-serif" } = {}) {
  const [c, g] = canvas(w, h);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  return toTexture(c);
}
