// One game room as a Cloudflare Durable Object: the same Room logic as the Node relay
// (shared/room.js), around hibernating WebSockets.
//
// A Durable Object can be evicted from memory between messages, so everything the room
// knows (its key, the last snapshot, the photos, the backup, when it was last used) lives
// in the object's own storage, and the sockets keep their role in an attachment. On the
// next message the room is rebuilt from both.
import { DurableObject } from 'cloudflare:workers';
import { Room, IDLE_MS } from '../shared/room.js';

const randomKey = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const SAVED = ['code', 'key', 'view', 'photos', 'backup', 'touched'];

export class FFRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.conns = new Map();
    // Pings are answered without waking the room, so an idle game costs nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  conn(ws) {
    let c = this.conns.get(ws);
    if (!c) {
      c = {
        ws,
        role: null,
        send: (obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) { /* closed */ } },
        close: () => { try { ws.close(4000, 'replaced'); } catch (e) { /* closed */ } },
      };
      this.conns.set(ws, c);
    }
    return c;
  }

  // The Room as it was before any hibernation: stored state plus the sockets still open.
  async load() {
    if (this.room) return this.room;
    const s = await this.ctx.storage.get(SAVED);
    if (!s.get('code')) return null;
    const room = new Room(s.get('code'), { makeKey: randomKey });
    room.key = s.get('key') ?? null;
    room.view = s.get('view') ?? null;
    room.photos = s.get('photos') ?? [null, null];
    room.backup = s.get('backup') ?? null;
    room.touched = s.get('touched') ?? Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const c = this.conn(ws);
      c.role = (ws.deserializeAttachment() || {}).role || null;
      if (c.role === 'host') room.host = c;
      else if (c.role === 'tv') room.tvs.add(c);
    }
    this.room = room;
    return room;
  }

  async save(room) {
    await this.ctx.storage.put({ key: room.key, view: room.view, photos: room.photos, backup: room.backup, touched: room.touched });
    await this.ctx.storage.setAlarm(room.touched + IDLE_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);
    // A TV making a new room: claim this code unless a live room already has it.
    if (url.pathname === '/init') {
      const touched = await this.ctx.storage.get('touched');
      if (touched && Date.now() - touched < IDLE_MS) return new Response('taken', { status: 409 });
      await this.ctx.storage.deleteAll();
      const now = Date.now();
      await this.ctx.storage.put({ code: url.searchParams.get('code'), touched: now });
      await this.ctx.storage.setAlarm(now + IDLE_MS);
      this.room = null;
      return new Response('ok');
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const c = this.conn(ws);
    const room = await this.load();
    if (!room) { c.send({ t: 'error', reason: 'nocode' }); try { ws.close(1000, 'no such room'); } catch (e) { /* closed */ } return; }
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (e) { c.send({ t: 'error', reason: 'bad' }); return; }
    if (!msg || typeof msg !== 'object') return;
    if (!c.role && msg.t !== 'ping') {
      if (room.join(c, msg)) ws.serializeAttachment({ role: c.role });
      await this.save(room);
      return;
    }
    room.receive(c, msg);
    if (msg.t === 'view' || msg.t === 'photo' || msg.t === 'backup') await this.save(room);
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) {
    const room = await this.load();
    if (room) { room.leave(this.conn(ws)); await this.save(room); }
    this.conns.delete(ws);
  }

  // Twelve hours after the last use, the room is dropped and its sockets closed.
  async alarm() {
    const touched = await this.ctx.storage.get('touched');
    if (touched && Date.now() - touched < IDLE_MS) { await this.ctx.storage.setAlarm(touched + IDLE_MS); return; }
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1001, 'room expired'); } catch (e) { /* closed */ } }
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.conns.clear();
  }
}
