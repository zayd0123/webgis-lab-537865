#!/usr/bin/env node
/**
 * Lab 3, Part 9 - capture Checkpoint 9: the Elements tab in both renderers.
 *
 * The handout asks for "screenshots of the Elements tab in both modes", so the
 * figure has to show DevTools' Elements panel with the overlay pane expanded,
 * not just the map. This drives DevTools the same way the Part 3 capture does:
 *
 *   1. Chrome in a window (DevTools needs a compositor), page loaded.
 *   2. DevTools opened with `Target.openDevTools {panelId: 'elements'}`.
 *   3. The DevTools search box is used to find `leaflet-overlay-pane`, which
 *      selects the node *and* expands the tree down to it - the same thing the
 *      checkpoint describes doing by hand, and it avoids having to click
 *      through an unknown number of collapsed ancestors.
 *   4. The result rows are expanded so the children are visible, then the
 *      Chrome window is captured with `screencapture -l`.
 *   5. Repeated with index.html?canvas, where the pane holds one <canvas>.
 *
 *   node lab3/capture_devtools_elements.mjs [baseUrl] [outDir]
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:5511/lab3/index.html').replace(/\?canvas$/, '');
const OUTDIR = resolve(process.argv[3] || 'lab3/Report');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9431;
const SEARCH = 'leaflet-overlay-pane';

mkdirSync(OUTDIR, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'lab3-el-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeWindowIds() {
  const py = `
import ctypes, json
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
    o = ctypes.c_longlong(0); cf.CFNumberGetValue(v, 4, ctypes.byref(o)); return o.value
arr = cg.CGWindowListCopyWindowInfo(1, 0)
out = []
for i in range(cf.CFArrayGetCount(arr)):
    d = cf.CFArrayGetValueAtIndex(arr, i)
    if 'Chrome' in (sval(d, 'kCGWindowOwnerName') or '') and ival(d, 'kCGWindowLayer') == 0:
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
  async eval(expr, sessionId, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise }, sessionId);
    if (r.exceptionDetails) {
      throw new Error('threw: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

const listTargets = async () =>
  (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());

/* helper source injected into the DevTools frontend */
const FIND = `
  const find = (root, sel) => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const h = find(el.shadowRoot, sel); if (h) return h; }
    }
    return null;
  };`;

const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  '--window-size=1700,1120',
  '--window-position=20,20',
  '--force-device-scale-factor=2',
  BASE,
], { stdio: 'ignore' });

let socket;
try {
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json())
        .webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Chrome never opened its debugging port');
  socket = new WebSocket(wsUrl);
  await new Promise((r) => socket.addEventListener('open', r, { once: true }));
  const cdp = new CDP(socket);

  for (const [label, url, file] of [
    ['SVG', BASE, 'checkpoint9a_svg_overlay_pane.png'],
    ['canvas', BASE + '?canvas', 'checkpoint9b_canvas_overlay_pane.png'],
  ]) {
    console.log(`\n=== ${label} mode ===`);

    // navigate the existing target rather than opening new ones
    let pageTarget = (await listTargets()).find(
      (t) => t.type === 'page' && t.url.startsWith('http'));
    if (!pageTarget) {
      for (let i = 0; i < 80 && !pageTarget; i++) {
        pageTarget = (await listTargets()).find(
          (t) => t.type === 'page' && t.url.startsWith('http'));
        if (!pageTarget) await sleep(300);
      }
    }
    const page = await cdp.attach(pageTarget.id, true);
    await cdp.send('Page.navigate', { url }, page).catch(() => {});
    for (let i = 0; i < 80; i++) {
      const ready = await cdp.eval(
        `document.getElementById('count') && /districts$/.test(document.getElementById('count').textContent)`,
        page).catch(() => false);
      if (ready) break;
      await sleep(300);
    }
    // Carto Positron returns "API KEY REQUIRED" placeholder tiles, which would
    // put a watermark across half the figure; OpenStreetMap renders.
    await cdp.eval(`(() => {
      if (typeof positron !== 'undefined' && map.hasLayer(positron)) map.removeLayer(positron);
      if (typeof osm !== 'undefined' && !map.hasLayer(osm)) osm.addTo(map);
    })()`, page).catch(() => {});
    await sleep(3000);

    const shape = JSON.parse(await cdp.eval(`JSON.stringify({
      preferCanvas: map.options.preferCanvas,
      paths: map.getPane('overlayPane').querySelectorAll('path').length,
      canvases: map.getPane('overlayPane').querySelectorAll('canvas').length,
      symbolPaths: map.getPane('symbols').querySelectorAll('path').length,
      symbolCanvases: map.getPane('symbols').querySelectorAll('canvas').length
    })`, page));
    console.log(`overlay pane: ${shape.paths} paths, ${shape.canvases} canvas(es)`);

    // open DevTools on the Elements panel
    await cdp.send('Target.openDevTools', {
      targetId: pageTarget.id, panelId: 'elements', mode: 'right',
    });
    await sleep(4500);
    const dt = (await listTargets()).find(
      (t) => t.type === 'page' && t.url.startsWith('devtools://'));
    if (!dt) throw new Error('no DevTools target');
    const devtools = await cdp.attach(dt.id, true);
    await sleep(2000);

    // The Elements tree opens with #map collapsed, and the search box is not
    // reachable from the frontend's DOM (DevTools renders the toolbar outside
    // the inspected document tree in this build). Expanding the ancestors is
    // what the checkpoint describes doing by hand anyway: click the disclosure
    // arrows until leaflet-overlay-pane is showing.
    // Open the Elements search with Cmd+F. The search box is in the DOM but
    // hidden ("search-bar hidden"), and DevTools ignores synthetic key events,
    // so the shortcut and the typing are delivered as trusted input through
    // Input.dispatchKeyEvent / Input.insertText. Searching for the pane is then
    // what expands the tree down to it and selects it, which is exactly the
    // shortcut the checkpoint describes doing by hand.
    const MOD_META = 4;   // CDP modifier bit for the Command key
    console.log('opening the Elements search box with Command+F ...');
    for (const type of ['rawKeyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        modifiers: MOD_META,
        key: 'f',
        code: 'KeyF',
        windowsVirtualKeyCode: 70,
        nativeVirtualKeyCode: 3,
        text: type === 'keyUp' ? undefined : 'f',
      }, devtools);
    }
    await sleep(1200);

    // type the search term
    await cdp.send('Input.insertText', { text: SEARCH }, devtools).catch(() => {});
    await sleep(1200);
    for (const type of ['rawKeyDown', 'keyUp', 'char']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 36,
        text: type === 'char' ? '\r' : undefined,
      }, devtools).catch(() => {});
    }
    await sleep(3000);

    const searchState = await cdp.eval(`(() => {${FIND}
      const box = find(document, 'input.search-replace.search')
        || find(document, '.toolbar-search input')
        || find(document, 'input[type="search"]');
      const bar = find(document, '.search-bar');
      return JSON.stringify({
        boxFound: !!box,
        boxValue: box ? box.value : null,
        barClass: bar ? bar.className : null,
        barVisible: bar ? !!bar.getBoundingClientRect().width : false
      });
    })()`, devtools);
    console.log('search state:', searchState);

    // The panes are still collapsed. Synthetic events are ignored and key
    // events do not reach the row, so the row's own coordinates are read out of
    // the frontend and a REAL mouse click is delivered there with
    // Input.dispatchMouseEvent. DevTools cannot tell that from a click by hand.
    const rowPoint = (cls) => `(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      if (!tree) return 'NO_TREE';
      const rows = [...tree.querySelectorAll('li[role="treeitem"]')];
      const row = rows.find((r) => {
        const g = r.querySelector('.gutter-container');
        return false;   // placeholder, replaced below
      });
      return 'UNUSED';
    })()`;

    // find the row whose *tag span* is exactly the pane we want
    const locate = (cls) => `(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      if (!tree) return JSON.stringify({ error: 'no tree' });
      const rows = [...tree.querySelectorAll('li[role="treeitem"]')];
      const row = rows.find((r) => {
        const sp = r.querySelector('span[aria-label]');
        const label = sp ? (sp.getAttribute('aria-label') || '') : '';
        return new RegExp('class=.?"[^"]*' + ${JSON.stringify(cls)} + '[" ]').test(label) ||
               label.indexOf(${JSON.stringify(cls)}) >= 0;
      });
      if (!row) return JSON.stringify({ error: 'no row for ' + ${JSON.stringify(cls)} });
      row.scrollIntoView({ block: 'center' });
      const r = row.getBoundingClientRect();
      const g = row.querySelector('.gutter-container');
      const gr = g ? g.getBoundingClientRect() : null;
      return JSON.stringify({
        expanded: /expanded/.test(row.className),
        rowRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        gutter: gr ? { x: Math.round(gr.left + gr.width / 2), y: Math.round(gr.top + gr.height / 2) } : null,
        label: (row.innerText || '').split(String.fromCharCode(10))[0].slice(0, 60)
      });
    })()`;

    const clickAt = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
        }, devtools);
        await sleep(120);
      }
      await sleep(900);
    };

    for (const cls of ['leaflet-overlay-pane', 'leaflet-symbols-pane']) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const info = JSON.parse(await cdp.eval(locate(cls), devtools));
        if (info.error) { console.log('  locate', cls, '->', info.error); break; }
        if (info.expanded) { console.log('  ', cls, 'expanded'); break; }
        // the disclosure is in the gutter at the row's right edge; the row can
        // move as the tree renders, so the coordinates are re-read each attempt
        const x = info.gutter ? info.gutter.x : info.rowRect.x + info.rowRect.w - 24;
        const y = info.gutter ? info.gutter.y : info.rowRect.y + info.rowRect.h / 2;
        console.log('  clicking', cls, 'disclosure at', x + ',' + y, '(attempt ' + attempt + ')');
        await clickAt(x, y);
        await sleep(1800);
      }
    }

    // Expand the whole visible chain: the first two children of the overlay
    // pane, so the tree shows what the pane actually contains.
    const firstChildren = JSON.parse(await cdp.eval(`(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      const rows = [...tree.querySelectorAll('li[role="treeitem"]')];
      const paneRow = rows.find((r) => (r.innerText || '').includes('leaflet-overlay-pane'));
      if (!paneRow) return JSON.stringify({ error: 'no pane row' });
      const kids = [...paneRow.querySelectorAll('ol.children > li[role="treeitem"]')];
      return JSON.stringify({
        count: kids.length,
        first: kids.slice(0, 3).map((k) => ({
          expanded: /expanded/.test(k.className),
          label: (k.innerText || '').split(String.fromCharCode(10))[0].slice(0, 70),
          gutter: (() => {
            const g = k.querySelector('.gutter-container');
            if (!g) return null;
            const r = g.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()
        }))
      });
    })()`, devtools));
    console.log('  children of the overlay pane:', JSON.stringify(firstChildren));
    for (const kid of (firstChildren.first || [])) {
      if (!kid.expanded && kid.gutter) {
        await clickAt(kid.gutter.x, kid.gutter.y);
        await sleep(1200);
      }
    }
    // put the pane back in view after expanding its children
    await cdp.eval(`(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      const row = [...tree.querySelectorAll('li[role="treeitem"]')]
        .find((r) => (r.innerText || '').includes('leaflet-overlay-pane'));
      if (row) row.scrollIntoView({ block: 'start' });
      return 'ok';
    })()`, devtools).catch(() => {});
    await sleep(2500);

    const deep = await cdp.eval(`(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      const txt = tree ? (tree.innerText || '') : '';
      const overlay = txt.indexOf('leaflet-overlay-pane');
      return JSON.stringify({
        overlayVisible: overlay >= 0,
        afterOverlay: txt.slice(overlay, overlay + 500).split(String.fromCharCode(10)).slice(0, 12),
        canvasCount: (txt.match(/<canvas/g) || []).length,
        pathCount: (txt.match(/<path/g) || []).length
      }, null, 1);
    })()`, devtools);
    console.log('tree contents near the pane:', deep);
    const state = await cdp.eval(`(() => {${FIND}
      const tree = find(document, '.elements-tree-outline') || find(document, '.tree-outline');
      const txt = tree ? (tree.innerText || '') : '';
      return JSON.stringify({
        treeFound: !!tree,
        hasOverlayPane: txt.includes('leaflet-overlay-pane'),
        hasMapPane: txt.includes('leaflet-map-pane'),
        canvasCount: (txt.match(/<canvas/g) || []).length,
        pathCount: (txt.match(/<path/g) || []).length,
        snippet: txt.slice(0, 1500)
      });
    })()`, devtools);
    console.log('tree state:', state);
    const crumbs = await cdp.eval(`(() => {${FIND}
      const bc = find(document, '.crumbs') || find(document, '.styles-pane-toolbar')
        || find(document, '.elements-breadcrumbs');
      return bc ? (bc.innerText || '').split(String.fromCharCode(10)).join(' > ') : 'NO_CRUMBS';
    })()`, devtools);
    console.log('selected node breadcrumb:', crumbs);
    await sleep(1500);
    await sleep(2500);


    // raise the window and shoot it
    spawnSync('open', ['-a', 'Google Chrome']);
    await sleep(2500);
    const windows = chromeWindowIds();
    const win = windows.find((w) => /District Dashboard/i.test(w.name)) || windows[0];
    if (!win) throw new Error('no Chrome window to capture');
    const out = join(OUTDIR, file);
    spawnSync('screencapture', ['-x', '-o', '-l', String(win.id), out]);
    console.log(`wrote ${out} (${statSync(out).size.toLocaleString()} bytes)`);

    // close DevTools again before switching renderer
    await cdp.send('Target.closeTarget', { targetId: dt.id }).catch(() => {});
    await sleep(1500);
  }
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
