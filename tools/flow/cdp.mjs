// Open TAN · talk to the signed-in Google Flow window over its DevTools port (law 34).
// Trusted mouse / key events only inside the create panel; never "Start generation", never the prompt box.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(profile = 'default') {
  const portFile = path.join(process.env.GFLOW_HOME || path.join(os.homedir(), '.gflow'), 'profiles', profile, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) throw new Error('no Flow window open (run `gflow doctor` once)');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
    .find((t) => t.type === 'page' && /flow\.google\.com|labs\.google\/fx/.test(t.url));
  if (!tab) throw new Error('no Flow tab open in the Flow window');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
  // One reply per call: a CDP error rejects with the method's name, no answer in `timeout` ms rejects, and a closed
  // tab rejects every call still waiting (a failed call never passes as "undefined").
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    let d; try { d = JSON.parse(m.data); } catch { return; }
    const p = d.id != null && pending.get(d.id);
    if (!p) return;
    pending.delete(d.id); clearTimeout(p.timer);
    if (d.error) p.reject(new Error(`CDP ${p.method}: ${d.error.message || 'error'}${d.error.data ? ` (${d.error.data})` : ''}`));
    else p.resolve(d.result);
  });
  ws.addEventListener('close', () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`CDP ${p.method}: the Flow tab closed`)); }
    pending.clear();
  });
  const send = (method, params = {}, { timeout = 30000 } = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`CDP ${method}: the Flow tab is not connected`));
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}: no answer in ${timeout / 1000} s`)); }, timeout);
    pending.set(id, { method, resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

  const installHelpers = () => js(`window.__tan = {
    vis(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; },
    controls() { return [...document.querySelectorAll('button,[role=button],[role=radio],[role=menuitemradio],[role=option],[role=menuitem],[role=tab]')].filter((e) => this.vis(e)); },
    text(e) { return (e.textContent || '').trim().replace(/\\s+/g, ' '); },
    find(src) { const re = new RegExp(src); return this.controls().find((e) => re.test(this.text(e)) && (e.getAttribute('aria-label') || '') !== 'Start generation'); },
    center(e) { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    popoverOpen() { return this.controls().some((e) => /^(videocam\\s?)?Video$/.test(this.text(e))); },
    credits() { const m = (document.body.innerText || '').match(/Generating will use[^\\n]*?(\\d+)\\s*credits?/i); return m ? Number(m[1]) : null; },
    model() { const b = [...document.querySelectorAll('button')].find((e) => this.vis(e) && /arrow_drop_down/.test(e.textContent || '')); return b ? this.text(b).replace('arrow_drop_down', '').trim() : null; },
    slider() { const s = [...document.querySelectorAll('input[type=range]')].find((e) => /Length/i.test(e.getAttribute('aria-label') || '')); return s ? { el: s, value: Number(s.value), min: Number(s.min), max: Number(s.max), label: (s.parentElement?.parentElement?.innerText || '').match(/(\\d+)\\s*sec/)?.[1] } : null; },
    trigger() { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || '') === 'Settings trigger'); return b ? this.text(b) : null; },
  };`);
  await installHelpers();

  async function clickAt({ x, y }) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await wait(300);
  }
  async function key(k, code, vk) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
    await wait(200);
  }
  async function pick(src) {
    const c = await js(`(() => { const e = __tan.find(${JSON.stringify(src)}); return e ? __tan.center(e) : null; })()`);
    if (!c) return false;
    await clickAt(c);
    return true;
  }
  const escape = () => key('Escape', 'Escape', 27);
  // The panel lives inside a project. On Flow's home page, open the most recent project and wait for its prompt box.
  async function ensureProject() {
    if (!(await js('!!window.__tan'))) await installHelpers(); // a page load drops the helpers
    if (await js("!!document.querySelector('button[aria-label=\"Settings trigger\"]')")) return;
    const href = await js(`(() => { const a = [...document.querySelectorAll('a[href*="/project/"]')][0]; return a ? a.href : null; })()`);
    if (!href) throw new Error('no Flow project to open');
    await send('Page.navigate', { url: href });
    for (let i = 0; i < 60; i++) {
      await wait(500);
      const ok = await js("!!document.querySelector('button[aria-label=\"Settings trigger\"]')").catch(() => false);
      if (ok) break;
    }
    await installHelpers();
  }
  async function openPanel() {
    await ensureProject();
    if (await js('__tan.popoverOpen()')) return;
    const c = await js(`(() => { const e = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings trigger'); return e ? __tan.center(e) : null; })()`);
    if (!c) throw new Error('settings trigger not found');
    await clickAt(c);
    await wait(500);
  }
  const norm = (s) => String(s).toLowerCase().replace(/volume_up|leaving.*$/g, '').replace(/[^a-z0-9]/g, '');
  async function pickModel(name) {
    await openPanel();
    if (norm(await js('__tan.model()')) === norm(name)) return true;
    if (!(await pick('arrow_drop_down'))) return false;
    await wait(400);
    const c = await js(`(() => { const want = ${JSON.stringify(norm(name))}; const e = [...document.querySelectorAll('[role=menu] [role=menuitem]')].filter((x) => __tan.vis(x)).find((x) => (x.textContent || '').toLowerCase().replace(/volume_up|leaving.*$/g, '').replace(/[^a-z0-9]/g, '') === want); return e ? __tan.center(e) : null; })()`);
    if (!c) { await escape(); return false; }
    await clickAt(c);
    await wait(400);
    await openPanel();
    return norm(await js('__tan.model()')) === norm(name);
  }
  // Omni 1.2's Length slider: focus it, Home, then ArrowRight until the label shows the wanted seconds.
  async function setLength(seconds) {
    const s = await js('(() => { const s = __tan.slider(); if (!s) return null; s.el.focus(); return { value: s.value, min: s.min, max: s.max }; })()');
    if (!s) return false;
    await key('Home', 'Home', 36);
    for (let i = 0; i <= s.max - s.min; i++) {
      const now = await js('(() => { const s = __tan.slider(); return s ? Number(s.label) : null; })()');
      if (now === Number(seconds)) return true;
      await key('ArrowRight', 'ArrowRight', 39);
    }
    return false;
  }
  const read = () => js('__tan.credits()');
  const close = async () => { await escape(); await escape(); };
  return { send, js, clickAt, key, pick, escape, openPanel, pickModel, setLength, read, close, ws };
}
