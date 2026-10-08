// End-to-end: a TV and an iPad in two browsers, against a server of their own.
//
//   npm run e2e                     (CHROME=path/to/chrome if it isn't in the usual place)
//   SHOTS=some/folder npm run e2e   also saves screenshots
//
// Checks: a full round mirrors to the TV; no answer reaches the TV before it is revealed;
// bytes per message; the iPad plays on while its line is down and the TV catches up; a
// device without the key can't drive; two rooms stay apart; Resume on an empty iPad; and
// the github.io build (no relay) is unchanged.
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import WebSocket from 'ws';
import { createServer } from '../server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env.SHOTS || '';
const results = [];
const step = (name) => { results.push(name); console.log('  ✓ ' + name); };

const listen = (server) => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
const { server } = createServer({ log: () => {} });
const port = await listen(server);
const base = `http://127.0.0.1:${port}`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
async function context(kind) {
  const opts = kind === 'tv'
    ? { viewport: { width: 1280, height: 720 } }
    : { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { window.__ffFast = true; });
  return ctx;
}
async function open(ctx, url, label) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(label + ' console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const tvCode = async (tv) => { await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('wCode').textContent)); return tv.textContent('#wCode'); };

// Every frame the TVs receive, and every frame each iPad sends, for the secrecy and size checks.
const tvFrames = [];
const watchTv = (page) => page.on('websocket', (ws) => ws.on('framereceived', (f) => tvFrames.push(String(f.payload))));
const ipadSent = [];

// The iPad's socket goes through a gate, so a dropped line can be simulated exactly.
async function gateIpad(page) {
  const gate = { cut: false, live: new Set() };
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (gate.cut) { ws.close(); return; }
    const srv = ws.connectToServer();
    const pair = { ws, srv };
    gate.live.add(pair);
    ws.onMessage((m) => { ipadSent.push(String(m)); srv.send(m); });
    srv.onMessage((m) => ws.send(m));
    ws.onClose(() => { gate.live.delete(pair); srv.close(); });
    srv.onClose(() => { gate.live.delete(pair); ws.close(); });
  });
  gate.drop = () => { gate.cut = true; for (const p of gate.live) { p.ws.close(); p.srv.close(); } gate.live.clear(); };
  gate.restore = () => { gate.cut = false; };
  return gate;
}

async function judge(page, idx) {   // idx: answer index, or -1 for "not on board" / strike
  // Joined to a TV the iPad is the GM console: tap the answer they gave, or ✗.
  if (await page.evaluate(() => document.body.classList.contains('console'))) {
    if (idx >= 0) await page.click(`#grid .slot[data-i="${idx}"]`); else await page.click('#btnStrike');
    await page.waitForTimeout(350);
    return;
  }
  await page.click('#bStatus [data-act="check"]');
  await page.click('#curtain');
  if (idx >= 0) await page.click(`#gmList button[data-i="${idx}"]`); else await page.click('#gmMiss');
  await page.click('#gmOk');
  await page.click('#curtain');
  await page.waitForTimeout(350);
}
async function photoFile(page) {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#2563eb'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(800, 560, 380, 0, 7); g.fill();
    return c.toDataURL('image/jpeg', 0.9);
  });
  return { name: 'team.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data.split(',')[1], 'base64') };
}
const flipped = (tv) => tv.$$eval('#grid .slot.flipped', (els) => els.map((e) => e.querySelector('.ans').textContent));

try {
  // ---------- a TV makes a room ----------
  const tvCtx = await context('tv');
  const tv = await open(tvCtx, base + '/tv', 'tv');
  watchTv(tv);
  const code = await tvCode(tv);
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.ok((await tv.textContent('#wHow')).includes('127.0.0.1:' + port));
  await shot(tv, 'tv-1-code');
  step('the TV makes a room and shows a 4-letter code (' + code + ')');

  // ---------- the iPad joins ----------
  const ipadCtx = await context('ipad');
  const ipad = await ipadCtx.newPage();
  ipad.on('pageerror', (e) => errors.push('ipad: ' + e.message));
  ipad.on('dialog', (d) => d.accept());
  const gate = await gateIpad(ipad);
  await ipad.goto(base + '/', { waitUntil: 'networkidle' });
  await ipad.waitForSelector('#tvCard:not([hidden])');
  await ipad.fill('#nameA', 'Sambranos'); await ipad.fill('#nameB', 'In-laws');
  await ipad.locator('[data-photo-input="0"]').setInputFiles(await photoFile(ipad));
  await ipad.waitForFunction(() => document.querySelector('[data-photo-pick="0"]').textContent === 'Change photo');
  await ipad.fill('#tvCode', code.toLowerCase());
  await ipad.click('#btnTvJoin');
  await ipad.waitForFunction(() => document.getElementById('tvState').textContent.includes('On the TV'));
  await tv.waitForFunction(() => document.getElementById('wReady').textContent.includes('iPad connected'));
  assert.ok((await ipad.evaluate(() => location.hash)).startsWith('#tv=' + code + '.'));
  await shot(ipad, 'ipad-1-connected');
  await shot(tv, 'tv-2-ipad-connected');
  step('the iPad types the code (lower case is fine) and becomes the game master');

  // ---------- a round ----------
  await ipad.click('#btnStart');
  await tv.waitForSelector('#faceoff.active');
  const q1 = (await ipad.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')))).questions[0].q;
  // Until the count ends, the question is on neither screen and was never sent to the TV.
  assert.equal(await tv.textContent('#fQ'), 'Face-off');
  assert.notEqual(await ipad.textContent('#foQ'), q1);
  assert.ok(!tvFrames.some((f) => f.includes(JSON.stringify(q1).slice(1, -1))), 'the question reached the TV before arming');
  await tv.waitForFunction(() => !document.querySelector('#faceoff .photo[data-photo="0"]').hidden);
  assert.equal(await tv.$eval('#faceoff .photo[data-photo="1"]', (e) => e.hidden), true);
  await ipad.click('#btnArm');
  // A tap during the count is ignored: no buzz winner.
  await ipad.locator('.zone[data-side="1"]').dispatchEvent('pointerdown');
  await tv.waitForSelector('#faceoff .zone.armed');
  assert.equal(await tv.$('#faceoff .zone.winner'), null, 'a tap during the countdown must not win the buzz');
  assert.equal(await tv.textContent('#fQ'), q1);
  assert.equal(await ipad.textContent('#foQ'), q1);
  await shot(tv, 'tv-3-armed');
  await ipad.locator('.zone[data-side="0"]').dispatchEvent('pointerdown');
  await tv.waitForSelector('#faceoff .zone.t0.winner');
  await shot(tv, 'tv-4-buzzed');
  step('face-off: the question stays hidden and unsent until arming counts 3-2-1, a tap during the count is ignored, then the buzz winner shows on the TV');

  await ipad.waitForSelector('#board.active');
  await tv.waitForSelector('#board.active');
  await judge(ipad, 0);                                           // the buzz winner says the top answer
  await tv.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 1);
  const top = (await ipad.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')))).questions[0].answers[0].text;
  assert.deepEqual(await flipped(tv), [top]);
  await tv.waitForFunction(() => document.getElementById('bStatus').textContent.includes('won the face-off'));
  // The joined iPad is a GM console: every answer with its points up front, no GM-view toggle, no sounds.
  const answers = (await ipad.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')))).questions[0].answers;
  assert.ok(await ipad.evaluate(() => document.body.classList.contains('console')));
  assert.ok(await ipad.$eval('#grid', (g) => g.classList.contains('gm')));
  const onIpad = await ipad.$$eval('#grid .slot:not(.empty) .ans', (els) => els.map((e) => e.textContent));
  assert.deepEqual(onIpad, answers.map((a) => a.text));
  assert.equal(await ipad.$eval('#gmToggle', (b) => getComputedStyle(b).display), 'none');
  assert.equal(await ipad.evaluate(() => document.querySelector('.btn-sound') && getComputedStyle(document.querySelector('.btn-sound')).display), 'none');
  await ipad.click('#bStatus [data-act="play"]');
  await judge(ipad, 2);
  await tv.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 2);
  assert.equal(await ipad.textContent('#btnStrike'), '✗ Strike');
  await judge(ipad, -1);                                          // a strike
  await tv.waitForFunction(() => document.querySelectorAll('.sbox.on').length === 1);
  await tv.waitForSelector('#flash.on');                          // the X shows on the TV …
  assert.equal(await ipad.$eval('#strikeFlash', (f) => getComputedStyle(f).display), 'none');   // … not on the console
  assert.equal(await tv.textContent('#pot'), await ipad.textContent('#pot'));
  await shot(tv, 'tv-5-board');
  await shot(ipad, 'ipad-2-board');
  step('board: the iPad is a GM console (every answer up front, tap to rule, no X or sounds), and reveals, control, a strike and the pot match on the TV');

  // ---------- the line drops; the iPad plays on ----------
  gate.drop();
  await tv.waitForFunction(() => document.getElementById('tag').textContent.includes('Waiting for the iPad'));
  await ipad.waitForFunction(() => document.getElementById('tvPill').textContent.includes('reconnecting'));
  await judge(ipad, 1);
  await judge(ipad, -1);
  assert.equal((await flipped(tv)).length, 2, 'the TV must not change while the line is down');
  assert.equal(await ipad.$$eval('.sbox.on', (e) => e.length), 2);
  await shot(tv, 'tv-6-waiting');
  await shot(ipad, 'ipad-3-reconnecting');
  gate.restore();
  await tv.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 3 && document.querySelectorAll('.sbox.on').length === 2, null, { timeout: 20000 });
  await tv.waitForFunction(() => !document.getElementById('tag').classList.contains('on'));
  step('line down: the iPad plays two moves alone, the TV says "Waiting for the iPad…", then catches up on reconnect');

  // A TV reload resyncs everything at once, with no replayed animation.
  await tv.reload({ waitUntil: 'networkidle' });
  await tv.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 3);
  assert.equal(await tv.textContent('#wCode').catch(() => ''), code);
  assert.equal(await tv.$eval('.team.t0 .score', (e) => e.textContent), await ipad.$eval('.team.t0 .tscore', (e) => e.textContent));
  step('the TV reloads into the same room and redraws the whole board');

  // ---------- a device without the key can't drive ----------
  const otherCtx = await context('ipad');
  const other = await open(otherCtx, base + '/', 'other');
  await other.waitForSelector('#tvCard:not([hidden])');
  await other.fill('#tvCode', code); await other.click('#btnTvJoin');
  await other.waitForFunction(() => document.getElementById('tvHint').textContent.includes('already has a game master'));
  const raw = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const rawGot = [];
  await new Promise((res) => raw.on('open', res));
  raw.on('message', (m) => rawGot.push(JSON.parse(m)));
  raw.send(JSON.stringify({ t: 'host', code, key: 'not-the-key' }));
  raw.send(JSON.stringify({ t: 'view', view: { phase: 'end', teams: [{ name: 'Hacked', score: 999 }, { name: 'x', score: 0 }] } }));
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(rawGot[0], { t: 'error', reason: 'taken' });
  const raw2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res) => raw2.on('open', res));
  raw2.send(JSON.stringify({ t: 'tv', code }));
  raw2.send(JSON.stringify({ t: 'view', view: { phase: 'end', teams: [{ name: 'Hacked', score: 999 }, { name: 'x', score: 0 }] } }));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(await tv.$('#board.active'), 'the TV is still on the board');
  assert.ok(!(await tv.content()).includes('Hacked'));
  raw.close(); raw2.close(); await otherCtx.close();
  step('without the key, neither another iPad nor a raw socket (as host or as a TV) can change the game');

  // ---------- two rooms side by side ----------
  const tvBCtx = await context('tv');
  const tvB = await open(tvBCtx, base + '/tv', 'tvB');
  watchTv(tvB);
  const codeB = await tvCode(tvB);
  assert.notEqual(codeB, code);
  const ipadBCtx = await context('ipad');
  const ipadB = await open(ipadBCtx, base + '/', 'ipadB');
  ipadB.on('websocket', (ws) => ws.on('framesent', (f) => ipadSent.push(String(f.payload))));
  await ipadB.waitForSelector('#tvCard:not([hidden])');
  await ipadB.fill('#nameA', 'Cousins'); await ipadB.fill('#nameB', 'Aunties');
  await ipadB.fill('#tvCode', codeB); await ipadB.click('#btnTvJoin');
  await ipadB.waitForFunction(() => document.getElementById('tvState').textContent.includes('On the TV'));
  await ipadB.click('#btnStart');
  await tvB.waitForSelector('#faceoff.active');
  assert.equal(await tvB.textContent('#faceoff .zone.t0 .name'), 'Cousins');
  assert.equal(await tv.textContent('.team.t0 .name'), 'Sambranos');
  assert.equal(await tvB.$eval('#faceoff .photo[data-photo="0"]', (e) => e.hidden), true, 'room B has no photo from room A');
  await shot(tvB, 'tv-7-second-room');
  await ipadBCtx.close(); await tvBCtx.close();
  step('two rooms run side by side and never see each other (' + code + ' and ' + codeB + ')');

  // ---------- Resume on an empty iPad ----------
  await ipad.waitForTimeout(2500);                                 // the backup goes out about 2 s after a change
  const hash = await ipad.evaluate(() => location.hash);
  const scores = await ipad.$$eval('.team .tscore', (e) => e.map((x) => x.textContent));
  await ipad.close();
  await tv.waitForFunction(() => document.getElementById('tag').textContent.includes('Waiting for the iPad'));
  const freshCtx = await context('ipad');
  const fresh = await open(freshCtx, base + '/' + hash, 'fresh');
  await fresh.waitForSelector('#tvResume:not([hidden])');
  assert.ok((await fresh.textContent('#tvResumeInfo')).includes('Sambranos'));
  await shot(fresh, 'ipad-4-resume');
  await fresh.click('#btnTvResume');
  await fresh.waitForTimeout(1500);
  if (process.env.DEBUG) console.log('DEBUG after resume:', await fresh.evaluate(() => ({ phase: JSON.parse(localStorage.getItem('family-feud-state-v1')).phase, active: [...document.querySelectorAll('.screen.active')].map((s) => s.id), toast: document.getElementById('toast').textContent, setupOpen: JSON.parse(localStorage.getItem('family-feud-state-v1')).setupOpen })));
  await fresh.waitForSelector('#board.active');
  assert.deepEqual(await fresh.$$eval('.team .tscore', (e) => e.map((x) => x.textContent)), scores);
  await fresh.waitForFunction(() => !document.querySelector('.team.t0 .tphoto').hidden);
  await tv.waitForFunction(() => !document.getElementById('tag').classList.contains('on'));
  step('Resume: an empty iPad with the game link gets "Resume game" and comes back with scores and photo');

  // Finish the game from the resumed iPad: the TV shows the end.
  await fresh.evaluate(() => { document.getElementById('btnNext').click(); });
  await fresh.waitForTimeout(300);
  await fresh.evaluate(() => { const q = JSON.parse(localStorage.getItem('family-feud-state-v1')); return q.phase; });
  await tv.waitForFunction(() => document.querySelector('#faceoff.active, #board.active, #end.active') !== null);
  step('the resumed iPad drives the TV');

  // ---------- secrecy and size ----------
  const bank = await fresh.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions);
  let views = 0;
  for (const f of [...tvFrames, ...ipadSent]) {
    let m; try { m = JSON.parse(f); } catch (e) { continue; }
    if (m.t === 'backup' && tvFrames.includes(f)) assert.fail('a TV received the backup');
    const v = m.view;
    if (!v || !v.qn) continue;
    views++;
    const q = bank[v.qn - 1];
    const shown = new Set((v.shown || []).map((s) => s[1]));
    for (const a of q.answers) {
      if (shown.has(a.text)) continue;
      const inOpen = (q.q + ' ' + v.teams.map((t) => t.name).join(' ') + ' ' + (v.msg || '')).toLowerCase().includes(a.text.toLowerCase());
      if (!inOpen && f.includes(JSON.stringify(a.text).slice(1, -1))) assert.fail(`unrevealed answer "${a.text}" was sent: ${f}`);
    }
  }
  assert.ok(views > 10);
  step(`no unrevealed answer in any of ${views} snapshots the iPads sent or the TVs received`);

  const by = {};
  for (const f of ipadSent) { let t = '?'; try { t = JSON.parse(f).t; } catch (e) {} (by[t] ||= []).push(f.length); }
  const line = (t) => by[t] ? `${t}: ${by[t].length} × avg ${Math.round(by[t].reduce((a, b) => a + b, 0) / by[t].length)} B (max ${Math.max(...by[t])} B)` : `${t}: none`;
  console.log('    bytes sent by the iPads → ' + ['view', 'photo', 'backup', 'host', 'ping'].map(line).join(' · '));
  step('bytes logged');

  // ---------- an old save from before the translations ----------
  // Family favorites saved on the iPad before it had Tagalog and Vietnamese: a reload fills them in
  // from the built-in set, keeps a line the GM typed, and leaves a home-made question alone.
  const oldCtx = await context('ipad');
  const old = await open(oldCtx, base + '/', 'old save');
  await old.click('#sets button[data-set="1"]');
  await old.waitForFunction(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions.length === 21);
  await old.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('family-feud-state-v1'));
    s.questions.forEach((q) => { delete q.tl; delete q.vi; });
    s.questions[0].tl = 'Sariling salin ng GM';
    s.questions.push({ q: 'Name a homemade question', answers: [{ text: 'Yes', points: 50 }], mult: 1 });
    localStorage.setItem('family-feud-state-v1', JSON.stringify(s));
  });
  await old.reload({ waitUntil: 'networkidle' });
  await old.waitForFunction(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions.filter((q) => q.vi).length === 21);
  const filled = await old.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions);
  assert.equal(filled[0].tl, 'Sariling salin ng GM', 'a translation the GM typed is kept');
  assert.ok(filled[0].vi);
  assert.equal(filled.slice(0, 21).filter((q) => q.tl && q.vi).length, 21);
  assert.equal(filled[21].tl, undefined); assert.equal(filled[21].vi, undefined);
  await oldCtx.close();
  step('an old save without translations gets them on reload, keeps a line the GM typed, and leaves a home-made question alone');

  // ---------- Two families, and the GM-only answer hints ----------
  // The board stays English; Tagalog/Vietnamese hints show under each answer on the GM console only,
  // and never reach the TV: not on its screen, not in any frame it receives.
  const tvHCtx = await context('tv');
  const tvH = await tvHCtx.newPage();          // listen before the page opens its socket
  const hintFrames = [];
  tvH.on('websocket', (ws) => ws.on('framereceived', (f) => hintFrames.push(String(f.payload))));
  tvH.on('pageerror', (e) => errors.push('tv (hints): ' + e.message));
  await tvH.goto(base + '/tv', { waitUntil: 'networkidle' });
  const codeH = await tvCode(tvH);
  const ipHCtx = await context('ipad');
  const ipH = await open(ipHCtx, base + '/', 'ipad (hints)');
  await ipH.click('#sets button[data-set="1"]');
  await ipH.waitForFunction(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions.length === 21);
  const favHints = await ipH.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions.flatMap((q) => q.answers.filter((a) => a.hint)).length);
  await ipH.click('#sets button[data-set="3"]');
  await ipH.waitForFunction(() => /15 questions \(from Two families\)/.test(document.getElementById('fileInfo').textContent));
  assert.equal(await ipH.textContent('#flags'), '');
  const twoBank = await ipH.evaluate(() => JSON.parse(localStorage.getItem('family-feud-state-v1')).questions);
  const twoHints = twoBank.flatMap((q) => q.answers.map((a) => a.hint).filter(Boolean));
  assert.ok(favHints > 100 && twoHints.length > 60, `hints loaded: ${favHints} and ${twoHints.length}`);
  assert.ok(twoBank.every((q) => q.tl && q.vi));
  await ipH.fill('#tvCode', codeH); await ipH.click('#btnTvJoin');
  await ipH.waitForFunction(() => document.getElementById('tvState').textContent.includes('On the TV'));
  await ipH.click('#btnStart');
  await ipH.click('#btnArm');
  await tvH.waitForSelector('#faceoff .zone.armed');
  await ipH.locator('.zone[data-side="0"]').dispatchEvent('pointerdown');
  await ipH.waitForSelector('#board.active');
  // On the console: each answer's hint is visible under it.
  const firstHint = await ipH.$eval('#grid .slot[data-i="0"] .hint', (h) => ({ text: h.textContent, shown: getComputedStyle(h).display !== 'none' }));
  assert.ok(firstHint.shown && firstHint.text.includes('áo khoác'), JSON.stringify(firstHint));
  await judge(ipH, 0);
  await tvH.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 1);
  await ipH.click('#bStatus [data-act="play"]');
  await judge(ipH, 1); await judge(ipH, 3); await judge(ipH, -1);
  await tvH.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 3);
  await shot(ipH, 'ipad-5-hints');
  // On the TV: no hint element, no hint text on screen, no hint in any frame.
  assert.equal(await tvH.$$eval('.hint', (h) => h.length), 0);
  const tvText = await tvH.evaluate(() => document.body.innerText);
  for (const h of twoHints) {
    assert.ok(!hintFrames.some((f) => f.includes(JSON.stringify(h).slice(1, -1))), `hint "${h}" reached the TV`);
    const tl = h.split('/')[0].trim();
    if (tl.length >= 4 && !twoBank.some((q) => q.tl.toLowerCase().includes(tl.toLowerCase()))) assert.ok(!tvText.toLowerCase().includes(tl.toLowerCase()), `hint word "${tl}" on the TV`);
  }
  assert.ok(hintFrames.filter((f) => f.includes('"view"')).length >= 5, `the TV's frames were captured (${hintFrames.length})`);
  assert.ok(!hintFrames.some((f) => f.includes('"hint"')), 'a hint field reached the TV');
  // Export keeps the column; re-import is covered by the parser reading the same header.
  await ipH.click('#btnBoardSetup'); await ipH.waitForSelector('#btnExport');
  await ipHCtx.close(); await tvHCtx.close();
  step(`Two families loads (15, with TL/VI); GM hints show on the console only (${favHints} in Family favorites, ${twoHints.length} in Two families), and none reached the TV's screen or its ${hintFrames.length} frames`);

  // ---------- the github.io build: no relay, no TV card ----------
  const plain = http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = p === '/' ? 'index.html' : p.slice(1);
    if (!/^[\w.-]+\.(html|js|csv|webmanifest)$/.test(file) || file === 'tv.html') { res.writeHead(404); return res.end('Not found'); }
    try { res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/plain' }); res.end(await readFile(path.join(ROOT, file))); }
    catch (e) { res.writeHead(404); res.end(); }
  });
  const plainPort = await listen(plain);
  const pCtx = await context('ipad');
  const pPage = await open(pCtx, `http://127.0.0.1:${plainPort}/`, 'github.io build');
  await pPage.waitForTimeout(800);
  assert.equal(await pPage.$eval('#tvCard', (e) => e.hidden), true);
  assert.equal(await pPage.$eval('#tvPill', (e) => e.hidden), true);
  assert.equal(await pPage.evaluate(() => document.body.classList.contains('console')), false);
  await pPage.click('#btnStart');
  await pPage.waitForSelector('#faceoff.active');
  await pCtx.close(); plain.close();
  step('the github.io build (no relay): no TV card, no pill, no console, the game starts as before');

  // The stand-in static server answers the relay probe (api/info) with 404, as any plain host would.
  const real = errors.filter((e) => !/^github\.io build console: Failed to load resource: .*404/.test(e));
  assert.deepEqual(real, []);
  step('no page errors');
  console.log(`\n${results.length} checks passed`);
} catch (e) {
  console.error('\nFAILED after: ' + (results[results.length - 1] || 'start'));
  console.error(e);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  setTimeout(() => process.exit(), 200);
}
