'use strict';
// =====================================================================
//  종족대전 - ⚔ 전장 (최대 8명 토너먼트, 빈자리는 AI)
//  · 8강 4경기(동시 진행) → 준결승 2경기 → 결승 → 최후의 1명이 우승
//  · 랭크 점수: 1000점 시작, 경기마다 Elo 방식(강한 상대를 이기면 많이 오름) + 우승 보너스
//  · 판마다 종족을 다시 선착순으로 고름 (종족은 6개라 종족마다 최대 2명)
//  · 같은 종족 2명은 대진표 반대편에 배치 → 결승 전에는 같은 종족끼리 안 만남
//  · 전장 연습: 나 + AI 7명, 점수 변동 없음
//  호스트(또는 연습 시 내 컴퓨터)가 '심판(H)'으로 모든 경기를 돌리고,
//  각 사람 플레이어는 '보기(view)'와 '경기 상태'만 받아서 화면에 그린다.
// =====================================================================
const RATING_KEY = 'jj_rating';
const START_RATING = 1000, ELO_K = 32, CHAMP_BONUS = 15, ARENA_SIZE = 8;
const ROUNDS = ['8강', '준결승', '결승'];
const RACE_CAP = Math.ceil(ARENA_SIZE / Object.keys(RACES).length); // 종족마다 최대 인원
function raceCount(seats, race) { return seats.filter(s => s.race === race).length; }

function getRating() { try { const v = +localStorage.getItem(RATING_KEY); return v > 0 ? v : START_RATING; } catch (_) { return START_RATING; } }
function setRating(v) { try { localStorage.setItem(RATING_KEY, String(Math.round(v))); } catch (_) {} }
function eloDelta(ra, rb, score) { return Math.round(ELO_K * (score - 1 / (1 + Math.pow(10, (rb - ra) / 400)))); }
function updateMenuRating() { const el = $('#menuRating'); if (el) el.textContent = getRating(); }

// ───────────────────────── 심판(호스트) ─────────────────────────
const Arena = {
  H: null,

  create(practice) {
    const me = { id: 'host', name: myName(), rating: getRating(), human: true, race: null, delta: 0 };
    this.H = { practice, phase: 'lobby', seats: [me], matches: [], nextId: 1, code: null };
    if (practice) this.startPick();
  },

  seatOf(id) { return this.H ? this.H.seats.findIndex(s => s.id === id) : -1; },

  // 사람 → 자리 추가 (로비에서만)
  addGuest(id, name, rating) {
    const H = this.H;
    if (!H || H.phase !== 'lobby' || H.seats.length >= ARENA_SIZE) { Net.sendTo(id, { type: 'full' }); return; }
    H.seats.push({ id, name: String(name || '친구').slice(0, 10), rating: +rating > 0 ? Math.round(+rating) : START_RATING, human: true, race: null, delta: 0 });
    this.publish();
  },

  // 연결 끊김: 로비면 자리 삭제, 경기 중이면 AI가 대신 플레이
  dropGuest(id) {
    const H = this.H, i = this.seatOf(id);
    if (!H || i < 0) return;
    if (H.phase === 'lobby') H.seats.splice(i, 1);
    else {
      const s = H.seats[i];
      s.human = false; s.left = true; s.name += ' (나감·AI 대신)';
      if (H.phase === 'pick') this.autoPickAI();
      H.matches.forEach(m => this.scheduleAI(m));
      [...new Set(H.matches.map(m => m.roundIdx))].forEach(r => this.maybeFastForward(r));
    }
    this.publish();
  },

  // ── 종족 선택 (선착순)
  startPick() {
    const H = this.H;
    Net.locked = true;
    const avg = Math.round(H.seats.reduce((a, s) => a + s.rating, 0) / H.seats.length);
    let n = 1;
    while (H.seats.length < ARENA_SIZE) {
      H.seats.push({ id: 'ai-' + n, name: `AI ${n}호`, rating: H.practice ? avg : START_RATING, human: false, race: null, delta: 0 });
      n++;
    }
    H.phase = 'pick';
    this.publish();
  },

  pick(seatIdx, race) {
    const H = this.H;
    if (!H || H.phase !== 'pick' || !RACES[race]) return false;
    const seat = H.seats[seatIdx];
    if (!seat || seat.race || raceCount(H.seats, race) >= RACE_CAP) {
      if (seat && seat.id !== 'host') Net.sendTo(seat.id, { type: 'deny', race });
      else if (seat) toast(`${josa(RACES[race].name, '은', '는')} 이미 다른 사람이 골랐습니다!`);
      return false;
    }
    seat.race = race;
    this.publish();
    this.autoPickAI();
    return true;
  },

  // 사람이 모두 고르면 AI가 남은 종족 중에서 고르고 시작
  autoPickAI() {
    const H = this.H;
    if (H.phase !== 'pick' || H.seats.some(s => s.human && !s.race)) return;
    clearTimeout(this._pickTimer);
    this._pickTimer = setTimeout(() => {
      H.seats.forEach(s => {
        if (s.race) return;
        // 아직 아무도 안 고른 종족을 먼저, 그다음 자리가 남은 종족
        const open = Object.keys(RACES).filter(r => raceCount(H.seats, r) < RACE_CAP);
        const fresh = open.filter(r => raceCount(H.seats, r) === 0);
        s.race = pick(fresh.length ? fresh : open);
      });
      this.publish();
      setTimeout(() => this.startBattle(), 1600);
    }, 700);
  },

  // ── 대진: 같은 종족 2명은 왼쪽/오른쪽 반대편으로 나눠서 결승 전엔 못 만나게
  startBattle() {
    const H = this.H;
    if (H.phase !== 'pick') return;
    H.phase = 'battle';
    const left = [], right = [];
    const byRace = {};
    shuffle(H.seats.map((_, i) => i)).forEach(i => (byRace[H.seats[i].race] = byRace[H.seats[i].race] || []).push(i));
    Object.values(byRace).filter(g => g.length > 1).forEach(g => { left.push(g[0]); right.push(g[1]); });
    Object.values(byRace).filter(g => g.length === 1).forEach(g => (left.length <= right.length ? left : right).push(g[0]));
    const order = [...shuffle(left), ...shuffle(right)];
    for (let k = 0; k < order.length / 2; k++) this.newMatch(0, k, order[2 * k], order[2 * k + 1]);
    this.publish();
  },

  // roundIdx: 0=8강 1=준결승 2=결승 / slot: 그 라운드에서 몇 번째 경기인지 (대진표 순서)
  newMatch(roundIdx, slot, a, b) {
    const H = this.H, A = H.seats[a], Bs = H.seats[b];
    const last = roundIdx === ROUNDS.length - 1;
    const m = {
      id: H.nextId++, round: last ? ROUNDS[roundIdx] : `${ROUNDS[roundIdx]} ${slot + 1}`, roundIdx, slot,
      seats: [a, b], done: false, winner: null, aiBusy: false,
      state: createGame({ name: A.name, race: A.race }, { name: Bs.name, race: Bs.race }),
    };
    H.matches.push(m);
    this.sendMatch(m);
    this.scheduleAI(m);
    return m;
  },

  // 사람 플레이어의 행동
  action(seatIdx, matchId, a) {
    const H = this.H;
    const m = H && H.matches.find(x => x.id === matchId);
    if (!m || m.done) return;
    const k = m.seats.indexOf(seatIdx);
    if (k < 0 || !H.seats[seatIdx].human) return;
    if (applyAction(m.state, k, a)) this.afterUpdate(m);
    else this.sendMatch(m);
  },

  afterUpdate(m) {
    this.sendMatch(m);
    this.publish();
    if (m.state.winner != null) {
      if (!m.finishing) { m.finishing = true; setTimeout(() => this.finishMatch(m), 1800); }
    } else this.scheduleAI(m);
  },

  // AI 차례면 자동으로 진행 (AI끼리 경기는 빠르게)
  scheduleAI(m) {
    const H = this.H;
    if (!H || m.done || m.aiBusy || m.state.winner != null) return;
    const cur = m.state.current, seat = H.seats[m.seats[cur]];
    if (seat.human) return;
    const allAI = m.seats.every(i => !H.seats[i].human);
    const longAnim = (m.state.events || []).some(e => e.type === 'abduct');
    m.aiBusy = true;
    setTimeout(() => {
      m.aiBusy = false;
      if (this.H !== H || m.done || m.state.winner != null || m.state.current !== cur) return;
      let a = aiChoose(m.state, cur);
      if (!applyAction(m.state, cur, a)) applyAction(m.state, cur, { type: 'end' });
      this.afterUpdate(m);
    }, allAI ? 450 : longAnim ? 2400 : 1000);
  },

  finishMatch(m) {
    const H = this.H;
    if (!H || m.done) return;
    m.done = true;
    const w = m.state.winner === 'draw' ? rnd(2) : m.state.winner;
    m.winner = m.seats[w];
    m.loser = m.seats[1 - w];
    const W = H.seats[m.winner], L = H.seats[m.loser];
    if (!H.practice) {
      const score = m.state.winner === 'draw' ? 0.5 : 1;
      const dw = eloDelta(W.rating, L.rating, score), dl = eloDelta(L.rating, W.rating, 1 - score);
      W.rating += dw; W.delta += dw; m.dW = dw;
      L.rating += dl; L.delta += dl; m.dL = dl;
    }
    L.out = ROUNDS[m.roundIdx];
    L.outIdx = m.roundIdx;
    this.publish();
    this.maybeFastForward(m.roundIdx);
    // 이번 라운드가 다 끝나면 승자끼리 다음 라운드 (대진표 순서대로 짝)
    const round = H.matches.filter(x => x.roundIdx === m.roundIdx).sort((a, b) => a.slot - b.slot);
    if (!round.every(x => x.done)) return;
    if (m.roundIdx === ROUNDS.length - 1) return this.finishArena(m);
    if (H.matches.some(x => x.roundIdx === m.roundIdx + 1)) return;
    setTimeout(() => {
      if (this.H !== H) return;
      for (let k = 0; k < round.length / 2; k++) this.newMatch(m.roundIdx + 1, k, round[2 * k].winner, round[2 * k + 1].winner);
      this.publish();
    }, 1200);
  },

  // 이 라운드에 사람이 하는 경기가 하나도 안 남았으면, AI끼리 남은 경기는 기다리지 않고 바로 끝까지 진행
  maybeFastForward(roundIdx) {
    const H = this.H;
    if (!H) return;
    const pending = H.matches.filter(x => x.roundIdx === roundIdx && !x.done);
    if (!pending.length || pending.some(x => x.seats.some(i => H.seats[i].human))) return;
    setTimeout(() => {
      if (this.H !== H) return;
      for (const m of pending) {
        if (m.done) continue;
        for (let n = 0; n < 4000 && m.state.winner == null; n++) {
          const cur = m.state.current;
          if (!applyAction(m.state, cur, aiChoose(m.state, cur))) applyAction(m.state, cur, { type: 'end' });
        }
        m.finishing = true;
        this.sendMatch(m);
        this.finishMatch(m);
      }
    }, 700);
  },

  finishArena(final) {
    const H = this.H;
    const champ = H.seats[final.winner];
    if (!H.practice) { champ.rating += CHAMP_BONUS; champ.delta += CHAMP_BONUS; }
    // 순위: 우승 1 · 준우승 2 · 준결승 탈락 공동 3 · 8강 탈락 공동 5
    H.seats.forEach((s, i) => {
      if (i === final.winner) s.place = 1;
      else if (i === final.loser) s.place = 2;
      else s.place = s.outIdx === 1 ? 3 : 5;
    });
    H.phase = 'done';
    this.publish();
  },

  // 다시 전장: 사람은 남기고 AI 빼고 종족 다시 뽑기
  again() {
    const H = this.H;
    if (!H) return;
    H.seats = H.seats.filter(s => s.human && !s.left);
    H.seats.forEach(s => { s.race = null; s.delta = 0; delete s.place; delete s.out; delete s.outIdx; });
    H.matches = []; H.bracket = null;
    H.phase = 'lobby';
    Net.locked = false;
    if (H.practice) this.startPick(); else this.publish();
  },

  // ── 사람들에게 보내기
  view() {
    const H = this.H;
    return {
      practice: H.practice, phase: H.phase, code: H.code,
      seats: H.seats.map(s => ({ name: s.name, rating: s.rating, human: s.human, race: s.race, delta: s.delta, place: s.place, out: s.out })),
      matches: H.matches.map(m => ({
        id: m.id, round: m.round, roundIdx: m.roundIdx, seats: m.seats, done: m.done, winner: m.winner, dW: m.dW, dL: m.dL,
        hp: m.state.players.map(p => p.hp), turn: m.state.turn, current: m.state.current,
      })),
    };
  },
  publish() {
    const H = this.H;
    if (!H) return;
    const v = this.view();
    H.seats.forEach((s, i) => {
      if (!s.human) return;
      if (s.id === 'host') ArenaClient.onView(v, i);
      else Net.sendTo(s.id, { type: 'arena', view: v, you: i });
    });
  },
  sendMatch(m) {
    const H = this.H;
    H.seats.forEach(s => {
      if (!s.human) return;
      if (s.id === 'host') ArenaClient.onMatch(m.id, m.state);
      else Net.sendTo(s.id, { type: 'match', id: m.id, state: m.state });
    });
  },

  // 참가자 메시지 처리
  onMessage(id, d) {
    if (d.type === 'hello') this.addGuest(id, d.name, d.rating);
    else if (d.type === 'pick') this.pick(this.seatOf(id), d.race);
    else if (d.type === 'action') this.action(this.seatOf(id), d.id, d.a);
  },
};

// ───────────────────────── 화면(모든 사람 공통) ─────────────────────────
const ArenaClient = {
  view: null, you: -1, states: {}, isHost: false, savedResult: false,

  reset() { this.view = null; this.you = -1; this.states = {}; this.savedResult = false; },

  onView(v, you) {
    const prevPhase = this.view && this.view.phase;
    this.view = v; this.you = you;
    if (v.phase !== 'done') this.savedResult = false;
    if (!v.practice && v.seats[you] && v.phase !== 'lobby') { setRating(v.seats[you].rating); updateMenuRating(); }
    if (v.phase === 'lobby') return this.showLobby();
    if (v.phase === 'pick') return this.showPick();
    if (v.phase === 'battle') {
      const mine = this.myActiveMatch();
      if (mine && App.viewing !== mine.id) return this.watch(mine.id);
      if (App.viewing == null) return this.showBracket();
      if (!$('#lobby').classList.contains('hidden')) this.showBracket();
      return;
    }
    if (v.phase === 'done') {
      if (prevPhase !== 'done') setTimeout(() => this.showResults(), App.viewing != null ? 2200 : 0);
      else this.showResults();
    }
  },

  onMatch(id, state) {
    this.states[id] = state;
    if (App.viewing === id) { App.state = state; render(); }
    // 내 새 경기가 시작되면 자동으로 들어감
    const mine = this.myActiveMatch();
    if (mine && mine.id === id && App.viewing !== id && state.winner == null && $('#overlay').classList.contains('hidden')) this.watch(id);
  },

  myActiveMatch() {
    const v = this.view;
    if (!v) return null;
    return v.matches.find(m => !m.done && m.seats.includes(this.you) && this.states[m.id]) || null;
  },

  // 경기 화면으로 (내 경기면 조작, 남의 경기면 관전)
  watch(id) {
    const m = this.view.matches.find(x => x.id === id), st = this.states[id];
    if (!m || !st) return;
    App.mode = 'arena';
    App.viewing = id;
    App.state = st;
    const k = m.seats.indexOf(this.you);
    App.spectating = k < 0;
    App.me = k < 0 ? 0 : k;
    enterGame();
    if (App.spectating) toast(`👀 ${m.round} 관전 중 — ⚙ 메뉴에서 대진표로 돌아갈 수 있습니다`, 2500);
  },

  backToBracket() {
    App.viewing = null; App.state = null; App.spectating = false;
    closeOverlay();
    if (this.view.phase === 'done') this.showResults(); else this.showBracket();
  },

  seatTag(i) {
    const s = this.view.seats[i];
    const r = s.race ? RACES[s.race] : null;
    return `${r ? r.hero : '❔'} <b>${esc(s.name)}</b>${i === this.you ? ' (나)' : ''} <span class="rk">🏆${s.rating}</span>`;
  },

  showLobby() {
    const v = this.view;
    const seats = Array.from({ length: ARENA_SIZE }, (_, i) => {
      const s = v.seats[i];
      return s ? `<div class="seat">${i === 0 ? '👑' : '🙂'} <b>${esc(s.name)}</b>${i === this.you ? ' (나)' : ''} <span class="rk">🏆${s.rating}</span></div>`
        : `<div class="seat empty">빈자리 — 시작하면 🤖 AI가 채웁니다</div>`;
    }).join('');
    const hostPart = this.isHost
      ? `<div>친구에게 이 코드를 알려주세요 (최대 ${ARENA_SIZE}명)</div><div class="room-code">${v.code || '...'}</div>
         <button class="btn" id="copyCode">📋 코드 복사</button>`
      : '';
    const startBtn = this.isHost ? `<button class="btn primary big" id="arenaStart">⚔ 전장 시작 (빈자리는 AI)</button>` : `<div class="status"><span class="spinner">⏳</span> 방장이 전장을 시작하길 기다리는 중...</div>`;
    lobby('⚔ 전장 대기실', `${hostPart}<div class="seats">${seats}</div>${startBtn}`);
    if (this.isHost) {
      $('#copyCode').onclick = () => { navigator.clipboard?.writeText(v.code).then(() => toast('복사했습니다!')).catch(() => {}); };
      $('#arenaStart').onclick = () => Arena.startPick();
    }
  },

  showPick() {
    const v = this.view, me = v.seats[this.you];
    // 종족마다 최대 RACE_CAP명: 꽉 차면 잠김, 한 명만 골랐으면 "1자리 남음" 표시
    const taken = {}, notes = {};
    Object.keys(RACES).forEach(r => {
      const who = v.seats.filter((s, i) => s.race === r && i !== this.you).map(s => s.name);
      if (!who.length) return;
      const n = raceCount(v.seats, r);
      if (n >= RACE_CAP && me.race !== r) taken[r] = who.join(', ');
      else notes[r] = `${who.join(', ')} 선택 · ${RACE_CAP - n}자리 남음`;
    });
    const waiting = v.seats.filter(s => s.human && !s.race).map(s => s.name);
    let status;
    if (me.race) status = waiting.length ? `내 종족: ${RACES[me.race].hero} ${RACES[me.race].name} — <span class="spinner">⏳</span> ${esc(waiting.join(', '))} 님이 고르는 중...` : '⚔ 모두 골랐습니다! AI가 남은 종족을 고르고 곧 전장이 시작됩니다...';
    else status = `선착순! 종족마다 최대 ${RACE_CAP}명까지 고를 수 있고, 같은 종족은 결승 전에는 만나지 않습니다.${v.practice ? ' (전장 연습: 점수 변동 없음)' : ''}`;
    const opts = { taken, notes, mine: me.race, locked: !!me.race, status };
    const onPick = race => {
      if (this.isHost) Arena.pick(this.you, race);
      else Net.send({ type: 'pick', race });
    };
    if ($('#raceSelect').classList.contains('hidden') || !App.racePick || App.racePick.arena !== true) {
      pickRace(`⚔ 전장 — 종족 선택 (선착순)${v.practice ? ' · 연습' : ''}`, onPick, opts);
      App.racePick.arena = true;
    } else drawRacePick(opts);
  },

  matchRow(m) {
    const [a, b] = m.seats;
    const st = m.done ? `🏁 승리: ${this.seatTag(m.winner)}` : `⚔ 진행 중 · ${m.turn}턴 · ❤ ${m.hp[0]} : ${m.hp[1]}`;
    const watchBtn = !m.done ? `<button class="btn" data-watch="${m.id}">${m.seats.includes(this.you) ? '▶ 내 경기로' : '👀 관전'}</button>` : '';
    return `<div class="match-row ${m.done ? 'done' : ''}">
      <div class="m-round">${m.round}</div>
      <div class="m-vs">${this.seatTag(a)} <span class="vs">VS</span> ${this.seatTag(b)}</div>
      <div class="m-st">${st}</div>${watchBtn}</div>`;
  },

  showBracket() {
    const v = this.view;
    const sorted = [...v.matches].sort((a, b) => b.roundIdx - a.roundIdx || a.id - b.id);
    const rows = sorted.map(m => this.matchRow(m)).join('');
    const maxRound = Math.max(...v.matches.map(m => m.roundIdx));
    const finalPending = ROUNDS.slice(maxRound + 1).reverse().map((r, i, arr) =>
      `<div class="match-row pending"><div class="m-round">${r}</div><div class="m-vs">${ROUNDS[ROUNDS.indexOf(r) - 1]} 승자끼리 대결</div></div>`).join('');
    const me = v.seats[this.you];
    const myState = me.out ? `😢 ${me.out}에서 탈락했습니다. 남은 경기를 관전할 수 있습니다.` : '';
    lobby(`🏟 전장 대진표${v.practice ? ' (연습)' : ''}`, `<div class="status">${myState}</div><div class="bracket">${finalPending}${rows}</div>`);
    $('#lobbyBody').onclick = e => { const b = e.target.closest('[data-watch]'); if (b) this.watch(+b.dataset.watch); };
  },

  showResults() {
    const v = this.view;
    if (!v || v.phase !== 'done' || App.mode !== 'arena') return; // 이미 전장을 나갔으면 무시
    if (App.viewing != null && !$('#game').classList.contains('hidden') && !$('#overlay').classList.contains('hidden')) return; // 게임오버 창 보는 중
    App.viewing = null; App.state = null;
    const order = v.seats.map((s, i) => ({ s, i })).sort((a, b) => a.s.place - b.s.place);
    const medal = p => p === 1 ? '🥇 우승' : p === 2 ? '🥈 준우승' : p === 3 ? '🥉 공동 3위' : '🎖️ 공동 5위';
    const rows = order.map(({ s, i }) => `<tr class="${i === this.you ? 'me' : ''}">
      <td>${medal(s.place)}</td><td>${s.race ? RACES[s.race].hero : ''} ${esc(s.name)}${i === this.you ? ' (나)' : ''}</td>
      <td>${v.practice ? '-' : (s.delta >= 0 ? '<span class="up">+' + s.delta + '</span>' : '<span class="down">' + s.delta + '</span>')}</td>
      <td>🏆 ${s.rating}</td></tr>`).join('');
    const mine = v.seats[this.you];
    const again = this.isHost ? `<button class="btn primary big" id="arenaAgain">⚔ 다시 전장 (종족 다시 뽑기)</button>`
      : `<div class="status">방장이 다시 시작하면 종족 선택 화면이 열립니다.</div>`;
    lobby('🏆 전장 결과', `
      <div class="big-result">${mine.place === 1 ? '🥇' : mine.place === 2 ? '🥈' : mine.place === 3 ? '🥉' : '🎖️'}</div>
      <table class="result-table"><tr><th>순위</th><th>플레이어</th><th>점수 변화</th><th>랭크 점수</th></tr>${rows}</table>
      ${v.practice ? '<div class="status">전장 연습이라 랭크 점수는 바뀌지 않았습니다.</div>' : `<div class="status">내 랭크 점수: <b>${mine.rating}</b> (강한 상대를 이길수록 많이 오릅니다 · 우승 보너스 +${CHAMP_BONUS})</div>`}
      ${again}
      <button class="btn ghost" id="arenaExit">🚪 메인으로</button>`);
    if (this.isHost) $('#arenaAgain').onclick = () => Arena.again();
    $('#arenaExit').onclick = () => toMenu();
  },
};

// ───────────────────────── 메뉴 버튼 ─────────────────────────
function arenaEnterAsHost(practice) {
  toMenu();
  App.mode = 'arena';
  ArenaClient.reset();
  ArenaClient.isHost = true;
  Net.maxGuests = ARENA_SIZE - 1;
  Arena.create(practice);
  if (practice) return;
  lobby('⚔ 전장 만들기', `<div class="status"><span class="spinner">⏳</span> 방을 만드는 중...</div>`);
  Net.onData = (d, id) => Arena.onMessage(id, d);
  Net.onClose = id => Arena.dropGuest(id);
  Net.host(code => { Arena.H.code = code; Arena.publish(); },
    err => lobby('⚔ 전장 만들기', `<div class="status" style="color:#ff9a9a">${esc(err)}</div>`));
}

$('#btnHost').onclick = () => arenaEnterAsHost(false);
$('#btnArenaPractice').onclick = () => arenaEnterAsHost(true);

$('#btnJoin').onclick = () => {
  toMenu();
  App.mode = 'arena';
  ArenaClient.reset();
  ArenaClient.isHost = false;
  lobby('⚔ 전장 참가', `<div>친구에게 받은 방 코드를 입력하세요</div>
    <input class="code-input" id="codeIn" maxlength="5" placeholder="ABCDE" style="font-size:32px;text-align:center;letter-spacing:6px;width:240px;text-transform:uppercase">
    <button class="btn primary big" id="joinGo">참가하기</button><div class="status" id="joinStatus"></div>`);
  const go = () => {
    const code = $('#codeIn').value.trim();
    if (code.length < 5) return toast('코드 5자리를 입력하세요.');
    $('#joinStatus').innerHTML = '<span class="spinner">⏳</span> 접속 중...';
    Net.onData = d => {
      if (d.type === 'arena') ArenaClient.onView(d.view, d.you);
      else if (d.type === 'match') ArenaClient.onMatch(d.id, d.state);
      else if (d.type === 'deny') toast(`${josa(RACES[d.race].name, '은', '는')} 이미 다른 사람이 골랐습니다!`);
      else if (d.type === 'full') { toast('방이 가득 찼거나 이미 전장이 시작됐습니다.', 3000); toMenu(); }
    };
    Net.onClose = () => netLost();
    Net.join(code, () => {
      $('#joinStatus').textContent = '접속 성공! 대기실을 여는 중...';
      Net.send({ type: 'hello', name: myName(), rating: getRating() });
    }, err => { const st = $('#joinStatus'); if (st) st.innerHTML = `<span style="color:#ff9a9a">${esc(err)}</span>`; else toast(err); });
  };
  $('#joinGo').onclick = go;
  $('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#codeIn').focus();
};

updateMenuRating();
