// One game room: a TV (or several) watching, one iPad driving.
//
// No transport in here. A connection is any object with send(obj) and close(),
// so the Node server (server/server.js) uses it today and a Cloudflare Durable
// Object can use it later unchanged.
//
// Messages are small JSON objects with a `t` field.
//   TV   → room: { t: 'tv', code }
//   iPad → room: { t: 'host', code, key? }        key is absent the first time
//                { t: 'view', view }              what the TV should show now
//                { t: 'photo', team, data }       a 256px JPEG data: URL, or null
//                { t: 'backup', state }           the iPad's whole game, for Resume
//                { t: 'resume' }                  asks for that backup back
//   either:      { t: 'ping' } → { t: 'pong' }    so a dead line is noticed
//   room → TV:   { t: 'joined', role: 'tv', code, hostOnline, view, photos }
//                { t: 'view', view } · { t: 'photo', team, data } · { t: 'host', online }
//   room → iPad: { t: 'joined', role: 'host', code, key, backup: summary | null }
//                { t: 'backup', state, photos }   the answer to 'resume'
//   room → any:  { t: 'error', reason }           reason: 'taken' | 'bad' | 'big'
//
// The room never sees an unrevealed answer: the iPad builds `view` from what the
// players have already been shown.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O, and no digits, so no 0/O or 1/I mix-ups
export const CODE_LENGTH = 4;
export const IDLE_MS = 12 * 60 * 60 * 1000;                // a room nobody has touched for 12 hours is dropped
export const LIMITS = { view: 16 * 1024, photo: 192 * 1024, backup: 512 * 1024 };   // a photo is a ~768px JPEG data: URL

export function newCode(random = Math.random) {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return c;
}

export function normalCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}

const size = (v) => (typeof v === 'string' ? v.length : JSON.stringify(v).length);

export class Room {
  constructor(code, { now = () => Date.now(), makeKey } = {}) {
    this.code = code;
    this.now = now;
    this.makeKey = makeKey;
    this.key = null;            // handed to the first iPad; only it drives from then on
    this.host = null;           // the connected iPad, if any
    this.tvs = new Set();
    this.view = null;
    this.photos = [null, null];
    this.backup = null;         // { state, summary }
    this.touched = now();
  }

  touch() { this.touched = this.now(); }
  isIdle(now = this.now()) { return now - this.touched > IDLE_MS; }
  get empty() { return !this.host && this.tvs.size === 0; }

  // The first message on a connection says who it is.
  join(conn, msg) {
    this.touch();
    if (msg.t === 'tv') {
      conn.role = 'tv';
      this.tvs.add(conn);
      conn.send({ t: 'joined', role: 'tv', code: this.code, hostOnline: !!this.host, view: this.view, photos: this.photos });
      return true;
    }
    if (msg.t === 'host') {
      if (this.key && msg.key !== this.key) { conn.send({ t: 'error', reason: 'taken' }); return false; }
      if (!this.key) this.key = this.makeKey();
      if (this.host && this.host !== conn) {
        // The same iPad again (a reload, a new tab): the newest connection drives.
        const old = this.host; old.role = null; try { old.close(); } catch (e) { /* already gone */ }
      }
      conn.role = 'host';
      this.host = conn;
      conn.send({ t: 'joined', role: 'host', code: this.code, key: this.key, backup: this.backup ? this.backup.summary : null });
      this.toTvs({ t: 'host', online: true });
      return true;
    }
    conn.send({ t: 'error', reason: 'bad' });
    return false;
  }

  receive(conn, msg) {
    // Either side checks the line is alive; on a weak connection a socket can die without closing.
    if (msg.t === 'ping') return conn.send({ t: 'pong' });
    if (conn.role !== 'host' || conn !== this.host) return;   // TVs only watch; a replaced iPad is ignored
    this.touch();
    if (msg.t === 'view') {
      if (!msg.view || typeof msg.view !== 'object' || size(msg.view) > LIMITS.view) return conn.send({ t: 'error', reason: 'big' });
      this.view = msg.view;
      this.toTvs({ t: 'view', view: msg.view });
    } else if (msg.t === 'photo') {
      const team = msg.team === 1 ? 1 : 0;
      const data = typeof msg.data === 'string' && msg.data.startsWith('data:image/') ? msg.data : null;
      if (data && data.length > LIMITS.photo) return conn.send({ t: 'error', reason: 'big' });
      this.photos[team] = data;
      this.toTvs({ t: 'photo', team, data });
    } else if (msg.t === 'backup') {
      if (!msg.state || typeof msg.state !== 'object' || size(msg.state) > LIMITS.backup) return conn.send({ t: 'error', reason: 'big' });
      this.backup = { state: msg.state, summary: summarize(msg.state) };
    } else if (msg.t === 'resume') {
      conn.send({ t: 'backup', state: this.backup ? this.backup.state : null, photos: this.photos });
    }
  }

  leave(conn) {
    if (conn === this.host) {
      this.host = null;
      this.toTvs({ t: 'host', online: false });
    }
    this.tvs.delete(conn);
    this.touch();
  }

  toTvs(msg) {
    for (const tv of this.tvs) { try { tv.send(msg); } catch (e) { /* the transport drops it */ } }
  }
}

// What "Resume game" says before anyone taps it.
function summarize(s) {
  const teams = Array.isArray(s.teams) ? s.teams : [];
  const name = (i) => String((teams[i] && teams[i].name) || (i ? 'Team B' : 'Team A')).slice(0, 20);
  const score = (i) => Number((teams[i] && teams[i].score) || 0);
  const questions = Array.isArray(s.questions) ? s.questions.length : 0;
  return { teams: [name(0), name(1)], scores: [score(0), score(1)], question: Number(s.qi || 0) + 1, questions, phase: String(s.phase || 'setup') };
}

// All the rooms on one server. Codes are unique among live rooms.
export class Rooms {
  constructor({ now = () => Date.now(), makeKey, random = Math.random, max = 500 } = {}) {
    this.now = now; this.makeKey = makeKey; this.random = random; this.max = max;
    this.byCode = new Map();
  }
  create() {
    this.sweep();
    if (this.byCode.size >= this.max) return null;
    let code;
    do { code = newCode(this.random); } while (this.byCode.has(code));
    const room = new Room(code, { now: this.now, makeKey: this.makeKey });
    this.byCode.set(code, room);
    return room;
  }
  get(code) {
    const c = normalCode(code);
    return c ? this.byCode.get(c) || null : null;
  }
  // Drops rooms nobody has touched for IDLE_MS, closing anything still attached.
  sweep(now = this.now()) {
    for (const [code, room] of this.byCode) {
      if (!room.isIdle(now)) continue;
      for (const c of [room.host, ...room.tvs]) if (c) { try { c.close(); } catch (e) { /* gone */ } }
      this.byCode.delete(code);
    }
  }
}
