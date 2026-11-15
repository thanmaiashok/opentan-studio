#!/usr/bin/env node
// Open TAN · map Google Flow's create panel (law 34). READ-ONLY: walks every mode × input × ratio × model ×
// resolution × length × outputs in the settings popover of the signed-in Flow window and reads the
// "Generating will use N credits" line for each. It clicks only options inside the settings popover and the model
// menu — never "Start generation", never the prompt box. The popover is reopened before every pick (a pick can close
// it, as in set.mjs). Leaves the panel on the cheap default Video · Ingredients · 16:9 · Omni 1.2 Flash · x1 · 360p
// (Omni 1.1 Flash only if 1.2 is not offered) and closed — also after a failed walk (exit 3); exit 4 when that
// default could not be confirmed.
//   node tools/flow/panel.mjs [--out data/flow-panel.json] [--quick]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const outFile = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(process.cwd(), 'data', 'flow-panel.json');
const quick = argv.includes('--quick');
const portFile = path.join(process.env.GFLOW_HOME || path.join(os.homedir(), '.gflow'), 'profiles', 'default', 'DevToolsActivePort');
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .find((t) => t.type === 'page' && /flow\.google\.com|labs\.google\/fx/.test(t.url));
if (!tab) { console.error('no Flow tab'); process.exit(2); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
// One reply per call: a CDP error rejects with the method's name, no answer in `timeout` ms rejects, a closed tab
// rejects every call still waiting (same as cdp.mjs).
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Page-side helpers, installed once.
await js(`window.__tan = {
  vis(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; },
  controls() { return [...document.querySelectorAll('button,[role=button],[role=radio],[role=menuitemradio],[role=option],[role=menuitem],[role=tab]')].filter(this.vis); },
  text(e) { return (e.textContent || '').trim().replace(/\\s+/g, ' '); },
  find(src) { const re = new RegExp(src); return this.controls().find((e) => re.test(this.text(e)) && (e.getAttribute('aria-label') || '') !== 'Start generation'); },
  center(e) { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  popoverOpen() { return this.controls().some((e) => /^(videocam\\s?)?Video$/.test(this.text(e))); },
  credits() { const m = (document.body.innerText || '').match(/Generating will use[^\\n]*?(\\d+)\\s*credits?/i); return m ? Number(m[1]) : null; },
  model() { const b = [...document.querySelectorAll('button')].find((e) => this.vis(e) && /arrow_drop_down/.test(e.textContent || '')); return b ? this.text(b).replace('arrow_drop_down', '').trim() : null; },
  menuItems() { return [...document.querySelectorAll('[role=menu] [role=menuitem]')].filter(this.vis).map((e) => this.text(e)); },
  options(src) { const re = new RegExp(src); return [...new Set(this.controls().map((e) => this.text(e).replace(/info$/, '').trim()).filter((t) => re.test(t)))]; },
  selected(src) { const re = new RegExp(src); return this.controls().filter((e) => re.test(this.text(e))).filter((e) => e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('data-state') === 'on' || e.getAttribute('aria-pressed') === 'true').map((e) => this.text(e)); },
};`);

async function clickAt({ x, y }) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await wait(300);
}
async function pick(src) {
  const c = await js(`(() => { const e = __tan.find(${JSON.stringify(src)}); return e ? __tan.center(e) : null; })()`);
  if (!c) return false;
  await clickAt(c);
  return true;
}
async function escape() {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(250);
}
async function openPanel() {
  if (await js('__tan.popoverOpen()')) return;
  const c = await js(`(() => { const e = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Settings trigger'); return e ? __tan.center(e) : null; })()`);
  if (!c) throw new Error('settings trigger not found');
  await clickAt(c);
  await wait(500);
}
async function models() {
  await openPanel();
  if (!(await pick('arrow_drop_down'))) return [];
  await wait(400);
  const items = await js('__tan.menuItems()');
  await escape();
  return items.map((s) => s.replace(/volume_up/g, '').replace(/Leaving.*$/, '').trim()).filter(Boolean);
}
async function pickModel(name) {
  await openPanel();
  if (!(await pick('arrow_drop_down'))) return false;
  await wait(400);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = await js(`(() => { const e = [...document.querySelectorAll('[role=menu] [role=menuitem]')].filter((x) => __tan.vis(x)).find((x) => (${JSON.stringify(norm(name))}) === (x.textContent || '').replace(/volume_up/g, '').replace(/Leaving.*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '')); return e ? __tan.center(e) : null; })()`);
  if (!c) { await escape(); return false; }
  await clickAt(c);
  await wait(400);
  await openPanel();
  return norm((await js('__tan.model()')) || '') === norm(name);
}
const read = () => js('__tan.credits()');

const startTrigger = await js(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || '') === 'Settings trigger'); return b ? __tan.text(b) : null; })()`);
const result = { at: new Date().toISOString(), startTrigger, video: [], image: [] };

// The walk runs inside try: a failed CDP call (now an error, not undefined) still ends with the panel put back below.
try {
  // ---- Video
  await openPanel();
  await pick('^(videocam\\s?)?Video$');
  await wait(400);
  const inputs = ['Frames', 'Ingredients'];
  const ratios = quick ? ['crop_16_9'] : ['crop_16_9', 'crop_9_16'];
  for (const input of inputs) {
    await openPanel(); await pick(`${input}$`); await wait(300);
    for (const ratio of ratios) {
      await openPanel(); await pick(`^${ratio}`); await wait(300);
      const list = await models();
      for (const m of list) {
        if (!(await pickModel(m))) { result.video.push({ input, ratio, model: m, error: 'could not select' }); continue; }
        await openPanel(); await pick('^(x1|1x)$');
        const resolutions = await js(`__tan.options('^\\\\d+p$')`);
        const durations = await js(`__tan.options('^\\\\d+s$')`);
        const credits = {};
        for (const res of resolutions.length ? resolutions : ['']) {
          if (res) { await openPanel(); await pick(`^${res}`); }
          for (const d of durations.length ? durations : ['']) {
            if (d) { await openPanel(); await pick(`^${d}$`); }
            await wait(250);
            credits[[res, d].filter(Boolean).join(' ') || 'fixed'] = await read();
          }
        }
        // outputs multiplier, once per model
        await openPanel(); await pick('^(x2|2x)$'); await wait(250);
        const x2 = await read();
        await openPanel(); await pick('^(x1|1x)$'); await wait(200);
        const all = await js(`__tan.controls().map((e) => __tan.text(e)).filter((t) => t.length < 40)`);
        result.video.push({ input, ratio: ratio.replace('crop_', '').replace('_', ':'), model: m, resolutions, durations, credits, x2, controls: all });
        console.error(`video ${input} ${ratio} ${m}: ${JSON.stringify(credits)} x2=${x2}`);
      }
    }
  }

  // ---- Image
  await openPanel();
  await pick('^(image\\s?)?Image$');
  await wait(400);
  const imgRatios = await js(`__tan.options('^crop_')`);
  const imgModels = await models();
  for (const m of imgModels) {
    if (!(await pickModel(m))) { result.image.push({ model: m, error: 'could not select' }); continue; }
    await openPanel(); await pick('^(x1|1x)$'); await wait(250);
    const x1 = await read();
    await openPanel(); await pick('^(x2|2x)$'); await wait(250);
    const x2 = await read();
    await openPanel(); await pick('^(x1|1x)$');
    const resolutions = await js(`__tan.options('^\\\\d+[pK]$|^(1K|2K|4K)$')`);
    result.image.push({ model: m, ratios: imgRatios, resolutions, credits: { x1, x2 } });
    console.error(`image ${m}: x1=${x1} x2=${x2}`);
  }
} catch (err) {
  result.error = err.message;
  console.error(`panel walk stopped: ${err.message} — putting the panel back`);
}

// ---- Leave Flow on the cheap, safe default (never x2, never Veo Quality): Video · Ingredients · 16:9 ·
// Omni 1.2 Flash · x1 · 360p. Omni 1.1 Flash (retires 5 Dec 2026) only when 1.2 is not offered; a missing one is skipped.
const end = {};
await openPanel(); end.video = await pick('^(videocam\\s?)?Video$'); await wait(300);
await openPanel(); end.input = await pick('Ingredients$');
await openPanel(); end.ratio = await pick('^crop_16_9');
end.model = null;
for (const m of ['Omni 1.2 Flash', 'Omni 1.1 Flash']) if (await pickModel(m)) { end.model = m; break; }
await openPanel(); end.x1 = await pick('^(x1|1x)$');
await openPanel(); end.res = (await pick('^360p')) ? '360p' : null;
if (end.model === 'Omni 1.1 Flash') { await openPanel(); await pick('^4s$'); } // its cheapest length button
await wait(250);
result.endTrigger = await js(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || '') === 'Settings trigger'); return b ? __tan.text(b) : null; })()`);
result.endCredits = await read();
result.end = end;
result.endOk = !!(end.video && end.input && end.ratio && end.model && end.x1 && end.res);
if (!result.endOk) console.error(`panel NOT back on the cheap default — check it by hand before any generation: ${JSON.stringify(end)}`);
await escape(); await escape();
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ saved: outFile, video: result.video.length, image: result.image.length, endTrigger: result.endTrigger, endCredits: result.endCredits, endOk: result.endOk }));
ws.close();
process.exit(result.endOk ? (result.error ? 3 : 0) : 4);
