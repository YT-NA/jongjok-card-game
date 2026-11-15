'use strict';
// =====================================================================
//  종족대전 - 화면/조작
// =====================================================================
const $ = sel => document.querySelector(sel);
// 받침 있으면 a, 없으면 b (예: 을/를)
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return w + ((c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? a : b); };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const App = {
  mode: null,          // 'ai' | 'hotseat' | 'host' | 'guest'
  state: null,
  me: 0,               // 내가 보고 있는 플레이어 번호
  sel: null,           // 공격하려고 선택한 소환물 uid
  pending: null,       // { kind: 'play', uid } | { kind: 'hero' }
  targets: [],
  lastSeq: -1,
  overShown: false,
  aiBusy: false,
  config: null,        // 재대결용 { races, names }
  myRace: null,
};

function myName() { return ($('#nameInput').value || '').trim() || '플레이어'; }
try { const n = localStorage.getItem('jj_name'); if (n) $('#nameInput').value = n; } catch (_) {}
$('#nameInput').addEventListener('change', () => { try { localStorage.setItem('jj_name', myName()); } catch (_) {} });

// 휴대폰/태블릿(마우스 없음): 탭 한 번 = 크게 보기, 한 번 더 = 사용
const TOUCH = window.matchMedia('(hover: none)').matches;
if (TOUCH) document.body.classList.add('touch');

function goFullscreen(silent) {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) { if (!silent) toast('이 기기는 전체화면을 지원하지 않습니다. 휴대폰을 가로로 돌려주세요.'); return; }
  if (document.fullscreenElement) { try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} return; }
  Promise.resolve(req.call(el)).then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} }).catch(() => {});
}

function show(id) {
  document.body.classList.toggle('in-game', id === 'game');
  ['menu', 'raceSelect', 'lobby', 'game'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
}

// ───────────── 오버레이 / 알림 ─────────────
function overlay(html, opaque) {
  const o = $('#overlay');
  o.className = opaque ? 'opaque' : '';
  o.innerHTML = `<div class="ov-box">${html}</div>`;
  return o;
}
function closeOverlay() { const o = $('#overlay'); o.className = 'hidden'; o.innerHTML = ''; }

let toastTimer = null;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function banner(text) {
  const b = $('#banner');
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

// ───────────── 카드 HTML ─────────────
function cardHTML(id, o = {}) {
  const c = CARDS[id], r = raceOf(id);
  const typeLabel = c.type === 'minion' ? '소환물' : r.spellLabel;
  return `<div class="card ${c.type} ${c.look || ''} ${o.cls || ''}" ${o.attrs || ''} style="--rc:${r.color};${o.style || ''}">
    <div class="c-cost">${c.cost}</div>
    ${c.look === 'magazine' ? '<div class="mag-issue">특집호</div>' : ''}
    <div class="c-art">${c.emoji}${c.emoji2 ? `<span class="art-sub">${c.emoji2}</span>` : ''}</div>
    <div class="c-name">${c.name}</div>
    <div class="c-text"><div>${cardText(c)}</div></div>
    <div class="c-type">${r.name} · ${typeLabel}${c.token ? ' (토큰)' : ''}</div>
    ${c.type === 'minion' && !c.structure ? `<div class="c-atk">${c.atk}</div><div class="c-hp">${c.hp}</div>` : ''}
  </div>`;
}

// 동굴 속 짝 하나의 상태 설명
function pairStatus(p, pr) {
  const left = Math.max(0, 2 - pr.age);
  if (left) return { short: `⏳${left}턴`, long: `${left}턴 더 동굴에서 지내야 함` };
  if (p.ssuk < 1 || p.garlic < 1) {
    const need = [p.ssuk < 1 ? '쑥🌿' : '', p.garlic < 1 ? '마늘🧄' : ''].filter(Boolean).join('·');
    return { short: `${need} 필요`, long: `${need}이(가) 있어야 나올 수 있음` };
  }
  return { short: '💒 곧 결혼', long: '다음 내 턴 시작에 쑥·마늘을 먹고 나와서 결혼!' };
}

// 전장에 떨어진 고기 (적이 공격·지정 불가, 턴 끝에 돼지가 먹음)
function meatUnitHTML(m) {
  const c = CARDS[m.id];
  return `<div class="minion meat-unit" data-ref="m${m.uid}"><div class="meat-plate">${c.emoji}</div><div class="cave-tag">${c.name}</div></div>`;
}

// 전장에 놓인 호랑이 동굴 (적이 공격·지정 불가)
function caveUnitHTML(m, owner) {
  const p = App.state.players[owner];
  const rows = p.cave.map(pr => {
    const st = pairStatus(p, pr);
    return `<div class="cave-row">${CARDS[pr.tiger.id].emoji}❤${CARDS[pr.captive.id].emoji} <span>${st.short}</span></div>`;
  }).join('');
  return `<div class="minion cave-unit" data-ref="m${m.uid}">
    <div class="cave-mouth">🕳️</div>
    <div class="cave-list">${rows}</div>
    <div class="cave-tag">동굴</div>
  </div>`;
}

function minionHTML(m, owner) {
  if (m.cave) return CARDS[m.id].meat ? meatUnitHTML(m) : caveUnitHTML(m, owner);
  const c = CARDS[m.id], r = raceOf(m.id);
  const cls = ['minion'];
  if (m.taunt) cls.push('taunt');
  if (m.shield) cls.push('shield');
  if (m.stealth) cls.push('stealth');
  if (m.frozen) cls.push('frozen');
  if (owner === App.me && isMyTurn() && canAttack(m) && !App.pending) cls.push('ready');
  if (App.sel === m.uid || (App.pending && App.pending.first === 'm' + m.uid)) cls.push('selected');
  if (App.targets.includes('m' + m.uid)) cls.push('targetable');
  const badges = [];
  if (m.poison) badges.push('🧪');
  if (m.spellDmg) badges.push(`🔮${m.spellDmg}`);
  if (c.deathrattle) badges.push('💀');
  if (c.onTurnEnd || c.onTurnStart || c.onSpell) badges.push('⚡');
  if (c.grow) badges.push(`<span class="grow">🌱${c.grow.turns - (m.age || 0)}</span>`);
  if (c.mineral) badges.push(`<span class="mineral">⛏${c.mineral}</span>`);
  if (c.turret) badges.push(`<span class="turret">🎯${c.turret}</span>`);
  if (c.turretAll) badges.push(`<span class="turret">🔥전체${c.turretAll}</span>`);
  badges.push(poisonBadges(m.poisons));
  if (m.frozen) badges.push('❄️');
  const sleeping = m.sleeping && !m.charge && owner === App.state.current;
  const atkCls = m.atk > c.atk ? 'buffed' : m.atk < c.atk ? 'debuffed' : '';
  const hpCls = m.hp < m.maxHp ? 'hurt' : m.maxHp > c.hp ? 'buffed' : '';
  return `<div class="${cls.join(' ')}" data-ref="m${m.uid}" style="--rc:${r.color}">
    <div class="m-art">${c.emoji}${c.emoji2 ? `<span class="art-sub">${c.emoji2}</span>` : ''}</div>
    <div class="m-badges">${badges.join('')}</div>
    ${sleeping ? '<div class="sleep">💤</div>' : ''}
    <div class="m-atk ${atkCls}">${m.atk}</div>
    <div class="m-hp ${hpCls}">${m.hp}</div>
  </div>`;
}

function heroZoneHTML(p, isMe) {
  const s = App.state, r = RACES[p.race], hp = r.heroPower;
  const tgt = App.targets.includes('h' + p.idx) ? ' targetable' : '';
  const usable = isMe && isMyTurn() && canHeroPower(s, p.idx).ok;
  const crystals = Array.from({ length: 10 }, (_, i) =>
    `<i class="${i < p.mana ? 'full' : i < p.maxMana ? 'empty' : 'none'}"></i>`).join('');
  return `<div class="hz-inner">
    <div class="hero-info"><div class="hero-name">${esc(p.name)}</div><div class="hero-race">${r.name} · 손패 ${p.hand.length}</div>${caveHTML(p)}${Object.keys(p.poisons || {}).length ? '<div class="hero-poison">감염 ' + poisonBadges(p.poisons) + '</div>' : ''}</div>
    <div class="hero${tgt}" data-ref="h${p.idx}" style="--rc:${r.color}">
      <div class="portrait">${r.hero}</div>
      <div class="hero-hp ${p.hp < p.maxHp ? 'hurt' : ''}">${p.hp}</div>
    </div>
    <div class="hpower ${usable ? 'usable' : ''} ${p.heroPowerUsed ? 'used' : ''} ${isMe && App.pending && App.pending.kind === 'hero' ? 'active' : ''}"
      ${isMe ? 'data-hpower="1"' : ''} data-hpinfo="${p.race}">
      <span>${hp.emoji}</span><span class="hp-cost">${hp.cost}</span>
    </div>
    <div class="mana-box"><div class="mana-num">💎 ${p.mana} / ${p.maxMana}</div><div class="crystals">${crystals}</div></div>
  </div>`;
}

// 감염(독) 표시: 🟢2↑ = 다음 턴 피해 2, 상급(매 턴 +1)
function poisonBadges(ps) {
  return Object.entries(ps || {}).map(([k, pz]) => `<span class="pz" title="${POISON_INFO[k].name}">${POISON_INFO[k].icon}${pz.dmg}${pz.adv ? '↑' : ''}</span>`).join('');
}

// 호랑이: 쑥/마늘 보유량 (동굴 속 짝이 나올 때 1개씩 먹음)
function caveHTML(p) {
  if (p.race !== 'tiger') return '';
  return `<div class="tiger-box" title="동굴 속 짝 하나가 나올 때 쑥 1개 + 마늘 1개를 먹습니다">🌿쑥 ${p.ssuk || 0} · 🧄마늘 ${p.garlic || 0}</div>`;
}

// ───────────── 렌더링 ─────────────
function isMyTurn() {
  const s = App.state;
  return !!s && s.winner == null && s.current === App.me && !App.spectating && !(App.mode === 'ai' && App.me !== 0);
}

function captureRects() {
  const map = { _html: {} };
  document.querySelectorAll('#game [data-ref]').forEach(el => {
    map[el.dataset.ref] = el.getBoundingClientRect();
    if (el.dataset.ref[0] === 'm') map._html[el.dataset.ref] = el.outerHTML;
  });
  return map;
}

function render() {
  const s = App.state;
  if (!s) return;
  clearPredict();
  const prev = captureRects();
  const me = s.players[App.me], op = s.players[1 - App.me];
  const myTurn = isMyTurn();

  $('#game').classList.toggle('targeting', App.targets.length > 0);
  $('#oppHand').innerHTML = op.hand.map(() => '<div class="cback"></div>').join('');
  $('#oppZone').innerHTML = heroZoneHTML(op, false);
  $('#myZone').innerHTML = heroZoneHTML(me, true);
  $('#oppBoard').innerHTML = op.board.map(m => minionHTML(m, op.idx)).join('');
  $('#myBoard').innerHTML = me.board.map(m => minionHTML(m, me.idx)).join('');

  const n = me.hand.length;
  const ov = n <= 6 ? 0.8 : Math.max(-8.5, 0.8 - (n - 6) * 2.1);
  if (App.spectating) $('#myHand').innerHTML = me.hand.map(() => '<div class="cback"></div>').join('');
  else $('#myHand').innerHTML = me.hand.map((h, i) => {
    const playable = myTurn && canPlayCard(s, me.idx, h.uid).ok;
    const k = i - (n - 1) / 2;
    const cls = ['in-hand', playable ? 'playable' : '', App.pending && App.pending.uid === h.uid ? 'pending' : '', App.inspect === h.uid ? 'inspect' : ''].join(' ');
    return cardHTML(h.id, { cls, attrs: `data-hand="${h.uid}"`, style: `--ov:${ov};--i:${k};--i2:${k * k}` });
  }).join('');

  $('#oppDeck').textContent = deckCount(op);
  $('#oppDeck').classList.toggle('empty', !deckCount(op));
  $('#oppDeckLabel').textContent = `상대 덱 · ${PHASE_NAMES[phaseOf(op)]}`;
  $('#myDeck').textContent = deckCount(me);
  $('#myDeck').classList.toggle('empty', !deckCount(me));
  $('#myDeckLabel').textContent = `내 덱 · ${PHASE_NAMES[phaseOf(me)]}`;

  const et = $('#endTurn');
  et.classList.toggle('waiting', !myTurn);
  et.classList.toggle('done', myTurn && !hasMovesLeft());
  et.textContent = myTurn ? '턴 종료' : '상대 턴';
  $('#turnInfo').innerHTML = s.winner != null ? '게임 종료' : (myTurn ? '<span style="color:#7dff8f">내 턴</span>' : `${esc(s.players[s.current].name)}의 턴`);
  $('#log').innerHTML = s.log.slice(-14).map(l => `<div>${esc(l)}</div>`).join('');

  if (s.seq !== App.lastSeq) {
    App.lastSeq = s.seq;
    playEvents(s.events || [], prev);
  }
  if (s.winner != null && !App.overShown) {
    App.overShown = true;
    setTimeout(showGameOver, 1100);
  }
}

function hasMovesLeft() {
  const s = App.state, p = s.players[App.me];
  if (p.hand.some(h => canPlayCard(s, p.idx, h.uid).ok)) return true;
  if (canHeroPower(s, p.idx).ok) return true;
  return p.board.some(m => canAttack(m));
}

// ───────────── 연출 ─────────────
// 죽은 소환물은 화면에서 바로 사라지므로, 연출이 끝날 때까지 '유령' 복제본을 남겨둔다
const ghosts = {};
// ───── 드워프 연출: 포탑 사격 / 조립 ─────
function fireProjectile(from, to, prev) {
  const a = rectOf(from, prev), b = rectOf(to, prev);
  if (!a || !b) return;
  const el = elByRef(from);
  if (el) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15) translateY(-4px)' }, { transform: 'scale(1)' }], { duration: 200 });
  const p = document.createElement('div');
  p.className = 'bullet';
  p.textContent = '●';
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2, by = b.top + b.height / 2;
  Object.assign(p.style, { left: ax + 'px', top: ay + 'px' });
  $('#fx').appendChild(p);
  p.animate([{ transform: 'translate(-50%,-50%) scale(.6)' }, { transform: `translate(calc(-50% + ${bx - ax}px), calc(-50% + ${by - ay}px)) scale(1.2)` }],
    { duration: 300, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => { p.remove(); floatText(b, '💥', 'spark'); }, 300);
}
function flameBurst(from, pi, prev) {
  const el = elByRef(from);
  if (el) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 300 });
  App.state.players[pi].board.forEach(m => { const r = rectOf('m' + m.uid, prev); if (r) setTimeout(() => floatText(r, '🔥', 'spark'), 250); });
}
function playAssemble(e, prev) {
  const target = elByRef(e.ref);
  const tr = target ? target.getBoundingClientRect() : null;
  if (target) target.style.opacity = '0';
  e.parts.forEach(ref => {
    const r = prev[ref], html = prev._html && prev._html[ref];
    if (!r || !html || !tr) return;
    const g = ghostAt(html, r);
    g.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${tr.left - r.left}px,${tr.top - r.top}px) scale(.7) rotate(180deg)`, opacity: .9 },
    ], { duration: 550, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => g.remove(), 560);
  });
  setTimeout(() => {
    const t = elByRef(e.ref);
    if (t) {
      t.style.opacity = '';
      t.animate([{ transform: 'scale(.3) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 400, easing: 'ease-out' });
      floatText(t.getBoundingClientRect(), '🔧 조립 완료!', 'info');
    }
  }, 560);
}

// ───── 돼지 고기 주워 먹기 연출: 고기가 돼지에게 날아가서 냠 ─────
function playEat(e, prev) {
  const from = prev[e.meat], html = prev._html && prev._html[e.meat];
  const pigEl = elByRef(e.pig);
  if (!from || !pigEl) return;
  const g = html ? ghostAt(html, from) : null;
  const to = pigEl.getBoundingClientRect();
  if (g) {
    g.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${(to.left - from.left) / 2}px, ${(to.top - from.top) / 2 - 40}px) scale(.8)`, opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(.3)`, opacity: 0 },
    ], { duration: 650, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => g.remove(), 660);
  }
  setTimeout(() => {
    const p = elByRef(e.pig);
    if (p) { p.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 300 }); floatText(p.getBoundingClientRect(), '냠냠 ' + CARDS[e.id].emoji, 'heal'); }
  }, 650);
}

// ───── 호랑이 물어가기 연출 ─────
// ① 동굴 자리에서 호랑이 등장(어흥!) → ② 적에게 달려들어 냠! → ③ 적을 물고 동굴로 쏙 → ④ 동굴 등장
const ABDUCT_MS = 2100;
function ghostAt(html, rect) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const g = wrap.firstElementChild;
  g.removeAttribute('data-ref');
  g.classList.remove('ready', 'selected', 'targetable');
  Object.assign(g.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', margin: 0, zIndex: 320, pointerEvents: 'none' });
  $('#fx').appendChild(g);
  return g;
}
function playAbduct(e, prev) {
  const caveEl = elByRef(e.caveRef);
  const capRect = prev[e.ref], capHtml = prev._html && prev._html[e.ref];
  const home = caveEl ? caveEl.getBoundingClientRect() : rectOf('h' + e.pi, prev);
  if (!home) return;
  // 동굴은 연출 끝에 나타나도록 잠깐 숨김
  if (caveEl && e.newCave) caveEl.style.opacity = '0';

  const fakeTiger = { uid: 0, id: e.tigerId, atk: e.tigerAtk, hp: e.tigerHp, maxHp: e.tigerHp, taunt: true, attacksLeft: 0, sleeping: false };
  const tg = ghostAt(minionHTML(fakeTiger, e.pi), home);
  tg.style.zIndex = 330;
  const cg = capHtml && capRect ? ghostAt(capHtml, capRect) : null;

  const T = ABDUCT_MS;
  const center = r => [r.left + r.width / 2, r.top + r.height / 2];
  const [hx, hy] = center(home);
  const [cx, cy] = capRect ? center(capRect) : [hx, hy - 150];
  const dx = cx - hx, dy = cy - hy;

  // 호랑이: 등장 → 달려듦 → 물고 돌아옴 → 동굴 속으로
  tg.animate([
    { offset: 0, transform: 'translate(0,0) scale(0)', opacity: 0 },
    { offset: .12, transform: 'translate(0,0) scale(1.3)', opacity: 1 },
    { offset: .2, transform: 'translate(0,0) scale(1)' },
    { offset: .28, transform: `translate(${-dx * .1}px,${-dy * .1}px) scale(1.05)` },
    { offset: .4, transform: `translate(${dx * .8}px,${dy * .8}px) scale(1.2)` },
    { offset: .5, transform: `translate(${dx * .72}px,${dy * .72}px) scale(1.15) rotate(-6deg)` },
    { offset: .85, transform: 'translate(0,0) scale(.9) rotate(0deg)', opacity: 1 },
    { offset: 1, transform: 'translate(0,0) scale(.2)', opacity: 0 },
  ], { duration: T, easing: 'ease-in-out', fill: 'forwards' });

  // 잡힌 적: 가만히 → 물려서 버둥 → 끌려감 → 동굴 속으로
  if (cg) {
    cg.animate([
      { offset: 0, transform: 'translate(0,0)' },
      { offset: .4, transform: 'translate(0,0)' },
      { offset: .44, transform: 'translate(-8px,0) rotate(-12deg)' },
      { offset: .48, transform: 'translate(8px,0) rotate(12deg)' },
      { offset: .52, transform: 'translate(-6px,0) rotate(-8deg)' },
      { offset: .56, transform: `translate(${-dx * .1}px,${-dy * .1}px) rotate(10deg)` },
      { offset: .88, transform: `translate(${-dx * .95}px,${-dy * .95}px) rotate(25deg) scale(.85)`, opacity: 1 },
      { offset: 1, transform: `translate(${-dx}px,${-dy}px) rotate(40deg) scale(.15)`, opacity: 0 },
    ], { duration: T, easing: 'ease-in-out', fill: 'forwards' });
  }

  const at = (frac, fn) => setTimeout(fn, T * frac);
  at(.08, () => floatText(home, '어흥!', 'info'));
  at(.42, () => {
    floatText({ left: cx, top: cy, width: 0, height: 0 }, '냠!', 'dmg');
    floatText({ left: cx, top: cy, width: 0, height: 0 }, '🦷', 'spark');
  });
  at(.92, () => {
    const c = elByRef(e.caveRef);
    if (c) {
      c.style.opacity = '';
      c.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-out' });
    }
    floatText(home, '🕳️ 동굴로!', 'info');
  });
  at(1.02, () => { tg.remove(); if (cg) cg.remove(); });
}

function makeGhost(ref, prev, lifeMs) {
  const r = prev[ref], html = prev._html && prev._html[ref];
  if (!r || !html || ghosts[ref]) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const g = wrap.firstElementChild;
  g.removeAttribute('data-ref');
  g.classList.remove('ready', 'selected', 'targetable');
  Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', margin: 0, zIndex: 300, pointerEvents: 'none' });
  $('#fx').appendChild(g);
  ghosts[ref] = g;
  setTimeout(() => {
    g.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.6) rotate(-8deg)' }], { duration: 300, fill: 'forwards' });
    setTimeout(() => { g.remove(); delete ghosts[ref]; }, 320);
  }, lifeMs);
}
function elByRef(ref) { return ghosts[ref] || document.querySelector(`#game [data-ref="${ref}"]`); }
function rectOf(ref, prev) { const el = elByRef(ref); return el ? el.getBoundingClientRect() : prev[ref]; }
function floatText(rect, text, cls) {
  if (!rect) return;
  const d = document.createElement('div');
  d.className = 'float ' + cls;
  d.textContent = text;
  d.style.left = (rect.left + rect.width / 2) + 'px';
  d.style.top = (rect.top + rect.height / 2) + 'px';
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 1200);
}
function shake(ref) {
  const el = elByRef(ref);
  if (el) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 250 });
}
function centerDelta(a, b) {
  return [(b.left + b.width / 2) - (a.left + a.width / 2), (b.top + b.height / 2) - (a.top + a.height / 2)];
}
// 공격 모션: 뒤로 살짝 빠졌다가 → 돌진해서 쾅 → 제자리
const HIT_AT = 300, COUNTER_AT = 480, DEATH_AT = 850;
function lunge(from, to) {
  const a = elByRef(from), b = elByRef(to);
  if (!a || !b) return;
  const [dx, dy] = centerDelta(a.getBoundingClientRect(), b.getBoundingClientRect());
  a.style.zIndex = 60;
  a.animate([
    { transform: 'translate(0,0) scale(1)', offset: 0 },
    { transform: `translate(${-dx * .08}px,${-dy * .08}px) scale(1.08)`, offset: .3 },
    { transform: `translate(${dx * .8}px,${dy * .8}px) scale(1.15)`, offset: .5 },
    { transform: `translate(${dx * .7}px,${dy * .7}px) scale(1.1)`, offset: .62 },
    { transform: 'translate(0,0) scale(1)', offset: 1 },
  ], { duration: 650, easing: 'ease-in-out' }).onfinish = () => { a.style.zIndex = ''; };
}
// 반격: 맞은 쪽이 공격자 쪽으로 움찔하며 되받아침
function counterJab(from, to) {
  const t = elByRef(to), a = elByRef(from);
  if (!t || !a) return;
  const [dx, dy] = centerDelta(t.getBoundingClientRect(), a.getBoundingClientRect());
  t.animate([
    { transform: 'translate(0,0)' },
    { transform: `translate(${dx * .25}px,${dy * .25}px) scale(1.1)` },
    { transform: 'translate(0,0)' },
  ], { duration: 260, easing: 'ease-out' });
}
function clashSpark(from, to) {
  const a = elByRef(from), b = elByRef(to);
  if (!a || !b) return;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const x = rb.left + rb.width / 2 - (rb.left + rb.width / 2 - (ra.left + ra.width / 2)) * .2;
  const y = rb.top + rb.height / 2 - (rb.top + rb.height / 2 - (ra.top + ra.height / 2)) * .2;
  floatText({ left: x, top: y, width: 0, height: 0 }, '⚔️', 'spark');
}
function later(fn, ms) { if (ms) setTimeout(fn, ms); else fn(); }

function playEvents(evs, prev) {
  const s = App.state;
  const atk = evs.find(e => e.type === 'attack');
  const d = atk ? HIT_AT : 0;
  const who = pi => (pi === App.me && App.mode !== 'hotseat') ? '내' : `${s.players[pi].name}의`;
  // 드워프 포탑 사격: 한 발씩 차례로 쏘고, 그 뒤에 피해가 뜨도록 시간 계산
  const SHOT_GAP = 420, SHOT_HIT = 300;
  let shotIdx = 0, shotHit = null;
  const delayOf = new Map();
  for (const e of evs) {
    if (e.type === 'shoot' || e.type === 'shootAll') {
      const at = shotIdx++ * SHOT_GAP;
      if (e.type === 'shoot') later(() => fireProjectile(e.from, e.to, prev), at);
      else later(() => flameBurst(e.from, e.pi, prev), at);
      shotHit = at + SHOT_HIT;
    } else if (shotHit != null) delayOf.set(e, shotHit + (e.type === 'death' ? 150 : 0));
  }
  const lastShot = shotHit || 0;
  // 죽은 소환물은 연출 끝날 때까지 유령으로 남김
  evs.filter(e => e.type === 'death').forEach(e => makeGhost(e.ref, prev, atk ? DEATH_AT + 150 : Math.max(450, lastShot + 500)));
  if (atk) {
    lunge(atk.from, atk.to);
    later(() => clashSpark(atk.from, atk.to), HIT_AT - 20);
    if (atk.to[0] === 'm' && evs.some(e => (e.type === 'dmg' || e.type === 'shield') && e.ref === atk.from)) {
      later(() => counterJab(atk.from, atk.to), COUNTER_AT - 80);
    }
  }
  const hitDelay = ref => !atk ? 0 : (ref === atk.from ? COUNTER_AT : HIT_AT);
  for (const e of evs) {
    const sd = delayOf.get(e);
    switch (e.type) {
      case 'attack': case 'shoot': case 'shootAll': break;
      case 'dmg': later(() => {
        const counter = atk && e.ref === atk.from;
        floatText(rectOf(e.ref, prev), (counter ? '반격 -' : '-') + e.n, 'dmg');
        shake(e.ref);
      }, sd != null ? sd : hitDelay(e.ref)); break;
      case 'heal': later(() => floatText(rectOf(e.ref, prev), '+' + e.n, 'heal'), sd != null ? sd : d); break;
      case 'shield': later(() => floatText(rectOf(e.ref, prev), '보호막!', 'info'), sd != null ? sd : hitDelay(e.ref)); break;
      case 'death': later(() => floatText(rectOf(e.ref, prev), '💥', 'boom'), sd != null ? sd : atk ? DEATH_AT : 300); break;
      case 'assemble': playAssemble(e, prev); break;
      case 'poison': floatText(rectOf(e.ref, prev), POISON_INFO[e.kind].icon + (e.adv ? ' 상급 ' : ' ') + POISON_INFO[e.kind].name, 'info'); break;
      case 'poisonTick': later(() => floatText(rectOf(e.ref, prev), POISON_INFO[e.kind].icon + ' -' + e.n, 'dmg'), POISON_KINDS.indexOf(e.kind) * 250); break;
      case 'mutate': later(() => floatText(rectOf(e.ref, prev), '🧬 +' + e.n + '/+' + e.n, 'heal'), POISON_KINDS.indexOf(e.kind) * 250); break;
      case 'immune': floatText(rectOf(e.ref, prev), '🧚 감염 내성', 'heal'); break;
      case 'freeze': floatText(rectOf(e.ref, prev), '❄ 빙결', 'info'); break;
      case 'buff': floatText(rectOf(e.ref, prev), '▲', 'heal'); break;
      case 'grow': floatText(rectOf(e.ref, prev), '🌱 성장!', 'heal'); break;
      case 'herbEat': floatText(rectOf(e.ref, prev), '🌿🧄 냠 +1/+1', 'heal'); break;
      case 'tutor': if (e.pi === App.me) toast(`🐾 [${CARDS[e.id].name}]을(를) 찾아왔습니다!`); break;
      case 'feedGrow': floatText(rectOf(e.ref, prev), '🌱 성장 1턴 빨라짐', 'heal'); break;
      case 'eat': playEat(e, prev); break;
      case 'devour':
        lunge(e.ref, e.prey);
        later(() => { floatText(rectOf(e.prey, prev), '🥸 꿀꺽!', 'dmg'); floatText(rectOf(e.ref, prev), '+' + CARDS[e.id].name, 'heal'); }, HIT_AT);
        toast(`🥸 돼지인 척하는 사람이 [${CARDS[e.id].name}]을(를) 잡아먹었습니다!`, 2200);
        break;
      case 'meat': later(() => floatText(rectOf(e.ref, prev), CARDS[e.id].emoji + ' ' + CARDS[e.id].name + '!', 'heal'), (atk ? DEATH_AT : 300) + 200); break;
      case 'herb':
        floatText(rectOf('h' + e.pi, prev), (e.ssuk ? '🌿+' + e.ssuk + ' ' : '') + (e.garlic ? '🧄+' + e.garlic : ''), 'heal');
        break;
      case 'abduct':
        playAbduct(e, prev);
        toast(`🐯 [${CARDS[e.tigerId].name}]이(가) [${CARDS[e.id].name}]을(를) 물고 동굴로 들어갔습니다!`, 2600);
        break;
      case 'wedding':
        banner('💒 결혼식!');
        later(() => { floatText(rectOf(e.tiger, prev), '💒 결혼!', 'heal'); floatText(rectOf(e.spouse, prev), '💍', 'heal'); }, 200);
        toast(`💒 [${CARDS[e.captiveId].name}]이(가) 사람이 되어 [${CARDS[e.tigerId].name}]와(과) 결혼! 👰 신부 버프: ${e.buff || ''}`, 3400);
        break;
      case 'debuff': floatText(rectOf(e.ref, prev), '▼', 'dmg'); break;
      case 'steal': toast(`🧠 [${CARDS[getChar(s, e.ref)?.m?.id]?.name || '소환물'}]을(를) 빼앗았습니다!`); break;
      case 'play':
        if (e.pi !== App.me || App.mode === 'ai' && e.pi === 1) showPlayed(e.id, e.pi);
        break;
      case 'heropower':
        if (e.pi !== App.me) toast(`${s.players[e.pi].name}: 영웅 능력 [${RACES[s.players[e.pi].race].heroPower.name}]`);
        break;
      case 'turn':
        banner(App.mode === 'hotseat' ? `${s.players[e.pi].name}의 턴` : (e.pi === App.me ? '내 턴!' : '상대 턴'));
        break;
      case 'burn': toast(`${who(e.pi)} 손패가 가득 차서 [${CARDS[e.id].name}]이(가) 불탔습니다`); break;
      case 'fatigue': toast(`${who(e.pi)} 덱이 비었습니다! 피로 피해 ${e.n}`); break;
      case 'discard': toast(`${who(e.pi)} [${CARDS[e.id].name}] 카드가 버려졌습니다 😈`); break;
      case 'bounce': toast(`[${CARDS[e.id].name}]이(가) 손으로 되돌아갔습니다`); break;
    }
  }
}

let playedTimer = null;
function showPlayed(id, pi) {
  const el = $('#played');
  el.innerHTML = `<div class="who">${esc(App.state.players[pi].name)}</div>` + cardHTML(id);
  clearTimeout(playedTimer);
  playedTimer = setTimeout(() => { el.innerHTML = ''; }, 1800);
}

// ───────────── 조작 ─────────────
function clearSel() { App.sel = null; App.pending = null; App.targets = []; App.inspect = null; }
function cancelSel() {
  if (TOUCH) $('#preview').innerHTML = '';
  if (App.sel != null || App.pending || App.inspect != null) { clearSel(); render(); }
}

function act(a) {
  clearSel();
  if (App.mode === 'arena') {
    if (App.spectating) return render();
    if (ArenaClient.isHost) Arena.action(ArenaClient.you, App.viewing, a);
    else { Net.send({ type: 'action', id: App.viewing, a }); render(); }
    return;
  }
  const ok = applyAction(App.state, App.me, a);
  if (!ok) { toast('지금은 할 수 없습니다.'); render(); return; }
  afterAction();
}

function afterAction() {
  const s = App.state;
  render();
  if (s.winner != null) return;
  if (App.mode === 'hotseat' && s.current !== App.me) setTimeout(handoff, 700);
  if (App.mode === 'ai' && s.current === 1) runAI();
}

function onHand(uid) {
  const s = App.state;
  if (TOUCH && App.inspect !== uid && !(App.pending && App.pending.uid === uid)) {
    App.inspect = uid;
    const h = s.players[App.me].hand.find(x => x.uid === uid);
    if (h) $('#preview').innerHTML = cardHTML(h.id);
    render();
    return toast(isMyTurn() ? '👆 한 번 더 누르면 사용합니다' : '상대의 턴입니다', 1200);
  }
  App.inspect = null; if (TOUCH) $('#preview').innerHTML = '';
  if (!isMyTurn()) { render(); return toast('상대의 턴입니다.'); }
  if (App.pending && App.pending.uid === uid) return cancelSel();
  const chk = canPlayCard(s, App.me, uid);
  if (!chk.ok) { clearSel(); render(); return toast(chk.reason); }
  const h = s.players[App.me].hand.find(x => x.uid === uid), c = CARDS[h.id];
  if (c.target) {
    const vt = validTargets(s, App.me, c.target);
    if (vt.length) {
      clearSel();
      App.pending = { kind: 'play', uid };
      App.targets = vt;
      render();
      return toast('대상을 선택하세요 (우클릭: 취소)', 1400);
    }
  }
  act({ type: 'play', uid });
}

function onHeroPower() {
  const s = App.state;
  if (TOUCH && App.inspect !== 'hp' && !(App.pending && App.pending.kind === 'hero')) {
    App.inspect = 'hp';
    return toast(isMyTurn() ? '👆 한 번 더 누르면 영웅 능력을 씁니다' : '상대의 턴입니다', 1200);
  }
  App.inspect = null; if (TOUCH) $('#preview').innerHTML = '';
  if (!isMyTurn()) return toast('상대의 턴입니다.');
  if (App.pending && App.pending.kind === 'hero') return cancelSel();
  const chk = canHeroPower(s, App.me);
  if (!chk.ok) return toast(chk.reason);
  const hp = RACES[s.players[App.me].race].heroPower;
  if (hp.target) {
    clearSel();
    App.pending = { kind: 'hero' };
    App.targets = validTargets(s, App.me, hp.target);
    render();
    return toast('대상을 선택하세요 (우클릭: 취소)', 1400);
  }
  act({ type: 'hero' });
}

function onRef(ref) {
  const s = App.state;
  if (App.targets.includes(ref)) {
    if (App.pending && App.pending.kind === 'play') return act({ type: 'play', uid: App.pending.uid, target: ref });
    if (App.pending && App.pending.kind === 'hero') {
      const hp = RACES[s.players[App.me].race].heroPower;
      if (hp.target2 && !App.pending.first) {
        App.pending.first = ref;
        App.targets = validTargets(s, App.me, hp.target).filter(r => r !== ref);
        render();
        return toast('🔧 합칠 두 번째 광물을 고르세요' + (TOUCH ? ' (한 번 누르면 결과 미리보기)' : ' (마우스를 올리면 결과 미리보기)'), 1800);
      }
      if (hp.target2) {
        if (TOUCH && App.inspect !== ref) { App.inspect = ref; showRecipePreview(App.pending.first, ref); return toast('👆 한 번 더 누르면 조립합니다', 1200); }
        return act({ type: 'hero', target: App.pending.first, target2: ref });
      }
      return act({ type: 'hero', target: ref });
    }
    if (App.sel != null) return act({ type: 'attack', uid: App.sel, target: ref });
  }
  if (ref[0] === 'm' && isMyTurn() && !App.pending) {
    const c = getChar(s, ref);
    if (c && c.m.cave && CARDS[c.m.id].meat) return toast(`${CARDS[c.m.id].emoji} 고기입니다. 내 턴이 끝날 때 아무 돼지가 주워 먹습니다.`);
    if (c && c.m.cave) return toast('🕳️ 동굴입니다. 안의 짝은 2턴 뒤 쑥·마늘을 먹고 나와 결혼합니다. (마우스를 올리면 자세히)');
    if (c && c.pi === App.me) {
      if (App.sel === c.m.uid) return cancelSel();
      if (canAttack(c.m)) {
        clearSel();
        App.sel = c.m.uid;
        App.targets = attackTargets(s, App.me);
        $('#preview').innerHTML = '';
        render();
        if (TOUCH) toast('⚔ 공격할 적을 누르세요 (끌어서 놓아도 됩니다)', 1500);
        return;
      }
      clearSel(); render();
      const m = c.m;
      if (isMineral(m)) return toast('⛏ 광물은 공격할 수 없습니다. 영웅 능력 「조립」으로 포탑을 만드세요!');
      if (m.frozen) return toast('빙결되어 이번 턴에 공격할 수 없습니다.');
      if (m.atk <= 0) return toast('공격력이 0이라 공격할 수 없습니다.');
      if (m.sleeping && !m.charge) return toast('이번 턴에 나온 소환물은 다음 턴부터 공격할 수 있습니다.');
      return toast('이미 공격했습니다.');
    }
  }
  if (App.sel != null || App.pending) {
    if (App.targets.length && ref[0] === 'm' && getChar(s, ref)?.pi !== App.me && App.sel != null) toast('도발 소환물을 먼저 공격해야 합니다! (또는 은신 상태)');
    cancelSel();
  }
}

$('#game').addEventListener('click', e => {
  if (!App.state) return;
  if (e.target.closest('#endTurn')) { if (isMyTurn()) act({ type: 'end' }); return; }
  if (e.target.closest('#menuBtn')) return openGameMenu();
  if (e.target.closest('#fsBtn')) return goFullscreen();
  if (TOUCH && !e.target.closest('[data-hand]') && !e.target.closest('[data-ref]') && App.inspect != null && App.inspect !== 'hp' && !e.target.closest('[data-hpower]')) { App.inspect = null; $('#preview').innerHTML = ''; render(); }
  const refEl = e.target.closest('[data-ref]');
  if (refEl) return onRef(refEl.dataset.ref);
  const handEl = e.target.closest('[data-hand]');
  if (handEl) return onHand(+handEl.dataset.hand);
  if (e.target.closest('[data-hpower]')) return onHeroPower();
  cancelSel();
});
$('#game').addEventListener('contextmenu', e => { e.preventDefault(); cancelSel(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelSel();
  if ((e.key === ' ' || e.key === 'Enter') && $('#overlay').classList.contains('hidden') && isMyTurn() && document.activeElement === document.body) {
    e.preventDefault(); act({ type: 'end' });
  }
});

// 마우스 올리면 카드 크게 보기
let pvTimer = null;
$('#game').addEventListener('mouseover', e => {
  const s = App.state;
  if (!s) return;
  const pv = $('#preview');
  if (TOUCH) {
    if (e.target.closest('[data-hand]') || (App.inspect != null && App.inspect !== 'hp')) return;
    // 공격 대상 고르는 중이거나, 공격할 수 있는 내 소환물을 누른 경우엔 크게 보기를 띄우지 않음 (적을 가리지 않게)
    const tEl = e.target.closest('[data-ref]');
    const tc = tEl && getChar(s, tEl.dataset.ref);
    if (App.sel != null || App.pending || (tc && !tc.hero && tc.pi === App.me && isMyTurn() && canAttack(tc.m))) { pv.innerHTML = ''; return; }
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => { if (App.inspect == null || App.inspect === 'hp') pv.innerHTML = ''; }, 2600);
  }
  updatePredict(e.target.closest('[data-ref]'));
  const rEl = e.target.closest('[data-ref]');
  if (App.pending && App.pending.kind === 'hero' && App.pending.first && rEl && App.targets.includes(rEl.dataset.ref)) { showRecipePreview(App.pending.first, rEl.dataset.ref); return; }
  const mEl = e.target.closest('[data-ref^="m"]');
  if (mEl) {
    const c = getChar(s, mEl.dataset.ref);
    if (c && !c.hero && c.m.cave && CARDS[c.m.id].meat) { pv.innerHTML = cardHTML(c.m.id); return; }
    if (c && !c.hero && c.m.cave) {
      const p = c.p;
      const rows = p.cave.map(pr => `${CARDS[pr.tiger.id].name} ❤ ${CARDS[pr.captive.id].name}<br><span style="color:#ffe39a">→ ${pairStatus(p, pr).long}</span>`).join('<br>');
      pv.innerHTML = cardHTML('t_cave') + `<div style="margin-top:8px;font-weight:700;text-align:center;font-size:13px;line-height:1.5;text-shadow:0 1px 3px #000;max-width:240px">
        동굴 속 짝<br>${rows}<br><br>보유: 🌿쑥 ${p.ssuk} · 🧄마늘 ${p.garlic}<br>(짝 하나가 나올 때 쑥 1 + 마늘 1)</div>`;
      return;
    }
    if (c && !c.hero) {
      const m = c.m;
      const extra = [];
      Object.entries(m.poisons || {}).forEach(([k, pz]) => extra.push(`${POISON_INFO[k].icon} ${pz.adv ? '상급 ' : ''}${POISON_INFO[k].name}: 다음 턴 피해 ${pz.dmg}${pz.adv ? ' (매 턴 +1)' : ''}`));
      if (m.frozen) extra.push('❄ 빙결: 다음 공격 불가');
      const gc = CARDS[m.id].grow;
      if (gc) extra.push(`🌱 ${gc.turns - (m.age || 0)}턴 뒤 ${[].concat(gc.into).map(id => '[' + CARDS[id].name + ']').join(' 또는 ')}(으)로 성장`);
      if (m.fromId) extra.push(`💍 원래는 [${CARDS[m.fromId].name}]이었음`);
      if (m.brideBuff) extra.push(`👰 신부 버프: ${m.brideBuff}`);
      pv.innerHTML = cardHTML(m.id) + (extra.length ? `<div style="margin-top:8px;font-weight:700;text-align:center;font-size:13px;text-shadow:0 1px 3px #000">${extra.join('<br>')}</div>` : '');
      return;
    }
  }
  const hpEl = e.target.closest('[data-hpinfo]');
  if (hpEl) {
    const hp = RACES[hpEl.dataset.hpinfo].heroPower;
    pv.innerHTML = `<div class="card spell" style="--rc:${RACES[hpEl.dataset.hpinfo].color}"><div class="c-cost">${hp.cost}</div><div class="c-art">${hp.emoji}</div><div class="c-name">${hp.name}</div><div class="c-text"><div>${hp.text}</div></div><div class="c-type">영웅 능력 (턴마다 1번)</div></div>`;
    return;
  }
  pv.innerHTML = '';
});
$('#game').addEventListener('mouseleave', () => { $('#preview').innerHTML = ''; clearPredict(); });

// 드워프 조립: 두 광물을 합치면 나올 포탑을 크게 보여줌
function showRecipePreview(r1, r2) {
  const a = getChar(App.state, r1), b = getChar(App.state, r2);
  if (!a || !b || a.hero || b.hero) return;
  const id = recipeFor(CARDS[a.m.id].mineral, CARDS[b.m.id].mineral);
  if (id) $('#preview').innerHTML = `<div style="text-align:center;font-weight:900;margin-bottom:8px;text-shadow:0 2px 4px #000">🔧 조립 결과</div>` + cardHTML(id);
}

// 공격 대상에 마우스를 올리면 예상 피해를 미리 보여줌 (서로 주고받는 양)
function clearPredict() { document.querySelectorAll('.predict').forEach(x => x.remove()); }
function predictTag(el, html, cls) {
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'predict ' + cls;
  d.innerHTML = html;
  d.style.left = (r.left + r.width / 2) + 'px';
  d.style.top = (r.top + r.height / 2) + 'px';
  $('#fx').appendChild(d);
}
function updatePredict(refEl) {
  clearPredict();
  const s = App.state;
  if (!s || App.sel == null || !refEl || !App.targets.includes(refEl.dataset.ref)) return;
  const a = getChar(s, 'm' + App.sel), t = getChar(s, refEl.dataset.ref);
  if (!a || !t) return;
  const aEl = elByRef('m' + App.sel);
  const dmgText = (n, victim, poison) => {
    if (victim.shield && n > 0) return '보호막 깨짐';
    if (n <= 0) return '피해 없음';
    const dies = victim.hp - n <= 0 || poison;
    return `-${n}${dies ? ' 💀' : ''}`;
  };
  if (t.hero) {
    predictTag(refEl, `⚔ ${dmgText(a.m.atk, t.p, false)}`, 'hit');
    if (aEl) predictTag(aEl, '반격 없음', 'safe');
  } else {
    predictTag(refEl, `⚔ ${dmgText(a.m.atk, t.m, a.m.poison)}`, 'hit');
    if (aEl) predictTag(aEl, `반격 ${dmgText(t.m.atk, a.m, t.m.poison)}`, t.m.atk > 0 ? 'hit' : 'safe');
  }
}

// ───────────── AI ─────────────
function runAI() {
  if (App.aiBusy) return;
  App.aiBusy = true;
  const step = () => {
    const s = App.state;
    if (App.mode !== 'ai' || !s || s.winner != null || s.current !== 1) { App.aiBusy = false; render(); return; }
    let a = aiChoose(s, 1);
    if (!applyAction(s, 1, a)) { a = { type: 'end' }; applyAction(s, 1, a); }
    render();
    if (s.winner != null) { App.aiBusy = false; return; }
    if (s.current !== 1) { App.aiBusy = false; render(); return; }
    const longAnim = s.events.some(ev => ev.type === 'abduct');
    setTimeout(step, longAnim ? ABDUCT_MS + 400 : a.type === 'attack' ? 850 : 1000);
  };
  setTimeout(step, 1200);
}

// ───────────── 게임 시작 / 종료 ─────────────
function enterGame() {
  clearSel();
  App.lastSeq = -1;
  App.overShown = false;
  closeOverlay();
  show('game');
  render();
}

function startLocal(mode, races, names) {
  App.mode = mode;
  App.config = { races, names };
  App.state = createGame({ name: names[0], race: races[0] }, { name: names[1], race: races[1] });
  App.me = mode === 'ai' ? 0 : App.state.current;
  enterGame();
  if (mode === 'hotseat') handoff();
  if (mode === 'ai' && App.state.current === 1) runAI();
}

function handoff() {
  const s = App.state;
  if (!s || s.winner != null) return;
  const p = s.players[s.current];
  const o = overlay(`<div style="font-size:60px">${RACES[p.race].hero}</div>
    <h2>${esc(p.name)} (${RACES[p.race].name})의 차례</h2>
    <p>상대방은 화면을 보지 마세요! 👀</p>
    <button class="btn primary big" id="hoGo">준비 완료</button>`, true);
  o.querySelector('#hoGo').onclick = () => { App.me = s.current; closeOverlay(); App.lastSeq = -1; render(); };
}

function showGameOver() {
  const s = App.state;
  if (!s) return;
  if (App.mode === 'arena') return showArenaGameOver();
  let title, emoji;
  if (s.winner === 'draw') { title = '무승부'; emoji = '🤝'; }
  else if (App.mode === 'hotseat') { title = `${s.players[s.winner].name} 승리!`; emoji = RACES[s.players[s.winner].race].hero; }
  else if (s.winner === App.me) { title = '승리!'; emoji = '🏆'; }
  else { title = '패배...'; emoji = '💀'; }
  const rematchBtn = App.mode === 'guest'
    ? '<button class="btn primary" id="goRe">재대결 요청</button>'
    : '<button class="btn primary" id="goRe">재대결</button>';
  const o = overlay(`<div class="big-result">${emoji}</div><h2>${esc(title)}</h2>
    <div class="ov-btns">${rematchBtn}<button class="btn" id="goView">전장 보기</button><button class="btn ghost" id="goMenu">메인 메뉴</button></div>`);
  o.querySelector('#goRe').onclick = rematch;
  o.querySelector('#goView').onclick = () => {
    closeOverlay();
    toast('⚙ 버튼으로 메뉴를 다시 열 수 있습니다.');
  };
  o.querySelector('#goMenu').onclick = toMenu;
}

function showArenaGameOver() {
  const s = App.state, v = ArenaClient.view;
  const m = v && v.matches.find(x => x.id === App.viewing);
  const round = m ? m.round : '경기';
  let title, emoji;
  if (App.spectating) { title = s.winner === 'draw' ? round + ' 무승부' : round + ': ' + s.players[s.winner].name + ' 승리'; emoji = '🏁'; }
  else if (s.winner === 'draw') { title = round + ' 무승부 (동전 던지기로 진출자 결정)'; emoji = '🤝'; }
  else if (s.winner === App.me) { title = round === '결승' ? '🏆 전장 우승!' : round + ' 승리! ' + (round.startsWith('8강') ? '준결승' : '결승') + ' 진출!'; emoji = round === '결승' ? '🥇' : '🎉'; }
  else { title = round + ' 패배...'; emoji = '💀'; }
  const won = !App.spectating && s.winner === App.me, lost = !App.spectating && s.winner !== App.me;
  const note = won && round !== '결승' ? '다른 사람 경기가 끝나면 다음 경기가 바로 시작됩니다. (AI끼리 경기는 기다리지 않고 바로 끝냄)'
    : lost && !(v && v.practice) ? `랭크 점수는 이미 저장됐습니다. 지금 나가도 괜찮아요.` : '';
  const o = overlay('<div class="big-result">' + emoji + '</div><h2>' + esc(title) + '</h2><div class="status">' + note + '</div>' +
    '<div class="ov-btns">' +
    (won && round !== '결승' ? '<button class="btn primary big" id="goBracket">⏩ 다음 경기로</button>'
      : lost ? '<button class="btn primary big" id="goExit">🚪 나가기</button><button class="btn" id="goBracket">🏟 남은 경기 보기</button>'
      : '<button class="btn primary" id="goBracket">' + (round === '결승' ? '🏆 결과 보기' : '🏟 대진표 보기') + '</button>') +
    '<button class="btn ghost" id="goView">전장 보기</button></div>');
  o.querySelector('#goBracket').onclick = () => ArenaClient.backToBracket();
  const ex = o.querySelector('#goExit');
  if (ex) ex.onclick = () => {
    // 진 사람은 바로 나감. 단, 온라인 방장이 나가면 다른 사람 경기가 끝나므로 한 번 확인
    if (ArenaClient.isHost && Arena.H && !Arena.H.practice) return confirmLeaveArena(showArenaGameOver);
    toMenu();
  };
  o.querySelector('#goView').onclick = () => { closeOverlay(); toast('⚙ 버튼으로 대진표로 돌아갈 수 있습니다.'); };
}

function rematch() {
  const cfg = App.config;
  if (App.mode === 'ai' || App.mode === 'hotseat') return startLocal(App.mode, cfg.races, cfg.names);
  if (App.mode === 'host') return hostStartGame();
  if (App.mode === 'guest') { Net.send({ type: 'rematch' }); toast('재대결을 요청했습니다. 호스트가 수락하면 시작됩니다.'); }
}

function openGameMenu() {
  const s = App.state;
  const over = s.winner != null;
  const o = overlay(`<h2>메뉴</h2><div class="ov-btns" style="flex-direction:column">
    <button class="btn" id="gmBack">계속하기</button>
    ${App.mode === 'arena' ? '<button class="btn primary" id="gmBracket">🏟 대진표 보기</button>' : ''}
    ${over ? (App.mode === 'arena' ? '' : '<button class="btn primary" id="gmRe">결과 / 재대결</button>') : (App.spectating ? '' : '<button class="btn" id="gmGiveup">🏳 항복</button>')}
    <button class="btn" id="gmCodex">📖 카드 도감</button>
    <button class="btn ghost" id="gmMenu">메인 메뉴로</button></div>`);
  o.querySelector('#gmBack').onclick = closeOverlay;
  const bb = o.querySelector('#gmBracket'); if (bb) bb.onclick = () => ArenaClient.backToBracket();
  const re = o.querySelector('#gmRe'); if (re) re.onclick = showGameOver;
  const gu = o.querySelector('#gmGiveup');
  if (gu) gu.onclick = () => {
    closeOverlay();
    if (App.mode === 'arena') return act({ type: 'concede' });
    applyAction(App.state, App.me, { type: 'concede' });
    afterAction();
  };
  o.querySelector('#gmCodex').onclick = () => showCodex(s.players[App.me].race, openGameMenu);
  o.querySelector('#gmMenu').onclick = () => (App.mode === 'arena' ? confirmLeaveArena(openGameMenu) : toMenu());
}

// 화면 안에서 묻는 확인창 (브라우저 confirm 창은 웹 페이지 버전에서 막혀 있음)
function confirmBox(title, msg, yesLabel, noLabel, onYes, onNo) {
  const o = overlay(`<h2>${title}</h2><p>${msg}</p>
    <div class="ov-btns"><button class="btn primary" id="cbNo">${noLabel}</button><button class="btn ghost" id="cbYes">${yesLabel}</button></div>`);
  o.querySelector('#cbNo').onclick = () => { closeOverlay(); if (onNo) onNo(); };
  o.querySelector('#cbYes').onclick = () => { closeOverlay(); onYes(); };
}
// 전장에서 나가기: 꼭 한 번 더 확인 (실수로 눌러도 대진표에 남도록 기본 버튼은 '남기')
function confirmLeaveArena(onStay) {
  const v = ArenaClient.view;
  if (!v || v.phase === 'done') return toMenu();
  const hostOnline = ArenaClient.isHost && Arena.H && !Arena.H.practice;
  confirmBox('전장을 나갈까요?',
    hostOnline ? '방장이 나가면 전장이 끝나고 모든 친구의 연결이 끊어집니다.'
      : (Arena.H && Arena.H.practice) ? '나가면 지금 진행 중인 연습 전장이 끝납니다.'
      : '나가면 이번 전장에 다시 들어올 수 없습니다. (내 경기는 AI가 대신합니다)',
    '나가기', '🏟 전장에 남기', toMenu, onStay);
}
function lobbyBackClick() {
  if (App.mode === 'arena') return confirmLeaveArena(() => {});
  toMenu();
}

function toMenu() {
  Net.onData = null; Net.onClose = null;
  Net.close();
  App.state = null; App.mode = null; App.aiBusy = false;
  App.viewing = null; App.spectating = false;
  if (typeof Arena !== 'undefined') { Arena.H = null; ArenaClient.reset(); }
  if (typeof updateMenuRating === 'function') updateMenuRating();
  clearSel();
  closeOverlay();
  $('#preview').innerHTML = '';
  $('#banner').classList.remove('show');
  $('#played').innerHTML = '';
  show('menu');
}

// ───────────── 종족 선택 / 도감 / 규칙 ─────────────
// opts: { taken: {종족id: '고른 사람'}, mine: 내가 고른 종족id, locked: 더 못 고름, status: 안내 문구 }
function pickRace(title, cb, opts = {}) {
  App.racePick = { title, cb };
  drawRacePick(opts);
  show('raceSelect');
}
function drawRacePick(opts = {}) {
  const taken = opts.taken || {};
  $('#raceTitle').textContent = App.racePick.title;
  $('#raceStatus').innerHTML = opts.status || '';
  $('#raceList').innerHTML = Object.values(RACES).map(r => {
    const who = taken[r.id], isMine = opts.mine === r.id;
    let btn = `<button class="btn primary" data-pick="${r.id}">선택</button>`;
    if (who) btn = `<div class="taken-label">🔒 ${esc(who)} 선택</div>`;
    else if (isMine) btn = `<div class="mine-label">✔ 내 종족</div>`;
    else if (opts.locked) btn = '';
    return `<div class="race-card ${who ? 'taken' : ''} ${isMine ? 'mine' : ''}" style="--rc:${r.color}" data-race="${r.id}">
      <div class="race-emoji">${r.hero}</div>
      <div class="race-name">${r.name}</div>
      <div class="race-desc">${r.desc}</div>
      <div class="race-style">${r.style}</div>
      <div class="race-power"><b>영웅 능력 · ${r.heroPower.name}</b> (💎${r.heroPower.cost})<br>${r.heroPower.text}</div>
      ${opts.notes && opts.notes[r.id] ? `<div class="race-note">👤 ${esc(opts.notes[r.id])}</div>` : ''}
      <div class="race-btns">${btn}<button class="btn" data-view="${r.id}">카드 보기</button></div>
    </div>`;
  }).join('');
  $('#raceList').onclick = e => {
    const p = e.target.closest('[data-pick]'), v = e.target.closest('[data-view]');
    if (p) App.racePick.cb(p.dataset.pick);
    if (v) showCodex(v.dataset.view);
  };
}
$('#raceBack').onclick = toMenu;

function showCodex(race, onClose) {
  const draw = r => {
    const cards = CARD_LIST.filter(c => c.race === r);
    const sec = (label, list) => list.length ? `<div class="codex-sec">${label}</div>` + list.map(c => cardHTML(c.id)).join('') : '';
    const minions = cards.filter(c => c.type === 'minion' && !c.token).sort((a, b) => a.cost - b.cost);
    const spells = cards.filter(c => c.type === 'spell' && !c.token).sort((a, b) => a.cost - b.cost);
    const tokens = cards.filter(c => c.token);
    const R = RACES[r];
    const o = overlay(`<h2>${R.hero} ${R.name} 카드</h2>
      <div class="codex-tabs">${Object.values(RACES).map(x => `<button class="btn ${x.id === r ? 'on' : ''}" data-tab="${x.id}">${x.hero} ${x.name}</button>`).join('')}</div>
      <div style="font-size:14px;opacity:.85">덱 = 아래 카드 ${minions.length + spells.length}종 × 2장 = ${(minions.length + spells.length) * 2}장 · 영웅 능력 <b>${R.heroPower.name}</b>: ${R.heroPower.text}</div>
      <div class="codex-grid">${sec('소환물 (1~7 코스트)', minions)}${sec(R.spellLabel + ' (1~3 코스트)', spells)}${sec('토큰 (덱에 없음)', tokens)}</div>
      <div class="kw-list">${Object.entries(KEYWORD_HELP).map(([k, v]) => `<b>${k}</b>: ${v}`).join(' &nbsp;·&nbsp; ')}</div>
      <button class="btn" id="cxClose">닫기</button>`);
    o.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => draw(b.dataset.tab); });
    o.querySelector('#cxClose').onclick = () => { closeOverlay(); if (onClose) onClose(); };
  };
  draw(race);
}

function showRules() {
  const o = overlay(`<h2>게임 방법</h2><div class="rules">
    <h3>목표</h3>상대 영웅의 생명력 30을 먼저 0으로 만들면 승리!
    <h3>턴 진행</h3>
    · 매 턴 마나(💎)가 1씩 늘어나고(최대 10) 전부 채워지며, 카드를 1장 뽑습니다.<br>
    · 선공은 카드 3장, 후공은 4장 + <b>행운의 동전</b>(이번 턴 마나 +1)으로 시작합니다.<br>
    · 덱은 <b>3개 페이즈</b>로 나뉩니다: <b>초반</b>(1~3턴) 1~2코스트 · <b>중반</b>(4~6턴) 3~4코스트 · <b>후반</b>(7턴~) 5~7코스트 카드가 주로 나옵니다.<br>
    · 덱이 비면 뽑을 때마다 피로 피해가 1, 2, 3… 늘어납니다.
    <h3>조작</h3>
    · <b>손패 클릭</b>: 카드 사용 (대상이 필요하면 빨갛게 빛나는 대상을 클릭)<br>
    · <b>초록색으로 빛나는 내 소환물 클릭 → 적 클릭</b>: 공격 (소환물은 다음 턴부터 공격 가능, <b>속공</b>이 붙은 소환물은 바로 공격)<br>
    · <b>소환물끼리 싸우면 서로 공격력만큼 주고받습니다.</b> 영웅을 때리면 반격은 없습니다. 공격 대상에 마우스를 올리면 예상 피해가 미리 보입니다.<br>
    · <b>영웅 능력</b>(초상화 오른쪽 동그라미): 마나 2, 턴마다 1번<br>
    · <b>우클릭 / ESC</b>: 선택 취소 · <b>스페이스</b>: 턴 종료 · 마우스를 올리면 카드 설명이 크게 보입니다.<br>
    · 할 수 있는 행동이 없으면 턴 종료 버튼이 초록색으로 깜빡입니다.
    <h3>⚔ 전장 (최대 8명 토너먼트)</h3>
    · 방장이 <b>전장 만들기</b> → 5자리 코드를 알려주면 친구들(최대 7명)이 <b>전장 참가</b>로 들어옵니다. 빈자리는 🤖 AI가 채웁니다.<br>
    · 판마다 종족을 <b>선착순</b>으로 다시 고릅니다. 종족은 6개라 <b>종족마다 최대 2명</b>까지 고를 수 있고, 같은 종족 2명은 대진표 반대편에 배치되어 <b>결승 전에는 만나지 않습니다</b>.<br>
    · <b>8강 4경기</b>(동시 진행) → <b>준결승</b> → <b>결승</b>. 3연승해야 우승! 탈락하면 남은 경기를 관전할 수 있습니다.<br>
    · <b>랭크 점수</b>: 1000점에서 시작. 경기마다 강한 상대를 이기면 많이 오르고, 약한 상대에게 지면 많이 떨어집니다. 우승하면 보너스 +15.<br>
    · <b>전장 연습</b>: 나 + AI 7명으로 똑같이 진행, 점수는 바뀌지 않습니다.<br>
    · <b>연습 게임 (1:1)</b>만 종족을 자유롭게 고를 수 있고, AI는 나와 다른 종족으로 나옵니다.<br>
    (두 사람 모두 이 게임 폴더를 가지고 있어야 하고, 인터넷이 연결되어 있어야 합니다.)
    <h3>키워드</h3>${Object.entries(KEYWORD_HELP).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>')}
    </div><button class="btn" id="ruClose">닫기</button>`);
  o.querySelector('#ruClose').onclick = closeOverlay;
}

// ───────────── 메인 메뉴 버튼 ─────────────
$('#btnCodex').onclick = () => showCodex('human');
$('#btnRules').onclick = showRules;

// 연습: 내 종족은 자유 선택, AI는 나와 다른 종족
$('#btnAI').onclick = () => pickRace('🤖 연습 게임 — 내 종족을 고르세요', race => {
  const aiRace = pick(Object.keys(RACES).filter(r => r !== race));
  startLocal('ai', [race, aiRace], [myName(), `AI ${RACES[aiRace].name}`]);
}, { status: '연습 게임은 원하는 종족을 자유롭게 고를 수 있습니다. AI는 다른 종족으로 나옵니다.' });

// ───────────── 온라인 ─────────────
function lobby(title, html) {
  $('#lobbyTitle').textContent = title;
  $('#lobbyBody').innerHTML = html;
  show('lobby');
}
$('#lobbyBack').onclick = lobbyBackClick;

function netLost() {
  if (App.mode !== 'arena') return;
  const o = overlay(`<h2>🔌 연결이 끊어졌습니다</h2><p>방장과의 연결이 끊어졌습니다.</p><button class="btn" id="nlMenu">메인 메뉴</button>`);
  o.querySelector('#nlMenu').onclick = toMenu;
}

// 카드 설명이 칸을 넘치면 글자 크기를 자동으로 줄임
function fitCardTexts() {
  document.querySelectorAll('.c-text').forEach(el => {
    if (el.dataset.fit) return;
    el.dataset.fit = '1';
    let fs = parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 10 && el.scrollHeight > el.clientHeight + 1; i++) {
      fs *= 0.9;
      el.style.fontSize = fs + 'px';
    }
  });
}
let fitQueued = false;
new MutationObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitCardTexts(); });
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => {
  document.querySelectorAll('.c-text').forEach(el => { delete el.dataset.fit; el.style.fontSize = ''; });
  fitCardTexts();
});

if (window.JJ_NO_ONLINE) {
  ['#btnHost', '#btnJoin'].forEach(sel => { const b = $(sel); if (b) b.style.display = 'none'; });
  const note = document.createElement('div');
  note.className = 'web-note';
  note.innerHTML = '🌐 이 웹 버전에서는 <b>친구와 온라인 전장</b>이 안 됩니다.<br>전장 연습(나 + AI 7명)과 1:1 연습은 모두 할 수 있어요.';
  $('.menu-btns').prepend(note);
}
if (TOUCH) {
  document.addEventListener('pointerup', () => { if (!document.fullscreenElement) goFullscreen(true); }, true);
}
$('#btnFull').onclick = () => goFullscreen();
$('#btnFull2').onclick = () => goFullscreen();

window.addEventListener('beforeunload', () => Net.close());
show('menu');
