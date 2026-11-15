'use strict';
// =====================================================================
//  종족대전 - 온라인 (PeerJS / WebRTC P2P)
//  방장(호스트)이 모든 경기를 관리하고, 참가자(최대 3명)는 행동만 보내고 상태를 받는다.
// =====================================================================
const NET_PREFIX = 'jongjokdaejeon-v1-';

const Net = {
  peer: null,
  conns: {},        // 호스트: 참가자 id → 연결
  hostConn: null,   // 참가자: 호스트로의 연결
  locked: false,    // 호스트: 경기 시작 후 새 참가 막기
  maxGuests: 3,
  onData: null,     // (msg, fromId)
  onClose: null,    // (fromId)

  available() { return typeof Peer !== 'undefined'; },

  genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  },

  host(onCode, onError) {
    if (!this.available()) return onError('온라인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    this.close();
    const code = this.genCode();
    this.peer = new Peer(NET_PREFIX + code);
    this.peer.on('open', () => onCode(code));
    this.peer.on('connection', c => {
      c.on('open', () => {
        if (this.locked || Object.keys(this.conns).length >= this.maxGuests) {
          c.send(JSON.stringify({ type: 'full' }));
          setTimeout(() => c.close(), 400);
          return;
        }
        this.conns[c.peer] = c;
        this.bind(c, c.peer);
      });
    });
    this.peer.on('error', e => onError(e.type === 'unavailable-id' ? '코드가 겹쳤습니다. 다시 시도하세요.' : '연결 오류: ' + (e.type || e)));
  },

  join(code, onConnected, onError) {
    if (!this.available()) return onError('온라인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    this.close();
    this.peer = new Peer();
    this.peer.on('open', () => {
      const c = this.peer.connect(NET_PREFIX + code.trim().toUpperCase(), { reliable: true });
      this.hostConn = c;
      this.bind(c, 'host');
      c.on('open', () => onConnected());
    });
    this.peer.on('error', e => onError(e.type === 'peer-unavailable' ? '방을 찾을 수 없습니다. 코드를 확인하세요.' : '연결 오류: ' + (e.type || e)));
  },

  bind(c, id) {
    c.on('data', d => {
      let msg = d;
      if (typeof d === 'string') { try { msg = JSON.parse(d); } catch (_) { return; } }
      if (this.onData) this.onData(msg, id);
    });
    c.on('close', () => {
      if (this.conns[id] === c) delete this.conns[id];
      if (this.hostConn === c) this.hostConn = null;
      if (this.onClose) this.onClose(id);
    });
  },

  // 참가자 → 호스트
  send(msg) { const c = this.hostConn; if (c && c.open) c.send(JSON.stringify(msg)); },
  // 호스트 → 특정 참가자 / 전원
  sendTo(id, msg) { const c = this.conns[id]; if (c && c.open) c.send(JSON.stringify(msg)); },
  broadcast(msg) { const s = JSON.stringify(msg); Object.values(this.conns).forEach(c => { if (c.open) c.send(s); }); },

  close() {
    const cs = [...Object.values(this.conns), this.hostConn].filter(Boolean), p = this.peer;
    this.conns = {}; this.hostConn = null; this.peer = null; this.locked = false;
    cs.forEach(c => { try { c.close(); } catch (_) {} });
    try { if (p) p.destroy(); } catch (_) {}
  },
};
