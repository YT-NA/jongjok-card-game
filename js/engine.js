'use strict';
// =====================================================================
//  엉뚱 한마당 - 게임 규칙 엔진 (상태는 순수 데이터 → 온라인 전송 가능)
// =====================================================================
const MAX_BOARD = 7, MAX_HAND = 10, HERO_HP = 30;
const CARDS = {};
CARD_LIST.forEach(c => { CARDS[c.id] = c; });
// 드워프 광물: 공격 불가, 공격력 강화의 대상이 될 수 없음
function isMineral(m) { return !!CARDS[m.id].mineral; }
function markNoMineral(spec, effects) {
  if (spec && (effects || []).some(e => e.to === 'target' && e.t === 'buff' && (e.atk || 0) > 0)) spec.noMineral = true;
}
CARD_LIST.forEach(c => markNoMineral(c.target, [...(c.effects || []), ...(c.battlecry || [])]));
Object.values(RACES).forEach(r => markNoMineral(r.heroPower.target, r.heroPower.effects));
const KW_NAMES = { taunt: '도발', charge: '속공', shield: '보호막', poison: '독성', stealth: '은신' };

function rnd(n) { return Math.floor(Math.random() * n); }
function pick(a) { return a.length ? a[rnd(a.length)] : null; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function ev(s, e) { s.events.push(e); }
function log(s, m) { s.log.push(m); if (s.log.length > 60) s.log.shift(); }
function raceOf(id) { const c = CARDS[id]; return RACES[c.race] || NEUTRAL; }

const MINERAL_ICON = { 1: '🪨돌', 2: '⛓️철', 3: '🟡금', 4: '🔷미스릴' };
// 조합표: 등급 2개 → 포탑 id
// 광석 바르기: 녹슨 포탑은 수리, 진화 포탑·진화 로봇은 레벨업
function upgradeMachine(s, pi, ore, mach) {
  const me = s.players[pi];
  const grade = CARDS[ore.id].mineral, kind = CARDS[mach.id].upgrade, before = CARDS[mach.id].name;
  me.board.splice(me.board.indexOf(ore), 1);
  let label;
  if (kind === 'repair') {
    const n = CARDS.d_fixed;
    mach.id = 'd_fixed'; mach.atk = n.atk; mach.hp = n.hp; mach.maxHp = n.hp;
    label = '🔧 수리 완료!';
  } else if (kind === 'turret') {
    mach.level = (mach.level || 1) + 1;
    mach.turretBonus = (mach.turretBonus || 0) + (grade >= 4 ? 2 : 1);
    mach.hp += 2; mach.maxHp += 2;
    label = `⬆ Lv.${mach.level} 사격 ${CARDS[mach.id].turret + mach.turretBonus}`;
  } else {
    mach.level = (mach.level || 1) + 1;
    mach.atk += grade >= 3 ? 2 : 1; mach.hp += 2; mach.maxHp += 2;
    label = `⬆ Lv.${mach.level} ${mach.atk}/${mach.hp}`;
  }
  ev(s, { type: 'upgrade', pi, ore: 'm' + ore.uid, ref: 'm' + mach.uid, oreId: ore.id, label });
  log(s, `🔧 [${CARDS[ore.id].name}]을(를) [${before}]에 발라서 ${label}`);
}

function recipeFor(g1, g2) {
  const [a, b] = [g1, g2].sort((x, y) => x - y);
  const c = CARD_LIST.find(x => x.recipe && x.recipe[0] === a && x.recipe[1] === b);
  return c ? c.id : null;
}

function cardText(c) {
  const parts = [];
  if (c.kw && c.kw.length) parts.push(c.kw.map(k => `<b>${KW_NAMES[k]}</b>`).join(', '));
  if (c.mineral) parts.unshift(`<b>광물</b> (등급 ${c.mineral})`);
  if (c.recipe) parts.unshift(`<b>조합:</b> ${c.recipe.map(g => MINERAL_ICON[g]).join(' + ')}`);
  if (c.sd) parts.push(`<b>주문 공격력 +${c.sd}</b>`);
  if (c.turret) parts.push(`<b>자동 사격:</b> 내 턴이 끝날 때 무작위 적에게 피해 ${c.turret}`);
  if (c.turretAll) parts.push(`<b>자동 사격:</b> 내 턴이 끝날 때 모든 적 소환물에게 피해 ${c.turretAll}`);
  if (c.turretMulti) parts.push(`<b>자동 사격:</b> 내 턴이 끝날 때 무작위 적에게 피해 ${c.turretMulti.n}씩 ${c.turretMulti.count}발`);
  if (c.turretFace) parts.push(`<b>자동 사격:</b> 내 턴이 끝날 때 적 영웅에게 피해 ${c.turretFace}`);
  if (c.turretFreeze) parts.push('맞은 적 소환물은 <b>빙결</b>됩니다.');
  if (c.turretHeal) parts.push(`쏠 때마다 모든 아군 소환물의 생명력을 ${c.turretHeal} 회복합니다.`);
  if (c.text) parts.push(c.text);
  if (c.grow) {
    const opts = [].concat(c.grow.into).map(id => `${CARDS[id].name}(${CARDS[id].atk}/${CARDS[id].hp})`);
    parts.push(`<b>성장(${c.grow.turns}턴):</b> ${opts.join(' 또는 ')}(으)로 자랍니다.`);
  }
  return parts.join('<br>');
}

// 덱: 종족 카드(토큰 제외) 15종 × 2장 = 30장을 3개 페이즈 더미로 나눔
//  초반(1~3턴): 1~2코스트 · 중반(4~6턴): 3~4코스트 · 후반(7턴~): 5~7코스트
const PHASE_NAMES = ['초반', '중반', '후반'];
function cardPhase(c) { return c.cost <= 2 ? 0 : c.cost <= 4 ? 1 : 2; }
function buildPiles(race) {
  const piles = [[], [], []];
  CARD_LIST.filter(c => c.race === race && !c.token).forEach(c => piles[cardPhase(c)].push(c.id, c.id));
  piles.forEach(shuffle);
  return piles;
}
function phaseOf(p) { return p.maxMana <= 3 ? 0 : p.maxMana <= 6 ? 1 : 2; }
function deckCount(p) { return p.piles.reduce((a, x) => a + x.length, 0); }

function createGame(a, b, first) {
  const s = { players: [], current: 0, turn: 0, winner: null, nextUid: 1, seq: 0, events: [], log: [] };
  [a, b].forEach((p, i) => s.players.push({
    idx: i, name: p.name, race: p.race, hp: HERO_HP, maxHp: HERO_HP, mana: 0, maxMana: 0,
    piles: buildPiles(p.race), hand: [], board: [], fatigue: 0, heroPowerUsed: false,
    ssuk: 0, garlic: 0, cave: [], poisons: {}, weather: null, time: p.race === 'owl' ? 'day' : null,
  }));
  if (first == null) first = rnd(2);
  s.current = first;
  for (let i = 0; i < 3; i++) drawCard(s, first);
  for (let i = 0; i < 4; i++) drawCard(s, 1 - first);
  addToHand(s, 1 - first, 'coin');
  log(s, `${s.players[first].name} 님이 선공입니다.`);
  startTurn(s);
  return s;
}

// ───────────── 기본 동작 ─────────────
function addToHand(s, pi, id) {
  const p = s.players[pi];
  if (p.hand.length >= MAX_HAND) {
    ev(s, { type: 'burn', pi, id });
    log(s, `${p.name}: 손패가 가득 차 [${CARDS[id].name}] 소멸`);
    return null;
  }
  const h = { uid: s.nextUid++, id };
  p.hand.push(h);
  return h;
}

function drawCard(s, pi) {
  const p = s.players[pi];
  const ph = phaseOf(p);
  let order = [ph, ph - 1, ph + 1, ph - 2, ph + 2];
  if (ph > 0 && Math.random() < 0.25) order = [ph - 1, ...order]; // 가끔 이전 페이즈 카드
  const pile = order.filter(i => i >= 0 && i < 3).map(i => p.piles[i]).find(x => x.length);
  if (!pile) {
    p.fatigue++;
    ev(s, { type: 'fatigue', pi, n: p.fatigue });
    log(s, `${p.name}: 덱이 비어 피로 피해 ${p.fatigue}`);
    dealDamage(s, 'h' + pi, p.fatigue);
    return;
  }
  addToHand(s, pi, pile.pop());
}

// ───────────── 페어리 감염(독) ─────────────
const POISON_KINDS = ['rot', 'nerve', 'acid'];
const POISON_INFO = {
  rot: { name: '부패독', icon: '🟢' },
  nerve: { name: '신경독', icon: '🟣' },
  acid: { name: '산성독', icon: '🟠' },
};
// 요정은 감염 내성 (돌연변이 괴수 제외), 페어리 영웅도 내성
function poisonImmune(s, c) {
  if (c.hero) return c.p.race === 'fairy';
  const card = CARDS[c.m.id];
  return card.race === 'fairy' && !card.mutant;
}
// 독 걸기: 처음이면 일반(피해 1), 이미 걸린 독이면 상급(매 턴 +1씩 세짐)
function applyPoison(s, ref, kind, adv) {
  const c = getChar(s, ref);
  if (!c || !POISON_INFO[kind]) return;
  if (!c.hero && !isUnit(c.m)) return;
  if (poisonImmune(s, c)) { ev(s, { type: 'immune', ref }); return; }
  const holder = c.hero ? c.p : c.m;
  holder.poisons = holder.poisons || {};
  const cur = holder.poisons[kind];
  if (cur) { if (!cur.adv) { cur.adv = true; ev(s, { type: 'poison', ref, kind, adv: true }); } }
  else { holder.poisons[kind] = { adv: !!adv, dmg: 1 }; ev(s, { type: 'poison', ref, kind, adv: !!adv }); }
}
// 턴 시작 시 독 피해
function tickPoisons(s, ref) {
  const c = getChar(s, ref);
  if (!c) return;
  const holder = c.hero ? c.p : c.m;
  const ps = holder.poisons || {};
  for (const k of POISON_KINDS) {
    const pz = ps[k];
    if (!pz) continue;
    if (!c.hero && !alive(c.m)) return;
    const dmg = pz.dmg;
    if (!c.hero && CARDS[c.m.id].mutant) {
      // 돌연변이: 다치는 대신 강해짐
      c.m.atk += dmg; c.m.hp += dmg; c.m.maxHp += dmg;
      ev(s, { type: 'mutate', ref, n: dmg, kind: k });
    } else {
      ev(s, { type: 'poisonTick', ref, kind: k, n: dmg });
      dealDamage(s, ref, dmg, { ignoreShield: true });
      if (!c.hero && k === 'nerve') c.m.atk = Math.max(0, c.m.atk - 1);
      if (!c.hero && k === 'acid') { c.m.taunt = false; c.m.shield = false; }
    }
    if (pz.adv) pz.dmg++;
  }
}

// 성장: 다른 카드로 변신하되 받은 강화/피해/독은 유지
function growMinion(s, m, newId) {
  if (Array.isArray(newId)) newId = pick(newId); // 갈림길 성장 (수퇘지/암퇘지)
  const o = CARDS[m.id], n = CARDS[newId];
  const dA = m.atk - o.atk, dH = m.maxHp - o.hp, dmg = m.maxHp - m.hp;
  m.id = newId;
  m.atk = Math.max(0, n.atk + dA);
  m.maxHp = n.hp + dH;
  m.hp = m.maxHp - dmg;
  (n.kw || []).forEach(k => { m[k] = true; });
  m.spellDmg = Math.max(m.spellDmg, n.sd || 0);
  m.age = 0;
  ev(s, { type: 'grow', ref: 'm' + m.uid });
  log(s, `[${o.name}] → [${n.name}] 성장!`);
}

function makeMinion(s, id) {
  const c = CARDS[id], kw = c.kw || [];
  return {
    uid: s.nextUid++, id, atk: c.atk, hp: c.hp, maxHp: c.hp,
    taunt: kw.includes('taunt'), charge: kw.includes('charge'), shield: kw.includes('shield'),
    poison: kw.includes('poison'), stealth: kw.includes('stealth'),
    cave: !!c.structure, spellDmg: c.sd || 0, poisons: {}, age: 0, frozen: false, sleeping: true, attacksLeft: 1, dead: false,
  };
}

function summon(s, pi, id, pos) {
  const p = s.players[pi];
  if (p.board.length >= MAX_BOARD) return null;
  const m = makeMinion(s, id);
  if (pos == null || pos > p.board.length) pos = p.board.length;
  p.board.splice(pos, 0, m);
  syncOwl(m, p);
  ev(s, { type: 'summon', ref: 'm' + m.uid });
  return m;
}

// ───────────── 아울: 낮과 밤 ─────────────
var OWL_DAY_HP = 1, OWL_NIGHT_ATK = 1;
function isOwl(m) { return CARDS[m.id].race === 'owl'; }
// 소환물이 지금 받고 있어야 할 낮/밤 보너스로 맞춤 (m.dn = 지금 받고 있는 보너스)
function syncOwl(m, p) {
  const want = p.time && isOwl(m) && isUnit(m) ? p.time : null;
  if ((m.dn || null) === want) return;
  if (m.dn === 'day') { m.maxHp -= OWL_DAY_HP; m.hp = Math.min(m.hp, m.maxHp); if (m.dTaunt) { m.taunt = false; m.dTaunt = false; } }
  if (m.dn === 'night') m.atk = Math.max(0, m.atk - OWL_NIGHT_ATK);
  if (want === 'day') { m.maxHp += OWL_DAY_HP; m.hp += OWL_DAY_HP; if (CARDS[m.id].dayTaunt && !m.taunt) { m.taunt = true; m.dTaunt = true; } }
  if (want === 'night') m.atk += OWL_NIGHT_ATK;
  m.dn = want;
  m.dozing = want === 'day';
}
function syncOwls(s) { s.players.forEach(p => p.board.forEach(m => syncOwl(m, p))); }
function flipMoon(s, pi, to) {
  const p = s.players[pi];
  if (p.race !== 'owl' || p.time === to) return;
  p.time = to;
  p.board.forEach(m => syncOwl(m, p));
  ev(s, { type: 'moonFlip', pi, time: to });
  log(s, to === 'night' ? `🌙 ${p.name}: 밤이 되었다! 부엉이들이 눈을 뜬다` : `☀️ ${p.name}: 낮이 되었다. 부엉이들이 잠든다`);
  for (const m of [...p.board]) {
    const c = CARDS[m.id];
    if (c.onFlip && isUnit(m)) runEffects(s, c.onFlip, { pi, source: m, target: null, isSpell: false });
  }
}

function alive(m) { return !m.dead && m.hp > 0; }
// 동굴 같은 구조물은 전장 칸만 차지하고, 공격·대상·효과에서 모두 제외
function isUnit(m) { return alive(m) && !m.cave; }

function getChar(s, ref) {
  if (!ref) return null;
  if (ref[0] === 'h') { const pi = +ref.slice(1); return { hero: true, pi, p: s.players[pi] }; }
  const uid = +ref.slice(1);
  for (const p of s.players) {
    const i = p.board.findIndex(m => m.uid === uid);
    if (i >= 0) return { hero: false, pi: p.idx, p, m: p.board[i], i };
  }
  return null;
}
function charName(s, ref) {
  const c = getChar(s, ref);
  if (!c) return '?';
  return c.hero ? `${c.p.name}(영웅)` : CARDS[c.m.id].name;
}

function dealDamage(s, ref, n, o = {}) {
  const c = getChar(s, ref);
  if (!c || n <= 0) return 0;
  if (c.hero) {
    c.p.hp -= n;
    ev(s, { type: 'dmg', ref, n });
    return n;
  }
  const m = c.m;
  if (m.shield && !o.ignoreShield) {
    m.shield = false;
    ev(s, { type: 'shield', ref });
    return 0;
  }
  m.hp -= n;
  if (o.poison) m.dead = true;
  ev(s, { type: 'dmg', ref, n, poison: !!o.poison });
  return n;
}

function healChar(s, ref, n) {
  const c = getChar(s, ref);
  if (!c) return;
  const t = c.hero ? c.p : c.m;
  const before = t.hp;
  t.hp = Math.min(t.maxHp, t.hp + n);
  if (t.hp > before) ev(s, { type: 'heal', ref, n: t.hp - before });
}

function spellDamage(s, pi) {
  return s.players[pi].board.reduce((a, m) => a + (alive(m) ? m.spellDmg : 0), 0);
}

function checkWinner(s) {
  if (s.winner != null) return;
  const a = s.players[0].hp <= 0, b = s.players[1].hp <= 0;
  if (a && b) s.winner = 'draw';
  else if (a) s.winner = 1;
  else if (b) s.winner = 0;
  if (s.winner != null) ev(s, { type: 'gameover', winner: s.winner });
}

const MEAT_IDS = ['h_meat1', 'h_meat2', 'h_meat3'];
function resolveDeaths(s) {
  for (let guard = 0; guard < 30; guard++) {
    const dead = [];
    for (const pi of [s.current, 1 - s.current]) {
      for (const m of s.players[pi].board) if (!alive(m)) dead.push({ m, pi });
    }
    if (!dead.length) break;
    for (const { m, pi } of dead) {
      const b = s.players[pi].board, i = b.indexOf(m);
      if (i >= 0) b.splice(i, 1);
      ev(s, { type: 'death', ref: 'm' + m.uid, id: m.id, pi });
    }
    for (const { m, pi } of dead) {
      const c = CARDS[m.id];
      if (c.deathrattle) runEffects(s, c.deathrattle, { pi, source: null, target: null, isSpell: false });
      // 돼지는 죽으면서 고기를 남김
      if (c.race === 'human' && c.type === 'minion' && !c.structure && !c.notPig && !m.eaten) {
        const meat = pick(MEAT_IDS);
        const b = s.players[pi].board;
        if (b.length < MAX_BOARD) {
          const mm = summon(s, pi, meat);
          ev(s, { type: 'meat', pi, ref: 'm' + m.uid, meatRef: 'm' + mm.uid, id: meat });
        }
      }
    }
  }
  checkWinner(s);
}

// ───────────── 효과 처리 ─────────────
function resolveTo(s, to, ctx) {
  const me = s.players[ctx.pi], op = s.players[1 - ctx.pi];
  const refs = p => p.board.filter(isUnit).map(m => 'm' + m.uid);
  const selfRef = ctx.source ? 'm' + ctx.source.uid : null;
  const one = r => (r ? [r] : []);
  switch (to) {
    case 'target': return ctx.target ? [ctx.target] : [];
    case 'self': return one(selfRef);
    case 'myHero': return ['h' + me.idx];
    case 'enemyHero': return ['h' + op.idx];
    case 'allEnemyMinions': return refs(op);
    case 'allEnemies': return [...refs(op), 'h' + op.idx];
    case 'allFriendlyMinions': return refs(me);
    case 'otherFriendlyMinions': return refs(me).filter(r => r !== selfRef);
    case 'allMinions': return [...refs(s.players[0]), ...refs(s.players[1])];
    case 'allOtherMinions': return [...refs(s.players[0]), ...refs(s.players[1])].filter(r => r !== selfRef);
    case 'randomEnemyMinion': return one(pick(refs(op)));
    case 'randomEnemy': return one(pick([...refs(op), 'h' + op.idx]));
    case 'randomFriendlyMinion': return one(pick(refs(me).filter(r => r !== selfRef)));
    case 'friendlyTigers': return me.board.filter(isTiger).map(m => 'm' + m.uid);
  }
  return [];
}

function minionsOf(s, refs) {
  return refs.map(r => getChar(s, r)).filter(c => c && !c.hero);
}

function runEffects(s, effects, ctx) {
  for (const e of effects) {
    if (s.winner != null) break;
    applyEffect(s, e, ctx);
  }
}

function applyEffect(s, e, ctx) {
  const me = s.players[ctx.pi], op = s.players[1 - ctx.pi];
  const sd = ctx.isSpell ? spellDamage(s, ctx.pi) : 0;
  switch (e.t) {
    case 'summon': {
      let pos = ctx.source ? me.board.indexOf(ctx.source) + 1 : null;
      for (let i = 0; i < (e.n || 1); i++) { if (summon(s, ctx.pi, e.id, pos) && pos != null) pos++; }
      break;
    }
    case 'fillBoard':
      while (me.board.length < MAX_BOARD) summon(s, ctx.pi, e.id);
      break;
    case 'damage':
      resolveTo(s, e.to, ctx).forEach(r => dealDamage(s, r, e.n + sd));
      break;
    case 'missiles': {
      let count = e.count === 'friendlyMinions' ? me.board.filter(isUnit).length : e.count;
      count += sd;
      for (let i = 0; i < count; i++) {
        const cands = [...op.board.filter(isUnit).map(m => 'm' + m.uid)];
        if (op.hp > 0) cands.push('h' + op.idx);
        const r = pick(cands);
        if (!r) break;
        dealDamage(s, r, e.n);
      }
      break;
    }
    case 'heal':
      resolveTo(s, e.to, ctx).forEach(r => healChar(s, r, e.n));
      break;
    case 'buff':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => {
        if (!isMineral(m)) m.atk += e.atk || 0;
        m.hp += e.hp || 0; m.maxHp += e.hp || 0;
        if (e.shield) m.shield = true; (e.kw || []).forEach(k => { m[k] = true; });
        ev(s, { type: 'buff', ref: 'm' + m.uid });
      });
      break;
    case 'flipMoon':
      flipMoon(s, ctx.pi, me.time === 'night' ? 'day' : 'night');
      break;
    case 'eclipse':
      if (me.race === 'owl') { if (me.time !== 'night') flipMoon(s, ctx.pi, 'night'); me.heroPowerUsed = false; }
      break;
    case 'buffPerFriendly': {
      const m = ctx.source;
      if (!m) break;
      const k = me.board.filter(x => x !== m && isUnit(x)).length;
      if (k > 0) { m.atk += k; if (!e.atkOnly) { m.hp += k; m.maxHp += k; } ev(s, { type: 'buff', ref: 'm' + m.uid }); }
      break;
    }
    case 'draw':
      for (let i = 0; i < e.n; i++) drawCard(s, ctx.pi);
      break;
    case 'freeze':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => { m.frozen = true; ev(s, { type: 'freeze', ref: 'm' + m.uid }); });
      break;
    case 'destroy':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => { m.dead = true; ev(s, { type: 'destroy', ref: 'm' + m.uid }); });
      break;
    case 'bounce':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(c => {
        c.p.board.splice(c.p.board.indexOf(c.m), 1);
        ev(s, { type: 'bounce', ref: 'm' + c.m.uid, id: c.m.id, pi: c.pi });
        log(s, `[${CARDS[c.m.id].name}] 손으로 되돌아감`);
        addToHand(s, c.pi, c.m.id);
      });
      break;
    case 'poison':
      resolveTo(s, e.to, ctx).forEach(r => {
        const kinds = e.kind === 'all' ? POISON_KINDS : [e.kind === 'random' ? pick(POISON_KINDS) : e.kind];
        kinds.forEach(k => applyPoison(s, r, k, e.adv));
      });
      break;
    case 'upgradePoison':
      resolveTo(s, e.to, ctx).forEach(r => {
        const c = getChar(s, r);
        if (!c) return;
        const ps = c.hero ? c.p.poisons : c.m.poisons;
        const ks = Object.keys(ps || {});
        if (!ks.length) applyPoison(s, r, 'rot', true);
        else ks.forEach(k => { if (!ps[k].adv) { ps[k].adv = true; ev(s, { type: 'poison', ref: r, kind: k, adv: true }); } });
      });
      break;
    case 'setAtk':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => { m.atk = e.n; ev(s, { type: 'debuff', ref: 'm' + m.uid }); });
      break;
    case 'atkMod':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => { m.atk = Math.max(0, m.atk + e.n); ev(s, { type: 'debuff', ref: 'm' + m.uid }); });
      break;
    case 'discard':
      for (let i = 0; i < e.n; i++) {
        if (!op.hand.length) break;
        const h = op.hand.splice(rnd(op.hand.length), 1)[0];
        ev(s, { type: 'discard', pi: op.idx, id: h.id });
        log(s, `${op.name}: [${CARDS[h.id].name}] 버림`);
      }
      break;
    case 'steal':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(c => {
        if (c.pi === ctx.pi || me.board.length >= MAX_BOARD) return;
        c.p.board.splice(c.p.board.indexOf(c.m), 1);
        c.m.sleeping = true; c.m.attacksLeft = 1; c.m.frozen = false;
        me.board.push(c.m);
        ev(s, { type: 'steal', ref: 'm' + c.m.uid });
        log(s, `${me.name}: [${CARDS[c.m.id].name}] 빼앗음`);
      });
      break;
    case 'addRandomSpell': {
      const pool = CARD_LIST.filter(c => c.race === e.race && c.type === 'spell' && !c.token);
      for (let i = 0; i < e.n; i++) addToHand(s, ctx.pi, pick(pool).id);
      break;
    }
    case 'gainMana':
      me.mana = Math.min(10, me.mana + e.n);
      break;
    case 'fairyPower': {
      const r = pick(op.board.filter(isUnit).map(m => 'm' + m.uid));
      if (r) applyPoison(s, r, pick(POISON_KINDS));
      else dealDamage(s, 'h' + op.idx, 1);
      break;
    }
    case 'herb':
      gainHerb(s, ctx.pi, e.ssuk || 0, e.garlic || 0);
      break;
    case 'herbLow':
      for (let i = 0; i < e.n; i++) {
        if (me.ssuk <= me.garlic) gainHerb(s, ctx.pi, 1, 0); else gainHerb(s, ctx.pi, 0, 1);
      }
      break;
    case 'abduct': {
      // 호랑이(source)가 적을 물고 함께 동굴로
      const tiger = ctx.source;
      const c = minionsOf(s, resolveTo(s, e.to, ctx))[0];
      if (!tiger || !c || c.pi === ctx.pi) break;
      c.p.board.splice(c.p.board.indexOf(c.m), 1);
      const ti = me.board.indexOf(tiger);
      if (ti >= 0) me.board.splice(ti, 1);
      me.cave.push({ tiger, captive: c.m, age: 0 });
      // 동굴이 아직 없으면, 호랑이가 있던 자리에 동굴이 생긴다 (전장 한 칸 차지)
      let newCave = false;
      if (!caveMinion(me)) {
        const cave = makeMinion(s, 't_cave');
        me.board.splice(ti >= 0 ? ti : me.board.length, 0, cave);
        newCave = true;
      }
      ev(s, { type: 'abduct', pi: ctx.pi, ref: 'm' + c.m.uid, id: c.m.id, tigerId: tiger.id,
        tigerAtk: tiger.atk, tigerHp: tiger.hp, caveRef: 'm' + caveMinion(me).uid, newCave });
      log(s, `🐯 [${CARDS[tiger.id].name}]이(가) [${CARDS[c.m.id].name}]을(를) 물고 동굴로!`);
      break;
    }
    case 'feedGrow':
      // 고기를 먹은 돼지는 성장이 1턴 빨라짐 (다 찼으면 바로 성장)
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => {
        const g = CARDS[m.id].grow;
        if (!g || !isUnit(m)) return;
        m.age = (m.age || 0) + 1;
        if (m.age >= g.turns) growMinion(s, m, g.into);
        else ev(s, { type: 'feedGrow', ref: 'm' + m.uid });
      });
      break;
    case 'growNow':
      minionsOf(s, resolveTo(s, e.to, ctx)).forEach(({ m }) => {
        const g = CARDS[m.id].grow;
        if (g) growMinion(s, m, g.into);
      });
      break;
    case 'assemble': {
      // 무작위 작업대: 가능한 작업 중 하나 (① 광물 2개 합치기 ② 광물 1개를 기계에 바르기)
      const mins = me.board.filter(m => isUnit(m) && CARDS[m.id].mineral)
        .sort((a, b) => CARDS[b.id].mineral - CARDS[a.id].mineral);
      const ups = me.board.filter(m => isUnit(m) && CARDS[m.id].upgrade);
      const jobs = [];
      if (mins.length >= 2) jobs.push('combine');
      if (mins.length >= 1 && ups.length) jobs.push('upgrade');
      const job = pick(jobs);
      if (!job) break;
      if (job === 'upgrade') { upgradeMachine(s, ctx.pi, pick(mins), pick(ups)); break; }
      const ca = ctx.target && getChar(s, ctx.target), cb = ctx.target2 && getChar(s, ctx.target2);
      let [a, b] = shuffle([...mins]); // 무작위 2개
      if (ca && cb && !ca.hero && !cb.hero && ca.m !== cb.m && mins.includes(ca.m) && mins.includes(cb.m)) { a = ca.m; b = cb.m; }
      const sum = CARDS[a.id].mineral + CARDS[b.id].mineral;
      const id = recipeFor(CARDS[a.id].mineral, CARDS[b.id].mineral);
      const pos = Math.min(me.board.indexOf(a), me.board.indexOf(b));
      me.board.splice(me.board.indexOf(a), 1);
      me.board.splice(me.board.indexOf(b), 1);
      const t = makeMinion(s, id);
      me.board.splice(pos, 0, t);
      ev(s, { type: 'assemble', pi: ctx.pi, parts: ['m' + a.uid, 'm' + b.uid], ref: 'm' + t.uid, id, sum });
      log(s, `🔧 [${CARDS[a.id].name}] + [${CARDS[b.id].name}] → [${CARDS[id].name}] 조립!`);
      break;
    }
    case 'weather':
      // 날씨: 이번 턴에 바로 1번 발동, 남은 횟수는 다음 내 턴들에 발동
      me.weather = { id: e.id, left: e.turns - 1 };
      applyWeather(s, ctx.pi, e.id);
      break;
    case 'rampage': {
      // 호랑이 신부가 죽으면: 다른 아군 호랑이들이 미쳐서 각자 무작위 적을 공격 (도발 무시, 반격은 받음)
      const tigers = me.board.filter(isTiger);
      if (tigers.length) ev(s, { type: 'rage', pi: ctx.pi });
      for (const t of tigers) {
        if (!isUnit(t) || t.atk <= 0) continue;
        const cands = op.board.filter(isUnit).map(m => 'm' + m.uid);
        if (op.hp > 0) cands.push('h' + op.idx);
        const r = pick(cands);
        if (!r) break;
        ev(s, { type: 'rampage', from: 'm' + t.uid, to: r });
        log(s, `🐯 [${CARDS[t.id].name}]이(가) 미쳐서 ${charName(s, r)}을(를) 공격!`);
        const c = getChar(s, r);
        if (c.hero) dealDamage(s, r, t.atk);
        else { const back = c.m.atk; dealDamage(s, r, t.atk, { poison: t.poison }); dealDamage(s, 'm' + t.uid, back, { poison: c.m.poison }); }
        checkWinner(s);
        if (s.winner != null) break;
      }
      break;
    }
    case 'tutor': {
      // 덱(3개 페이즈 더미 전체)에서 조건에 맞는 카드 1장을 찾아 손으로
      const ok = id => { const c = CARDS[id]; return e.tag === 'abduct' && (c.battlecry || []).some(x => x.t === 'abduct'); };
      const piles = me.piles.filter(pl => pl.some(ok));
      if (!piles.length) { drawCard(s, ctx.pi); break; }
      const pl = pick(piles), idxs = pl.map((id, i) => ok(id) ? i : -1).filter(i => i >= 0);
      const id = pl.splice(pick(idxs), 1)[0];
      addToHand(s, ctx.pi, id);
      ev(s, { type: 'tutor', pi: ctx.pi, id });
      log(s, `🐾 [${CARDS[id].name}]을(를) 찾아왔습니다`);
      break;
    }
    case 'emergeAll':
      for (const pair of [...me.cave]) emergePair(s, ctx.pi, pair);
      break;
  }
}

// ───────────── 대상 지정 ─────────────
function validTargets(s, pi, spec, excludeUid) {
  if (!spec) return [];
  const me = s.players[pi], op = s.players[1 - pi];
  const mine = me.board.filter(m => isUnit(m) && m.uid !== excludeUid);
  const theirs = op.board.filter(m => isUnit(m) && !m.stealth);
  let ms = [], heroes = [];
  switch (spec.who) {
    case 'enemyMinion': ms = theirs; break;
    case 'friendlyMinion': ms = mine; break;
    case 'anyMinion': ms = [...mine, ...theirs]; break;
    case 'any': ms = [...mine, ...theirs]; heroes = ['h' + me.idx, 'h' + op.idx]; break;
    case 'enemy': ms = theirs; heroes = ['h' + op.idx]; break;
  }
  if (spec.maxAtk != null) ms = ms.filter(m => m.atk <= spec.maxAtk);
  if (spec.maxHp != null) ms = ms.filter(m => m.hp <= spec.maxHp);
  if (spec.noMineral) ms = ms.filter(m => !isMineral(m));
  if (spec.mineral) ms = ms.filter(m => isMineral(m));
  return [...ms.map(m => 'm' + m.uid), ...heroes];
}

function canPlayCard(s, pi, handUid) {
  const p = s.players[pi];
  const h = p.hand.find(x => x.uid === handUid);
  if (!h) return { ok: false, reason: '카드가 없습니다.' };
  const c = CARDS[h.id];
  if (p.mana < c.cost) return { ok: false, reason: '마나가 부족합니다.' };
  if (c.type === 'minion' && p.board.length >= MAX_BOARD) return { ok: false, reason: '전장이 가득 찼습니다.' };
  if (c.type === 'spell' && c.target && !validTargets(s, pi, c.target).length) return { ok: false, reason: '사용할 대상이 없습니다.' };
  return { ok: true };
}

function playCard(s, pi, handUid, target) {
  if (!canPlayCard(s, pi, handUid).ok) return false;
  const p = s.players[pi];
  const hi = p.hand.findIndex(x => x.uid === handUid);
  const h = p.hand[hi], c = CARDS[h.id];
  if (c.target) {
    const vt = validTargets(s, pi, c.target);
    if (vt.length) { if (!vt.includes(target)) return false; }
    else target = null;
  } else target = null;

  p.mana -= c.cost;
  p.hand.splice(hi, 1);
  ev(s, { type: 'play', pi, id: c.id, target });
  log(s, `${p.name}: [${c.name}]${target ? ' → ' + charName(s, target) : ''}`);

  if (c.type === 'minion') {
    const m = summon(s, pi, c.id);
    if (m && c.nightCharge && p.time === 'night') m.charge = true;
    if (c.battlecry) runEffects(s, c.battlecry, { pi, source: m, target, isSpell: false });
  } else {
    runEffects(s, c.effects, { pi, source: null, target, isSpell: true });
    for (const m of [...p.board]) {
      const mc = CARDS[m.id];
      if (mc.onSpell && alive(m)) runEffects(s, mc.onSpell, { pi, source: m, target: null, isSpell: false });
    }
  }
  resolveDeaths(s);
  return true;
}

// ───────────── 전투 ─────────────
function canAttack(m) {
  return isUnit(m) && !isMineral(m) && !m.dozing && m.attacksLeft > 0 && m.atk > 0 && !m.frozen && (!m.sleeping || m.charge);
}

function attackTargets(s, pi) {
  const op = s.players[1 - pi];
  const vis = op.board.filter(m => isUnit(m) && !m.stealth);
  const taunts = vis.filter(m => m.taunt);
  if (taunts.length) return taunts.map(m => 'm' + m.uid);
  return [...vis.map(m => 'm' + m.uid), 'h' + op.idx];
}

function doAttack(s, pi, uid, target) {
  const me = s.players[pi];
  const m = me.board.find(x => x.uid === uid);
  if (!m || !canAttack(m)) return false;
  if (!attackTargets(s, pi).includes(target)) return false;
  m.attacksLeft--;
  m.stealth = false;
  ev(s, { type: 'attack', from: 'm' + uid, to: target });
  log(s, `${CARDS[m.id].name} ⚔ ${charName(s, target)}`);
  const t = getChar(s, target);
  if (t.hero) {
    dealDamage(s, target, m.atk);
  } else {
    const tm = t.m, a1 = m.atk, a2 = tm.atk;
    dealDamage(s, target, a1, { poison: m.poison });
    dealDamage(s, 'm' + m.uid, a2, { poison: tm.poison });
  }
  resolveDeaths(s);
  return true;
}

// ───────────── 영웅 능력 ─────────────
function canHeroPower(s, pi) {
  const p = s.players[pi], hp = RACES[p.race].heroPower;
  if (p.heroPowerUsed) return { ok: false, reason: '영웅 능력은 턴마다 한 번만 쓸 수 있습니다.' };
  if (p.mana < hp.cost) return { ok: false, reason: '마나가 부족합니다.' };
  if (hp.needsBoard && p.board.length >= MAX_BOARD) return { ok: false, reason: '전장이 가득 찼습니다.' };
  if (hp.workshop) {
    const nm = p.board.filter(m => isUnit(m) && CARDS[m.id].mineral).length;
    const nu = p.board.filter(m => isUnit(m) && CARDS[m.id].upgrade).length;
    if (!(nm >= 2 || (nm >= 1 && nu >= 1))) return { ok: false, reason: '조립하려면 광물 2개, 또는 광물 1개 + 녹슨 포탑·진화 포탑·진화 로봇이 필요합니다.' };
  }
  if (hp.target && !validTargets(s, pi, hp.target).length) return { ok: false, reason: '사용할 대상이 없습니다.' };
  return { ok: true };
}

function useHeroPower(s, pi, target, target2) {
  if (!canHeroPower(s, pi).ok) return false;
  const p = s.players[pi], hp = RACES[p.race].heroPower;
  if (hp.target) { if (!validTargets(s, pi, hp.target).includes(target)) return false; }
  else target = null;
  if (hp.target2) { if (!target2 || target2 === target || !validTargets(s, pi, hp.target).includes(target2)) return false; }
  else target2 = null;
  p.mana -= hp.cost;
  p.heroPowerUsed = true;
  ev(s, { type: 'heropower', pi });
  log(s, `${p.name}: 영웅 능력 [${hp.name}]${target ? ' → ' + charName(s, target) : ''}`);
  runEffects(s, hp.effects, { pi, source: null, target, target2, isSpell: false });
  resolveDeaths(s);
  return true;
}

// ───────────── 턴 진행 ─────────────
function startTurn(s) {
  const pi = s.current, p = s.players[pi];
  s.turn++;
  p.maxMana = Math.min(10, p.maxMana + 1);
  p.mana = p.maxMana;
  p.heroPowerUsed = false;
  p.board.forEach(m => { m.sleeping = false; m.attacksLeft = 1; });
  ev(s, { type: 'turn', pi });
  log(s, `── ${p.name}의 턴 (${PHASE_NAMES[phaseOf(p)]}) ──`);
  // 성장 (나이 먹기)
  for (const m of p.board) {
    const c = CARDS[m.id];
    if (c.grow && alive(m)) {
      m.age = (m.age || 0) + 1;
      if (m.age >= c.grow.turns) growMinion(s, m, c.grow.into);
    }
  }
  // 감염(독) 피해 (보호막 무시) — 영웅과 소환물 모두
  tickPoisons(s, 'h' + pi);
  for (const m of [...p.board]) if (isUnit(m)) tickPoisons(s, 'm' + m.uid);
  resolveDeaths(s);
  if (s.winner != null) return;
  for (const m of [...p.board]) {
    const c = CARDS[m.id];
    if (c.onTurnStart && alive(m)) runEffects(s, c.onTurnStart, { pi, source: m, target: null, isSpell: false });
  }
  resolveDeaths(s);
  if (s.winner != null) return;
  processCave(s, pi);
  processWeather(s, pi);
  drawCard(s, pi);
  checkWinner(s);
}

// ───────────── 호랑이: 동굴 / 쑥과 마늘 / 결혼 ─────────────
function gainHerb(s, pi, ssuk, garlic) {
  const p = s.players[pi];
  p.ssuk += ssuk; p.garlic += garlic;
  if (ssuk || garlic) ev(s, { type: 'herb', pi, ssuk, garlic });
}

// 동굴 속 짝: 2턴 지나고, 쑥 1 + 마늘 1을 먹으면 나와서 결혼
// ───────────── 날씨 ─────────────
const WEATHER_INFO = { sunshower: { name: '호랑이 장가가는 날', icon: '🌦️' } };
function processWeather(s, pi) {
  const p = s.players[pi], w = p.weather;
  if (!w) return;
  if (w.left <= 0) { p.weather = null; ev(s, { type: 'weatherEnd', pi }); return; }
  w.left--;
  applyWeather(s, pi, w.id);
  if (w.left <= 0) p.weather = null;
}
function applyWeather(s, pi, id) {
  const me = s.players[pi], op = s.players[1 - pi];
  ev(s, { type: 'weather', pi, id, left: me.weather ? me.weather.left : 0 });
  if (id === 'sunshower') {
    // 내 호랑이들: 무작위로 은신 또는 보호막
    me.board.filter(isTiger).forEach(t => {
      if (Math.random() < 0.5) { t.stealth = true; ev(s, { type: 'gainKw', ref: 'm' + t.uid, label: '👻 은신' }); }
      else { t.shield = true; ev(s, { type: 'gainKw', ref: 'm' + t.uid, label: '🛡️ 보호막' }); }
    });
    // 적 소환물들: 공격력·생명력 숫자를 모두 모아 섞어서 다시 나눔
    const foes = op.board.filter(isUnit);
    if (!foes.length) return;
    const nums = [];
    foes.forEach(m => nums.push(m.atk, m.hp));
    shuffle(nums);
    foes.forEach((m, i) => {
      m.atk = Math.max(0, nums[2 * i]);
      m.hp = Math.max(1, nums[2 * i + 1]);
      m.maxHp = Math.max(m.maxHp, m.hp);
      ev(s, { type: 'scramble', ref: 'm' + m.uid });
    });
    log(s, `🌦️ 호랑이 장가가는 날: 적 소환물들의 능력치가 뒤죽박죽!`);
  }
}

function processCave(s, pi) {
  const p = s.players[pi];
  for (const pair of [...p.cave]) {
    pair.age++;
    if (pair.age < 2) continue;
    if (p.ssuk < 1 || p.garlic < 1) continue;
    if (!canEmerge(p)) continue;
    p.ssuk--; p.garlic--;
    emergePair(s, pi, pair);
  }
}

function caveMinion(p) { return p.board.find(m => m.cave && m.id === 't_cave'); }
// 나오려면 빈칸 2개 필요 (마지막 짝이 나가면 동굴이 사라지면서 한 칸이 비는 것까지 계산)
function canEmerge(p) {
  const vanish = p.cave.length === 1 && caveMinion(p) ? 1 : 0;
  return p.board.length - vanish + 2 <= MAX_BOARD;
}

// 호랑이 신부 버프: 끌려온 적의 종족별로 둘 중 하나
const BRIDE_BUFFS = {
  human: [{ name: '번식력 (턴 끝마다 아기 호랑이 출산)', endTurn: [{ t: 'summon', id: 't_cub', n: 1 }] }, { name: '튼튼함 +0/+3', hp: 3 }],
  kobold: [{ name: '주문 공격력 +1', sd: 1 }, { name: '마법 손톱 +2/+0', atk: 2 }],
  owl: [{ name: '우주 보호막', kw: ['shield'] }, { name: '별의 힘 +2/+2', atk: 2, hp: 2 }],
  fairy: [{ name: '독성', kw: ['poison'] }, { name: '은신', kw: ['stealth'] }],
  dwarf: [{ name: '광물 몸 (도발, +0/+2)', kw: ['taunt'], hp: 2 }, { name: '강철 피부 +1/+3', atk: 1, hp: 3 }],
  tiger: [{ name: '도발', kw: ['taunt'] }, { name: '+1/+2', atk: 1, hp: 2 }],
};

function emergePair(s, pi, pair) {
  const p = s.players[pi];
  const i = p.cave.indexOf(pair);
  if (i < 0 || !canEmerge(p)) return false;
  p.cave.splice(i, 1);
  const caveM = caveMinion(p);
  let pos = caveM ? p.board.indexOf(caveM) + 1 : p.board.length;
  if (caveM && !p.cave.length) { p.board.splice(pos - 1, 1); pos--; ev(s, { type: 'caveGone', ref: 'm' + caveM.uid }); }
  const t = pair.tiger;
  // (신랑 호랑이 +1/+1은 신부 버프로 대체)
  t.frozen = false; t.sleeping = false; t.attacksLeft = 1; t.dead = false;
  const sp = makeMinion(s, 't_spouse');
  // 신부 기본 능력치: 끌려온 적보다 1씩 낮게 (최소 1) + 신부 버프
  sp.atk = Math.max(1, pair.captive.atk - 1);
  sp.maxHp = Math.max(1, pair.captive.maxHp - 1);
  sp.hp = sp.maxHp;
  sp.sleeping = false;
  sp.fromId = pair.captive.id;
  // 끌려온 적의 종족에 따라 신부 버프 (둘 중 무작위)
  const pool = BRIDE_BUFFS[CARDS[pair.captive.id].race] || [].concat(...Object.values(BRIDE_BUFFS));
  const bb = pick(pool);
  sp.atk += bb.atk || 0; sp.hp += bb.hp || 0; sp.maxHp += bb.hp || 0;
  sp.spellDmg += bb.sd || 0;
  (bb.kw || []).forEach(k => { sp[k] = true; });
  if (bb.endTurn) sp.extraEndTurn = bb.endTurn;
  sp.brideBuff = bb.name;
  p.board.splice(pos, 0, t, sp);
  ev(s, { type: 'wedding', pi, tiger: 'm' + t.uid, spouse: 'm' + sp.uid, tigerId: t.id, captiveId: pair.captive.id, buff: bb.name });
  log(s, `👰 신부 버프: ${bb.name}`);
  log(s, `💒 [${CARDS[t.id].name}] ♥ 사람이 된 [${CARDS[pair.captive.id].name}] 결혼!`);
  return true;
}

// 드워프 포탑: 내 턴이 끝날 때 자동 사격 (빙결되면 못 쏨)
function fireTurrets(s, pi) {
  const me = s.players[pi], op = s.players[1 - pi];
  for (const m of [...me.board]) {
    const c = CARDS[m.id];
    if (!isUnit(m) || m.frozen || !(c.turret || c.turretAll || c.turretMulti || c.turretFace)) continue;
    const randomEnemy = () => {
      const cands = op.board.filter(isUnit).map(x => 'm' + x.uid);
      if (op.hp > 0) cands.push('h' + op.idx);
      return pick(cands);
    };
    const shot = (r, n) => {
      if (!r) return;
      ev(s, { type: 'shoot', from: 'm' + m.uid, to: r });
      dealDamage(s, r, n);
      if (c.turretFreeze && r[0] === 'm') { const t = getChar(s, r); if (t && isUnit(t.m)) { t.m.frozen = true; ev(s, { type: 'freeze', ref: r }); } }
    };
    if (c.turret) shot(randomEnemy(), c.turret + (m.turretBonus || 0));
    if (c.turretMulti) for (let i = 0; i < c.turretMulti.count; i++) shot(randomEnemy(), c.turretMulti.n);
    if (c.turretFace) shot('h' + op.idx, c.turretFace);
    if (c.turretAll) {
      ev(s, { type: 'shootAll', from: 'm' + m.uid, pi: op.idx });
      op.board.filter(isUnit).forEach(x => dealDamage(s, 'm' + x.uid, c.turretAll));
    }
    if (c.turretHeal) me.board.filter(isUnit).forEach(x => healChar(s, 'm' + x.uid, c.turretHeal));
    checkWinner(s);
    if (s.winner != null) break;
  }
  resolveDeaths(s);
}

// 돼지: 턴이 끝날 때 전장의 고기를 아무 돼지가 하나씩 주워 먹음
function isPig(m) { const c = CARDS[m.id]; return isUnit(m) && c.race === 'human' && !c.notPig; }

// 🥸 돼지인 척하는 사람: 고기를 전부 먼저 먹고(+2/+2씩), 고기가 없으면 아군 돼지를 하나 잡아먹고 그만큼 성장
function devour(s, pi) {
  const p = s.players[pi];
  for (const d of p.board.filter(m => isUnit(m) && CARDS[m.id].devour)) {
    const meats = p.board.filter(m => CARDS[m.id].meat);
    if (meats.length) {
      for (const meat of meats) {
        p.board.splice(p.board.indexOf(meat), 1);
        d.atk += 2; d.hp += 2; d.maxHp += 2;
        ev(s, { type: 'eat', pi, meat: 'm' + meat.uid, pig: 'm' + d.uid, id: meat.id });
        log(s, `🥸 [${CARDS[d.id].name}]이(가) [${CARDS[meat.id].name}]을(를) 가로채 먹음 (+2/+2)`);
      }
    } else {
      const prey = pick(p.board.filter(isPig));
      if (!prey) continue;
      d.atk += Math.max(0, prey.atk); d.hp += Math.max(1, prey.hp); d.maxHp += Math.max(1, prey.hp);
      prey.eaten = true; prey.dead = true;
      ev(s, { type: 'devour', pi, ref: 'm' + d.uid, prey: 'm' + prey.uid, id: prey.id });
      log(s, `🥸 [${CARDS[d.id].name}]이(가) [${CARDS[prey.id].name}]을(를) 잡아먹음! (+${prey.atk}/+${prey.hp})`);
    }
  }
  resolveDeaths(s);
}

// 호랑이: 동굴 짝에게 필요한 만큼 빼고 남는 쑥+마늘은 한 쌍마다 아무 호랑이가 먹고 +1/+1
function isTiger(m) { return isUnit(m) && CARDS[m.id].race === 'tiger' && m.id !== 't_magpie' && m.id !== 't_spouse'; }
function eatSpareHerbs(s, pi) {
  const p = s.players[pi];
  const keep = (p.cave || []).length;
  let spare = Math.min(1, (p.ssuk || 0) - keep, (p.garlic || 0) - keep); // 한 턴에 한 쌍만
  while (spare > 0) {
    const t = pick(p.board.filter(isTiger));
    if (!t) break;
    p.ssuk--; p.garlic--; spare--;
    t.atk += 1; t.hp += 1; t.maxHp += 1;
    ev(s, { type: 'herbEat', pi, ref: 'm' + t.uid });
    log(s, `🌿🧄 [${CARDS[t.id].name}]이(가) 남은 쑥과 마늘을 먹고 +1/+1`);
  }
}

function eatMeat(s, pi) {
  const p = s.players[pi];
  devour(s, pi);
  for (const meat of p.board.filter(m => CARDS[m.id].meat)) {
    const pigs = p.board.filter(isPig);
    if (!pigs.length) break;
    const pig = pick(pigs);
    p.board.splice(p.board.indexOf(meat), 1);
    ev(s, { type: 'eat', pi, meat: 'm' + meat.uid, pig: 'm' + pig.uid, id: meat.id });
    log(s, `🍽 [${CARDS[pig.id].name}]이(가) [${CARDS[meat.id].name}]을(를) 주워 먹음`);
    runEffects(s, CARDS[meat.id].eat, { pi, source: null, target: 'm' + pig.uid, isSpell: false });
  }
  resolveDeaths(s);
}

function endTurn(s, pi) {
  const p = s.players[pi];
  fireTurrets(s, pi);
  if (s.winner != null) return;
  eatMeat(s, pi);
  eatSpareHerbs(s, pi);
  if (s.winner != null) return;
  for (const m of [...p.board]) {
    const c = CARDS[m.id];
    if (c.onTurnEnd && alive(m)) runEffects(s, c.onTurnEnd, { pi, source: m, target: null, isSpell: false });
    if (m.extraEndTurn && alive(m)) runEffects(s, m.extraEndTurn, { pi, source: m, target: null, isSpell: false });
  }
  resolveDeaths(s);
  if (s.winner != null) return;
  p.board.forEach(m => { m.frozen = false; });
  s.current = 1 - pi;
  startTurn(s);
}

// 모든 플레이어 행동의 단일 입구 (로컬/AI/온라인 공통)
function applyAction(s, pi, a) {
  if (s.winner != null) return false;
  s.events = [];
  let ok = false;
  if (a.type === 'concede') {
    s.winner = 1 - pi;
    log(s, `${s.players[pi].name} 님이 항복했습니다.`);
    ev(s, { type: 'gameover', winner: s.winner });
    ok = true;
  } else if (pi === s.current) {
    switch (a.type) {
      case 'play': ok = playCard(s, pi, a.uid, a.target || null); break;
      case 'attack': ok = doAttack(s, pi, a.uid, a.target); break;
      case 'hero': ok = useHeroPower(s, pi, a.target || null, a.target2 || null); break;
      case 'end': endTurn(s, pi); ok = true; break;
    }
  }
  if (ok) { syncOwls(s); s.seq++; }
  return ok;
}
