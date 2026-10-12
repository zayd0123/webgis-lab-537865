#!/usr/bin/env node
/**
 * Lab 3 - figures for the four optional extensions.
 *
 *   node lab3/capture_extensions.mjs [baseUrl] [outDir]
 *
 * Writes:
 *   checkpoint11a_clusters.png         the 160 points collapsed into clusters
 *   checkpoint11b_density_labels.png   the density labels at zoom 9
 *   checkpoint11c_quantile_legend.png  quantile shading and its legend
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html';
const OUT = resolve(process.argv[3] || 'lab3/Report');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'lab3-ext-shots-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
  '--window-size=1400,900', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async attach() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget',
      { targetId, flatten: true });
    this.session = sessionId;
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise }, this.session);
    if (r.exceptionDetails) {
      throw new Error('threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  /** Leaflet methods return the map, whose graph is circular: run for effect. */
  async run(expr) {
    return this.eval(`(() => { ${expr} })()`);
  }
  async load(url) {
    await this.send('Page.navigate', { url }, this.session);
    for (let i = 0; i < 80; i++) {
      const ready = await this.eval(
        `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`
      ).catch(() => false);
      if (ready) { await sleep(1200); return; }
      await sleep(250);
    }
    throw new Error('page never finished loading');
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot',
      { format: 'png' }, this.session);
    const p = join(OUT, name);
    writeFileSync(p, Buffer.from(data, 'base64'));
    console.log('wrote', p);
  }
}

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
  const cdp = new CDP(ws);
  await cdp.attach();

  // a clean slate: no remembered view, so each figure starts from the data
  await cdp.load(BASE);
  await cdp.eval(`window.localStorage.removeItem('lab3.view')`);

  // The Carto key is restricted to the published site, so on localhost the
  // basemap is refused; OpenStreetMap renders and keeps the figures readable.
  const baseline = `
    if (map.hasLayer(positron)) map.removeLayer(positron);
    if (!map.hasLayer(osm)) osm.addTo(map);`;

  // ---------- 1. clustered points --------------------------------------
  console.log('\n--- clusters ---');
  await cdp.load(BASE);
  await cdp.run(baseline + `
    if (map.hasLayer(districtGroup)) map.removeLayer(districtGroup);
    clusterGroup.addTo(map);
    map.setView([30.3753, 69.3451], 6, { animate: false });`);
  await sleep(3500);
  console.log('clusters on screen:', await cdp.eval(
    `map.getPane('markerPane').querySelectorAll('.marker-cluster').length`));
  await cdp.shot('checkpoint11a_clusters.png');

  // ---------- 2. density labels at zoom 9 -------------------------------
  console.log('\n--- density labels ---');
  await cdp.load(BASE);
  await cdp.run(baseline + `
    clusterGroup.remove();
    map.setView([31.6, 74.3], 9, { animate: false });`);
  await sleep(4000);
  console.log('labels on screen:', await cdp.eval(
    `document.querySelectorAll('.density-label').length`));
  await cdp.shot('checkpoint11b_density_labels.png');

  // ---------- 4. quantile shading and legend ----------------------------
  console.log('\n--- quantiles ---');
  await cdp.load(BASE);
  await cdp.run(baseline);
  await cdp.eval(`(() => {
    const sel = document.getElementById('scheme');
    sel.value = 'quantile';
    sel.dispatchEvent(new Event('change'));
  })()`);
  await sleep(3500);
  console.log('breaks in force:', await cdp.eval(`window.getBreaks().join(' / ')`));
  await cdp.shot('checkpoint11c_quantile_legend.png');

  await cdp.eval(`window.localStorage.removeItem('lab3.view')`);
} finally {
  chrome.kill();
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
