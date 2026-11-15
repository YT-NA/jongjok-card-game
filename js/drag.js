'use strict';
// =====================================================================
//  종족대전 - 끌어서 놓기 (마우스·터치 공통, Pointer Events)
//  · 손패 카드를 끌어서 전장 쪽에 놓으면 사용 (대상이 필요하면 빛나는 대상 위에 놓기)
//  · 공격 가능한 내 소환물을 끌어서 적 위에 놓으면 공격 (화살표 표시)
//  · 조금만 움직이고 떼면(12px 미만) 기존처럼 '탭/클릭'으로 처리
// =====================================================================
const Drag = { st: null, suppressClick: false };
const DRAG_START_PX = 12;

function dragHitRef(x, y) {
  const el = document.elementFromPoint(x, y);
  const r = el && el.closest('#game [data-ref]');
  return r ? r.dataset.ref : null;
}

function dragBegin(st) {
  st.active = true;
  Drag.suppressClick = true;
  clearSel();
  $('#preview').innerHTML = '';
  clearPredict();
  const s = App.state;
  if (st.kind === 'card') {
    const h = s.players[App.me].hand.find(x => x.uid === st.uid);
    const c = CARDS[h.id];
    st.targets = c.target ? validTargets(s, App.me, c.target) : [];
    const wrap = document.createElement('div');
    wrap.innerHTML = cardHTML(h.id);
    st.ghost = wrap.firstElementChild;
    st.ghost.classList.add('drag-ghost');
    st.ghost.style.setProperty('--u', getComputedStyle(st.el).getPropertyValue('--u'));
    $('#fx').appendChild(st.ghost);
    st.el.classList.add('drag-src');
    if (!st.targets.length) $('#boards').classList.add('drop-zone');
  } else {
    st.targets = attackTargets(s, App.me);
    st.el.classList.add('selected');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'drag-arrow');
    svg.innerHTML = '<line x1="0" y1="0" x2="0" y2="0"/><circle r="10" cx="0" cy="0"/>';
    $('#fx').appendChild(svg);
    st.svg = svg;
    const r = st.el.getBoundingClientRect();
    st.ax = r.left + r.width / 2; st.ay = r.top + r.height / 2;
  }
  st.targets.forEach(ref => { const el = elByRef(ref); if (el) el.classList.add('targetable'); });
}

function dragMove(st, x, y) {
  if (st.ghost) { st.ghost.style.left = x + 'px'; st.ghost.style.top = y + 'px'; }
  if (st.svg) {
    const ln = st.svg.querySelector('line'), ci = st.svg.querySelector('circle');
    ln.setAttribute('x1', st.ax); ln.setAttribute('y1', st.ay); ln.setAttribute('x2', x); ln.setAttribute('y2', y);
    ci.setAttribute('cx', x); ci.setAttribute('cy', y);
  }
  // 놓을 수 있는 대상 위에 있으면 강조
  const ref = dragHitRef(x, y);
  document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
  if (ref && st.targets.includes(ref)) { const el = elByRef(ref); if (el) el.classList.add('drop-hover'); }
  if (st.kind === 'card' && !st.targets.length) {
    const over = y < $('#myHand').getBoundingClientRect().top - 10;
    $('#boards').classList.toggle('drop-hover-zone', over);
  }
}

function dragCleanup(st) {
  if (st.ghost) st.ghost.remove();
  if (st.svg) st.svg.remove();
  if (st.el) st.el.classList.remove('drag-src', 'selected');
  document.querySelectorAll('.drop-hover, .targetable').forEach(el => el.classList.remove('drop-hover', 'targetable'));
  $('#boards').classList.remove('drop-zone', 'drop-hover-zone');
}

function dragEnd(st, x, y) {
  const ref = dragHitRef(x, y);
  dragCleanup(st);
  if (!isMyTurn()) return render();
  if (st.kind === 'attack') {
    if (ref && st.targets.includes(ref)) return act({ type: 'attack', uid: st.uid, target: ref });
    return render();
  }
  if (st.targets.length) {
    if (ref && st.targets.includes(ref)) return act({ type: 'play', uid: st.uid, target: ref });
    render();
    return toast('빛나는 대상 위에 놓아야 사용됩니다', 1400);
  }
  // 대상이 필요 없는 카드: 손패 영역 위쪽(전장 쪽)에 놓으면 사용
  if (y < $('#myHand').getBoundingClientRect().top - 10) return act({ type: 'play', uid: st.uid });
  render();
}

$('#game').addEventListener('pointerdown', e => {
  if (e.button > 0 || !App.state || !isMyTurn() || Drag.st) return;
  const handEl = e.target.closest('[data-hand]');
  const mineEl = e.target.closest('#myBoard [data-ref]');
  let st = null;
  if (handEl) {
    const uid = +handEl.dataset.hand;
    if (canPlayCard(App.state, App.me, uid).ok) st = { kind: 'card', uid, el: handEl };
  } else if (mineEl) {
    const c = getChar(App.state, mineEl.dataset.ref);
    if (c && !c.hero && canAttack(c.m)) st = { kind: 'attack', uid: c.m.uid, el: mineEl };
  }
  if (!st) return;
  st.id = e.pointerId; st.x0 = e.clientX; st.y0 = e.clientY; st.active = false;
  Drag.st = st;
});

window.addEventListener('pointermove', e => {
  const st = Drag.st;
  if (!st || e.pointerId !== st.id) return;
  if (!st.active) {
    if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < DRAG_START_PX) return;
    dragBegin(st);
  }
  e.preventDefault();
  dragMove(st, e.clientX, e.clientY);
}, { passive: false });

window.addEventListener('pointerup', e => {
  const st = Drag.st;
  if (!st || e.pointerId !== st.id) return;
  Drag.st = null;
  if (st.active) dragEnd(st, e.clientX, e.clientY);
  setTimeout(() => { Drag.suppressClick = false; }, 60);
});

window.addEventListener('pointercancel', e => {
  const st = Drag.st;
  if (!st || e.pointerId !== st.id) return;
  Drag.st = null;
  if (st.active) { dragCleanup(st); render(); }
  Drag.suppressClick = false;
});

// 드래그가 끝난 직후의 클릭은 무시 (탭 처리와 겹치지 않게)
$('#game').addEventListener('click', e => {
  if (Drag.suppressClick) { e.stopPropagation(); e.preventDefault(); Drag.suppressClick = false; }
}, true);
