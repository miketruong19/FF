// A quick check of a running relay, e.g. the public one through the tunnel:
//
//   BASE=https://ff.eventurelog.ca node test/smoke.mjs
//
// A TV makes a room, an iPad joins it, plays a face-off, one reveal and one strike,
// and the TV must show each. Takes about 15 seconds.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const t0 = Date.now();
const say = (s) => console.log(`  ✓ ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
try {
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ipadCtx = await browser.newContext({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true });
  for (const c of [tvCtx, ipadCtx]) await c.addInitScript(() => { window.__ffFast = true; });
  const tv = await tvCtx.newPage(); tv.on('pageerror', (e) => errors.push('tv: ' + e.message));
  const ipad = await ipadCtx.newPage(); ipad.on('pageerror', (e) => errors.push('ipad: ' + e.message)); ipad.on('dialog', (d) => d.accept());
  let wsBytes = 0;
  ipad.on('websocket', (ws) => ws.on('framesent', (f) => { wsBytes += String(f.payload).length; }));

  await tv.goto(BASE + '/tv', { waitUntil: 'networkidle' });
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('wCode').textContent));
  const code = await tv.textContent('#wCode');
  say(`TV room ${code} at ${BASE}/tv`);

  await ipad.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ipad.waitForSelector('#tvCard:not([hidden])');
  await ipad.fill('#nameA', 'Smoke A'); await ipad.fill('#nameB', 'Smoke B');
  await ipad.fill('#tvCode', code); await ipad.click('#btnTvJoin');
  await ipad.waitForFunction(() => document.getElementById('tvState').textContent.includes('On the TV'));
  await tv.waitForFunction(() => document.getElementById('wReady').textContent.includes('iPad connected'));
  say('iPad joined as game master over ' + (BASE.startsWith('https') ? 'wss' : 'ws'));

  await ipad.click('#btnStart');
  await tv.waitForSelector('#faceoff.active');
  await ipad.click('#btnArm');
  await tv.waitForSelector('#faceoff .zone.armed');
  await ipad.locator('.zone[data-side="1"]').dispatchEvent('pointerdown');
  await tv.waitForSelector('#faceoff .zone.t1.winner');
  say('face-off armed and buzzed on the TV');

  await ipad.waitForSelector('#board.active');
  const judge = async (idx) => {
    await ipad.click('#bStatus [data-act="check"]'); await ipad.click('#curtain');
    if (idx >= 0) await ipad.click(`#gmList button[data-i="${idx}"]`); else await ipad.click('#gmMiss');
    await ipad.click('#gmOk'); await ipad.click('#curtain'); await ipad.waitForTimeout(300);
  };
  await judge(0);
  await tv.waitForFunction(() => document.querySelectorAll('#grid .slot.flipped').length === 1);
  await ipad.click('#bStatus [data-act="play"]');
  await judge(-1);
  await tv.waitForFunction(() => document.querySelectorAll('.sbox.on').length === 1);
  say('a reveal and a strike shown on the TV');
  assert.equal(await tv.textContent('#pot'), await ipad.textContent('#pot'));
  assert.deepEqual(errors, []);
  console.log(`  iPad sent ${wsBytes} bytes in all. Smoke test passed against ${BASE}.`);
} catch (e) {
  console.error('FAILED:', e.message, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
