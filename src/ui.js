// Small DOM helpers shared by the story, stations and HUD.
const $ = (id) => document.getElementById(id);

export const ui = {
  $,

  prompt(text) {
    const p = $('prompt');
    p.hidden = !text;
    if (text) p.querySelector('span').textContent = text;
    $('crosshair').classList.toggle('active', !!text);
  },

  actionButton(label, enabled = true) {
    const b = $('btn-action');
    b.textContent = label;
    b.disabled = !enabled;
  },

  hud(title, body = '', hint = '', { leave = true } = {}) {
    $('station-hud').hidden = false;
    $('sh-title').textContent = title;
    $('sh-body').textContent = body;
    $('sh-hint').textContent = hint;
    $('sh-leave').hidden = !leave;
  },

  hudBody(body, hint) {
    $('sh-body').textContent = body;
    if (hint !== undefined) $('sh-hint').textContent = hint;
  },

  hideHud() {
    $('station-hud').hidden = true;
  },

  toast(html, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = html;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  },

  show(id, on = true) {
    $(id).hidden = !on;
  },

  // A short confetti burst on a full-screen canvas.
  confetti(duration = 3.5) {
    const c = $('confetti');
    c.hidden = false;
    c.width = innerWidth;
    c.height = innerHeight;
    const g = c.getContext('2d');
    const cols = ['#ffb46b', '#ff5fa2', '#4fd1ff', '#6dff9a', '#ffd166', '#b9a8ff'];
    const bits = Array.from({ length: 180 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.55,
      vx: (Math.random() - 0.5) * 14,
      vy: -8 - Math.random() * 12,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      s: 5 + Math.random() * 7,
      c: cols[Math.floor(Math.random() * cols.length)],
    }));
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.vy += 0.35;
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.r);
        g.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration + 1));
        g.fillStyle = b.c;
        g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        g.restore();
      }
      if (t < duration) requestAnimationFrame(tick);
      else c.hidden = true;
    };
    requestAnimationFrame(tick);
  },
};
