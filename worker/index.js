// PAMILY PHEUD on Cloudflare: the game's files as static assets, and one Durable Object per
// room for TV mode. Same paths and protocol as the Node relay in server/ (which stays the
// local fallback): POST /api/rooms makes a room, /ws?code=ABCD is the room's socket.
import { newCode, normalCode } from '../shared/room.js';
export { FFRoom } from './room.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const roomFor = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/info' && request.method === 'GET') return json({ ff: true });
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      // A fresh 4-letter code, skipping any that a live room still holds.
      for (let tries = 0; tries < 12; tries++) {
        const code = newCode();
        const r = await roomFor(env, code).fetch('https://room/init?code=' + code);
        if (r.ok) return json({ code }, 201);
      }
      return json({ error: 'full' }, 503);
    }
    if (url.pathname === '/ws') {
      const code = normalCode(url.searchParams.get('code'));
      if (!code) return new Response('A room code is needed: /ws?code=ABCD', { status: 400 });
      return roomFor(env, code).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
