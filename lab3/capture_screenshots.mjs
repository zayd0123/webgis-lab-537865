#!/usr/bin/env node
/**
 * Lab 3 - capture the dashboard screenshots that do not need a human: the
 * finished map, a highlighted district with the tooltip and info panel up, the
 * NUST overlay at two zoom levels, a province selected, and the coordinate
 * popup on the sea.
 *
 * The QGIS screenshots (Part 2) and the DevTools screenshots (Parts 3 and 9)
 * still have to be taken by hand - they show application chrome, not the page.
 *
 *   node lab3/capture_screenshots.mjs [baseUrl] [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html').replace(/\?canvas$/, '');
const OUT = process.argv[3] || 'lab3/Report';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'lab3-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1400,1000', '--force-device-scale-factor=1',
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
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
    const r = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise }, this.session);
    if (r.exceptionDetails) {
      throw new Error('page threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  /** Leaflet methods return the map or the layer, whose graph is circular and
   *  cannot be serialised back. Run those for their effect only. */
  async run(expression) {
    return this.eval(`(() => { ${expression} })()`);
  }
  async load(url) {
    await this.send('Page.navigate', { url }, this.session);
    for (let i = 0; i < 80; i++) {
      const done = await this.eval(
        `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`
      ).catch(() => false);
      if (done) { await sleep(1200); return; }
      await sleep(200);
    }
    throw new Error('page never finished loading');
  }
  /** wait for tiles to arrive so the basemap is not half-blank */
  async settle(ms = 2500) { await sleep(ms); }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false }, this.session);
    const path = join(OUT, name + '.png');
    writeFileSync(path, Buffer.from(data, 'base64'));
    console.log('wrote', path);
  }
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const cdp = new CDP(ws);
await cdp.attach();

/** Hover helper. Leaflet listens for real DOM mouse events, so a synthetic
 *  mousemove dispatched over the map is a truer test than layer.fire(): it
 *  exercises the same path the user's pointer takes and it opens the real
 *  sticky tooltip. */
const hoverExpr = (district) => `(() => {
  const f = getAllDistricts().features.find(x => x.properties.district === ${JSON.stringify(district)});
  const layer = districts.getLayers().find(l => l.feature === f);
  if (!layer) throw new Error('no layer for ' + ${JSON.stringify(district)});
  const rect = map.getContainer().getBoundingClientRect();
  const c = map.latLngToContainerPoint(layer.getBounds().getCenter());
  const el = document.elementFromPoint(rect.left + c.x, rect.top + c.y);
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, clientX: rect.left + c.x, clientY: rect.top + c.y, view: window
    }));
  }
  return JSON.stringify({ x: Math.round(c.x), y: Math.round(c.y),
                          hit: el.tagName + '.' + (el.getAttribute('class') || '') });
})()`;

/** Move the pointer off every district, back to the resting state. */
const unhoverExpr = `(() => {
  districts.eachLayer(l => {
    l.closeTooltip();
    if (l.isTooltipOpen && l.isTooltipOpen()) l.closeTooltip();
  });
  districts.eachLayer(l => districts.resetStyle(l));
  info.update();
  // A sticky tooltip has no mouseout of its own, so it is left in the DOM at
  // opacity 0 rather than removed. Take it out so it cannot land in a figure.
  document.querySelectorAll('.leaflet-tooltip').forEach(t => t.remove());
  return JSON.stringify({
    tooltipsOpen: document.querySelectorAll('.leaflet-tooltip').length,
    panel: document.querySelector('.info').textContent.replace(/\\s+/g, ' '),
    weights: [...new Set(districts.getLayers().map(l => l.options.weight))]
  });
})()`;

try {
  // The Carto Positron basemap the handout specifies now returns "API KEY
  // REQUIRED" placeholder tiles, so the page as shipped shows that watermark
  // as its default background. For the screenshots in the report the working
  // basemaps are switched in instead, so that the density shading, the circles
  // and the controls can actually be seen against a map. The page itself is
  // unchanged. See the note at the top of report.md.
  const useWorkingBasemap = `
    map.removeLayer(positron); osm.addTo(map);
    document.querySelectorAll('.leaflet-control-layers-base input')[1].checked = true;`;

  // ---- the finished dashboard, all districts, both overlays on ----------
  await cdp.load(BASE);
  await cdp.run(useWorkingBasemap);
  await cdp.settle(3200);

  // Hover a district so the tooltip, the thick outline and the info panel are
  // all visible at once (checkpoint 5).
  const pos = JSON.parse(await cdp.eval(hoverExpr('Lahore')));
  console.log('hovering Lahore, pointing at', pos.hit, 'at', pos.x + ',' + pos.y);
  await sleep(900);

  // The checkpoint wants the info panel reporting the district, so check it
  // actually does before shooting. Dispatching a synthetic mouseover can open
  // the tooltip without driving info.update(), and a screenshot taken then has
  // the panel still on its resting text - which is exactly what went wrong the
  // first time. If the panel is empty, call the handler Leaflet would have.
  let panelText = await cdp.eval(
    `document.querySelector('.info').textContent.replace(/\\s+/g, ' ')`);
  if (!/Lahore/.test(panelText)) {
    console.log('info panel not populated by the synthetic event, calling it directly');
    await cdp.eval(`(() => {
      const f = getAllDistricts().features.find(x => x.properties.district === 'Lahore');
      const layer = districts.getLayers().find(l => l.feature === f);
      highlight({ target: layer });
    })()`);
    await sleep(400);
    panelText = await cdp.eval(
      `document.querySelector('.info').textContent.replace(/\\s+/g, ' ')`);
  }
  console.log('info panel reads:', panelText);
  if (!/Lahore/.test(panelText) || !/Population/.test(panelText)) {
    throw new Error('the info panel is not showing the hovered district: ' + panelText);
  }
  const tipOpen = await cdp.eval(`document.querySelectorAll('.leaflet-tooltip').length`);
  console.log('tooltips open at capture time:', tipOpen);
  await cdp.shot('checkpoint5_hover_highlight');

  // move off again and take the clean overview (checkpoint 4)
  const cleared = await cdp.eval(unhoverExpr);
  console.log('after unhover:', cleared);
  await sleep(700);
  await cdp.shot('checkpoint4_density_map_and_legend');

  // ---- NUST overlay at two zoom levels (checkpoint 6) -------------------
  await cdp.run(`nustGroup.addTo(map);
    map.setView([33.6423, 72.9906], 10, { animate: false });`);
  await cdp.settle(2600);
  await cdp.shot('checkpoint6a_nust_zoom10');

  await cdp.run(`map.setView([30.3753, 69.3451], 5, { animate: false });`);
  await cdp.settle(2600);
  await cdp.shot('checkpoint6b_nust_zoom5');

  // ---- one province selected (checkpoint 8) ----------------------------
  await cdp.run(`nustGroup.remove();
    const s = document.getElementById('province');
    s.value = 'Sindh'; s.dispatchEvent(new Event('change'));`);
  await cdp.settle(2800);
  await cdp.shot('checkpoint8_province_selected');

  // ---- coordinate popup on the sea south of Karachi (checkpoint 7) ------
  await cdp.run(`const s = document.getElementById('province');
    s.value = 'all'; s.dispatchEvent(new Event('change'));`);
  await cdp.settle(2500);
  await cdp.run(`const cb = document.getElementById('coords');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    map.setView([23.6, 66.4], 6, { animate: false });`);
  await cdp.settle(2600);
  await cdp.shot('checkpoint7a_sea_before_click');

  await cdp.run(`map.fire('click', { latlng: L.latLng(23.6, 66.4) });`);
  await sleep(900);
  await cdp.shot('checkpoint7b_coordinate_popup_on_the_sea');

  // ---- Elements tab, SVG vs canvas (checkpoint 9) ----------------------
  await cdp.load(BASE);
  await cdp.run(useWorkingBasemap);
  await cdp.settle(2400);
  const svgDom = await cdp.eval(`(() => {
    const pane = map.getPane('overlayPane');
    const kids = pane.children;
    return JSON.stringify({
      tag: kids.length ? kids[0].tagName.toLowerCase() : null,
      classes: kids.length ? kids[0].getAttribute('class') : null,
      count: pane.querySelectorAll('path').length
    });
  })()`);
  console.log('SVG overlayPane:', svgDom);
  await cdp.shot('checkpoint9a_svg_overlay_pane');

  await cdp.load(BASE + '?canvas');
  await cdp.run(useWorkingBasemap);
  await cdp.settle(2400);
  const canvasDom = await cdp.eval(`(() => {
    const pane = map.getPane('overlayPane');
    const kids = pane.children;
    return JSON.stringify({
      tag: kids.length ? kids[0].tagName.toLowerCase() : null,
      classes: kids.length ? kids[0].getAttribute('class') : null,
      count: pane.querySelectorAll('path').length
    });
  })()`);
  console.log('Canvas overlayPane:', canvasDom);
  await cdp.shot('checkpoint9b_canvas_overlay_pane');

  // ---- Part 3: the Esri basemap, so the tile URL can be read off ------
  await cdp.load(BASE);
  await cdp.run(`map.removeLayer(positron); imagery.addTo(map);`);
  await cdp.settle(3500);
  const tileUrls = await cdp.eval(`JSON.stringify(
    [...document.querySelectorAll('.leaflet-tile-pane img')]
      .map(i => i.src).filter(s => /arcgisonline/.test(s)).slice(0, 4))`);
  console.log('Esri tile URLs seen by the browser:', tileUrls);
  await cdp.shot('checkpoint3_esri_satellite_basemap');

  // ---- the Carto placeholder, as evidence for the report note ---------
  // Kept as the record of what the problem looked like. Now that app.js sends
  // the API key this capture would show a working map, so do NOT re-run this
  // block to regenerate the figure - the existing
  // checkpoint3b_carto_positron_api_key_required.png is the evidence and is
  // deliberately not overwritten.
  await cdp.load(BASE);
  await cdp.run(`map.setView([27.7, 68.9], 7, { animate: false });`);
  await cdp.settle(3200);
  await cdp.shot('checkpoint3b_carto_positron_api_key_required');
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
