#!/usr/bin/env node
/**
 * Lab 3, Part 9 - measure what SVG and canvas cost.
 *
 * Loads the dashboard five times in each renderer, reads the draw(all) time
 * that app.js prints, and reports the median. It also counts what is left in
 * the DOM for each renderer.
 *
 *   node lab3/measure_renderers.mjs [baseUrl]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html').replace(/\?canvas$/, '');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const RUNS = 5;

const profile = mkdtempSync(join(tmpdir(), 'lab3-measure-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1400,1000',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(200); }
  }
  throw new Error('Chrome did not start');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.console = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.console.push((msg.params.args || [])
          .map((a) => a.value ?? a.description ?? '').join(' '));
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
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate',
      { expression, returnByValue: true }, this.session);
    return r.result.value;
  }
  async load(url) {
    this.console.length = 0;
    await this.send('Page.navigate', { url }, this.session);
    for (let i = 0; i < 80; i++) {
      const done = await this.eval(
        `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`
      ).catch(() => false);
      if (done) { await sleep(150); return; }
      await sleep(200);
    }
    throw new Error('page never finished loading');
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const ws = new WebSocket(await devtoolsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const cdp = new CDP(ws);
await cdp.attach();

const out = {};

async function measure(label, url) {
  const times = [];
  let dom = null;
  for (let i = 0; i < RUNS; i++) {
    await cdp.load(url);
    const line = cdp.console.filter((l) => /^draw\(all\)/.test(l)).pop();
    if (!line) throw new Error('no timing line for ' + label);
    times.push(parseFloat(line.match(/in ([\d.]+) ms/)[1]));
    if (i === 0) {
      dom = JSON.parse(await cdp.eval(`JSON.stringify({
        paths: map.getPane('overlayPane').querySelectorAll('path').length,
        symbolPaths: map.getPane('symbols').querySelectorAll('path').length,
        canvases: map.getPane('overlayPane').querySelectorAll('canvas').length,
        symbolCanvas: map.getPane('symbols').querySelectorAll('canvas').length,
        overlayHTMLStart: map.getPane('overlayPane').innerHTML.slice(0, 60),
        inspectableDistrict: !!map.getPane('overlayPane').querySelector('path.leaflet-interactive')
      })`));
    }
  }
  out[label] = { times, median: +median(times).toFixed(1), dom };
  console.log(`${label}: ${times.map((t) => t.toFixed(1)).join(', ')}  -> median ${out[label].median} ms`);
}

try {
  await measure('SVG', BASE);
  await measure('Canvas', BASE + '?canvas');
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

console.log('\n--- table for the report -------------------------------');
console.log('draw(all), median of five (ms)');
console.log('  SVG    ', out.SVG.median);
console.log('  Canvas ', out.Canvas.median);
console.log('Elements inside leaflet-overlay-pane');
console.log('  SVG    ', out.SVG.dom.paths, 'path elements,',
  out.SVG.dom.symbolPaths, 'in the symbols pane');
console.log('  Canvas ', out.Canvas.dom.canvases, 'canvas element(s),',
  out.Canvas.dom.symbolCanvas, 'in the symbols pane');
console.log('One district inspectable in Elements?');
console.log('  SVG    ', out.SVG.dom.inspectableDistrict ? 'yes - path.leaflet-interactive per district' : 'no');
console.log('  Canvas ', out.Canvas.dom.inspectableDistrict ? 'yes' : 'no - pixels only, no per-feature element');
console.log('overlayPane html (SVG)   :', out.SVG.dom.overlayHTMLStart.replace(/\s+/g, ' '));
console.log('overlayPane html (Canvas):', out.Canvas.dom.overlayHTMLStart.replace(/\s+/g, ' '));

process.exit(0);
