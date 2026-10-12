#!/usr/bin/env node
/**
 * Headless check of the Lab 3 dashboard.
 *
 * Drives real Chrome over the DevTools Protocol - no dependencies, Node's own
 * fetch and WebSocket are enough - and asserts the things the handout's
 * checkpoints look at.
 *
 *   node lab3/check_dashboard.mjs [baseUrl]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'lab3-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
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

/** Minimal CDP client over one browser-level WebSocket. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.onConsole?.(msg.params);
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
    return sessionId;
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise
    }, this.session);
    if (r.exceptionDetails) {
      throw new Error('page threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async goto(url) {
    await this.send('Page.navigate', { url }, this.session);
    await sleep(400);
    // wait until the app has drawn
    for (let i = 0; i < 60; i++) {
      const done = await this.eval(
        `document.getElementById('count') && !/loading/.test(document.getElementById('count').textContent)`
      ).catch(() => false);
      if (done) return;
      await sleep(250);
    }
    throw new Error('page never finished loading');
  }
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const cdp = new CDP(ws);
await cdp.attach();

const consoleLog = [];
cdp.onConsole = (p) => {
  const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
  consoleLog.push(text);
};

try {
  // ================= Part 3-4: the map, basemaps, density layer ===========
  await cdp.goto(BASE);

  const mapState = await cdp.eval(`JSON.stringify({
    zoom: map.getZoom(),
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    center: map.getCenter(),
    bounds: map.getBounds().toBBoxString(),
    opacity: map.options.maxBoundsViscosity,
    canvasOpt: map.options.preferCanvas,
    panes: Object.keys(map.getPanes())
  })`);
  const m = JSON.parse(mapState);
  // The options say zoom 5, but the first draw() fits the view to the 160
  // districts, which lands on 5 or 6 depending on the window size. The point
  // of the check is that the view is constrained, not that it is exactly 5.
  check('map view fitted to the data, within the zoom limits',
    m.zoom >= 5 && m.zoom <= 6, 'zoom=' + m.zoom);
  const openingZoom = await cdp.eval(`map.options.zoom`);
  check('options object still asks for zoom 5', openingZoom === 5, 'options.zoom=' + openingZoom);
  check('minZoom 5 / maxZoom 14', m.minZoom === 5 && m.maxZoom === 14,
    `${m.minZoom}/${m.maxZoom}`);
  check('maxBoundsViscosity 1.0', m.opacity === 1.0);
  check('preferCanvas is false without ?canvas', m.canvasOpt === false);
  check('symbols pane created', m.panes.includes('symbols'), m.panes.join(','));

  const paneZ = await cdp.eval(`map.getPane('symbols').style.zIndex`);
  check('symbols pane z-index 450 (above overlayPane 400)', paneZ === '450', 'z=' + paneZ);

  const basemaps = await cdp.eval(`JSON.stringify(
    [...document.querySelectorAll('.leaflet-control-layers-base label')]
      .map(l => l.textContent.trim()))`);
  check('three basemaps in the control', JSON.parse(basemaps).length === 3, basemaps);

  const overlays = await cdp.eval(`JSON.stringify(
    [...document.querySelectorAll('.leaflet-control-layers-overlays label')]
      .map(l => l.textContent.trim()))`);
  const ov = JSON.parse(overlays);
  // The core lab asks for three; the four optional extensions add the quantile
  // shading and the clustered points, so five is the correct count for this
  // build. The names are asserted rather than only the number, so an overlay
  // going missing is still caught.
  const wanted = ['Population density', 'Population', 'NUST, 25 km',
                  'Density, quantile breaks', 'Districts, clustered'];
  check('all five overlays are in the control, core three included',
    wanted.every((w) => ov.includes(w)) && ov.length === wanted.length,
    ov.join(' | '));

  const attribution = await cdp.eval(`document.querySelector('.leaflet-control-attribution').textContent`);
  check('Carto/OSM attribution shown for the default basemap',
    /OpenStreetMap/.test(attribution) && /CARTO/.test(attribution), attribution.trim());

  // density styling
  const style = await cdp.eval(`JSON.stringify({
    lahore: (f => ({ fill: styleFor(f).fillColor, density: Math.round(densityOf(f.properties)) }))(
      getAllDistricts().features.find(x => x.properties.district === 'Lahore')),
    bagh: styleFor(getAllDistricts().features.find(x => x.properties.district === 'Bagh')).fillColor
  })`);
  const s = JSON.parse(style);
  check('Lahore shades into the top density class', s.lahore.fill === '#08306b',
    `${s.lahore.fill} at ${s.lahore.density}/km2`);
  check('a district with no census value is grey, not pale',
    s.bagh === '#c9cfd1', s.bagh);

  const classes = await cdp.eval(`(() => {
    const c = {};
    getAllDistricts().features.forEach(f => {
      const k = colourFor(densityOf(f.properties));
      c[k] = (c[k] || 0) + 1;
    });
    return JSON.stringify(c);
  })()`);
  // The handout predicts 20 / 18 / 34 / 41 / 22 across the five density
  // classes, plus the 25 districts with no census value.
  check('five density classes plus grey, in the proportions the handout gives',
    classes === '{"#c9cfd1":25,"#deebf7":20,"#9ecae1":18,"#4292c6":34,"#2171b5":41,"#08306b":22}',
    classes);

  // ============ Part 4: legend, group in the control ======================
  const legend = await cdp.eval(`document.querySelector('.legend').innerHTML.length`);
  check('legend rendered', legend > 100, legend + ' chars of html');
  check('legend has the population reference circles',
    await cdp.eval(`document.querySelectorAll('.legend svg circle').length`) === 3);

  // ============ Part 5: info panel + highlight ===========================
  const panel0 = await cdp.eval(`document.querySelector('.info').textContent`);
  check('info panel rests with the hover prompt', /Hover over a district/.test(panel0),
    JSON.stringify(panel0.slice(0, 60)));
  check('info panel shows the zoom level', /Zoom level 5/.test(panel0));

  // hover a district through its real DOM path
  const hover = await cdp.eval(`(() => {
    const feats = getAllDistricts().features;
    const f = feats.find(x => x.properties.district === 'Lahore');
    const layer = districts.getLayers().find(l => l.feature === f);
    layer.fire('mouseover', { target: layer }, true);
    const out = {
      panel: document.querySelector('.info').textContent,
      weight: layer.options.weight,
      color: layer.options.color,
      fillOpacity: layer.options.fillOpacity
    };
    layer.fire('mouseout', { target: layer }, true);
    out.after = {
      weight: districts.getLayers().find(l => l.feature === f).options.weight,
      color: districts.getLayers().find(l => l.feature === f).options.color
    };
    out.panelAfter = document.querySelector('.info').textContent;
    return JSON.stringify(out);
  })()`);
  const h = JSON.parse(hover);
  check('hover updates the info panel with name, population, density',
    /Lahore/.test(h.panel) && /13,004,135/.test(h.panel) && /per km/.test(h.panel),
    h.panel.replace(/\s+/g, ' ').slice(0, 110));
  check('hover thickens the outline to weight 3', h.weight === 3, 'weight=' + h.weight);
  check('resetStyle restores the original weight', h.after.weight === 1,
    'weight back to ' + h.after.weight);
  check('mouseout returns the panel to its resting text',
    /Hover over a district/.test(h.panelAfter));

  // ============ Part 6: proportional circles =============================
  const circles = await cdp.eval(`(() => {
    const pts = getAllPoints().features;
    const withPop = pts.filter(f => f.properties.pop_2023 !== null && f.properties.pop_2023 !== undefined);
    const drawn = circleGroup.getLayers()[0].getLayers();
    const lahore = drawn.find(l => l.feature.properties.district === 'Lahore');
    return JSON.stringify({
      pointFeatures: pts.length,
      withPop: withPop.length,
      drawn: drawn.length,
      inSymbolsPane: !!(lahore && lahore.options.pane === 'symbols'),
      lahoreRadius: lahore && lahore.options.radius,
      radiusAreaCheck: (() => {
        const a = drawn.find(l => l.feature.properties.pop_2023 > 10000000);
        const b = drawn.find(l => {
          const p = l.feature.properties.pop_2023;
          return p > 2000000 && p < 4000000;
        });
        if (!a || !b) return null;
        const ratioArea = (a.options.radius ** 2) / (b.options.radius ** 2);
        const ratioPop = a.feature.properties.pop_2023 / b.feature.properties.pop_2023;
        return { ratioArea: +ratioArea.toFixed(2), ratioPop: +ratioPop.toFixed(2) };
      })()
    });
  })()`);
  const c = JSON.parse(circles);
  check('160 points loaded, 135 of them with a population', c.pointFeatures === 160 && c.withPop === 135,
    `${c.pointFeatures} points / ${c.withPop} with pop`);
  check('135 circles drawn (nulls filtered out)', c.drawn === 135, c.drawn + ' circles');
  check('circles carry pane: symbols', c.inSymbolsPane === true);
  check('Lahore radius ~22 px', Math.abs(c.lahoreRadius - 22) < 1,
    c.lahoreRadius?.toFixed(2) + ' px');
  check('circle AREA follows population, not radius',
    c.radiusAreaCheck && Math.abs(c.radiusAreaCheck.ratioArea / c.radiusAreaCheck.ratioPop - 1) < 0.05,
    JSON.stringify(c.radiusAreaCheck));

  // draw order: circles must not be inside overlayPane
  const order = await cdp.eval(`(() => {
    const symbols = map.getPane('symbols');
    const overlay = map.getPane('overlayPane');
    return JSON.stringify({
      symbolsChildren: symbols ? symbols.querySelectorAll('path,.leaflet-interactive').length : 0,
      overlayChildren: overlay.querySelectorAll('path,.leaflet-interactive').length,
      symbolsZ: +getComputedStyle(symbols).zIndex,
      overlayZ: +getComputedStyle(overlay).zIndex
    });
  })()`);
  const o = JSON.parse(order);
  check('symbols pane stacks above the polygon pane', o.symbolsZ > o.overlayZ,
    `symbols ${o.symbolsZ} > overlay ${o.overlayZ}`);

  // ============ Part 7: coordinate handler on and off ====================
  await cdp.eval(`document.getElementById('coords').checked = true;
    document.getElementById('coords').dispatchEvent(new Event('change'))`);
  const afterOn = await cdp.eval(`(() => {
    map.fire('click', { latlng: L.latLng(23.5, 66.0) });
    const popups = document.querySelectorAll('.leaflet-popup');
    return JSON.stringify({
      count: popups.length,
      text: popups.length ? popups[0].textContent.replace(/\\s+/g,' ').trim() : ''
    });
  })()`);
  const on = JSON.parse(afterOn);
  check('ticking the box registers the click handler',
    on.count === 1 && /23\.5000/.test(on.text), on.text);

  await cdp.eval(`document.getElementById('coords').checked = false;
    document.getElementById('coords').dispatchEvent(new Event('change'))`);
  const afterOff = await cdp.eval(`(() => {
    document.querySelectorAll('.leaflet-popup').forEach(p => p.remove());
    map.fire('click', { latlng: L.latLng(24.0, 67.0) });
    return document.querySelectorAll('.leaflet-popup').length;
  })()`);
  check('unticking it removes the handler (map.off finds the named function)',
    afterOff === 0, afterOff + ' popups after unticking');

  // ============ Part 8: the province filter ==============================
  const provinces = await cdp.eval(`JSON.stringify(
    [...document.querySelectorAll('#province option')].map(o => o.value))`);
  const pv = JSON.parse(provinces);
  check('province list built from the data: 7 provinces + "all"',
    pv.length === 8 && pv[0] === 'all', pv.join(', '));

  await cdp.eval(`(() => { const s = document.getElementById('province');
    s.value = 'Gilgit Baltistan'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  const gb = await cdp.eval(`JSON.stringify({
    count: document.getElementById('count').textContent,
    districts: districtGroup.getLayers()[0].getLayers().length,
    circles: circleGroup.getLayers()[0].getLayers().length,
    tellUser: /no census data/.test(document.getElementById('count').textContent)
  })`);
  const g = JSON.parse(gb);
  check('Gilgit Baltistan filters to 14 districts', g.districts === 14, g.count);
  check('Gilgit Baltistan draws no circles (no census there)', g.circles === 0);
  check('the page says why the circles are missing', g.tellUser, JSON.stringify(g.count));

  await cdp.eval(`(() => { const s = document.getElementById('province');
    s.value = 'Punjab'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  const pj = await cdp.eval(`JSON.stringify({
    districts: districtGroup.getLayers()[0].getLayers().length,
    circles: circleGroup.getLayers()[0].getLayers().length
  })`);
  check('Punjab redraws cleanly (no stale layers)', JSON.parse(pj).districts === 36,
    JSON.parse(pj).districts + ' districts');

  const extToggle = await cdp.eval(`(() => {
    const boxes = [...document.querySelectorAll('.leaflet-control-layers-overlays input')];
    const labels = [...document.querySelectorAll('.leaflet-control-layers-overlays label')]
      .map(l => l.textContent.trim());
    const idx = (name) => labels.findIndex(l => l.includes(name));
    const out = {};
    for (const name of ['Density, quantile breaks', 'Districts, clustered']) {
      const i = idx(name);
      if (i < 0) { out[name] = 'missing'; continue; }
      boxes[i].click();
      const on = name.includes('cluster') ? map.hasLayer(clusterGroup) : map.hasLayer(quantileGroup);
      boxes[i].click();
      const off = name.includes('cluster') ? map.hasLayer(clusterGroup) : map.hasLayer(quantileGroup);
      out[name] = { on, off };
    }
    return JSON.stringify(out);
  })()`);
  check('the two extension overlays switch on and off',
    JSON.parse(extToggle)['Density, quantile breaks'].on === true &&
    JSON.parse(extToggle)['Density, quantile breaks'].off === false &&
    JSON.parse(extToggle)['Districts, clustered'].on === true &&
    JSON.parse(extToggle)['Districts, clustered'].off === false,
    extToggle);

  const toggleOverlay = await cdp.eval(`(() => {
    const cb = [...document.querySelectorAll('.leaflet-control-layers-overlays input')][0];
    const before = map.hasLayer(districtGroup);
    cb.click();
    const off = map.hasLayer(districtGroup);
    cb.click();
    return JSON.stringify({ before, off, back: map.hasLayer(districtGroup) });
  })()`);
  check('overlay switches the REBUILT layer on and off',
    JSON.parse(toggleOverlay).before && !JSON.parse(toggleOverlay).off &&
    JSON.parse(toggleOverlay).back, toggleOverlay);

  await cdp.eval(`(() => { const s = document.getElementById('province');
    s.value = 'all'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);

  // ============ Part 9: SVG vs canvas ====================================
  const svgCount = await cdp.eval(
    `map.getPane('overlayPane').querySelectorAll('path').length`);
  check('SVG mode: one <path> per polygon in overlayPane', svgCount === 160,
    svgCount + ' paths');

  const svgLog = consoleLog.filter((l) => /^draw\(all\)/.test(l)).pop();
  check('draw() logs its timing in SVG mode', !!svgLog, svgLog);

  await cdp.goto(BASE + '?canvas');
  const canvasMode = await cdp.eval(`JSON.stringify({
    preferCanvas: map.options.preferCanvas,
    paths: map.getPane('overlayPane').querySelectorAll('path').length,
    canvases: map.getPane('overlayPane').querySelectorAll('canvas').length,
    count: document.getElementById('count').textContent
  })`);
  const cv = JSON.parse(canvasMode);
  check('?canvas turns preferCanvas on', cv.preferCanvas === true);
  check('canvas mode: no <path> elements at all', cv.paths === 0, cv.paths + ' paths');
  check('canvas mode: one <canvas> per vector pane', cv.canvases >= 1, cv.canvases + ' canvases');
  check('canvas mode still draws all 160 districts', cv.count === '160 districts', cv.count);

  const canvasHover = await cdp.eval(`(() => {
    const f = getAllDistricts().features.find(x => x.properties.district === 'Lahore');
    const layer = districts.getLayers().find(l => l.feature === f);
    layer.fire('mouseover', { target: layer }, true);
    const panel = document.querySelector('.info').textContent;
    layer.fire('mouseout', { target: layer }, true);
    return panel;
  })()`);
  check('hover highlight still works on canvas', /Lahore/.test(canvasHover),
    canvasHover.replace(/\s+/g, ' ').slice(0, 80));

  const canvasLog = consoleLog.filter((l) => /^draw\(all\)/.test(l)).pop();
  check('draw() logs its timing in canvas mode', /canvas$/.test(canvasLog || ''), canvasLog);
} catch (err) {
  check('run completed without throwing', false, err.message);
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(70));
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log('  - ' + f.name + (f.detail ? '  [' + f.detail + ']' : ''));
  process.exit(1);
}
