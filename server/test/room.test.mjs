// The room logic on its own, with fake connections: who may drive, what a TV is
// sent, Resume, and dropping idle rooms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, Rooms, newCode, normalCode, CODE_ALPHABET, IDLE_MS } from '../../shared/room.js';

const conn = () => { const c = { role: null, got: [], closed: false }; c.send = (m) => c.got.push(m); c.close = () => { c.closed = true; }; return c; };
const last = (c) => c.got[c.got.length - 1];
let n = 0;
const room = (now = () => 0) => new Room('ABCD', { now, makeKey: () => 'key' + (++n) });

test('codes are four letters with no I or O', () => {
  for (let i = 0; i < 500; i++) {
    const c = newCode();
    assert.match(c, /^[A-Z]{4}$/);
    assert.ok(!/[IO]/.test(c));
  }
  assert.ok(!CODE_ALPHABET.includes('I') && !CODE_ALPHABET.includes('O'));
  assert.equal(normalCode(' ab-cd '), 'ABCD');
  assert.equal(normalCode('AB1D'), null);
  assert.equal(normalCode('ABCO'), null);
});

test('the first iPad gets the key; another device without it cannot drive', () => {
  const r = room(), ipad = conn(), other = conn(), tv = conn();
  r.join(tv, { t: 'tv' });
  assert.ok(r.join(ipad, { t: 'host' }));
  const key = last(ipad).key;
  assert.ok(key);
  assert.equal(r.join(other, { t: 'host' }), false);
  assert.deepEqual(last(other), { t: 'error', reason: 'taken' });
  assert.equal(r.join(other, { t: 'host', key: 'guess' }), false);
  // A TV can't push a view either.
  r.receive(tv, { t: 'view', view: { phase: 'board', q: 'hacked' } });
  assert.equal(r.view, null);
});

test('the iPad view reaches every TV, and a late TV gets the latest at once', () => {
  const r = room(), ipad = conn(), tv1 = conn();
  r.join(tv1, { t: 'tv' });
  r.join(ipad, { t: 'host' });
  r.receive(ipad, { t: 'view', view: { phase: 'board', strikes: 1 } });
  assert.deepEqual(last(tv1), { t: 'view', view: { phase: 'board', strikes: 1 } });
  r.receive(ipad, { t: 'photo', team: 1, data: 'data:image/jpeg;base64,AAAA' });
  const tv2 = conn();
  r.join(tv2, { t: 'tv' });
  const j = last(tv2);
  assert.equal(j.t, 'joined'); assert.equal(j.hostOnline, true);
  assert.deepEqual(j.view, { phase: 'board', strikes: 1 });
  assert.deepEqual(j.photos, [null, 'data:image/jpeg;base64,AAAA']);
});

test('TVs hear when the iPad goes and comes back, and the same key takes over', () => {
  const r = room(), ipad = conn(), tv = conn();
  r.join(tv, { t: 'tv' }); r.join(ipad, { t: 'host' });
  const key = last(ipad).key;
  r.leave(ipad);
  assert.deepEqual(last(tv), { t: 'host', online: false });
  const again = conn();
  assert.ok(r.join(again, { t: 'host', key }));
  assert.deepEqual(last(tv), { t: 'host', online: true });
  // A second tab with the key replaces the first; the old one is closed and ignored.
  const third = conn();
  r.join(third, { t: 'host', key });
  assert.equal(again.closed, true);
  r.receive(again, { t: 'view', view: { phase: 'end' } });
  assert.equal(r.view, null);
});

test('Resume: the backup comes back with a summary first', () => {
  const r = room(), ipad = conn();
  r.join(ipad, { t: 'host' });
  const key = last(ipad).key;
  const state = { teams: [{ name: 'Sambranos', score: 120 }, { name: 'In-laws', score: 80 }], qi: 4, phase: 'board', questions: [{}, {}, {}, {}, {}, {}] };
  r.receive(ipad, { t: 'backup', state });
  r.leave(ipad);
  const fresh = conn();
  r.join(fresh, { t: 'host', key });
  assert.deepEqual(last(fresh).backup, { teams: ['Sambranos', 'In-laws'], scores: [120, 80], question: 5, questions: 6, phase: 'board' });
  r.receive(fresh, { t: 'resume' });
  assert.deepEqual(last(fresh).state, state);
});

test('oversized or malformed messages are refused', () => {
  const r = room(), ipad = conn();
  r.join(ipad, { t: 'host' });
  r.receive(ipad, { t: 'view', view: { big: 'x'.repeat(20000) } });
  assert.deepEqual(last(ipad), { t: 'error', reason: 'big' });
  r.receive(ipad, { t: 'photo', team: 0, data: 'javascript:alert(1)' });
  assert.equal(r.photos[0], null);
});

test('rooms are separate, and idle ones are dropped after 12 hours', () => {
  let t = 0;
  const rooms = new Rooms({ now: () => t, makeKey: () => 'k' });
  const a = rooms.create(), b = rooms.create();
  assert.notEqual(a.code, b.code);
  const ipadA = conn(), tvB = conn();
  a.join(ipadA, { t: 'host' }); b.join(tvB, { t: 'tv' });
  a.receive(ipadA, { t: 'view', view: { q: 'A only' } });
  assert.equal(b.view, null);
  assert.ok(!tvB.got.some((m) => m.t === 'view'));
  t = IDLE_MS - 1; b.touch();
  t = IDLE_MS + 10; rooms.sweep();
  assert.equal(rooms.get(a.code), null);
  assert.ok(rooms.get(b.code));
  assert.equal(ipadA.closed, true);
});
