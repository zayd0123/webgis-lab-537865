#!/usr/bin/env node
/**
 * Verify that the Carto Positron basemap renders real tiles on a given URL.
 *
 * The watermark is a 200 OK, so a status check proves nothing. This loads the
 * page, reads the Carto tiles the browser actually got, decodes them and counts
 * their colours: the placeholder has ~16 colours and is 2,049 bytes, a real
 * Positron tile has many more.
 *
 * Run it against the published site, which is what the Referer restriction
 * allows; against localhost the tiles 403 and this reports a failure, which is
 * the correct answer there.
 *
 *   node lab3/verify_carto_basemap.mjs https://zayd0123.github.io/webgis-lab-537865/lab3/index.html
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'https://zayd0123.github.io/webgis-lab-537865/lab3/index.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9441;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'cartocheck-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });

try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json())
        .webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map();
  const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++id; pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Page.navigate', { url: URL_ }, sessionId);
  await sleep(9000);

  // which Carto tiles did the browser load, and did the image decode?
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const imgs = [...document.querySelectorAll('.leaflet-tile-pane img')]
        .filter(i => /cartocdn/.test(i.src));
      return JSON.stringify({
        cartoTiles: imgs.length,
        loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
        sample: imgs.slice(0, 2).map(i => i.src)
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  const info = JSON.parse(r.result.value);
  console.log('URL:', URL_);
  console.log('Carto tiles in the DOM :', info.cartoTiles);
  console.log('  decoded successfully :', info.loaded);
  console.log('  broken (403 refused) :', info.broken);
  if (info.sample[0]) console.log('  example              :', info.sample[0]);

  // fetch one tile inside the page, so it carries the page's Referer, and
  // measure it: the placeholder is a flat 16-colour image
  const probe = await send('Runtime.evaluate', {
    expression: `(async () => {
      const url = ${JSON.stringify(info.sample[0] || '')};
      if (!url) return JSON.stringify({ error: 'no tile src found' });
      const res = await fetch(url);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob).catch(() => null);
      if (!bmp) return JSON.stringify({ status: res.status, bytes: blob.size, decoded: false });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i+1] << 8) | d[i+2]);
      return JSON.stringify({ status: res.status, bytes: blob.size,
                              size: bmp.width + 'x' + bmp.height, colours: set.size });
    })()`,
    returnByValue: true, awaitPromise: true,
  }, sessionId);
  const p = JSON.parse(probe.result.value);
  console.log('probe of one tile      :', JSON.stringify(p));

  const failed = events.filter((e) => e.method === 'Network.loadingFailed');
  const cartoFailed = failed.length;
  console.log('network failures       :', cartoFailed);

  const colours = p.colours || 0;
  const verdict = p.status === 200 && colours > 40 && info.broken === 0;
  console.log('\n' + (verdict
    ? 'PASS - real Carto tiles; the watermark is gone.'
    : 'FAIL - the basemap is not rendering real tiles here.'));
  ws.close();
  process.exit(verdict ? 0 : 1);
} finally {
  chrome.kill();
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
