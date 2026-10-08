// The TV relay: serves the game's files and passes the iPad's snapshots to the TV.
//
//   npm start            listens on 127.0.0.1:8090 (PORT and HOST override)
//
// It only listens on this PC. The Cloudflare tunnel brings https://ff.eventurelog.ca
// here, so nothing on the LAN can reach it and Windows asks no firewall question.
// Rooms live in memory: a restart drops them, and the iPad simply joins a new code.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Rooms, LIMITS } from '../shared/room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';

// Only the app's own files are served: nothing from server/, shared/ or .git.
const FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/tv': 'tv.html',
  '/tv.html': 'tv.html',
  '/sw.js': 'sw.js',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/xlsx.mini.min.js': 'xlsx.mini.min.js',
  '/game-night.csv': 'game-night.csv',
  '/filipino-vietnamese-family.csv': 'filipino-vietnamese-family.csv',
  '/family-questions.csv': 'family-questions.csv',
  '/two-families.csv': 'two-families.csv',
  '/sample-questions.csv': 'sample-questions.csv',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function createServer({ log = console.log } = {}) {
  const rooms = new Rooms({ makeKey: () => randomBytes(12).toString('base64url') });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    try {
      if (url.pathname === '/api/info' && req.method === 'GET') return send(200, JSON.stringify({ ff: true }));
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        const room = rooms.create();
        return room ? send(201, JSON.stringify({ code: room.code })) : send(503, JSON.stringify({ error: 'full' }));
      }
      if (url.pathname.startsWith('/api/')) return send(404, JSON.stringify({ error: 'not found' }));
      const file = FILES[url.pathname];
      if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return send(404, 'Not found', 'text/plain; charset=utf-8');
      const body = await readFile(path.join(ROOT, file));
      // The app's own service worker decides caching; the browser cache always revalidates.
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      log('error ' + req.method + ' ' + url.pathname + ': ' + e.message);
      send(500, 'Server error', 'text/plain; charset=utf-8');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.backup + 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    let room = null;
    const conn = {
      role: null,
      send: (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); },
      close: () => ws.close(4000, 'replaced'),
    };
    // A dead connection on a flaky line is noticed within about 30 s.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return conn.send({ t: 'error', reason: 'bad' }); }
      if (!msg || typeof msg !== 'object') return;
      if (!room) {
        room = rooms.get(msg.code);
        if (!room) { conn.send({ t: 'error', reason: 'nocode' }); return; }
        if (!room.join(conn, msg)) room = null;
        return;
      }
      room.receive(conn, msg);
    });
    ws.on('close', () => { if (room) room.leave(conn); });
    ws.on('error', () => {});
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* closing */ }
    }
    rooms.sweep();
  }, 15000);
  server.on('close', () => clearInterval(beat));

  return { server, rooms, wss };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createServer();
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Stop the other program, or run with PORT=8091 npm start.` : e.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Family Feud is running on http://${HOST}:${PORT}`);
    console.log(`  TV:   http://${HOST}:${PORT}/tv   (or https://ff.eventurelog.ca/tv through the tunnel)`);
    console.log(`  iPad: http://${HOST}:${PORT}/     (or https://ff.eventurelog.ca)`);
    console.log('Press Ctrl+C to stop.');
  });
}
