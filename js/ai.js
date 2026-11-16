'use strict';
// =====================================================================
//  엉뚱 한마당 - 간단한 연습용 AI
// =====================================================================
function aiValue(m) { return m.atk * 2 + m.hp + (m.taunt ? 2 : 0) + (m.shield ? 2 : 0) + (m.poison ? 3 : 0); }

function aiPickTarget(s, pi, spec, effects, isSpell, excludeUid) {
  const vt = validTargets(s, pi, spec, excludeUid);
  if (!vt.length) return null;
  const e = effects.find(x => x.to === 'target') || {};
  const chars = vt.map(r => ({ r, c: getChar(s, r) }));
  const enemy = chars.filter(x => x.c.pi !== pi);
  const friend = chars.filter(x => x.c.pi === pi);
  const best = list => {
    const ms = list.filter(x => !x.c.hero).sort((a, b) => aiValue(b.c.m) - aiValue(a.c.m));
    return ms.length ? ms[0].r : null;
  };
  switch (e.t) {
    case 'buff': return best(friend);
    case 'heal': {
      // 가장 많이 다친 아군에게 (안 다쳤으면 쓰지 않음)
      const hurt = friend.filter(x => !x.c.hero && x.c.m.maxHp - x.c.m.hp >= 2).sort((a, b) => (b.c.m.maxHp - b.c.m.hp) - (a.c.m.maxHp - a.c.m.hp));
      if (hurt.length) return hurt[0].r;
      return vt.includes('h' + pi) ? 'h' + pi : null;
    }
    case 'damage': {
      const amt = e.n + (isSpell ? spellDamage(s, pi) : 0);
      const kill = enemy.filter(x => !x.c.hero && x.c.m.hp <= amt && !x.c.m.shield)
        .sort((a, b) => aiValue(b.c.m) - aiValue(a.c.m));
      if (kill.length) return kill[0].r;
      const h = enemy.find(x => x.c.hero);
      if (h) return h.r;
      return best(enemy);
    }
    default: return best(enemy);
  }
}

function aiUseless(s, pi, c) {
  const me = s.players[pi], op = s.players[1 - pi];
  if (c.aiNeed === 'enemy' && !op.board.length) return true;
  if (c.aiNeed === 'friendly' && !me.board.some(isUnit)) return true;
  if (c.aiNeed === 'cave' && !me.cave.length) return true;
  if (c.aiNeed === 'growable' && !me.board.some(m => CARDS[m.id].grow)) return true;
  return false;
}

function aiAttackTarget(s, pi, m, ts) {
  const me = s.players[pi], op = s.players[1 - pi];
  const face = 'h' + op.idx;
  const total = me.board.filter(canAttack).reduce((a, x) => a + x.atk, 0);
  if (ts.includes(face) && total >= op.hp) return face;
  const ms = ts.filter(r => r !== face).map(r => getChar(s, r).m);
  const kills = t => !t.shield && (t.hp <= m.atk || m.poison);
  const dies = t => !m.shield && t.atk > 0 && (m.hp <= t.atk || t.poison);
  let best = null, bv = -1;
  for (const t of ms) if (kills(t) && !dies(t) && aiValue(t) > bv) { best = t; bv = aiValue(t); }
  if (best) return 'm' + best.uid;
  for (const t of ms) if (kills(t) && aiValue(t) >= aiValue(m) && aiValue(t) > bv) { best = t; bv = aiValue(t); }
  if (best) return 'm' + best.uid;
  if (ts.includes(face)) return face;
  ms.sort((a, b) => a.hp - b.hp);
  return ms.length ? 'm' + ms[0].uid : null;
}

function aiChoose(s, pi) {
  const p = s.players[pi];
  // 1) 카드 내기 (비싼 카드부터)
  const hand = [...p.hand].sort((a, b) => CARDS[b.id].cost - CARDS[a.id].cost);
  for (const h of hand) {
    const c = CARDS[h.id];
    if (!canPlayCard(s, pi, h.uid).ok) continue;
    if (h.id === 'coin') {
      if (p.hand.some(o => o.uid !== h.uid && CARDS[o.id].cost === p.mana + 1)) return { type: 'play', uid: h.uid };
      continue;
    }
    if (aiUseless(s, pi, c)) continue;
    if (c.target) {
      const vt = validTargets(s, pi, c.target);
      if (vt.length) {
        let t = aiPickTarget(s, pi, c.target, c.effects || c.battlecry || [], c.type === 'spell');
        if (!t) { if (c.type === 'spell') continue; t = vt[0]; }
        return { type: 'play', uid: h.uid, target: t };
      }
      if (c.type === 'spell') continue;
    }
    return { type: 'play', uid: h.uid };
  }
  // 2) 영웅 능력
  if (canHeroPower(s, pi).ok) {
    const hp = RACES[p.race].heroPower;
    if (hp.target2) {
      const mins = p.board.filter(m => isUnit(m) && CARDS[m.id].mineral).sort((a, b) => CARDS[b.id].mineral - CARDS[a.id].mineral);
      if (mins.length >= 2) return { type: 'hero', target: 'm' + mins[0].uid, target2: 'm' + mins[1].uid };
    } else if (hp.target) {
      const t = aiPickTarget(s, pi, hp.target, hp.effects, false);
      if (t) return { type: 'hero', target: t };
    } else return { type: 'hero' };
  }
  // 3) 공격
  for (const m of p.board) {
    if (!canAttack(m)) continue;
    const t = aiAttackTarget(s, pi, m, attackTargets(s, pi));
    if (t) return { type: 'attack', uid: m.uid, target: t };
  }
  return { type: 'end' };
}
