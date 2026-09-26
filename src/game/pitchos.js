import { ui } from '../ui.js';
import { profile, projects, about } from '../content.js';

// PitchOS: the desk computer. It's the actual portfolio (about, work, contact) plus a recap
// of what this visitor did tonight, and the button that ships the pitch.
export class PitchOS {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = ui.$('pitchos');
    this.body = ui.$('os-body');
    this.tabsEl = ui.$('os-tabs');
    this.isOpen = false;
    ui.$('os-close').onclick = () => this.close();
    this.tabs = [
      ['hello', 'Hello'],
      ['work', 'Work'],
      ['tonight', 'Tonight'],
      ['contact', 'Contact'],
    ];
    this.tabsEl.innerHTML = this.tabs.map(([id, label]) => `<button type="button" data-tab="${id}">${label}</button>`).join('');
    this.tabsEl.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) this.show(b.dataset.tab);
    };
    this.body.onclick = (e) => {
      const card = e.target.closest('[data-project]');
      if (card) this.showProject(+card.dataset.project);
      if (e.target.closest('[data-ship]')) this.ship();
      if (e.target.closest('[data-back]')) this.show('work');
    };
    addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') this.close();
    });
  }

  open(onClose) {
    this.onClose = onClose;
    this.isOpen = true;
    this.root.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const c = this.ctx.story.clock(this.ctx.story.minutes);
    ui.$('os-clock').textContent = `${c.text} ${c.ampm}`;
    this.show(this.ctx.story.ready && !this.ctx.story.shipped ? 'tonight' : 'hello');
  }

  close(silent = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    if (!silent && cb) cb();
  }

  show(tab) {
    this.tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.body.scrollTop = 0;
    this.body.innerHTML = this[tab]();
  }

  shipButton() {
    const s = this.ctx.story;
    if (s.shipped) return `<p class="os-hero"><p>✓ Shipped at 6:59 AM.</p></p>`;
    if (!s.ready) return '';
    return `<button type="button" class="q-btn primary os-ship" data-ship>Ship the pitch 🚀</button>`;
  }

  hello() {
    return `<div class="os-hero">
      <p class="q-eyebrow">${profile.eyebrow}</p>
      <h1>${profile.name}</h1>
      <p><b>${profile.role}.</b> ${about.bio.join(' ')}</p>
      <div class="os-chips">${about.skills.map((s) => `<span>${s}</span>`).join('')}</div>
      ${this.shipButton()}
    </div>`;
  }

  work() {
    return `<div class="os-grid">${projects
      .map((p, i) => {
        const frame = this.ctx.room.frames[i];
        return `<button type="button" class="os-card" data-project="${i}"><img src="${frame.coverUrl}" alt="${p.title}"><div><b>${p.title}</b><small>${p.tag}</small></div></button>`;
      })
      .join('')}</div>`;
  }

  showProject(i) {
    const p = projects[i];
    const frame = this.ctx.room.frames[i];
    this.body.innerHTML = `<div class="os-case"><img src="${frame.coverUrl}" alt="${p.title}"><div class="os-hero">
      <p class="q-eyebrow">${p.tag}</p><h1>${p.title}</h1><p>${p.desc}</p>
      <button type="button" class="q-btn" data-back>← All work</button></div></div>`;
  }

  tonight() {
    const s = this.ctx.story;
    const items = s.log
      .map((l) => `<li><time>${l.time.text}</time><div>You ${l.text}${l.img ? `<img src="${l.img}" alt="Your sketch">` : ''}</div></li>`)
      .join('');
    const intro = s.shipped
      ? 'The pitch is out. Here’s how the night went.'
      : s.ready
        ? 'Six sparks. Everything’s ready. Ship it.'
        : `The deck is building itself as you collect sparks (${s.sparks.size}/6).`;
    return `<div class="os-hero"><p class="q-eyebrow">Night Shift log</p><h1>Tonight</h1><p>${intro}</p></div>
      <ul class="os-log">${items}</ul>${this.shipButton()}`;
  }

  contact() {
    return `<div class="os-hero os-contact"><p class="q-eyebrow">Say hi</p><h1>Let’s make something.</h1>
      ${about.contact.map((c) => `<small>${c.label}</small><a href="${c.href}" target="_blank" rel="noopener">${c.value}</a>`).join('')}</div>`;
  }

  ship() {
    this.ctx.story.ship();
    this.show('tonight');
  }
}
