#!/usr/bin/env node
/**
 * Lab 3, Part 3 - capture Checkpoint 3: Chrome's Network tab showing an Esri
 * tile request with its full URL readable.
 *
 * This is a real screenshot of Chrome, not a mock-up:
 *
 *   1. Chrome is launched in a window (not headless - DevTools does not render
 *      without a compositor).
 *   2. The dashboard is loaded and switched to the Satellite (Esri) basemap, so
 *      arcgisonline tiles are genuinely requested.
 *   3. DevTools is opened on the page with `Target.openDevTools` and
 *      `panelId: 'network'`, so the Network panel is the one showing.
 *   4. The Network panel's filter box is set to "arcgisonline", which is exactly
 *      what the checkpoint describes doing by hand.
 *   5. The Chrome window is captured with `screencapture -l <windowId>`, the
 *      window id coming from CoreGraphics.
 *
 * If Chrome is occluded the capture shows whatever is in front, so the window
 * is raised first. Nothing here needs Accessibility permission: the window id
 * comes from CGWindowListCopyWindowInfo, and the panel is driven through the
 * DevTools protocol rather than through synthetic keystrokes.
 *
 *   node lab3/capture_devtools_network.mjs [baseUrl] [outPng]
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html').replace(/\?canvas$/, '');
const OUT = resolve(process.argv[3] || 'lab3/Report/checkpoint3_devtools_network_esri_tile.png');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9421;
const FILTER = 'arcgisonline';

mkdirSync(dirname(OUT), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'lab3-dt-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ helpers */

/** Chrome window ids owned by Google Chrome, via CoreGraphics, no permissions. */
function chromeWindowIds() {
  const py = `
import ctypes, ctypes.util, json
cg = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
cg.CGWindowListCopyWindowInfo.restype = ctypes.c_void_p
cg.CGWindowListCopyWindowInfo.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
cf.CFArrayGetCount.restype = ctypes.c_long
cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
cf.CFDictionaryGetValue.restype = ctypes.c_void_p
cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
cf.CFStringGetCString.restype = ctypes.c_bool
cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
cf.CFNumberGetValue.restype = ctypes.c_bool
cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p]
def key(n): return cf.CFStringCreateWithCString(None, n.encode(), 0)
def sval(d, n):
    v = cf.CFDictionaryGetValue(d, key(n))
    if not v: return None
    b = ctypes.create_string_buffer(2048)
    return b.value.decode() if cf.CFStringGetCString(v, b, 2048, 0x08000100) else None
def ival(d, n):
    v = cf.CFDictionaryGetValue(d, key(n))
    if not v: return None
    out = ctypes.c_longlong(0)
    cf.CFNumberGetValue(v, 4, ctypes.byref(out))
    return out.value
arr = cg.CGWindowListCopyWindowInfo(1, 0)
out = []
for i in range(cf.CFArrayGetCount(arr)):
    d = cf.CFArrayGetValueAtIndex(arr, i)
    owner = sval(d, 'kCGWindowOwnerName') or ''
    layer = ival(d, 'kCGWindowLayer')
    if 'Chrome' in owner and layer == 0:
        out.append({'id': ival(d, 'kCGWindowNumber'), 'name': sval(d, 'kCGWindowName') or ''})
print(json.dumps(out))
`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  try { return JSON.parse(r.stdout.trim() || '[]'); } catch { return []; }
}

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
  async attach(targetId, withPage = false) {
    const { sessionId } = await this.send('Target.attachToTarget',
      { targetId, flatten: true });
    await this.send('Runtime.enable', {}, sessionId);
    if (withPage) await this.send('Page.enable', {}, sessionId);
    return sessionId;
  }
  async eval(expr, sessionId) {
    const r = await this.send('Runtime.evaluate',
      { expression: expr, returnByValue: true }, sessionId);
    if (r.exceptionDetails) {
      throw new Error('threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function listTargets() {
  return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
}

/* --------------------------------------------------------------------- main */

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  '--window-size=1700,1120',
  '--window-position=20,20',
  '--force-device-scale-factor=2',
  BASE,
], { stdio: 'ignore' });

let browserSocket;
try {
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json())
        .webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome never opened its debugging port');
  browserSocket = new WebSocket(wsUrl);
  await new Promise((r) => browserSocket.addEventListener('open', r, { once: true }));
  const cdp = new CDP(browserSocket);

  // ---- 1. the page ------------------------------------------------------
  let pageTarget = null;
  for (let i = 0; i < 80 && !pageTarget; i++) {
    pageTarget = (await listTargets()).find(
      (t) => t.type === 'page' && t.url.startsWith('http'));
    if (!pageTarget) await sleep(300);
  }
  if (!pageTarget) throw new Error('the dashboard never loaded');
  console.log('page:', pageTarget.url);

  const page = await cdp.attach(pageTarget.id, true);
  for (let i = 0; i < 80; i++) {
    const ready = await cdp.eval(
      `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`,
      page).catch(() => false);
    if (ready) break;
    await sleep(300);
  }
  console.log('dashboard:', await cdp.eval(
    `document.getElementById('count').textContent`, page));

  // ---- 2. the Esri basemap, so arcgisonline tiles are requested ---------
  console.log('switching to Satellite (Esri) ...');
  await cdp.eval(`(() => {
    if (map.hasLayer(positron)) map.removeLayer(positron);
    imagery.addTo(map);
    document.querySelectorAll('.leaflet-control-layers-base input')[2].checked = true;
  })()`, page);
  await sleep(4000);

  const tiles = JSON.parse(await cdp.eval(`JSON.stringify(
    [...document.querySelectorAll('.leaflet-tile-pane img')]
      .map(i => i.src).filter(s => /arcgisonline/.test(s)))`, page));
  console.log('Esri tiles on the map:', tiles.length);

  // ---- 3. DevTools, on the Network panel -------------------------------
  console.log('opening DevTools on the Network panel ...');
  await cdp.send('Target.openDevTools', {
    targetId: pageTarget.id, panelId: 'network', mode: 'right',
  });
  await sleep(5000);

  const dt = (await listTargets()).find(
    (t) => t.type === 'page' && t.url.startsWith('devtools://'));
  if (!dt) throw new Error('no DevTools frontend target appeared');
  const devtools = await cdp.attach(dt.id, true);
  await sleep(2500);

  // The Network panel starts recording from when it opened, and the tiles were
  // already fetched by then - it would say "Perform a request or reload the
  // page". So reload with the panel open, which is also what the checkpoint
  // describes doing by hand.
  console.log('reloading the page with the Network panel recording ...');
  await cdp.eval('location.reload()', page).catch(() => {});
  // the reload destroys the execution context, so wait on the target instead
  let reloaded = false;
  for (let i = 0; i < 80 && !reloaded; i++) {
    await sleep(400);
    const target = (await listTargets()).find((t) => t.id === pageTarget.id);
    const session = await cdp.attach(pageTarget.id, false);
    reloaded = await cdp.eval(
      `!!document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`,
      session).catch(() => false);
    if (reloaded) {
      // leave the page on the Esri basemap for the screenshot
      await cdp.eval(`(() => {
        if (map.hasLayer(positron)) map.removeLayer(positron);
        imagery.addTo(map);
        document.querySelectorAll('.leaflet-control-layers-base input')[2].checked = true;
      })()`, session).catch(() => {});
    }
  }
  console.log('page reloaded, tiles re-requested');
  await sleep(5000);

  // ---- 4. filter the request list -------------------------------------
  const setFilter = `(() => {
    const find = (root, sel) => {
      const hit = root.querySelector(sel);
      if (hit) return hit;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const h = find(el.shadowRoot, sel); if (h) return h; }
      }
      return null;
    };
    const input = find(document, '.toolbar-input-prompt')
      || find(document, 'input[aria-label="Filter"]')
      || find(document, '.filter-text-input');
    if (!input) return 'NO_INPUT';
    input.focus();
    input.value = ${JSON.stringify(FILTER)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    return 'SET';
  })()`;
  console.log('network filter:', await cdp.eval(setFilter, devtools));
  await sleep(3000);

  /* The Name column shows "27@2x.png" - Chrome's Network panel truncates the
   * request name, so the full URL the checkpoint asks for is not readable. Two
   * things fix that, both done through the DOM rather than by hand:
   *
   *   - widen the Name column by dispatching a drag on its resize handle
   *   - select the row for one known tile, so its full URL appears in the
   *     Headers pane underneath as well                                    */
  const widen = `(() => {
    const res = {};
    // the grid's header cells; the first is "Name"
    const headers = [...document.querySelectorAll('.network-log-grid th, .data-grid th, [role="columnheader"]')];
    res.headerCount = headers.length;
    res.headers = headers.map(h => (h.textContent || '').trim()).slice(0, 8);
    const resizers = [...document.querySelectorAll('.network-log-grid .resizer, .data-grid .resizer, [class*="resizer"]')];
    res.resizerCount = resizers.length;
    if (resizers.length) {
      const r = resizers[0];
      const box = r.getBoundingClientRect();
      const opts = { bubbles: true, clientX: box.left + 2, clientY: box.top + box.height / 2, buttons: 1 };
      r.dispatchEvent(new MouseEvent('mousedown', opts));
      r.dispatchEvent(new MouseEvent('mousemove', { ...opts, clientX: box.left + 320 }));
      r.dispatchEvent(new MouseEvent('mouseup', { ...opts, clientX: box.left + 320 }));
      res.dragged = true;
    }
    return JSON.stringify(res);
  })()`;
  console.log('widen Name column:', await cdp.eval(widen, devtools));
  await sleep(1500);

  // select the row for the zoom-6 row-26 column-44 tile, so the panel's
  // Headers pane underneath spells the URL out in full
  const select = `(() => {
    const res = {};
    // Chrome 154's grid is a React list: rows are divs with
    // data-grid-data-grid-node, and row selection is a synthetic click, so the
    // event is dispatched on the row's own cell rather than on a container.
    const rows = [...document.querySelectorAll(
      '.network-log-grid .data-grid-data-grid-node, .data-grid-data-grid-node')];
    res.rows = rows.length;
    if (!rows.length) {
      res.classesSeen = [...new Set([...document.querySelectorAll('.network-log-grid *')]
        .map(e => (typeof e.className === 'string' ? e.className : ''))
        .filter(Boolean).map(c => c.split(' ')[0]))].slice(0, 30);
      return JSON.stringify(res);
    }
    // Each name-column cell is three pieces of text run together: the file
    // name, the host, then the path. For an Esri tile that reads
    // "27@2x.png | server.arcgisonline.com | .../tile/6/26/44", but DevTools
    // paints only the first piece, so the row is matched on the whole cell.
    const nameOf = (r) => {
      const c = r.querySelector('.name-column') || r;
      return String(c.textContent || '');
    };
    const isEsriTile = (r, yy, xx) => {
      const t = nameOf(r);
      return /arcgisonline/.test(t) && t.includes('/tile/') &&
             (!yy || t.includes('/' + yy + '/' + xx));
    };
    // the tile over central Pakistan at zoom 6: row 26, column 44
    const row = rows.find((r) => isEsriTile(r, '26', '44'))
      || rows.find((r) => isEsriTile(r))
      || rows[0];
    res.tile = (nameOf(row).match(/\\/tile\\/(\\d+)\\/(\\d+)\\/(\\d+)/) || []).slice(1);
    res.rowText = String(row.textContent || '').slice(0, 110);
    const cell = row.querySelector('[class*="name-column"]') || row.firstElementChild || row;
    const box = cell.getBoundingClientRect();
    const common = { bubbles: true, cancelable: true, view: window, button: 0,
                     clientX: box.left + 30, clientY: box.top + box.height / 2 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      cell.dispatchEvent(new MouseEvent(type,
        { ...common, buttons: type.endsWith('down') ? 1 : 0 }));
    }
    res.clicked = true;
    return JSON.stringify(res);
  })()`;
  console.log('select row:', await cdp.eval(select, devtools));
  await sleep(3500);

  // what does the panel now say the selected request's URL is?
  const detail = await cdp.eval(`(() => {
    const txt = document.body.innerText || '';
    const urls = [...new Set(txt.match(/https?:\\/\\/[^\\s"']*arcgisonline[^\\s"']*/g) || [])];
    return JSON.stringify({
      fullUrlsVisible: urls.slice(0, 6),
      showsRow26Col44: urls.some(u => /\\/tile\\/6\\/26\\/44/.test(u)),
      anyFullTileUrl: urls.some(u => /\\/tile\\/\\d+\\/\\d+\\/\\d+/.test(u)),
    });
  })()`, devtools);
  console.log('panel detail:', detail);

  // how many requests the panel is showing, and what the filter is set to
  const panel = await cdp.eval(`(() => {
    const find = (root, sel) => {
      const hit = root.querySelector(sel);
      if (hit) return hit;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const h = find(el.shadowRoot, sel); if (h) return h; }
      }
      return null;
    };
    const grid = find(document, '.network-log-grid') || find(document, '.data-grid');
    const rows = grid ? grid.querySelectorAll('[role="row"]').length : -1;
    const input = find(document, '.toolbar-input-prompt');
    const urls = [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && /arcgisonline.*tile\\/6\\//.test(e.textContent))
      .map(e => e.textContent.trim()).slice(0, 3);
    return JSON.stringify({ rows, filterValue: input ? input.value : null,
                            sampleUrlsInPanel: urls });
  })()`, devtools);
  console.log('panel state:', panel);

  // ---- 5. raise the window and capture it ------------------------------
  spawnSync('open', ['-a', 'Google Chrome']);
  await sleep(2500);

  const windows = chromeWindowIds();
  console.log('Chrome windows on screen:', JSON.stringify(windows));
  const win = windows.find((w) => /District Dashboard|webgis|lab3|Chrome/i.test(w.name))
    || windows[0];
  if (!win) throw new Error('no Chrome window found to capture');

  const shot = spawnSync('screencapture',
    ['-x', '-o', '-l', String(win.id), OUT], { encoding: 'utf8' });
  if (shot.status !== 0) throw new Error('screencapture failed: ' + shot.stderr);
  const size = statSync(OUT).size;
  console.log(`\nwrote ${OUT}`);
  console.log(`  window id ${win.id} (${win.name || 'untitled'}), ${size.toLocaleString()} bytes`);
} finally {
  try { browserSocket?.close(); } catch {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
