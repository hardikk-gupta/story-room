import * as THREE from 'three';
import { ui } from '../ui.js';
import { story as S } from '../content.js';

// Night Shift: sparks, secrets, the 2 AM → 7 AM clock, the sunrise, the quest panel, the
// waypoint, and the night's log (which the desk computer turns into a personal recap).
export class Story {
  constructor(ctx) {
    this.ctx = ctx;
    this.sparks = new Set();
    this.secrets = new Set();
    this.log = [];
    this.minutes = S.startTime;
    this.shown = S.startTime;
    this.started = false;
    this.shipped = false;
    this.idleT = 0;
    this.idleI = 0;

    // waypoint: a glowing chevron that hovers over the next objective
    const mat = new THREE.MeshBasicMaterial({ color: '#ffb46b', toneMapped: false, transparent: true, opacity: 0.9 });
    this.marker = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), mat);
    cone.rotation.x = Math.PI;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 32), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    this.marker.add(cone, ring);
    this.marker.visible = false;
    ctx.scene.add(this.marker);
    this.markerMat = mat;

    this.list = ui.$('q-list');
    const touch = document.body.classList.contains('touch');
    if (touch) ui.$('q-toggle').textContent = 'Show all';
    ui.$('q-toggle').onclick = () => {
      const q = ui.$('quest');
      if (touch) {
        q.classList.toggle('expanded');
        ui.$('q-toggle').textContent = q.classList.contains('expanded') ? 'Less' : 'Show all';
      } else {
        q.classList.toggle('collapsed');
        ui.$('q-toggle').textContent = q.classList.contains('collapsed') ? 'Show' : 'Hide';
      }
    };
  }

  get secretIds() {
    return S.secrets.map((x) => x.id);
  }

  get ready() {
    return this.sparks.size >= S.sparks.length;
  }

  has(id) {
    return this.sparks.has(id);
  }

  hasSecret(id) {
    return this.secrets.has(id);
  }

  say(lines, now = true) {
    this.ctx.bulb.say(lines, { now });
    this.idleT = 0;
  }

  start() {
    if (this.started) return;
    this.started = true;
    ui.show('quest', true);
    this.render();
    this.addLog('flipped the lights on. The studio woke up. So did Bulb.');
    this.say(S.intro, false);
    const touch = document.body.classList.contains('touch');
    setTimeout(() => ui.toast(touch ? 'Walk up to anything with a <b>✦</b> label and tap the big button' : 'Walk up to anything with a <b>✦</b> label and press <b>Space</b> or <b>E</b>'), 1500);
  }

  clock(min = this.shown) {
    const m = Math.round(min);
    let h = Math.floor(m / 60) % 24;
    const mm = String(m % 60).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return { text: `${String(h).padStart(2, '0')}:${mm}`, ampm };
  }

  addMinutes(n) {
    this.minutes = Math.min(S.endTime - 1, this.minutes + n);
  }

  addLog(text, img) {
    this.log.push({ time: this.clock(this.minutes), text, img });
  }

  complete(id, from, extra = {}) {
    if (this.sparks.has(id)) return;
    const def = S.sparks.find((s) => s.id === id);
    if (!def) return;
    this.sparks.add(id);
    const n = this.sparks.size;
    // time jumps toward sunrise with every spark
    this.minutes = Math.max(this.minutes + 20, S.startTime + (n / S.sparks.length) * (S.endTime - S.startTime - 25));
    this.addLog(extra.note || def.log, extra.img);
    const { sfx, room, sparkFx } = this.ctx;
    sfx.event('spark');
    ui.toast(`✦ Spark <b>${n}/${S.sparks.length}</b> · ${def.title}`);
    if (from) sparkFx.launch(from.clone ? from.clone() : from, new THREE.Vector3(2.0, 1.2, -5.55), () => sfx.event('arrive'));
    this.say(def.done);
    if (this.ready) this.ctx.bulb.say(S.final.ready);
    this.render();
    room.dawnTarget = (n / S.sparks.length) * 0.8;
  }

  secret(id) {
    if (this.secrets.has(id)) return;
    const def = S.secrets.find((s) => s.id === id);
    this.secrets.add(id);
    this.ctx.sfx.event('secret');
    ui.toast(`★ Secret <b>${this.secrets.size}/${S.secrets.length}</b> · ${def.title}`, 'secret');
    this.addLog(`found a secret: ${def.title.toLowerCase()}.`);
    this.say(def.text);
    this.render();
  }

  ship() {
    if (this.shipped) return;
    this.shipped = true;
    this.minutes = S.endTime;
    this.addLog('shipped the pitch. The sun came up. Nailed it.');
    this.ctx.room.dawnTarget = 1;
    this.ctx.sfx.event('spark');
    ui.confetti();
    ui.toast('🚀 <b>Pitch shipped</b> · Night Shift complete');
    this.say(S.final.done);
    this.render();
  }

  // Station the waypoint should point at: nearest unfinished spark, then the desk.
  nextStation() {
    const { stations, player } = this.ctx;
    if (this.shipped) return null;
    if (this.ready) return stations.byId('ship');
    let best = null;
    let bd = Infinity;
    for (const s of S.sparks) {
      if (this.sparks.has(s.id)) continue;
      const st = s.id === 'gallery' ? this.ctx.galleryAnchor : stations.byId(s.id);
      if (!st) continue;
      const d = Math.hypot(st.pos.x - player.pos.x, st.pos.z - player.pos.z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best;
  }

  render() {
    const next = this.nextStation();
    const rows = S.sparks.map((s) => {
      const done = this.sparks.has(s.id);
      const isNext = next && (next.id === s.id || (s.id === 'gallery' && next === this.ctx.galleryAnchor));
      const extra = s.id === 'gallery' && !done ? ` (${this.ctx.galleryCount()}/3)` : '';
      return `<li class="${done ? 'done' : ''} ${isNext ? 'next' : ''}"><span class="box">${done ? '✓' : ''}</span><span><span class="t">${s.title}${extra}</span><span class="h">${s.hint}</span></span></li>`;
    });
    const f = S.final;
    rows.push(
      `<li class="final ${this.shipped ? 'done' : this.ready ? 'next' : 'locked'}"><span class="box">${this.shipped ? '✓' : this.ready ? '' : '🔒'}</span><span><span class="t">${f.title}</span><span class="h">${f.hint}</span></span></li>`,
    );
    this.list.innerHTML = rows.join('');
    ui.$('q-count').textContent = `${this.sparks.size}/${S.sparks.length}`;
    ui.$('q-secrets').textContent = `${this.secrets.size}/${S.secrets.length}`;
  }

  update(dt) {
    if (!this.started) return;
    const { room, player, stations, bulb } = this.ctx;
    // the clock ticks on its own too (a game minute every 4 s), capped before 7 AM
    if (!this.shipped) this.minutes = Math.min(S.endTime - 1, this.minutes + dt / 4);
    this.shown += (this.minutes - this.shown) * (1 - Math.exp(-2.5 * dt));
    const c = this.clock();
    ui.$('q-time').textContent = c.text;
    ui.$('q-ampm').textContent = c.ampm;
    room.dawn += ((room.dawnTarget || 0) - room.dawn) * (1 - Math.exp(-0.6 * dt));

    // waypoint
    const next = this.nextStation();
    const d = next ? Math.hypot(next.pos.x - player.pos.x, next.pos.z - player.pos.z) : 0;
    this.marker.visible = !!next && !stations.busy && d > 1.4;
    if (next) {
      const t = performance.now() / 1000;
      this.marker.position.set(next.pos.x, Math.max(next.pos.y + 0.9, 2.1) + Math.sin(t * 3) * 0.08, next.pos.z);
      this.marker.rotation.y = t * 1.5;
      this.markerMat.opacity = 0.65 + Math.sin(t * 5) * 0.25;
    }
    if (next !== this.lastNext) {
      this.lastNext = next;
      this.render();
    }

    // gentle nudges if the visitor wanders for a while without doing anything
    if (!stations.busy && !bulb.current) this.idleT += dt;
    if (this.idleT > 40 && !this.shipped) {
      this.idleT = 0;
      this.say(S.idle[this.idleI++ % S.idle.length], false);
    }
  }
}
