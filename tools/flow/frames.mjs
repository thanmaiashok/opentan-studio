#!/usr/bin/env node
// Open TAN · make one Flow clip from a start (and end) frame, end to end, on the signed-in Flow window (law 34, 35).
//   node tools/flow/frames.mjs --prompt-file p.txt --start a.png [--end b.png] --model "Veo 3.1 - Lite"
//        --ratio 16:9|9:16 [--res 360p|720p] [--seconds N] --expect <credits> --dir <job folder> --name <file.mp4>
//        [--download original|720p|1080p]
// Steps: fresh project (Flow keeps the panel choice) → panel: Video · Frames · ratio · model · x1 · res · length →
// upload the frame(s) into the Start / End slots → type the prompt → the panel price must equal --expect → Start →
// wait for the clip → download (original or Flow's free upscale) straight into --dir as --name.
// Prints one JSON line {ok, file, credits, seconds, error}. Exit 0 ok, 3 failed before generating, 5 failed after.
import fs from 'node:fs';
import path from 'node:path';
import { connect, wait } from './cdp.mjs';
import { videoTiles, downloadClip, clipId } from './download.mjs';

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const done = (o, code) => { console.log(JSON.stringify(o)); process.exit(code ?? (o.ok ? 0 : 3)); };
const prompt = a['prompt-file'] ? fs.readFileSync(a['prompt-file'], 'utf8').trim() : String(a.prompt || '');
if (!prompt || !a.start || !a.dir || !a.name || a.expect == null) done({ ok: false, error: 'need --prompt(-file) --start --dir --name --expect' });
// exactly 16:9 or 9:16 (same rule as set.mjs); anything else stops before Flow is touched
const RATIO = { '16:9': 'crop_16_9', '9:16': 'crop_9_16' }[a.ratio];
if (!RATIO) done({ ok: false, error: `--ratio must be 16:9 or 9:16 (got ${a.ratio === true || a.ratio == null ? 'none' : a.ratio})` });
const dir = path.resolve(a.dir);
fs.mkdirSync(dir, { recursive: true });

const f = await connect();
await f.send('Page.enable');
const center = (expr) => f.js(`(() => { const e = ${expr}; if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
const btnByText = (re) => center(`[...document.querySelectorAll('button,[role=button]')].find((e) => e.getBoundingClientRect().width > 0 && ${re}.test(e.textContent.trim()) && (e.getAttribute('aria-label') || '') !== 'Start generation')`);
const shot = async (name) => { const s = await f.send('Page.captureScreenshot', { format: 'jpeg', quality: 45 }); fs.writeFileSync(path.join(dir, `.${name}.jpg`), Buffer.from(s.data, 'base64')); };
let stage = 'start';
try {
  // 1. fresh project (one clip per project, so the newest tile is ours)
  stage = 'project';
  await f.send('Page.navigate', { url: 'https://flow.google.com/' });
  await wait(4000);
  const np = await btnByText('/New project/');
  if (!np) throw new Error('no New project button on Flow home');
  await f.clickAt(np);
  for (let i = 0; i < 40; i++) { await wait(500); if (await f.js("!!document.querySelector('button[aria-label=\"Settings trigger\"]')").catch(() => false)) break; } // page may reload: keep waiting
  await wait(800);

  // 2. panel
  stage = 'panel';
  await f.openPanel();
  await f.pick('^(videocam\\s?)?Video$'); await wait(300);
  await f.openPanel(); await f.pick('Frames$');
  await f.openPanel(); await f.pick(`^${RATIO}`);
  if (a.model && !(await f.pickModel(a.model))) throw new Error(`model not offered: ${a.model}`);
  await f.openPanel(); await f.pick('^(x1|1x)$');
  if (a.res) { await f.openPanel(); if (!(await f.pick(`^${a.res}`))) throw new Error(`${a.res} not offered`); }
  if (a.seconds) { await f.openPanel(); if (!((await f.pick(`^${a.seconds}s$`)) || (await f.setLength(a.seconds)))) throw new Error(`${a.seconds} s not offered`); }
  await f.close();

  // 3. frames
  stage = 'frames';
  for (const [slot, file] of [['Start', a.start], ['End', a.end]]) {
    if (!file) continue;
    const s = await center(`[...document.querySelectorAll('button')].find((e) => e.getBoundingClientRect().width > 0 && e.textContent.trim() === '${slot}')`);
    if (!s) throw new Error(`no ${slot} frame slot (is the panel on Frames?)`);
    await f.clickAt(s); await wait(1200);
    await f.send('Page.setInterceptFileChooserDialog', { enabled: true });
    let chooser = null;
    const onMsg = (m) => { const d = JSON.parse(m.data); if (d.method === 'Page.fileChooserOpened') chooser = d.params; };
    f.ws.addEventListener('message', onMsg);
    const up = await btnByText('/Upload media/');
    if (!up) throw new Error('no Upload media button in the frame picker');
    await f.clickAt(up);
    for (let i = 0; i < 40 && !chooser; i++) await wait(250);
    f.ws.removeEventListener('message', onMsg);
    await f.send('Page.setInterceptFileChooserDialog', { enabled: false });
    if (!chooser) throw new Error('file chooser did not open');
    await f.send('DOM.setFileInputFiles', { files: [path.resolve(file)], backendNodeId: chooser.backendNodeId });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await wait(500);
      ready = await f.js(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /^Add to prompt$/.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0); return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; })()`);
    }
    await wait(1500); // the upload spinner clears a moment after the button wakes
    const add = await btnByText('/^Add to prompt$/');
    if (!add) throw new Error('no Add to prompt button');
    await f.clickAt(add); await wait(1500);
  }
  const filled = await f.js(`[...document.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 0 && /ingredient/i.test(e.getAttribute('aria-label') || '')).length`);
  if (filled < (a.end ? 2 : 1)) throw new Error(`frames not attached (${filled})`);

  // 4. prompt
  stage = 'prompt';
  const box = await center(`[...document.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')].find((e) => e.getBoundingClientRect().width > 200)`);
  if (!box) throw new Error('no prompt box');
  await f.clickAt(box);
  await f.send('Input.insertText', { text: prompt });
  await wait(800);
  const typed = await f.js(`(() => { const e = [...document.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')].find((x) => x.getBoundingClientRect().width > 200); return (e.value || e.innerText || '').trim().length; })()`);
  if (typed < Math.min(40, prompt.length)) throw new Error('prompt did not land in the box');

  // 5. price check, then generate
  stage = 'price';
  await f.openPanel();
  const credits = await f.read();
  await f.close();
  if (credits !== Number(a.expect)) throw new Error(`panel says ${credits} credits, expected ${a.expect}`);
  const tilesBefore = await f.js(`[...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === 'More options' && b.getBoundingClientRect().width > 0).length`);
  const idsBefore = (await videoTiles(f)).map((t) => clipId(t.key)); // to find OUR clip later (MISTAKES G06)
  const go = await center(`document.querySelector('button[aria-label="Start generation"]')`);
  await f.clickAt(go);
  stage = 'generating';
  const t0 = Date.now();

  // 6. wait for the clip: a playable tile appears, or Flow reports a failure
  let ok = false, err = null;
  for (let i = 0; i < 720 && !ok && !err; i++) {
    await wait(1000);
    const st = await f.js(`(() => {
      const txt = document.body.innerText || '';
      const fail = txt.match(/(Something went wrong[^\\n]*|failed to generate[^\\n]*|couldn.t generate[^\\n]*|violat[^\\n]*polic[^\\n]*)/i);
      const tiles = [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === 'More options' && b.getBoundingClientRect().width > 0).length;
      const playable = [...document.querySelectorAll('button')].some((b) => /play_circle/.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
      return { fail: fail ? fail[0].slice(0, 120) : null, tiles, playable };
    })()`);
    if (st.fail) err = st.fail;
    else if (st.playable && st.tiles > tilesBefore) ok = true;
  }
  if (!ok) { await shot('flow-fail'); done({ ok: false, error: err || 'clip did not finish within 12 min', stage, credits }, 5); }
  await wait(2000);

  // 7. download OUR clip (the tile that was not there before Start) straight into the job folder (MISTAKES G06)
  stage = 'download';
  // by media id, so a re-signed URL of an older clip is not taken for new; no fresh tile = downloadClip refuses unless
  // ours is the only clip
  const fresh = (await videoTiles(f)).find((t) => !idsBefore.includes(clipId(t.key)));
  const got = await downloadClip(f, { dir, name: a.name, tier: a.download || 'original', key: fresh?.key });
  done({ ok: true, file: got.file, credits, tier: a.download || 'original', picked: got.picked, seconds: Math.round((Date.now() - t0) / 1000) }, 0);
} catch (e) {
  await f.escape().catch(() => {}); await f.escape().catch(() => {});
  await shot(`flow-${stage}`).catch(() => {});
  done({ ok: false, error: e.message, stage }, stage === 'generating' || stage === 'download' ? 5 : 3);
}
