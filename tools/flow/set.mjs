#!/usr/bin/env node
// Open TAN · put Google Flow's create panel on exactly one choice and read its price (law 34). Generates nothing.
//   node tools/flow/set.mjs --model "Omni 1.2 Flash" [--input frames|ingredients] --ratio 16:9|9:16
//                           [--res 360p|720p] [--seconds 3..15 | 4|6|8|10] [--expect N]
// Prints {"ok": true, "credits": N, "trigger": "…"}; exit 4 when the panel's price is not --expect (nothing changed
// back — the caller must not generate). Always x1.
import { connect, wait } from './cdp.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []));
// exactly 16:9 or 9:16 (same rule as frames.mjs); anything else stops before the panel is touched
const RATIO = { '16:9': 'crop_16_9', '9:16': 'crop_9_16' }[a.ratio];
if (!RATIO) { console.log(JSON.stringify({ ok: false, error: `--ratio must be 16:9 or 9:16 (got ${a.ratio === true || a.ratio == null ? 'none' : a.ratio})` })); process.exit(3); }
const f = await connect();
try {
  await f.openPanel();
  await f.pick('^(videocam\\s?)?Video$'); await wait(300);
  await f.openPanel(); await f.pick(String(a.input || 'ingredients').toLowerCase() === 'frames' ? 'Frames$' : 'Ingredients$');
  await f.openPanel(); await f.pick(`^${RATIO}`);
  if (a.model && !(await f.pickModel(a.model))) throw new Error(`model not offered: ${a.model}`);
  await f.openPanel(); await f.pick('^(x1|1x)$');
  if (a.res) { await f.openPanel(); if (!(await f.pick(`^${a.res}`))) throw new Error(`${a.res} not offered for this model`); }
  if (a.seconds) {
    await f.openPanel();
    const ok = (await f.pick(`^${a.seconds}s$`)) || (await f.setLength(a.seconds));
    if (!ok) throw new Error(`${a.seconds} s not offered for this model`);
  }
  await wait(300);
  const credits = await f.read();
  const trigger = await f.js('__tan.trigger()');
  await f.close();
  const ok = a.expect == null || Number(a.expect) === credits;
  console.log(JSON.stringify({ ok, credits, trigger }));
  process.exit(ok ? 0 : 4);
} catch (err) {
  await f.close().catch(() => {});
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(3);
}
