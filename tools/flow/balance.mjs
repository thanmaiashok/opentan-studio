#!/usr/bin/env node
// Open TAN · read the Google Flow credit balance from the signed-in Flow window (law 9 / law 34).
//   node tools/flow/balance.mjs [--profile default]   → {"credits": 965, "resets": "7 Dec at 14:21", "plan": "PRO", "at": "…"}
// Talks to the Flow Chrome window over its DevTools port (the window gflow keeps signed in): opens the account panel,
// reads "N Google Flow credits" + "Resets on …", closes the panel with its own close button. Generates nothing,
// touches no other control. Exit 2 = no Flow window with a debug port (run `gflow doctor` once, then retry).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : 'default';
const portFile = path.join(process.env.GFLOW_HOME || path.join(os.homedir(), '.gflow'), 'profiles', profile, 'DevToolsActivePort');
const fail = (msg, code = 2) => { console.log(JSON.stringify({ error: msg })); process.exit(code); };

if (!fs.existsSync(portFile)) fail('no Flow window open (no DevToolsActivePort)');
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
let targets;
try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { fail('Flow window not reachable on its debug port'); }
const tab = targets.find((t) => t.type === 'page' && /flow\.google\.com|labs\.google\/fx/.test(t.url));
if (!tab) fail('no Flow tab open in the Flow window');

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
let seq = 0;
function evaluate(expression) {
  const id = ++seq;
  return new Promise((resolve) => {
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      resolve(d.result?.result?.value);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}

// One page-side function: open panel → wait for the balance line → read → close. Labels are the panel's aria-labels.
const read = await evaluate(`(async () => {
  const byLabel = (re) => [...document.querySelectorAll('button,[role=button]')]
    .find((b) => b.offsetParent !== null && re.test((b.getAttribute('aria-label') || '').trim()));
  const visibleText = () => [...document.querySelectorAll('*')]
    .filter((e) => e.childElementCount === 0 && e.offsetParent !== null).map((e) => e.textContent.trim());
  const wasOpen = visibleText().some((s) => /Google Flow credits/.test(s));
  if (!wasOpen) { const open = byLabel(/^Account details$/); if (!open) return { error: 'account button not found' }; open.click(); }
  let lines = [];
  for (let i = 0; i < 20; i++) {
    lines = visibleText();
    if (lines.some((s) => /Google Flow credits/.test(s))) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const bal = lines.find((s) => /^[\\d,]+ Google Flow credits$/.test(s));
  const resets = lines.find((s) => /^Resets on /.test(s));
  const plan = lines.find((s) => /^(PRO|ULTRA|PLUS|FREE)$/i.test(s));
  const close = byLabel(/^Close account panel$/);
  if (close) close.click();
  return { credits: bal ? Number(bal.replace(/[^\\d]/g, '')) : null, resets: resets ? resets.replace(/^Resets on /, '') : null, plan: plan || null };
})()`);
ws.close();
if (!read || read.error || read.credits == null) fail(read?.error || 'balance line not found in the account panel', 3);
console.log(JSON.stringify({ ...read, at: new Date().toISOString() }));
process.exit(0);
