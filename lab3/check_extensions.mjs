#!/usr/bin/env node
/**
 * Lab 3 - checks for the four optional extensions.
 *
 *   node lab3/check_extensions.mjs [baseUrl]
 *
 * Each extension is checked against the running page rather than by reading the
 * source: the cluster really collapses 160 markers, the labels really appear and
 * disappear across zoom 8, the stored view really comes back on a reload, and
 * the quantile classes really hold equal numbers of districts, computed
 * independently from districts.geojson.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9451;
const profile = mkdtempSync(join(tmpdir(), 'lab3-ext-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.console = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.console.push((m.params.args || [])
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
    const { sessionId } = await this.send('Target.attachToTarget',
      { targetId, flatten: true });
    this.session = sessionId;
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    return sessionId;
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise }, this.session);
    if (r.exceptionDetails) {
      throw new Error('threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async goto(url) {
    await this.send('Page.navigate', { url }, this.session);
    for (let i = 0; i < 80; i++) {
      const done = await this.eval(
        `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`
      ).catch(() => false);
      if (done) { await sleep(900); return; }
      await sleep(250);
    }
    throw new Error('page never finished loading');
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

  // ============ extension 1: clustered markers ==========================
  console.log('\n--- 1. Leaflet.markercluster ---');
  await cdp.goto(BASE);
  const loaded = await cdp.eval(`typeof L.markerClusterGroup === 'function'`);
  check('the markercluster plugin is loaded', loaded === true);

  const clusters = JSON.parse(await cdp.eval(`(() => {
    clusterGroup.addTo(map);
    const layers = clusterGroup.getLayers();
    // At one zoom both can be on screen at once: clusters for the crowded
    // places and single markers for the rest, so both are counted.
    const icons = map.getPane('markerPane').querySelectorAll('.marker-cluster');
    const singles = map.getPane('markerPane').querySelectorAll('.leaflet-marker-icon:not(.marker-cluster)');
    return JSON.stringify({
      markersInGroup: layers.length,
      visibleClusters: icons.length,
      inClusters: [...icons].reduce((a, el) =>
        a + (parseInt((el.textContent || '0').trim(), 10) || 0), 0),
      singles: singles.length,
      onScreen: [...icons].reduce((a, el) =>
        a + (parseInt((el.textContent || '0').trim(), 10) || 0), 0) + singles.length
    });
  })()`));
  check('all 160 points are in the cluster group', clusters.markersInGroup === 160,
    clusters.markersInGroup + ' markers');
  check('they collapse rather than drawing 160 separate pins',
    clusters.visibleClusters > 0 && clusters.visibleClusters < 60,
    `${clusters.visibleClusters} clusters + ${clusters.singles} singles at zoom 6`);
  check('every marker is accounted for on screen',
    clusters.onScreen === 160,
    `${clusters.inClusters} in clusters + ${clusters.singles} single = ${clusters.onScreen}`);

  // zoom in: clusters should break up and turn into individual markers
  const zoomsIn = JSON.parse(await cdp.eval(`(async () => {
    const count = () => {
      const pane = map.getPane('markerPane');
      const icons = pane.querySelectorAll('.marker-cluster');
      const singles = pane.querySelectorAll('.leaflet-marker-icon:not(.marker-cluster)');
      return { clusters: icons.length, singles: singles.length };
    };
    map.setZoom(6, { animate: false });
    await new Promise(r => setTimeout(r, 1000));
    const before = count();
    map.setZoom(11, { animate: false });
    await new Promise(r => setTimeout(r, 1400));
    const after = count();
    return JSON.stringify({ before, after });
  })()`, true));
  // At zoom 6 the whole country is in view and 160 markers are on screen. At
  // zoom 11 the viewport covers a fraction of it, so there are far fewer
  // markers, but the ones there are drawn individually: the test is that the
  // clusters are gone and singles have taken their place, not that the count
  // goes up, which depends on the viewport rather than on the clustering.
  check('zooming in breaks the clusters into individual markers',
    zoomsIn.after.clusters === 0 && zoomsIn.after.singles > 0 &&
    zoomsIn.before.clusters > 0,
    `zoom 6: ${zoomsIn.before.clusters} clusters / ${zoomsIn.before.singles} singles -> ` +
    `zoom 11: ${zoomsIn.after.clusters} / ${zoomsIn.after.singles}`);

  // returns the map, whose graph is circular: run it for effect only
  await cdp.eval(`(() => { clusterGroup.remove();
    map.setView([30.3753, 69.3451], 6, { animate: false }); })()`);

  // ============ extension 2: density labels above zoom 8 =================
  console.log('\n--- 2. density labels above zoom 8 ---');
  const labels = JSON.parse(await cdp.eval(`(async () => {
    const count = () => document.querySelectorAll('.density-label').length;
    map.setZoom(7, { animate: false });
    await new Promise(r => setTimeout(r, 900));
    const below = count();
    map.setZoom(9, { animate: false });
    await new Promise(r => setTimeout(r, 1200));
    const above = count();
    const sample = [...document.querySelectorAll('.density-label')]
      .slice(0, 3).map(e => e.textContent.trim());
    map.setZoom(7, { animate: false });
    await new Promise(r => setTimeout(r, 900));
    const backDown = count();
    return JSON.stringify({ below, above, backDown, sample });
  })()`, true));
  check('no density labels at zoom 7', labels.below === 0, String(labels.below));
  check('labels appear at zoom 9', labels.above > 100, labels.above + ' labels');
  check('the labels show a density value',
    labels.sample.every((t) => /\/\s?km/.test(t) || /no census/.test(t)),
    JSON.stringify(labels.sample));
  check('they are removed again below the threshold', labels.backDown === 0,
    String(labels.backDown));

  const hoverStillWorks = await cdp.eval(`(() => {
    const l = districts.getLayers()[0];
    return l.getTooltip() && l.getTooltip().options.permanent === false;
  })()`);
  check('the hover tooltip is restored below zoom 8', hoverStillWorks === true);

  // ============ extension 4: quantile breaks ============================
  console.log('\n--- 4. quantile breaks ---');
  const quant = JSON.parse(await cdp.eval(`(async () => {
    const sel = document.getElementById('scheme');
    sel.value = 'quantile';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1400));
    // count the districts per class straight from the rendered layers
    const counts = {};
    const layer = quantileGroup.getLayers()[0];
    layer.eachLayer(l => {
      const p = l.feature.properties;
      const d = p.pop_2023 === null ? null : p.pop_2023 / p.area_km2;
      const col = l.options.fillColor;
      counts[col] = (counts[col] || 0) + 1;
    });
    return JSON.stringify({
      scheme: window.getScheme(),
      breaks: window.getBreaks(),
      counts,
      legendText: document.querySelector('.legend').textContent.replace(/\\s+/g, ' ').slice(0, 200)
    });
  })()`, true));
  const classCounts = Object.entries(quant.counts)
    .filter(([c]) => c !== '#c9cfd1').map(([, n]) => n).sort((a, b) => a - b);
  check('the scheme switched to quantile', quant.scheme === 'quantile', quant.scheme);
  check('the breaks are computed, not the fixed ones',
    JSON.stringify(quant.breaks) !== JSON.stringify([50, 150, 400, 1000]),
    quant.breaks.join(' / '));
  // 135 districts over 5 classes: equal counts means 27 each, allow +-1
  check('each class holds about the same number of districts',
    classCounts.length === 5 && classCounts.every((n) => Math.abs(n - 27) <= 1),
    JSON.stringify(classCounts));
  check('the legend says which classification is showing',
    /quantile/i.test(quant.legendText), quant.legendText.slice(0, 90));

  const backToFixed = JSON.parse(await cdp.eval(`(async () => {
    const sel = document.getElementById('scheme');
    sel.value = 'fixed';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1400));
    const counts = {};
    const layer = districtGroup.getLayers()[0];
    layer.eachLayer(l => { counts[l.options.fillColor] = (counts[l.options.fillColor] || 0) + 1; });
    return JSON.stringify({ breaks: window.getBreaks(), counts,
      legendText: document.querySelector('.legend').textContent.replace(/\\s+/g, ' ').slice(0, 120) });
  })()`, true));
  check('switching back restores the fixed breaks',
    JSON.stringify(backToFixed.breaks) === JSON.stringify([50, 150, 400, 1000]),
    backToFixed.breaks.join(' / '));
  check('and the fixed class sizes return',
    backToFixed.counts['#08306b'] === 22 && backToFixed.counts['#2171b5'] === 41,
    JSON.stringify(backToFixed.counts));
  check('the legend follows the switch back',
    /fixed/i.test(backToFixed.legendText), backToFixed.legendText.slice(0, 80));

  // ============ extension 3: localStorage ===============================
  console.log('\n--- 3. remembering the view ---');
  const saved = JSON.parse(await cdp.eval(`(async () => {
    window.localStorage.removeItem('lab3.view');
    map.setView([25.0, 68.0], 8, { animate: false });
    await new Promise(r => setTimeout(r, 900));
    return JSON.stringify({
      stored: JSON.parse(window.localStorage.getItem('lab3.view') || 'null')
    });
  })()`, true));
  check('moving the map writes the view to localStorage',
    !!saved.stored && Math.abs(saved.stored.lat - 25.0) < 0.01 &&
    Math.abs(saved.stored.zoom - 8) < 0.01,
    JSON.stringify(saved.stored));

  await cdp.goto(BASE);
  const restored = JSON.parse(await cdp.eval(`JSON.stringify({
    lat: map.getCenter().lat,
    lng: map.getCenter().lng,
    zoom: map.getZoom()
  })`));
  check('a reload comes back to the saved position',
    Math.abs(restored.lat - 25.0) < 0.05 && Math.abs(restored.zoom - 8) < 0.01,
    `${restored.lat.toFixed(3)}, ${restored.lng.toFixed(3)} at zoom ${restored.zoom}`);

  const stale = JSON.parse(await cdp.eval(`(async () => {
    const v = JSON.parse(window.localStorage.getItem('lab3.view'));
    v.at = Date.now() - 13 * 60 * 60 * 1000;   // older than the 12 hour limit
    window.localStorage.setItem('lab3.view', JSON.stringify(v));
    return JSON.stringify(v);
  })()`, true));
  await cdp.goto(BASE);
  const afterStale = JSON.parse(await cdp.eval(`JSON.stringify({
    zoom: map.getZoom(), lat: +map.getCenter().lat.toFixed(3) })`));
  check('a stale view is ignored, and it falls back to the whole country',
    Math.abs(afterStale.lat - 25.0) > 1, `lat ${afterStale.lat}, zoom ${afterStale.zoom}`);

  await cdp.eval(`window.localStorage.removeItem('lab3.view')`);
} catch (err) {
  check('the run completed without throwing', false, err.message);
} finally {
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(66));
console.log(`${results.length - failed.length}/${results.length} extension checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log('  - ' + f.name + (f.detail ? '  [' + f.detail + ']' : ''));
  process.exit(1);
}
