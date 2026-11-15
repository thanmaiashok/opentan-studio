#!/usr/bin/env node
// studio — the one command the agent (Claude, Codex, Qwen, any) uses to make images and videos.
//
//   studio image "<prompt>" [--engine codex|flow] [--ratio 1:1] [--count 1] [--model <flow model>]
//                           [--cinema "<camera>|<lens>|<focal mm>|<aperture>"] [--ref a.jpg,b.png] [--upscale 2k|4k]
//   studio video "<prompt>" [--seconds N | --model <flow model> --duration 4|6|8|10] [--ratio 16:9|9:16] [--dry] [--no-balance]   x1, 720p (law 34)
//   studio vplan <seconds> [--audio] [--model M] [--quality]   cheapest Flow clips for a length + credits (generates nothing)
//                           [--count 1] [--start-frame <img>] [--end-frame <img>] [--cost <credits>]   --no-balance = run although the Flow balance can't be read
//                           [--studio make|cinema|moves|lipsync|influencer|marketing]  (library/video-studios.json)
//   Laws, router and workflow: STUDIO.md · map of everything: INDEX.md
//   studio laws · studio sec "<words>" · studio where "<topic>" · studio verify <job|brief>
//   studio direct "<owner's words>" [--json]   words → art-direction family + reference recipes (generates nothing)
//   studio vdirect "<owner's words>" [--json]  words → video studio (Video Director, law 25; generates nothing)
//   studio ddirect "<owner's words>" [--json]  words → 3D studio (3D Director, law 32) · studio shot <studio> <scene.blend> [--seconds 4] [--motes] [--wet]
//   studio poster <brief.json> [--dry] [--no-logo] [--logo-place top-right|top-left|bottom-right|bottom-left]
//                 [--logo-overlay]     poster from a brief + a reference recipe; the client's real logo
//                                       (library/clients/<id>/kit.json) is an INPUT with its exact text + font,
//                                       in a corner; --logo-overlay = clear corner + real file pasted after
//   studio ref <product|ingredient|character|location|style|start-frame> "<subject>" [--ref photo.jpg]
//   every make-command takes --client "<name>": files go to outputs/clients/<client>/<date>/
//   studio credits [--ratio 16:9]      read Flow video credit costs (generates nothing)
//   studio jobs [--limit 10]            list recent jobs
//   studio doctor [--quick] [--json]    is every tool installed + signed in? prints the fix (law 37, AGENTS.md)
//   studio pins <search|board|get|related|user|topic> "<query or ref>" [--limit 12, max 30] [--save]
//                                       browse public Pinterest; --save drops the
//                                       originals into the art-direction reference folder as "new"
//   studio unmark <video.mp4> [--out clean.mp4]   remove the visible Veo mark (law 28; auto after every video)
//   studio upscale <image|video> [--to 2k|4k | --scale 2] [--preset ai|restore]   TAN Upscaler engine (law 29); any
//                       make-command takes --upscale 2k|4k and runs it after the job
//   studio blender status | open [scene.blend] | run <script.py> [--file scene.blend] | kit | check <still.png> [--day]
//   studio blender render <scene.blend> [--frame 1 | --frames 1-120] [--engine eevee|cycles|workbench] [--samples 128]
//                         [--ratio 16:9] [--resolution 1080p|1440p|4k] [--device gpu|cpu]   → 3D · Renders
//   studio blender scene <scene.blend> [--title X]                       → 3D · Scenes (copy + preview still)
//   studio blender export <scene.blend> [--format glb|fbx|obj|usdz|blend] → 3D · Models (defaults: Settings → 3D)
//   studio texture find <category> [words] | info <slug> | get <slug> [--size large] | add <file> [--source chatgpt] | list   (law 31)
//
// Every job is written to data/jobs.json and its files to outputs/clients/<client>/<date>/.
// The web board (npm run dev) only reads those two places.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const JOBS = path.join(DATA, 'jobs.json');
const CREDITS = path.join(DATA, 'credits.json');
const CODEX_IMAGES = path.join(os.homedir(), '.codex', 'generated_images');
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i;

// ---------- small helpers ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; } // --ratio=9:16
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// data/jobs.json is shared with the board: every read-modify-write holds data/jobs.json.lock (the board uses the same
// protocol): create it with 'wx' + our pid; busy = retry every 25 ms for up to 3 s; a lock older than 10 s is stale
// (its writer died) and is removed; released in finally. Writes stay atomic (tmp + rename).
const JOBS_LOCK = `${JOBS}.lock`;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withJobsLock(fn) {
  fs.mkdirSync(DATA, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(JOBS_LOCK, 'wx');
      try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try { stale = Date.now() - fs.statSync(JOBS_LOCK).mtimeMs > 10000; } catch { continue; } // gone already: retry
      if (stale) { try { fs.unlinkSync(JOBS_LOCK); } catch {} continue; }
      if (Date.now() - t0 > 3000) throw new Error('data/jobs.json is locked (data/jobs.json.lock held for over 3 s)');
      sleepSync(25);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(JOBS_LOCK); } catch {} }
}

// create: only the job's first write may add it. A job missing later was deleted by the owner (a running card
// deleted on the board): it is never re-added as a partial record; returns null.
function updateJob(id, patch, { create = false } = {}) {
  return withJobsLock(() => {
    const jobs = readJson(JOBS, []);
    const i = jobs.findIndex((j) => j.id === id);
    if (i === -1 && !create) return null;
    if (i === -1) jobs.unshift({ id, ...patch });
    else jobs[i] = { ...jobs[i], ...patch };
    writeJson(JOBS, jobs);
    return jobs[i === -1 ? 0 : i];
  });
}

// Jobs this process set running. A crash, Ctrl-C or kill marks them failed instead of leaving them "running" forever;
// each running record also carries pid (the board marks running jobs of a dead pid failed).
const RUNNING = new Set();
function failRunning(message) {
  for (const id of RUNNING) {
    try { updateJob(id, { status: 'failed', error: String(message || 'stopped').slice(0, 600), finishedAt: new Date().toISOString() }); } catch {}
  }
  RUNNING.clear();
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => { failRunning(`stopped by ${sig}`); process.exit(code); });
}
process.on('uncaughtException', (err) => { console.error(err?.stack || err); failRunning(`crashed: ${err?.message || err}`); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error(err?.stack || err); failRunning(`crashed: ${err?.message || err}`); process.exit(1); });

// Honest render progress (owner 2026-11-14: "there is no accurate prediction. It is stopped at 95"): read Blender's
// own log while it renders and write { done, total, frac } into the job (at most once a second). done = frames saved,
// frac = how far the current frame is (EEVEE "Rendering 40 / 128 samples", Cycles "Sample 40/128"). The board card
// shows done / total and a time-left from the real rate instead of a guess.
function blenderProgress(id, total) {
  let done = 0, frac = 0, last = 0, buf = '';
  const write = (force) => {
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    try { updateJob(id, { progress: { done, total, frac: Math.min(1, (done + frac) / total), at: new Date(now).toISOString() } }); } catch {}
  };
  write(true);
  return (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n|\r/);
    buf = lines.pop();
    for (const line of lines) {
      if (/\bSaved: '/.test(line)) { done = Math.min(total, done + 1); frac = 0; write(true); continue; }
      const m = line.match(/Rendering (\d+) \/ (\d+) samples/) || line.match(/Sample (\d+)\/(\d+)/);
      if (m && +m[2] > 0) { frac = Math.min(0.99, +m[1] / +m[2]); write(false); }
    }
  };
}

function newJobId(type) {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${type}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- clients ----------
// Every job belongs to a client folder: outputs/clients/<id>/<date>/.
// Clients live in library/clients.json; an unknown --client name is added there.

const CLIENTS = path.join(ROOT, 'library', 'clients.json');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';

// write: false = look up only (--dry, verify, before runJob): an unknown name is not added to library/clients.json.
function resolveClient(name, { write = true } = {}) {
  if (!name || name === true) return { id: 'general', name: 'General', note: 'Default folder' };
  const clients = readJson(CLIENTS, []);
  const id = slug(name);
  const found = clients.find((c) => c.id === id || slug(c.name) === id);
  if (found) return found;
  const added = { id, name: String(name), note: '' };
  if (!write) return added;
  writeJson(CLIENTS, [...clients, added]);
  console.log(`new client folder: ${added.name} (${id})`);
  return added;
}

// the Mac's own date (IST), never UTC: a job made at 00:30 local lands in today's folder
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function outDir(clientId = 'general') {
  const dir = path.join(ROOT, 'outputs', 'clients', clientId, localDate());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd || ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; if (opts.echo) process.stdout.write(b); if (opts.onOut) opts.onOut(String(b)); });
    child.stderr.on('data', (b) => { out += b; if (opts.echo) process.stderr.write(b); if (opts.onOut) opts.onOut(String(b)); });
    child.on('error', (err) => resolve({ code: 127, out: String(err) }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(p));
    else found.push(p);
  }
  return found;
}

const rel = (p) => path.relative(ROOT, p);
const tail = (s, n = 600) => s.trim().slice(-n);

// ---------- engines ----------

// One Codex image job at a time: Codex writes into one shared folder and we pick files up by time, so two parallel
// jobs grab each other's images (MISTAKES G03). The lock waits for the other job (stale locks of dead pids are taken).
async function codexLock() {
  const lock = path.join(DATA, '.codex.lock');
  const release = () => { try { if (Number(fs.readFileSync(lock, 'utf8')) === process.pid) fs.rmSync(lock); } catch {} };
  fs.mkdirSync(DATA, { recursive: true });
  for (let i = 0; i < 1800; i++) {
    // atomic create: two jobs can never both see "free" and both write the lock
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return release; } catch (err) { if (err.code !== 'EEXIST') throw err; }
    let pid = null;
    try { pid = Number(fs.readFileSync(lock, 'utf8')); } catch { continue; } // released between our tries: take it now
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; } }
    else { try { alive = Date.now() - fs.statSync(lock).mtimeMs < 5000; } catch { continue; } } // pid not written yet
    if (!alive) {
      // stale (dead pid, or an empty lock that a crash left): remove it only if it is still that same stale lock,
      // then race for it with 'wx' again — whoever creates it first wins
      try { if (Number(fs.readFileSync(lock, 'utf8')) === pid) fs.unlinkSync(lock); } catch {}
      continue;
    }
    if (i === 0) console.log('codex: another image job is running — waiting for it');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('codex lock: waited 30 min');
}

async function codexImage({ id, prompt, ratio, count, refs = [], client }) {
  const unlock = await codexLock();
  try { return await codexImageLocked({ id, prompt, ratio, count, refs, client }); } finally { unlock(); }
}

async function codexImageLocked({ id, prompt, ratio, count, refs = [], client }) {
  const since = Date.now();
  const instruction = [
    `Use your image generation tool to create ${count} image${count > 1 ? 's' : ''}.`,
    ratio ? `Aspect ratio: ${ratio}.` : '',
    refs.length ? `${refs.length} reference image${refs.length > 1 ? 's are' : ' is'} attached; use them as the prompt says.` : '',
    'Pass the image prompt to the tool exactly as written. Do not run shell commands, do not write files, do not ask questions.',
    `Image prompt:\n${prompt}`,
  ].filter(Boolean).join('\n');
  const res = await run('codex', [
    'exec', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--enable', 'image_generation',
    ...refs.map((r) => `--image=${path.resolve(ROOT, r)}`),
    instruction,
  ]);
  const fresh = listFiles(CODEX_IMAGES)
    .filter((f) => MEDIA.test(f) && fs.statSync(f).mtimeMs >= since - 1000)
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  const dir = outDir(client);
  const files = fresh.map((src, n) => {
    const dest = path.join(dir, `${id}-${String(n + 1).padStart(3, '0')}${path.extname(src)}`);
    // straight into our library: MOVE, never leave a copy in Codex's folder (owner 2026-11-15)
    try { fs.renameSync(src, dest); } catch { fs.copyFileSync(src, dest); fs.rmSync(src, { force: true }); }
    try { fs.rmdirSync(path.dirname(src)); } catch {} // Codex's per-session folder, only when now empty
    return rel(dest);
  });
  return { ok: files.length > 0, files, log: tail(res.out) };
}

async function flowJob(kind, { id, prompt, ratio, count, model, duration, resolution, startFrame, endFrame, upscale, client, keepPanel, flowSeconds, flowExpect, flowMake, flowUpscale, flowControl }) {
  const dir = outDir(client);
  // law 35: clips from a start / end frame run on our own Frames runner (Flow's frame picker changed and gflow's upload
  // broke 2026-11-15); it also downloads Flow's free upscale directly
  if (kind === 'video' && (startFrame || endFrame)) {
    const pf = path.join(dir, `.${id}.prompt.txt`);
    fs.writeFileSync(pf, prompt);
    const name = `${id}-001.mp4`;
    const res = await run('node', [path.join(ROOT, 'tools', 'flow', 'frames.mjs'), '--prompt-file', pf,
      ...(startFrame ? ['--start', path.resolve(startFrame)] : []), ...(endFrame ? ['--end', path.resolve(endFrame)] : []),
      // resolution + length always set on models that have them (the panel keeps the last choice, so a native 720p clip
      // must say 720p); fixed-length Veo models offer neither, as in tools/flow/set.mjs
      '--model', model, '--ratio', ratio || '16:9', ...(flowControl !== 'fixed' && flowMake ? ['--res', flowMake] : []),
      ...(flowControl !== 'fixed' && flowSeconds ? ['--seconds', String(flowSeconds)] : []),
      '--expect', String(flowExpect), '--dir', dir, '--name', name, '--download', flowUpscale || 'original'], { echo: true });
    fs.rmSync(pf, { force: true });
    let r = null; try { r = JSON.parse(res.out.trim().split('\n').pop()); } catch {}
    return { ok: !!r?.ok, files: r?.ok ? [rel(r.file)] : [], log: r?.error ? `${r.stage}: ${r.error}` : tail(res.out), upscaledByFlow: !!(r?.ok && flowUpscale) };
  }
  const args = [kind, '--id', id, '--prompt', prompt, '--out', dir, '--outputs', String(count)];
  if (model && !keepPanel) args.push('--model', model); // keepPanel: set.mjs already chose the model (Omni 1.2 slider, Veo Lite)
  if (ratio) args.push('--ratio', ratio);
  if (duration) args.push('--duration', String(duration));
  if (resolution) args.push('--resolution', resolution);
  if (startFrame) args.push('--start-frame', path.resolve(startFrame));
  if (endFrame) args.push('--end-frame', path.resolve(endFrame));
  if (upscale) args.push('--upscale', upscale);
  const res = await run('gflow', args, { echo: true });
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${id}-`) && MEDIA.test(f))
    .sort()
    .map((f) => rel(path.join(dir, f)));
  return { ok: res.code === 0 && files.length > 0, files, log: tail(res.out) };
}

// ---------- commands ----------

async function runJob({ type, engine, title, prompt, refs = [], meta = {}, cost = null, client: clientName, after, noBalance = false, ...opts }) {
  const id = newJobId(type);
  const client = resolveClient(clientName);
  opts.client = client.id;
  // law 29: --upscale 2k|4k runs TAN Upscaler here after the job (free, local); Flow's own upscale only when
  // Settings → Upscaler says Flow and the job is a Flow job
  const upTo = opts.upscale && opts.upscale !== true ? String(opts.upscale).toLowerCase() : null;
  const upLocal = upTo && !(engine === 'flow' && SETTINGS.upscale.engine === 'flow');
  if (upLocal) delete opts.upscale;
  updateJob(id, {
    client: client.id,
    type, engine, model: opts.model || (engine === 'codex' ? 'ChatGPT image' : 'Flow default'),
    prompt: title || prompt, fullPrompt: prompt, refs, ...meta,
    ratio: opts.ratio || null, count: opts.count, cost,
    status: 'running', files: [], createdAt: new Date().toISOString(), pid: process.pid,
  }, { create: true });
  RUNNING.add(id);
  console.log(`job ${id} started (${type}, ${engine}, client ${client.name})`);

  // law 34: every Flow job reads the balance before and after, so each job knows what it really cost
  const before = engine === 'flow' ? await flowBalance() : null;
  const refuse = (error) => {
    updateJob(id, { status: 'failed', error, finishedAt: new Date().toISOString() });
    RUNNING.delete(id);
    throw new Error(`${error} — nothing generated.`);
  };
  // an unread balance never skips the "dearer than the balance" check: refuse, unless the owner said --no-balance
  if (before && before.credits == null && !noBalance) refuse(`Flow balance could not be read (${before.error || 'no reading'}); open the signed-in Flow window and retry, or pass --no-balance to run without the check`);
  if (before?.credits != null && cost != null && cost > before.credits) refuse(`needs ${cost} credits, balance ${before.credits}`);

  let result;
  try {
    result = engine === 'codex'
      ? await codexImage({ id, prompt, refs, ...opts })
      : await flowJob(type, { id, prompt, ...opts });
  } catch (err) {
    result = { ok: false, files: [], log: String(err) };
  }

  // law 34: Flow's own free upscale of a 360p clip → 720p, straight into the library; the 360p original goes to .raw/.
  // The upscale must download THIS job's clip (MISTAKES G06): gflow keeps no clip identity, so tools/flow/upscale.mjs
  // only takes a clip that is the one video in the open project and refuses to guess otherwise (several takes, an
  // older clip next to ours, a parallel job). Failed = the job fails; raw 360p is never shown (law 34(3)).
  if (result.ok && engine === 'flow' && opts.flowUpscale && !result.upscaledByFlow) {
    result.flowUpscale = [];
    const shown = [];
    for (const f of result.files) {
      const abs = path.join(ROOT, f);
      const raw = path.join(path.dirname(abs), '.raw');
      fs.mkdirSync(raw, { recursive: true });
      const keep = path.join(raw, path.basename(abs).replace(/(\.\w+)$/, `-${opts.flowMake || '360p'}$1`));
      let r = null, upOut = '';
      if (result.files.length > 1) r = { ok: false, error: `${result.files.length} takes and no clip identity from gflow — refusing to guess which Flow clip is ${path.basename(abs)}` };
      else {
        const up = await run('node', [path.join(ROOT, 'tools', 'flow', 'upscale.mjs'), '--dir', path.dirname(abs), '--name', `${path.basename(abs)}.up.mp4`, '--tier', opts.flowUpscale]);
        upOut = up.out;
        try { r = JSON.parse(up.out.trim().split('\n').pop()); } catch {}
      }
      if (r?.ok) {
        fs.renameSync(abs, keep);
        fs.renameSync(r.file, abs);
        shown.push(f);
        result.flowUpscale.push({ file: f, tier: opts.flowUpscale, seconds: r.seconds, raw: rel(keep) });
        console.log(`flow upscale: ${opts.flowUpscale} in ${r.seconds} s · 360p original in ${rel(raw)}/`);
      } else {
        fs.renameSync(abs, keep);
        const why = r?.error || tail(upOut, 200) || 'no report';
        result.flowUpscale.push({ file: f, error: why, raw: rel(keep) });
        result.ok = false;
        result.log = [result.flowUpscale.filter((u) => u.error).map((u) => `upscale failed for ${path.basename(u.file)} (${u.error})`).join('; '),
          `${opts.flowMake || '360p'} kept in ${rel(raw)}/ — rerun upscale (node tools/flow/upscale.mjs --dir … --name … --tier ${opts.flowUpscale})`].join('; ');
        console.error(`flow upscale failed (${why}) — ${opts.flowMake || '360p'} clip kept in ${rel(raw)}/, not shown`);
      }
    }
    result.files = shown;
  }

  // law 28: every new video loses the visible Veo mark (Settings → Video), original kept in .raw/
  if (result.ok && type === 'video' && SETTINGS.video.removeWatermark !== false) {
    result.unmark = [];
    for (const f of result.files) result.unmark.push(await unmarkFile(path.join(ROOT, f)));
  }

  // a failed post-process (the overlay logo paste) fails the job: never "done" with a logo the file does not carry
  let afterFailed = false;
  if (result.ok && after) {
    try { await after(result.files); } catch (err) {
      console.error(`post-process failed: ${err.message}`);
      afterFailed = true; result.ok = false; result.log = `post-process failed: ${err.message}`;
    }
  }

  // last step, after the watermark and the logo, so the larger file is the finished one
  if (result.ok && upLocal) {
    result.upscale = [];
    for (const f of result.files) result.upscale.push(await upscaleFile(path.join(ROOT, f), upTo));
    // a .jpg / .webp comes back as .png (the original moved to .raw/): the job lists the file that exists now
    result.files = result.files.map((f, i) => (result.upscale[i]?.ok ? result.upscale[i].file : f));
  }

  let spend = null;
  if (engine === 'flow') {
    const now = await flowBalance();
    spend = { expected: cost, before: before?.credits ?? null, after: now.credits ?? null,
      spent: before?.credits != null && now.credits != null ? before.credits - now.credits : null };
    const st = readJson(FLOW_STATE, { history: [] });
    st.history = [...(st.history || []), { job: id, at: new Date().toISOString(), model: opts.model || null, ...spend }].slice(-500);
    writeJson(FLOW_STATE, st);
    console.log(`credits: ${spend.spent ?? '?'} spent (expected ${cost ?? '?'}) · balance ${spend.after ?? '?'}`);
  }

  const job = updateJob(id, {
    ...(spend ? { credits: spend } : {}),
    ...(afterFailed && meta.logo ? { logo: null } : {}),
    status: result.ok ? 'done' : 'failed',
    files: result.files,
    error: result.ok ? null : result.log,
    ...(result.unmark ? { unmark: result.unmark } : {}),
    ...(result.flowUpscale ? { flowUpscale: result.flowUpscale } : {}),
    ...(result.upscale ? { upscale: result.upscale } : {}),
    finishedAt: new Date().toISOString(),
  });
  RUNNING.delete(id);
  console.log(job ? JSON.stringify({ ...job, fullPrompt: undefined }, null, 2) : `job ${id} is no longer in data/jobs.json (deleted on the board) — files: ${result.files.join(', ') || 'none'}`);
  process.exitCode = result.ok ? 0 : 1;
}

// Owner defaults from the board's Settings panel (data/settings.json); flags always win.
// Same defaults as lib/settings.js, so the panel and the CLI always agree.
const SAVED = readJson(path.join(DATA, 'settings.json'), {});
const SETTINGS = {
  image: { engine: 'codex', ratio: '4:5', ...SAVED.image },
  video: { ratio: '16:9', resolution: '720p', removeWatermark: true, ...SAVED.video },
  upscale: { engine: 'tan', preset: 'ai', ...SAVED.upscale },
  blender: {
    bridge: 'live', engine: 'eevee', device: 'gpu', samples: 128, ratio: '16:9', resolution: '1080p', fps: 30, export: 'glb',
    fullAccess: true, openBlender: true, saveBlend: true, lookEachStep: true, askBeforeGenerate: true, ...SAVED.blender,
  },
};

const optRatio = (args, fallback) => (args.ratio && args.ratio !== true ? args.ratio : fallback);
const optList = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

async function generate(type, args) {
  let prompt = args._.slice(1).join(' ').trim();
  if (!prompt) throw new Error(`Missing prompt. Usage: studio ${type} "<prompt>" [options]`);

  if (args.cinema) {
    const { buildCinemaPrompt } = await import(path.join(ROOT, 'library', 'cinema.mjs'));
    const [camera, lens, focal, aperture] = String(args.cinema).split('|').map((s) => s.trim());
    prompt = buildCinemaPrompt(prompt, camera, lens, Number(focal) || 35, aperture || 'f/4');
  }
  // law 34: Flow video is driven, not guessed — x1, the cheapest clip in budget for the exact length, the studio's
  // preferred models, and the panel's own price checked (tools/flow/set.mjs) before gflow generates anything.
  let flow = {};
  // Flow video makes 16:9 or 9:16 only (law 1: the owner's ratio is final) — anything else stops before any panel action
  const videoRatio = type === 'video' ? String(optRatio(args, SETTINGS.video?.ratio) || '16:9') : null;
  if (type === 'video' && !['16:9', '9:16'].includes(videoRatio)) throw new Error(`Flow video is 16:9 or 9:16 only — got --ratio ${videoRatio}. Ask the owner which one.`);
  if (type === 'video') {
    const count = Math.max(1, Number(args.count) || 1);
    if (count > 1 && !args.many) throw new Error('Flow video is always x1 (law 34). Add --many only when the owner asked for several takes.');
    const seconds = Math.round(Number(String(args.seconds || args.duration || 8).replace(/s$/, ''))) || 8;
    const plan = planVideo(seconds, planOptions(args));
    if (plan.clips.length > 1) {
      // --dry (and --no-balance) never touch Flow: no CDP, no data/flow.json write (MISTAKES G01)
      const skip = args.dry ? 'dry' : args['no-balance'] ? '--no-balance' : null;
      printPlan(plan, skip ? null : await flowBalance(), args);
      if (skip) console.log(`balance: not checked (${skip})`);
      console.log('More than one clip: make each shot with its own prompt (commands above), then join them in Edit.');
      return;
    }
    const c = plan.clips[0];
    flow = { model: c.model, seconds: c.seconds, res: c.make || c.res, upscale: c.upscale || null, route: c.route || c.res, control: c.control, expected: c.credits * count, count, excess: plan.excess,
      input: args['start-frame'] || args['end-frame'] ? 'frames' : 'ingredients' };
  }
  // --dry prints the final prompt and makes nothing (MISTAKES G01: a test once ran a real job because --dry was ignored)
  if (args.dry) {
    console.log(`${type} (dry, nothing made):\n${prompt}`);
    if (type === 'video') console.log(`flow: ${flow.model} · ${flow.seconds} s${flow.excess ? ` (${flow.excess} s to trim)` : ''} · ${flow.route} · ${flow.input} · x${flow.count} · ${flow.expected} credits`);
    return;
  }
  if (type === 'video' && !args['start-frame'] && !args['end-frame']) { // frames jobs check the price inside tools/flow/frames.mjs
    // put the panel on exactly this choice and read its price; a different price = stop, generate nothing
    const set = await run('node', [path.join(ROOT, 'tools', 'flow', 'set.mjs'), '--model', flow.model, '--input', flow.input, '--ratio', videoRatio,
      ...(flow.control === 'fixed' ? [] : ['--res', flow.res, '--seconds', String(flow.seconds)]), '--expect', String(flow.expected / flow.count)]);
    let r = null; try { r = JSON.parse(set.out.trim().split('\n').pop()); } catch {}
    if (!r?.ok) throw new Error(`Flow panel price check failed (${r?.error || `panel says ${r?.credits} credits, expected ${flow.expected / flow.count}`}) — nothing generated.`);
    console.log(`flow panel: ${r.trigger} · ${r.credits} credits`);
  }

  await runJob({
    type,
    engine: type === 'video' ? 'flow' : (args.engine || SETTINGS.image.engine || 'codex'),
    prompt,
    refs: optList(args.ref),
    meta: args.studio && args.studio !== true ? { studio: String(args.studio) } : {}, // Video sidebar page (law 25)
    client: args.client,
    noBalance: !!args['no-balance'],
    cost: args.cost ? Number(args.cost) : (type === 'video' ? flow.expected : null),
    ratio: type === 'video' ? videoRatio : optRatio(args, SETTINGS[type]?.ratio),
    count: type === 'video' ? flow.count : Math.max(1, Number(args.count) || 1),
    model: type === 'video' ? flow.model : args.model,
    // the panel is already set (tools/flow/set.mjs); gflow keeps it — only Omni 1.1's length buttons are passed again
    duration: type === 'video' ? (flow.control === 'buttons' ? String(flow.seconds) : undefined) : args.duration,
    resolution: type === 'video' ? (flow.control === 'buttons' ? flow.res : undefined) : args.resolution,
    keepPanel: type === 'video' && flow.control !== 'buttons',
    flowUpscale: type === 'video' ? flow.upscale : null,
    flowMake: type === 'video' ? flow.res : null,
    flowSeconds: type === 'video' ? flow.seconds : null,
    flowExpect: type === 'video' ? flow.expected / flow.count : null,
    flowControl: type === 'video' ? flow.control : null,
    startFrame: args['start-frame'],
    endFrame: args['end-frame'],
    upscale: args.upscale,
  });
}

// ---------- Blender (3D, law 24) ----------
// Two bridges: the live Blender (MCP tools in Claude Code) and the headless CLI here.
// Settings → 3D holds the defaults (engine, device, samples, ratio, resolution, fps, export).

const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const SHORT_SIDE = { '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 };

function blenderSize(ratio, resolution) {
  const [a, b] = String(ratio).split(':').map(Number);
  const short = SHORT_SIDE[resolution] || 1080;
  const even = (n) => Math.round(n / 2) * 2;
  return a >= b ? [even((short * a) / b), short] : [short, even((short * b) / a)];
}

// Python run inside Blender before a render: engine (read, never hardcode the enum), size, samples, device.
function blenderSetup({ engine, device, samples, width, height, fps }) {
  return [
    'import bpy',
    's = bpy.context.scene',
    `want = ${JSON.stringify({ eevee: ['BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'], cycles: ['CYCLES'], workbench: ['BLENDER_WORKBENCH'] }[engine] || ['BLENDER_EEVEE'])}`,
    'for e in want:',
    '    try:',
    '        s.render.engine = e; break',
    '    except TypeError: pass',
    `s.render.resolution_x = ${width}; s.render.resolution_y = ${height}; s.render.resolution_percentage = 100`,
    `s.render.fps = ${fps}`,
    "if s.render.engine == 'CYCLES':",
    `    s.cycles.samples = ${samples}`,
    `    if ${device === 'gpu' ? 'True' : 'False'}:`,
    '        try:',
    "            p = bpy.context.preferences.addons['cycles'].preferences",
    "            p.compute_device_type = 'METAL'; p.get_devices()",
    '            for d in p.devices: d.use = True',
    "            s.cycles.device = 'GPU'",
    '        except Exception as ex: print("GPU off:", ex)',
    'else:',
    '    try:',
    `        s.eevee.taa_render_samples = ${samples}`,
    '    except Exception: pass',
    "print('studio-setup', s.render.engine, s.render.resolution_x, s.render.resolution_y)",
  ].join('\n');
}

const EXPORT_PY = {
  glb: (f) => `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(f)}, export_format='GLB')`,
  fbx: (f) => `bpy.ops.export_scene.fbx(filepath=${JSON.stringify(f)})`,
  obj: (f) => `bpy.ops.wm.obj_export(filepath=${JSON.stringify(f)})`,
  usdz: (f) => `bpy.ops.wm.usd_export(filepath=${JSON.stringify(f)})`,
  blend: (f) => `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(f)}, copy=True)`,
};

// A 3D job (law 24). kind = render (still or animation) · scene (a saved .blend) · model (an export).
// files = what the board shows (render PNG / MP4, or a preview still); assets = the .blend / model file.
function blenderJob(kind, file, args, extra = {}) {
  const client = resolveClient(args.client);
  const id = newJobId('model');
  const title = args.title && args.title !== true ? String(args.title) : null;
  updateJob(id, {
    client: client.id, type: 'model', kind, engine: 'blender', refs: [], count: 1, cost: null,
    source: rel(file), status: 'running', files: [], assets: [], createdAt: new Date().toISOString(), pid: process.pid,
    prompt: title || `${path.basename(file, '.blend')}`, ...extra,
  }, { create: true });
  RUNNING.add(id);
  console.log(`job ${id} started (3D ${kind}, blender, client ${client.name})`);
  return { id, client, dir: outDir(client.id) };
}

// A quick EEVEE still of a scene (16 samples, 720p) for Scenes / Models cards.
async function blenderPreview(file, dir, id) {
  const [width, height] = blenderSize(SETTINGS.blender.ratio, '720p');
  const res = await run(BLENDER, [
    '-b', file, '--python-exit-code', '1',
    '--python-expr', blenderSetup({ engine: 'eevee', device: SETTINGS.blender.device, samples: 16, width, height, fps: SETTINGS.blender.fps }),
    '-o', path.join(dir, `${id}-preview-#`), '-F', 'PNG', '-x', '1', '-f', '1',
  ]);
  const png = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-preview-`) && f.endsWith('.png'));
  if (!png) { console.error(`preview failed: ${tail(res.out, 300)}`); return null; }
  const dest = path.join(dir, `${id}.png`);
  fs.renameSync(path.join(dir, png), dest);
  return rel(dest);
}

function finishJob(id, ok, patch, out) {
  const job = updateJob(id, { status: ok ? 'done' : 'failed', error: ok ? null : tail(out || ''), finishedAt: new Date().toISOString(), ...patch });
  RUNNING.delete(id);
  console.log(job ? JSON.stringify({ ...job, fullPrompt: undefined }, null, 2) : `job ${id} is no longer in data/jobs.json (deleted on the board)`);
  process.exitCode = ok ? 0 : 1;
  return job;
}

async function blender(args) {
  const sub = args._[1] || 'status';
  const B = SETTINGS.blender;
  const file = args._[2] && args._[2] !== true ? path.resolve(String(args._[2])) : null;
  if (!fs.existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER} (set BLENDER=/path/to/Blender)`);

  if (sub === 'status') {
    const v = await run(BLENDER, ['--version']);
    const live = await run('pgrep', ['-f', 'Blender.app/Contents/MacOS/Blender']);
    console.log(`${v.out.split('\n')[0]} · ${BLENDER}`);
    console.log(`running: ${live.code === 0 ? 'yes (live bridge: MCP tools)' : 'no'}`);
    console.log(`settings: ${JSON.stringify(B)}`);
    return;
  }
  if (sub === 'open') {
    if (!B.openBlender && !args.force) throw new Error('Settings → 3D: "Claude may open Blender" is off (add --force only if the owner says so)');
    const res = await run('open', ['-a', 'Blender', ...(file ? [file] : [])]);
    console.log(res.code === 0 ? `Blender opened${file ? ` with ${rel(file)}` : ''}` : res.out);
    return;
  }
  if (sub === 'run') {
    // studio blender run <script.py> [--file scene.blend] — headless Python with the full bpy API
    if (!file) throw new Error('Usage: studio blender run <script.py> [--file scene.blend]');
    const blend = args.file && args.file !== true ? [path.resolve(String(args.file))] : ['--factory-startup'];
    const res = await run(BLENDER, ['-b', ...blend, '--python-exit-code', '1', '--python', file], { echo: true });
    process.exitCode = res.code;
    return;
  }
  if (sub === 'check') {
    // studio blender check <still.png> [--day] — exposure / colour QC on a render (law 30, step 6 gate)
    const stills = args._.slice(2).filter((x) => x !== true).map((x) => path.resolve(String(x)));
    if (!stills.length) throw new Error('Usage: studio blender check <still.png> [more.png] [--day]');
    const res = await run('python3', [path.join(ROOT, 'tools', 'blender', 'exposure_check.py'), ...(args.day ? ['--day'] : []), ...stills], { echo: true });
    process.exitCode = res.code;
    return;
  }
  if (sub === 'kit') {
    // studio blender kit — the two lines that load tools/blender/kit.py in any Blender script or MCP call
    console.log(`import sys; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'blender'))})\nfrom kit import *`);
    return;
  }
  if (sub === 'scene') {
    // studio blender scene <scene.blend> [--title X] [--client X] — keep a .blend on the board (Scenes page)
    if (!file || !fs.existsSync(file)) throw new Error('Usage: studio blender scene <scene.blend> [--title X] [--client X]');
    const { id, dir } = blenderJob('scene', file, args, { model: 'Blender scene', fullPrompt: rel(file) });
    const copy = path.join(dir, `${id}.blend`);
    fs.copyFileSync(file, copy);
    const preview = await blenderPreview(file, dir, id);
    finishJob(id, true, { files: preview ? [preview] : [], assets: [rel(copy)] });
    return;
  }
  if (sub === 'export') {
    // studio blender export <scene.blend> [--format glb|fbx|obj|usdz|blend] [--title X] [--client X] — Models page
    if (!file) throw new Error('Usage: studio blender export <scene.blend> [--format glb]');
    const fmt = args.format && args.format !== true ? String(args.format) : B.export;
    if (!EXPORT_PY[fmt]) throw new Error(`Unknown format ${fmt} (glb, fbx, obj, usdz, blend)`);
    const { id, dir } = blenderJob('model', file, args, { model: `Blender · ${fmt.toUpperCase()}`, format: fmt, fullPrompt: `${rel(file)} → ${fmt}` });
    const out = path.join(dir, `${path.basename(file, '.blend')}-${id.slice(-4)}.${fmt}`);
    const res = await run(BLENDER, ['-b', file, '--python-exit-code', '1', '--python-expr', `import bpy\n${EXPORT_PY[fmt](out)}`]);
    const ok = res.code === 0 && fs.existsSync(out);
    const preview = ok ? await blenderPreview(file, dir, id) : null;
    finishJob(id, ok, { files: preview ? [preview] : [], assets: ok ? [rel(out)] : [] }, res.out);
    if (ok) console.log(`exported → ${rel(out)}`);
    return;
  }
  if (sub === 'render') {
    // studio blender render <scene.blend> [--frame 1 | --frames 1-120] [--engine eevee|cycles|workbench] [--samples 128]
    //                       [--ratio 16:9] [--resolution 1080p|1440p|4k] [--device gpu|cpu] [--title X] [--client X]
    if (!file) throw new Error('Usage: studio blender render <scene.blend> [--frame 1 | --frames 1-120] [--engine eevee|cycles|workbench]');
    const ratio = optRatio(args, B.ratio);
    const resolution = args.resolution && args.resolution !== true ? String(args.resolution) : B.resolution;
    const [width, height] = blenderSize(ratio, resolution);
    const opt = {
      engine: args.engine && args.engine !== true ? String(args.engine) : B.engine,
      device: args.device && args.device !== true ? String(args.device) : B.device,
      samples: Number(args.samples) || B.samples, width, height, fps: Number(args.fps) || B.fps,
    };
    const range = args.frames && args.frames !== true ? String(args.frames).match(/^(\d+)-(\d+)$/) : null;
    if (args.frames && !range) throw new Error('--frames takes a range, e.g. --frames 1-120');
    const frame = Number(args.frame) || 1;
    const what = range ? `frames ${range[1]}–${range[2]}` : `frame ${frame}`;
    const { id, dir } = blenderJob('render', file, args, {
      model: `Blender ${opt.engine}`, ratio, animation: !!range,
      ...(args.studio && args.studio !== true ? { studio: String(args.studio) } : {}), // 3D Director page (law 32)
      prompt: args.title && args.title !== true ? String(args.title) : `Render ${path.basename(file, '.blend')} · ${what}`,
      fullPrompt: `${rel(file)} · ${what} · ${opt.engine} · ${opt.samples} samples · ${width}×${height} · ${opt.fps} fps · ${opt.device}`,
    });
    const res = await run(BLENDER, [
      '-b', file, '--python-exit-code', '1', '--python-expr', blenderSetup(opt),
      '-o', path.join(dir, `${id}-####`), '-F', 'PNG', '-x', '1',
      ...(range ? ['-s', range[1], '-e', range[2], '-a'] : ['-f', String(frame)]),
    ], { echo: !!args.verbose, onOut: blenderProgress(id, range ? Number(range[2]) - Number(range[1]) + 1 : 1) });
    let files = fs.readdirSync(dir).filter((f) => /^\S+-\d{4}\.png$/.test(f) && f.startsWith(`${id}-`)).sort().map((f) => path.join(dir, f));
    let out = res.out;
    if (range && files.length) {
      // an animation: PNG frames → one H.264 MP4 at the scene fps; frames kept in .raw/ (hidden from the board)
      const mp4 = path.join(dir, `${id}.mp4`);
      const ff = await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(opt.fps), '-start_number', range[1],
        '-i', path.join(dir, `${id}-%04d.png`), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', mp4]);
      if (ff.code === 0 && fs.existsSync(mp4)) {
        const raw = path.join(dir, '.raw', `${id}-frames`);
        fs.mkdirSync(raw, { recursive: true });
        for (const f of files) fs.renameSync(f, path.join(raw, path.basename(f)));
        files = [mp4];
      } else { out += `\nffmpeg: ${ff.out}`; files = []; }
    }
    const assets = [];
    if (files.length && B.saveBlend) {
      const copy = path.join(dir, `${id}.blend`);
      fs.copyFileSync(file, copy);
      assets.push(rel(copy));
    }
    finishJob(id, res.code === 0 && files.length > 0, { files: files.map(rel), assets }, out);
    return;
  }
  throw new Error('Usage: studio blender <status|open [file.blend]|run <script.py>|kit|check <still.png>|scene <file.blend>|render <file.blend>|export <file.blend>>');
}

// ---------- 3D Director (law 32) ----------
// Our 3D shot types as studios (library/3d-studios.json). ddirect = owner words -> studio,
// shot = build that studio's camera / light / motion on a finished model (tools/blender/shots.py) and render it.
const STUDIOS_3D = path.join(ROOT, 'library', '3d-studios.json');

function ddirect(args) {
  const words = args._.slice(1).join(' ').trim().toLowerCase();
  if (!words) throw new Error('Usage: studio ddirect "<owner\'s words>" [--json]');
  const { studios } = readJson(STUDIOS_3D, { studios: [] });
  const ranked = studios.map((s) => {
    const has = (w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(words);
    const hits = (s.words || []).filter(has);
    const score = hits.reduce((n, w) => n + w.split(' ').length, 0) + (has(s.label) ? 3 : 0);
    return { id: s.id, label: s.label, group: s.group, status: s.status, score, hits, command: s.command, note: s.note, source: s.source };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  if (args.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
  if (!ranked.length) { console.log('no 3D studio matched — default: packshot (a still). Ask the owner if a moving shot is wanted.'); return; }
  for (const r of ranked.slice(0, 3)) {
    console.log(`${r.label} [${r.id}] · ${r.group} · ${r.status} · words: ${r.hits.join(', ')}`);
    console.log(`  from source: ${r.source}${r.note ? `\n  note: ${r.note}` : ''}`);
    console.log(r.command ? `  run: ${r.command}` : '  not built yet — build it in tools/blender/shots.py when the owner asks');
  }
}

async function shot(args) {
  // studio shot <studio> <scene.blend> [--seconds 4] [--motes] [--wet] [--turns 0.5] [--hero Name] [--samples N] [--title X] [--client X]
  // studio shot title --text "WORD" [--font file.ttf] …
  const sid = args._[1];
  const { studios } = readJson(STUDIOS_3D, { studios: [] });
  const st = studios.find((s) => s.id === sid);
  if (!st) throw new Error(`Usage: studio shot <${studios.filter((s) => s.status !== 'none' && s.kind !== 'env' && s.kind !== 'fx').map((s) => s.id).join('|')}> <scene.blend>`);
  if (st.status === 'none') throw new Error(`${st.label} is not built yet (${st.source}). Ask the owner, then add it to tools/blender/shots.py.`);
  if (st.kind === 'env' || st.kind === 'fx') throw new Error(`${st.label} is an add-on: ${st.command}`);
  if (st.status === 'partial') console.log(`note: ${st.note}`);
  const file = sid === 'title' ? null : (args._[2] && args._[2] !== true ? path.resolve(String(args._[2])) : null);
  if (sid !== 'title' && (!file || !fs.existsSync(file))) throw new Error(`Usage: studio shot ${sid} <scene.blend> — a finished model first (law 30)`);
  if (sid === 'title' && (!args.text || args.text === true)) throw new Error('Usage: studio shot title --text "WORD" [--font file.ttf]');
  const client = resolveClient(args.client);
  const tmp = path.join(outDir(client.id), `shot-${sid}-${Date.now().toString(36)}.blend`);
  const pass = ['--out', tmp];
  for (const k of ['seconds', 'turns', 'hero', 'text', 'font', 'fps']) if (args[k] !== undefined && args[k] !== true) pass.push(`--${k}`, String(args[k]));
  for (const k of ['motes', 'wet']) if (args[k]) pass.push(`--${k}`);
  if (!args.fps) pass.push('--fps', String(SETTINGS.blender.fps));
  const res = await run(BLENDER, [...(file ? ['-b', file] : ['-b', '--factory-startup']), '--python-exit-code', '1',
    '--python', path.join(ROOT, 'tools', 'blender', 'shots.py'), '--', sid, ...pass], { echo: !!args.verbose });
  const m = res.out.match(/\[shot\] \S+ frames (\d+)/);
  if (res.code !== 0 || !m || !fs.existsSync(tmp)) throw new Error(`shot ${sid} failed:\n${tail(res.out)}`);
  const n = Number(m[1]);
  const title = args.title && args.title !== true ? String(args.title)
    : `${st.label} · ${sid === 'title' ? String(args.text) : path.basename(file, '.blend')}`;
  // animations render at 16 samples by default (measured 2026-11-14: same look as 64, 4x faster, ~1.6 s a 1080p frame)
  const samples = args.samples && args.samples !== true ? String(args.samples) : (n > 1 ? '16' : undefined);
  const rargs = { ...args, _: ['blender', 'render', tmp], studio: sid, title, client: client.name,
    ...(n > 1 ? { frames: `1-${n}` } : { frame: '1' }), ...(samples ? { samples } : {}) };
  console.log(`shot ${sid}: ${n > 1 ? `${n} frames (${(n / (Number(args.fps) || SETTINGS.blender.fps)).toFixed(1)} s)` : 'one still'} · rendering…`);
  await blender(rargs);
  try { fs.unlinkSync(tmp); } catch {} // the render job keeps its own copy of the .blend
}

// ---------- textures (law 31) ----------
// Texturelabs.org (free for commercial use, no credit needed) on the owner's request, ONE texture at a time:
//   find  = read their category pages (cached a day) and rank textures by the words
//   get   = the download is a button on the texture page: Claude opens that page in the owner's Chrome and clicks it
//           like a person (their FAQ forbids scripts that auto-download, so never a script, never bulk)
//   add   = file from ~/Downloads (or a ChatGPT-made texture) -> library/textures/<source>/<slug>/ + meta.json
// Texturelabs rules kept in meta: never redistributed (not inside a GLB we hand out), never fed to AI image models.
const TEXTURES = path.join(ROOT, 'library', 'textures');
const TL = 'https://texturelabs.org';
const TL_CATS = { atmosphere: 744, brick: 695, concrete: 693, details: 719, fabric: 675, film: 681, glass: 732, grunge: 663,
  ink: 669, paint: 669, lens: 688, metal: 697, paper: 666, sky: 737, soil: 705, stone: 724, vector: 792, water: 735, wood: 673 };
const TL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function tlPage(url) {
  const dir = path.join(ROOT, '.run', 'texturelabs');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${url.replace(/[^a-z0-9]+/gi, '_').slice(-120)}.html`);
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 86400000) return fs.readFileSync(f, 'utf8');
  const r = await fetch(url, { headers: { 'User-Agent': TL_UA } });
  if (!r.ok) throw new Error(`texturelabs ${r.status} for ${url}`);
  const html = await r.text();
  fs.writeFileSync(f, html);
  await new Promise((ok) => setTimeout(ok, 800)); // gentle: one page at a time
  return html;
}

function tlCards(html) {
  const out = [];
  const re = /data-value="([a-z]+_\d+)"[\s\S]*?alt="([^"]*)"[\s\S]*?<div class="light">\s*<i>([^<]*)<\/i>/g;
  for (let m; (m = re.exec(html));) out.push({ slug: m[1], desc: m[2], label: m[3].trim(), page: `${TL}/textures/${m[1]}/` });
  return out;
}

async function texture(args) {
  const sub = args._[1] || 'list';
  if (sub === 'find') {
    // studio texture find <category> [words…]   e.g. studio texture find wood teak clean boards
    const words = args._.slice(2).map(String).map((w) => w.toLowerCase());
    const cat = words.shift();
    if (!TL_CATS[cat]) throw new Error(`Usage: studio texture find <${Object.keys(TL_CATS).join('|')}> [words]`);
    const home = await tlPage(`${TL}/?ct=${TL_CATS[cat]}`);
    const subs = [...home.matchAll(new RegExp(`\\?ct=${TL_CATS[cat]}&(?:amp;)?st=(\\d+)">(?:\\s*<div[^>]*>)?\\s*([^<(]+?)\\s*(?:\\((\\d+)\\))?\\s*<`, 'g'))]
      .map((m) => ({ st: m[1], name: m[2].trim().toLowerCase(), n: m[3] }));
    const pages = [`${TL}/?ct=${TL_CATS[cat]}`];
    for (const s of subs) if (words.some((w) => s.name.includes(w))) pages.push(`${TL}/?ct=${TL_CATS[cat]}&st=${s.st}`);
    const seen = new Map();
    for (const u of pages) for (const c of tlCards(await tlPage(u))) seen.set(c.slug, c);
    const score = (c) => words.reduce((n, w) => n + (`${c.desc} ${c.label}`.toLowerCase().includes(w) ? 1 : 0), 0);
    const list = [...seen.values()].map((c) => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score).slice(0, Number(args.limit) || 12);
    if (subs.length) console.log(`subcategories: ${subs.map((s) => `${s.name}${s.n ? ` (${s.n})` : ''}`).join(' · ')}`);
    for (const c of list) console.log(`${c.slug.padEnd(12)} ${String(c.score).padStart(1)}  ${c.label} — ${c.desc}\n             ${c.page}`);
    console.log('\nNext: open the page in Chrome, click ONE size (large = 4K), then: studio texture add ~/Downloads/<file> --page <url>');
    return;
  }
  if (sub === 'info') {
    // studio texture info <slug|url> — title, description, sizes from the texture page (no download)
    const slug = String(args._[2] || '').replace(/^.*\/textures\//, '').replace(/\/$/, '');
    const html = await tlPage(`${TL}/textures/${slug}/`);
    const sizes = [...html.matchAll(/data-id="textures\/([^"]+)"[\s\S]*?product-full">\s*([^<]+?)\s*</g)].map((m) => `${m[2]} → ${m[1]}`);
    const desc = (html.match(/name="description" content="([^"]+)/) || [])[1];
    const cat = [...html.matchAll(/href="https:\/\/texturelabs\.org\/\?ct=\d+(?:&(?:amp;)?st=\d+)?">([^<]+)</g)].map((m) => m[1].trim());
    console.log(`${slug} · ${desc || ''}\nfound in: ${cat.join(' > ')}\n${sizes.join('\n')}\npage: ${TL}/textures/${slug}/`);
    return;
  }
  if (sub === 'get') {
    // studio texture get <slug|url> [--size small|med|large|xl] [--size-m 0.5]
    // Owner 2026-11-14: "take control of the download … only for this repo it should not ask": ONE texture, the same
    // request the page's download button makes, saved straight into library/textures/texturelabs/<slug>/ (no Chrome,
    // no Save dialog). One slug per call, human pace (20 a day), never a loop over many.
    const raw = args._.slice(2);
    if (raw.length !== 1) throw new Error('Usage: studio texture get <slug|url> [--size large]  (exactly one texture per call)');
    const slug = String(raw[0]).replace(/^.*\/textures\//, '').replace(/\/$/, '');
    const want = { small: 's_dl', s: 's_dl', med: 'm_dl', m: 'm_dl', medium: 'm_dl', large: 'l_dl', l: 'l_dl', xl: 'xl_dl', 'x-large': 'xl_dl' }[String(args.size && args.size !== true ? args.size : 'large').toLowerCase()];
    if (!want) throw new Error('--size small|med|large|xl');
    fs.mkdirSync(path.join(TEXTURES, 'texturelabs'), { recursive: true });
    const log = path.join(TEXTURES, 'texturelabs', '.downloads.json');
    const today = new Date().toISOString().slice(0, 10);
    const hist = readJson(log, []);
    if (hist.filter((h) => h.at.startsWith(today)).length >= 20) throw new Error('20 Texturelabs downloads today already: human pace only (law 31). Ask the owner.');
    const pageUrl = `${TL}/textures/${slug}/`;
    const html = await tlPage(pageUrl);
    const btn = [...html.matchAll(/class="productDownloadLink" data-id="([^"]+)" data-product-id="(\d+)" data-size-field="([a-z_]+)"/g)]
      .map((m) => ({ path: m[1], id: m[2], size: m[3] })).find((b) => b.size === want);
    if (!btn) throw new Error(`${slug}: no ${want} download on the page`);
    const ajax = ((html.match(/class="ajaxurl"[^>]*>([^<]+)</) || [])[1] || `${TL}/wp-admin/admin-ajax.php`).trim();
    const body = new URLSearchParams({ action: 'custom_one_click_purchase', product_path: btn.path, product_parent_id: btn.id, product_size: btn.size });
    const r = await fetch(ajax, { method: 'POST', headers: { 'User-Agent': TL_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: pageUrl }, body });
    const j = await r.json().catch(() => null);
    if (!j?.downloadlink) throw new Error(`texturelabs gave no download link (${r.status})`);
    const dir = path.join(TEXTURES, 'texturelabs', slug);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `albedo${(path.extname(btn.path) || '.jpg').toLowerCase()}`);
    const f = await fetch(j.downloadlink, { headers: { 'User-Agent': TL_UA, Referer: pageUrl } });
    if (!f.ok) throw new Error(`download ${f.status}`);
    fs.writeFileSync(dest, Buffer.from(await f.arrayBuffer()));
    hist.push({ slug, size: btn.size, at: new Date().toISOString() });
    fs.writeFileSync(log, JSON.stringify(hist, null, 2) + '\n');
    args._ = ['texture', 'add', dest];
    args.page = pageUrl;
    args.name = slug;
    return texture(args); // writes meta.json (licence, size, description) next to it
  }
  if (sub === 'add') {
    // studio texture add <file> [--page <texturelabs url>] [--source chatgpt|own] [--name slug] [--size-m 0.5]
    const file = args._[2] && path.resolve(String(args._[2]).replace(/^~/, os.homedir()));
    if (!file || !fs.existsSync(file)) throw new Error('Usage: studio texture add <file> [--page <url>] [--source chatgpt|own] [--name slug] [--size-m 0.5]');
    const page = args.page && args.page !== true ? String(args.page) : null;
    const source = page ? 'texturelabs' : (args.source && args.source !== true ? String(args.source) : 'own');
    const slug = args.name && args.name !== true ? slug_(String(args.name))
      : page ? page.replace(/^.*\/textures\//, '').replace(/\/$/, '') : slug_(path.basename(file).replace(/\.[^.]+$/, ''));
    const dir = path.join(TEXTURES, source, slug);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `albedo${path.extname(file).toLowerCase()}`);
    if (path.resolve(file) !== path.resolve(dest)) fs.copyFileSync(file, dest);
    let desc = null;
    if (page) { try { desc = ((await tlPage(page.endsWith('/') ? page : `${page}/`)).match(/name="description" content="([^"]+)/) || [])[1] || null; } catch {} }
    const dim = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', dest]);
    const [w, h] = [...dim.out.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1]));
    const meta = {
      slug, source, page, desc, file: rel(dest), width: w, height: h, sizeM: Number(args['size-m']) || 0.5, added: new Date().toISOString(),
      licence: source === 'texturelabs'
        ? 'Texturelabs free licence: commercial use OK, no credit needed. Never redistribute the file (not as a pack, not inside a GLB/3D file handed out), never use for or with AI image generation, never bulk/scripted downloads.'
        : source === 'chatgpt' ? 'Made with ChatGPT image generation for the studio.' : 'Own file.',
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(`texture → ${rel(dest)} (${w}×${h}, ${source})${desc ? ` · ${desc}` : ''}`);
    return;
  }
  if (sub === 'list') {
    if (!fs.existsSync(TEXTURES)) { console.log('no textures yet'); return; }
    for (const src of fs.readdirSync(TEXTURES)) {
      const d = path.join(TEXTURES, src);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const slug of fs.readdirSync(d)) {
        const m = readJson(path.join(d, slug, 'meta.json'), null);
        if (m) console.log(`${src}/${slug}  ${m.width}×${m.height}  ${m.desc || ''}  → ${m.file}`);
      }
    }
    return;
  }
  throw new Error('Usage: studio texture <find <category> [words] | info <slug> | get <slug> [--size large] | add <file> [--page url | --source chatgpt] | list>');
}
const slug_ = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_]+/g, '-').replace(/^-|-$/g, '');

// ---------- watermark (law 28) ----------
// bin/unmark.py: reverse alpha blend of the visible Veo mark on OUR OWN videos. Never SynthID.
// In place: the cleaned file takes the original's name, the original moves to <dir>/.raw/ (hidden from the board).
async function unmarkFile(abs) {
  const tmp = abs.replace(/\.(mp4|mov|webm)$/i, '.clean.mp4');
  const res = await run('python3', [path.join(ROOT, 'bin', 'unmark.py'), abs, '--out', tmp, '--json', '--keep-if-none']);
  let report = null;
  try { report = JSON.parse(res.out.slice(res.out.indexOf('{'))); } catch {}
  if (res.code !== 0 || !report) { console.error(`unmark failed for ${rel(abs)}: ${tail(res.out, 300)}`); return { file: rel(abs), found: null, error: true }; }
  if (!report.found) { console.log(`unmark: no Gemini/Veo mark in ${rel(abs)} (score ${report.mark?.score ?? '—'}) — left as is${report.reason ? ` (${report.reason})` : ''}`); return { file: rel(abs), found: false, ...(report.reason ? { noMap: true } : {}) }; }
  const raw = path.join(path.dirname(abs), '.raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.renameSync(abs, path.join(raw, path.basename(abs)));
  fs.renameSync(tmp, abs);
  const m = report.mark;
  console.log(`unmark: removed ${m.profile} mark (${m.size}, gain ${m.gain}, score ${m.score}) from ${rel(abs)} · original in ${rel(raw)}/`);
  return { file: rel(abs), found: true, profile: m.profile, geometry: m.geometry, size: m.size, gain: m.gain, score: m.score, raw: rel(path.join(raw, path.basename(abs))) };
}

// studio unmark <video> [--out clean.mp4] — by hand, for any of our own Flow / Gemini videos
async function unmarkCmd(args) {
  const file = args._[1];
  if (!file) throw new Error('Usage: studio unmark <video.mp4> [--out clean.mp4]');
  const out = args.out && args.out !== true ? ['--out', String(args.out)] : [];
  const res = await run('python3', [path.join(ROOT, 'bin', 'unmark.py'), path.resolve(String(file)), ...out], { echo: true });
  process.exitCode = res.code;
}

// ---------- upscale (law 29) ----------
// bin/upscale.py = the TAN Upscaler: one ffmpeg filter graph (Lanczos + CAS + deband; restore adds deblock + BM3D).
// In place, like unmark: the larger file takes the original's name, the original moves to <dir>/.raw/.
async function upscaleFile(abs, to) {
  const video = /\.(mp4|mov|webm|m4v)$/i.test(abs);
  const tmp = abs.replace(/\.[^.]+$/, video ? '.up.mp4' : '.up.png');
  const res = await run('python3', [path.join(ROOT, 'bin', 'upscale.py'), abs, '--out', tmp, '--json',
    ...(/^\d+(\.\d+)?x?$/.test(to) ? ['--scale', to.replace('x', '')] : ['--to', to]), '--preset', SETTINGS.upscale.preset || 'ai']);
  let report = null;
  try { report = JSON.parse(res.out.slice(res.out.indexOf('{'))); } catch {}
  if (res.code !== 0 || !report) { console.error(`upscale failed for ${rel(abs)}: ${tail(res.out, 300)}`); return { file: rel(abs), ok: false }; }
  const raw = path.join(path.dirname(abs), '.raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.renameSync(abs, path.join(raw, path.basename(abs)));
  const dest = video ? abs : abs.replace(/\.[^.]+$/, '.png');
  fs.renameSync(tmp, dest);
  console.log(`upscale: ${report.from} → ${report.to} (${report.preset}) ${rel(dest)} · original in ${rel(raw)}/`);
  return { file: rel(dest), ok: true, from: report.from, to: report.to, preset: report.preset, raw: rel(path.join(raw, path.basename(abs))) };
}

// studio upscale <file> [--to 2k|4k | --scale 2] [--preset ai|restore] [--out file] — by hand, any image or video
async function upscaleCmd(args) {
  const file = args._[1];
  if (!file) throw new Error('Usage: studio upscale <image|video> [--to 2k|4k | --scale 2] [--preset ai|restore] [--out file]');
  const pass = [];
  for (const k of ['to', 'scale', 'out']) if (args[k] && args[k] !== true) pass.push(`--${k}`, String(args[k]));
  pass.push('--preset', args.preset && args.preset !== true ? String(args.preset) : SETTINGS.upscale.preset || 'ai');
  const res = await run('python3', [path.join(ROOT, 'bin', 'upscale.py'), path.resolve(String(file)), ...pass], { echo: true });
  process.exitCode = res.code;
}

// ---------- client key components (library/clients/<id>/kit.json) ----------

function readKit(clientId) {
  return readJson(path.join(ROOT, 'library', 'clients', clientId, 'kit.json'), null);
}

// Put the client's real logo on a finished image: exact file, same size and place every time.
async function placeLogo(file, clientId, logo) {
  const { default: sharp } = await import('sharp');
  const img = sharp(file);
  const { width, height } = await img.metadata();
  const w = Math.round(width * (logo.width || 0.22));
  const mark = await sharp(path.join(ROOT, 'library', 'clients', clientId, logo.file)).resize({ width: w }).png().toBuffer();
  const markH = (await sharp(mark).metadata()).height;
  const gap = Math.round(width * (logo.margin || 0.04));
  const place = logo.placement || 'top-right';
  const top = place.startsWith('bottom') ? height - markH - gap : Math.round(height * (logo.margin || 0.04));
  const left = place.endsWith('left') ? gap : place.endsWith('right') ? width - w - gap : Math.round((width - w) / 2);
  const out = await img.composite([{ input: mark, top, left }]).toBuffer();
  fs.writeFileSync(file, out);
  console.log(`logo placed on ${rel(file)}`);
}

async function poster(args) {
  const briefPath = args._[1];
  if (!briefPath) throw new Error('Usage: studio poster <brief.json> [--dry] [--count 1]');
  const brief = JSON.parse(fs.readFileSync(path.resolve(briefPath), 'utf8'));
  // LAW 1: the owner's answer IS the ratio. asked.ratio alone fills brief.ratio (never the 4:5 default); both, and different = stop
  if (brief.asked?.ratio && brief.ratio && brief.asked.ratio !== brief.ratio && !args.force) throw new Error(`Law 1 — the owner asked for ${brief.asked.ratio}, the brief says ${brief.ratio}.`);
  brief.ratio ??= brief.asked?.ratio;
  // look up only: --dry never writes library/clients.json; runJob adds an unknown client when the job really runs
  const client = resolveClient(args.client || brief.client, { write: false });
  const kit = readKit(client.id);
  const logo = !args['no-logo'] && brief.logo !== false && kit?.logo ? kit.logo : null;
  // Law 6 (owner 2026-11-14): logo in a corner, given to the model as an input with its exact text + font.
  // --logo-overlay = fallback: keep the corner clear and paste the real file after.
  const overlay = !!logo && (args['logo-overlay'] || brief.logoMode === 'overlay' || logo.mode === 'overlay');
  if (logo) brief.logoPlace = args['logo-place'] || brief.logoPlace || logo.placement || 'top-right';
  if (logo && !overlay) brief.logoInput = { ...logo, path: rel(path.join(ROOT, 'library', 'clients', client.id, logo.file)) };
  if (logo && overlay && !brief.logoBand) {
    // Band = margin + the logo's height at this ratio + a breath below it.
    const { default: sharp } = await import('sharp');
    const m = await sharp(path.join(ROOT, 'library', 'clients', client.id, logo.file)).metadata();
    const [rw, rh] = String(brief.ratio || '4:5').split(':').map(Number);
    const logoH = (logo.width || 0.22) * (m.height / m.width) * (rw / rh);
    brief.logoBand = Math.min(0.35, (logo.margin || 0.04) * 2 + logoH);
  }
  const { buildPosterPrompt, posterRefImages, findCard, lintPosterPrompt } = await import(path.join(ROOT, 'library', 'prompts.mjs'));
  const prompt = buildPosterPrompt(brief);
  const refs = posterRefImages(brief).map((p) => rel(p));
  // Pre-prompt check (law 19, guide/PROMPTING.md): the prompt is linted before anything is generated.
  const lint = lintPosterPrompt(prompt, brief);
  const lintReport = [...lint.errors.map((e) => `  ERROR R01 ${e}`), ...lint.warns.map((w) => `  WARN  R01 ${w}`)].join('\n');
  if (args.dry) { console.log(prompt, '\n\nrefs:', refs.map((r, i) => `Image ${i + 1} = ${r}`)); console.log(`\npre-prompt check: ${lint.errors.length ? 'FAIL' : 'PASS'}\n${lintReport}`); return; }
  if (lint.errors.length && !args.force) throw new Error(`Law 19 — pre-prompt check failed:\n${lintReport}`);
  // LAW 1 (owner 2026-11-14): ask first. A brief without the owner's answers never runs.
  if (!brief.asked && !args.force) throw new Error('Law 1 — ask first: this brief has no "asked" block (the owner\'s ratio and answers). Ask the owner, add "asked", or pass --force if they said to skip.');
  const card = findCard(brief.recipe);
  await runJob({
    type: 'image', engine: 'codex', prompt, refs,
    client: args.client || brief.client,
    title: `Poster · ${brief.text?.headline || brief.product} (recipe ${card.id} ${card.family})`,
    meta: { kind: 'poster', recipe: card.id, brief: rel(path.resolve(briefPath)), logo: logo ? client.id : null, logoMode: logo ? (overlay ? 'overlay' : 'input') : null, logoPlace: logo ? brief.logoPlace : null, asked: brief.asked || null },
    ratio: brief.ratio || '4:5', count: Math.max(1, Number(args.count) || 1),
    after: logo && overlay ? (files) => Promise.all(files.map((f) => placeLogo(path.join(ROOT, f), client.id, { ...logo, placement: brief.logoPlace }))) : undefined,
    upscale: args.upscale || (brief.asked?.use === 'print' ? '4k' : undefined), // law 12 + 29
  });
}

async function reference(args) {
  const kind = args._[1];
  const subject = args._.slice(2).join(' ').trim();
  const { buildReferencePrompt, REFERENCE_KINDS } = await import(path.join(ROOT, 'library', 'prompts.mjs'));
  if (!kind || !subject) throw new Error(`Usage: studio ref <${REFERENCE_KINDS.join('|')}> "<subject>" [--ratio 4:5] [--ref photo.jpg]`);
  const refs = optList(args.ref);
  const prompt = buildReferencePrompt(kind, subject, { hasRef: refs.length > 0 });
  if (args.dry) { console.log(prompt); return; }
  await runJob({
    type: 'image', engine: args.engine || 'codex', prompt, refs,
    client: args.client,
    title: `Reference · ${kind} · ${subject}`,
    meta: { kind: `ref-${kind}` },
    ratio: optRatio(args, kind === 'character' || kind === 'location' ? '16:9' : '4:5'),
    count: Math.max(1, Number(args.count) || 1),
  });
}

async function directCmd(args) {
  const words = args._.slice(1).join(' ').trim();
  if (!words) throw new Error('Usage: studio direct "<owner\'s words>" [--top 3] [--json]');
  const { direct, formatDirect } = await import(path.join(ROOT, 'library', 'posters', 'direct.mjs'));
  const result = direct(words, { top: Number(args.top) || 3 });
  console.log(args.json ? JSON.stringify(result, null, 2) : formatDirect(result));
}

// studio vdirect "<owner's words>" — Video Director (law 25): owner words → ranked video studios
// (library/video-studios.json), with what runs it today. Generates nothing.
function vdirect(args) {
  const words = args._.slice(1).join(' ').trim().toLowerCase();
  if (!words) throw new Error('Usage: studio vdirect "<owner\'s words>" [--json]');
  const { studios } = readJson(path.join(ROOT, 'library', 'video-studios.json'), { studios: [] });
  const ranked = studios.map((s) => {
    const has = (w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(words);
    const hits = (s.words || []).filter(has);
    const score = hits.reduce((n, w) => n + w.split(' ').length, 0) + (has(s.label) ? 3 : 0);
    return { id: s.id, label: s.label, group: s.group, status: s.status, score, hits, engine: s.engine, command: s.command };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  if (args.json) { console.log(JSON.stringify(ranked, null, 2)); return; }
  if (!ranked.length) { console.log('no studio matched — default: make (Text & Image to Video). Ask the owner which studio.'); return; }
  for (const r of ranked.slice(0, 3)) {
    console.log(`${r.label} [${r.id}] · ${r.group} · ${r.status} · words: ${r.hits.join(', ')}`);
    console.log(`  engine: ${r.engine}${r.command ? `\n  run: ${r.command}${r.command.includes('--studio') ? '' : ` --studio ${r.id}`}` : '\n  needs an engine — ask the owner before adding one'}`);
  }
}

// ---------- laws: sec / laws / verify (ported from FoxMotion's fm sec + fm verify) ----------

const KNOWLEDGE = ['STUDIO.md', 'guide/PROMPTING.md', 'guide/MISTAKES.md', 'library/posters/ART-DIRECTION.md', 'library/REFERENCE-IMAGES.md', 'notes/CAMERA-MAP.md', 'INDEX.md', 'CLAUDE.md'];

// studio where "<topic>" — find any file, command, route, board part (INDEX.md) or law line (STUDIO.md).
function where(args) {
  const q = args._.slice(1).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) throw new Error('Usage: studio where "<topic>"');
  const out = [];
  for (const f of ['INDEX.md', 'STUDIO.md']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    let section = '';
    lines.forEach((l, i) => {
      if (l.startsWith('## ')) section = l.slice(3);
      if (/^\|\s*-/.test(l) || !/^(\||\d+\.|>)/.test(l)) return;
      if (q.every((w) => l.toLowerCase().includes(w))) out.push(`${f}:${i + 1} [${section}] ${l.replace(/^>\s?/, '').replace(/\s*\|\s*/g, ' | ').slice(0, 300)}`);
    });
  }
  console.log(out.length ? out.slice(0, 15).join('\n') : 'Nothing found. Try fewer or other words, or studio sec.');
}

// studio sec "<words>" — print ONLY the section you need (heading match, best first).
function sec(args) {
  const q = args._.slice(1).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) throw new Error('Usage: studio sec "<words>" [--all] [--list]');
  const heads = [];
  for (const f of KNOWLEDGE) {
    const file = path.join(ROOT, f);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => { const m = l.match(/^(#{2,4})\s+(.*)/); if (m) heads.push({ f, i, lv: m[1].length, t: m[2], lines }); });
  }
  const score = (h) => q.reduce((n, w) => n + (h.t.toLowerCase().includes(w) ? 3 : 0), 0) || q.reduce((n, w) => n + (h.f.toLowerCase().includes(w) ? 0.5 : 0), 0);
  const ranked = heads.map((h) => [score(h), h]).filter(([n]) => n >= 1).sort((a, b) => b[0] - a[0]).slice(0, 8);
  if (!ranked.length) {
    // No heading: show the laws, router rows and rules that mention every word.
    const hits = [];
    for (const f of KNOWLEDGE) {
      const file = path.join(ROOT, f);
      if (!fs.existsSync(file)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        if (q.every((w) => l.toLowerCase().includes(w)) && /^(\s*\d+\.|>|\||-)/.test(l)) hits.push(`${f}:${i + 1}  ${l.replace(/^>\s?/, '').slice(0, 400)}`);
      });
    }
    console.log(hits.length ? hits.slice(0, 12).join('\n') : 'Nothing matches. Try other words, or studio laws.');
    return;
  }
  if (args.list) { for (const [, h] of ranked) console.log(`${h.f}:${h.i + 1}  ${h.t.slice(0, 90)}`); return; }
  const h = ranked[0][1];
  let j = h.i + 1;
  while (j < h.lines.length && !((h.lines[j].match(/^(#{2,4})\s/) || [])[1]?.length <= h.lv)) j++;
  const body = h.lines.slice(h.i, j);
  console.log(`[${h.f}:${h.i + 1}] others: ${ranked.slice(1, 4).map(([, x]) => `${x.f}:${x.i + 1} ${x.t.slice(0, 40)}`).join(' | ')}`);
  console.log((args.all ? body : body.slice(0, 90)).join('\n'));
  if (!args.all && body.length > 90) console.log(`… (${body.length - 90} more lines — add --all)`);
}

// studio laws [image|video|3d|shared] — the numbered owner laws, one line each, tagged with their director(s)
// (STUDIO.md "Laws by director", law 26). A director name prints only that director's laws.
function laws(args = { _: [] }) {
  const text = fs.readFileSync(path.join(ROOT, 'STUDIO.md'), 'utf8');
  const part = text.split('## Owner laws')[1]?.split('\n## ')[0] || '';
  const map = text.split('## Laws by director')[1]?.split('\n## ')[0] || '';
  const tags = {}; // law number -> ['Image', 'Video', …]
  for (const l of map.split('\n')) {
    const m = l.match(/^- \*\*(\w+)\*\*[^:]*:\s*([\d,\s]+)$/);
    if (m) for (const n of m[2].split(',').map((s) => s.trim()).filter(Boolean)) (tags[n] ||= []).push(m[1]);
  }
  const want = args._[1] ? String(args._[1]).toLowerCase() : null;
  const groups = ['image', 'video', '3d', 'shared'];
  if (want && !groups.includes(want)) throw new Error(`Usage: studio laws [${groups.join('|')}]`);
  for (const l of part.split('\n')) {
    const m = l.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
    if (!m) continue;
    const t = tags[m[1]] || [];
    if (want && !t.some((x) => x.toLowerCase() === want)) continue;
    const name = m[2].replace(/\s*\(owner[^)]*\)[.:]?$/, '').replace(/[.:]$/, '');
    console.log(`${m[1].padStart(2)}. ${name}${t.length ? `  [${t.join(' · ')}]` : '  [untagged — add it to Laws by director]'}`);
  }
}

// studio verify <job-id|brief.json> — the never-again checks in guide/MISTAKES.md.
async function verify(args) {
  const target = args._[1];
  if (!target) throw new Error('Usage: studio verify <job-id|brief.json>');
  const errors = []; const warns = []; const ok = [];
  const E = (id, msg) => errors.push(`${id}  ${msg}`);
  const W = (id, msg) => warns.push(`${id}  ${msg}`);
  const jobsList = readJson(JOBS, []);
  const job = jobsList.find((j) => j.id === target) || null;
  const briefPath = job?.brief ? path.join(ROOT, job.brief) : (target.endsWith('.json') ? path.resolve(target) : null);
  const brief = briefPath && fs.existsSync(briefPath) ? JSON.parse(fs.readFileSync(briefPath, 'utf8')) : null;
  if (!job && !brief) throw new Error(`No job or brief "${target}".`);
  const clientId = job?.client || resolveClient(brief?.client, { write: false }).id; // verify never adds a client
  const kit = readKit(clientId);

  // A01 ask first
  if (brief && !brief.asked) E('A01', 'brief has no "asked" — the owner was not asked (law 1)'); else if (brief) ok.push('A01');
  // A02 recipe + own idea
  if (job?.kind === 'poster' || brief) {
    const { loadCards } = await import(path.join(ROOT, 'library', 'prompts.mjs'));
    const id = String(job?.recipe || brief?.recipe || '').padStart(2, '0');
    if (!loadCards().some((c) => c.id === id)) E('A02', `no valid recipe (${id || 'none'}) — use studio direct (law 3/4)`); else ok.push('A02');
    if (brief && !brief.idea) W('A02', 'brief has no own "idea" — the reference idea was used');
  }
  // G06 credits spent on Flow but no file came home: recover it from the Flow project (tools/flow/upscale.mjs), never regenerate
  if (job?.engine === 'flow' && (job.credits?.spent || 0) > 0 && !(job.files || []).length) E('G06', `${job.credits.spent} credits spent, no file — download it from Flow (node tools/flow/upscale.mjs --dir … --name … --tier 720p), do not regenerate`);
  else if (job?.engine === 'flow') ok.push('G06');
  // G07 a Flow video whose visible mark was not found: Omni carries a sparkle, Veo a wordmark — look at the corner
  if (job?.type === 'video' && job?.engine === 'flow' && (job.unmark || []).some((u) => !u.found)) W('G07', 'unmark found no mark on a Flow clip — open the bottom-right corner; a new mark needs a map (python3 bin/markmap.py … --min --near X,Y,R)');
  // A03 ratio
  const ratio = brief?.ratio || job?.ratio;
  if (brief?.asked?.ratio && ratio && brief.asked.ratio !== ratio) E('A03', `owner asked ${brief.asked.ratio}, made ${ratio}`);
  const files = (job?.files || []).map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  let sharp = null;
  if (files.length) ({ default: sharp } = await import('sharp'));
  for (const f of files) {
    // Videos: sharp can't read them, so take the size from ffprobe.
    const { width, height } = /\.(mp4|mov|webm)$/i.test(f)
      ? Object.fromEntries(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'default=nw=1', f], { encoding: 'utf8' })
        .trim().split('\n').map((l) => l.split('=')).map(([k, v]) => [k, Number(v)]))
      : await sharp(f).metadata();
    if (ratio) {
      const [rw, rh] = String(ratio).split(':').map(Number);
      const off = Math.abs(width / height - rw / rh) / (rw / rh);
      if (off > 0.03) E('A03', `${rel(f)} is ${width}×${height}, not ${ratio} (${Math.round(off * 100)} % off)`);
    }
    const long = Math.max(width, height);
    if (/print/i.test(brief?.asked?.use || '') && long < 2400) E('Q01', `${rel(f)} long side ${long}px, print needs ≥ 2400 — upscale (law 12)`);
    else if (long < 1024) W('Q01', `${rel(f)} long side only ${long}px`);
  }
  if (files.length && !errors.some((e) => e.startsWith('A03'))) ok.push('A03');
  // L01 logo — image / poster jobs only; a client's video or 3D job carries no placed logo
  const logoJob = job && (job.type === 'image' || job.kind === 'poster');
  if (kit?.logo && logoJob && brief?.logo !== false && !job.logo) E('L01', `${kit.name} has a logo in its kit, but this job has none placed (law 6)`);
  else if (kit?.logo && logoJob) ok.push('L01');
  // L03 corner, never top centre
  if (job?.logo && /center/.test(job.logoPlace || '')) E('L03', `logo placed ${job.logoPlace} — use a corner (law 6)`);
  else if (job?.logo) ok.push('L03');
  // L02 real packs
  if (kit?.products?.length && brief?.product && !(brief.packRefs || []).length) W('L02', 'product poster without packRefs — attach the real pack');
  // T01 non-Latin copy needs an eye check (no Kannada OCR here)
  if (/[\u0C80-\u0CFF\u0900-\u097F]/.test(JSON.stringify(brief?.text || {}))) W('T01', 'Kannada / Devanagari copy — check every letter by eye before showing');
  // K01 kit exists
  if (clientId !== 'general' && !kit) W('K01', `client "${clientId}" has no kit (library/clients/${clientId}/kit.json)`);
  // P01 full prompt
  const prompt = job?.fullPrompt || '';
  if (job) {
    const missing = ['USE:', 'IMAGES:', 'IDEA:', 'LIGHT & CAMERA:', 'TYPOGRAPHY:', 'CONSTRAINTS:'].filter((k) => !prompt.includes(k));
    if (job.kind === 'poster' && missing.length) E('P01', `prompt missing ${missing.join(' ')} (law 10)`); else ok.push('P01');
  }

  console.log(`verify ${job ? `job ${job.id}` : rel(briefPath)}  ·  client ${clientId}${ratio ? `  ·  ${ratio}` : ''}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  for (const w of warns) console.log(`  WARN  ${w}`);
  console.log(errors.length ? `FAIL — ${errors.length} error(s)` : `PASS${ok.length ? ` (${[...new Set(ok)].join(' ')})` : ''}`);
  process.exitCode = errors.length ? 1 : 0;
}

// ---------- Google Flow: panel, costs, balance, plan (law 9, law 34) ----------
// library/flow-video.json = what the video panel offers per model (seconds, resolution, credits); data/credits.json =
// the last live cost probe; data/flow.json = the last balance read + every job's spend.
const FLOW_VIDEO = path.join(ROOT, 'library', 'flow-video.json');
const FLOW_STATE = path.join(DATA, 'flow.json');

// The live balance from the signed-in Flow window (tools/flow/balance.mjs opens + closes the account panel).
async function flowBalance() {
  const res = await run('node', [path.join(ROOT, 'tools', 'flow', 'balance.mjs')]);
  let r = null;
  try { r = JSON.parse(res.out.trim().split('\n').pop()); } catch {}
  if (!r || r.error || r.credits == null) return { credits: null, error: r?.error || tail(res.out, 200) };
  const st = readJson(FLOW_STATE, { history: [] });
  st.balance = r;
  writeJson(FLOW_STATE, st);
  return r;
}

// Every clip Flow can make, priced as the panel prices it (library/flow-video.json, read live 2026-11-15).
// res: '720p' (default, law 34) or '360p' (only when the owner says low-res / upscale route).
const TODAY = () => new Date().toISOString().slice(0, 10);
function flowLib() { return readJson(FLOW_VIDEO, { models: [], budget: { clip: 10, clip_10s: 15 } }); }
function clipOptions({ res = '720p', tier = 'draft', models = null, audio = false } = {}) {
  // 1080p = a native 720p clip + Flow's free 1080p upscale (tested 2026-11-15: 0 credits, ~40 s; 360p clips only get 720p)
  if (res === '1080p') return clipOptions({ res: '720p', tier, models, audio }).filter((o) => !o.upscale && o.seconds <= 10)
    .map((o) => ({ ...o, res: '1080p', make: '720p', upscale: '1080p', route: '720p → Flow 1080p' }));
  const lib = flowLib();
  const live = (m) => !m.retires || TODAY() < m.retires;
  const out = [];
  for (const m of lib.models) {
    if (!live(m) || (audio && !m.audio)) continue;
    if (models && !models.some((x) => x.toLowerCase() === m.model.toLowerCase())) continue;
    const isTier = (m.model === 'Veo 3.1 - Fast' ? 'quality' : m.model === 'Veo 3.1 - Quality' ? 'final' : 'draft') === tier;
    if (!models && !isTier) continue;
    if (m.model === 'Omni 1.2 Flash') {
      for (let s = m.seconds.min; s <= m.seconds.max; s++) {
        const per = res === '360p' ? 1 : 3;
        out.push({ model: m.model, seconds: s, res, credits: s <= 10 ? s * per : 10 * per + (s - 10) * per * 2, control: 'slider' });
        // law 34: 720p the cheap way — make at 360p (1 credit / s), then Flow's own upscale to 720p (free, ≤ 10 s; tested
        // 2026-11-15: far sharper than a classic upscale). Native 720p (3 / s) only with --native.
        if (res === '720p' && s <= 10) out.push({ model: m.model, seconds: s, res: '720p', make: '360p', upscale: '720p', credits: s, control: 'slider', route: '360p → Flow 720p' });
      }
    } else if (m.seconds.options) {
      for (const s of m.seconds.options) { const c = m.price[`${res} ${s}s`]; if (c != null) out.push({ model: m.model, seconds: s, res, credits: c, control: 'buttons' }); }
    } else if (m.seconds.fixed) {
      const c = m.price[`720p ${m.seconds.fixed}s`];
      if (c != null) out.push({ model: m.model, seconds: m.seconds.fixed, res: '720p', credits: c, control: 'fixed' });
    }
  }
  return out;
}
const flowModel = (name) => flowLib().models.find((m) => m.model.toLowerCase() === String(name || '').toLowerCase());

// The owner's budget: a clip costs at most 10 credits, a 10 s (or longer) clip at most 15.
function withinBudget(o) { const b = flowLib().budget || { clip: 10, clip_10s: 15 }; return o.credits <= (o.seconds >= 10 ? b.clip_10s : b.clip); }

// Cheapest set of clips that covers `target` seconds: fewest credits, then least excess, then fewest clips.
// Clips over the budget are left out unless `over` is set.
function planVideo(target, only = {}) {
  let opts = clipOptions(only);
  if (only.native) opts = opts.filter((o) => !o.upscale);
  else if (only.res !== '1080p') opts = opts.filter((o) => !(o.model === 'Omni 1.2 Flash' && o.res === '720p' && !o.upscale && o.seconds <= 10));
  if (!only.over) opts = opts.filter(withinBudget);
  if (!opts.length) throw new Error(`no clip fits${only.models ? ` (${only.models.join(', ')})` : ''}${only.over ? '' : ' the budget (≤ 10 credits, ≤ 15 for 10 s) — add --over to allow more'}`);
  const top = target + Math.max(...opts.map((o) => o.seconds));
  const best = Array(top + 1).fill(null);
  best[0] = { credits: 0, clips: [] };
  for (let t = 1; t <= top; t++) {
    for (const o of opts) {
      const prev = t - o.seconds >= 0 ? best[t - o.seconds] : null;
      if (!prev) continue;
      const cand = { credits: prev.credits + o.credits, clips: [...prev.clips, o] };
      const cur = best[t];
      if (!cur || cand.credits < cur.credits || (cand.credits === cur.credits && cand.clips.length < cur.clips.length)) best[t] = cand;
    }
  }
  let pick = null;
  for (let t = target; t <= top; t++) {
    const b = best[t];
    if (!b) continue;
    const key = [b.credits, t - target, b.clips.length];
    if (!pick || key[0] < pick.key[0] || (key[0] === pick.key[0] && (key[1] < pick.key[1] || (key[1] === pick.key[1] && key[2] < pick.key[2])))) pick = { ...b, seconds: t, key };
  }
  const clips = [...pick.clips].sort((a, b) => b.seconds - a.seconds);
  return { target, seconds: pick.seconds, excess: pick.seconds - target, credits: pick.credits, clips };
}

function studioModels(studioId) {
  const s = readJson(path.join(ROOT, 'library', 'video-studios.json'), { studios: [] }).studios.find((x) => x.id === studioId);
  return s?.flow?.models || null;
}

// args: the planning flags given (--over, --quality, --final, --native, --studio, --audio) go into every printed
// command, so each shot is planned the same way when it is run
function printPlan(plan, balance, args = {}) {
  const carry = ['over', 'quality', 'final', 'native', 'audio'].filter((k) => args[k]).map((k) => ` --${k}`).join('')
    + (args.studio && args.studio !== true ? ` --studio ${args.studio}` : '')
    + (args.client && args.client !== true ? ` --client "${args.client}"` : '')
    + (args.ratio && args.ratio !== true ? ` --ratio ${args.ratio}` : '');
  console.log(`${plan.target} s → ${plan.clips.length} clip${plan.clips.length > 1 ? 's' : ''}, ${plan.seconds} s made (${plan.excess ? `${plan.excess} s to trim in Edit` : 'no excess'}), ${plan.credits} credits${balance?.credits != null ? ` · balance ${balance.credits} → ${balance.credits - plan.credits}` : ''}`);
  plan.clips.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.model} · ${c.seconds} s · ${c.route || c.res} · ${c.credits} credits   studio video "<shot ${i + 1}>" --model "${c.model}" --seconds ${c.seconds}${c.res !== '720p' ? ` --res ${c.res}` : ''}${carry}`);
  });
  if (plan.clips.length > 1) console.log('  join: Video → Edit (law 27), cut or smooth between shots; one shot per prompt, same look words in each.');
}

// studio vplan <seconds> [--studio id] [--model M] [--audio] [--res 360p] [--quality|--final] [--over]
async function vplan(args) {
  const target = Math.round(Number(args._[1]));
  if (!target || target < 1) throw new Error('Usage: studio vplan <seconds> [--studio <id>] [--model "<M>"] [--audio] [--res 360p] [--quality|--final] [--over] [--no-balance]');
  printPlan(planVideo(target, planOptions(args)), args['no-balance'] ? null : await flowBalance(), args);
}
function planOptions(args) {
  const model = args.model && args.model !== true ? [String(args.model)] : null;
  const studio = args.studio && args.studio !== true ? studioModels(String(args.studio)) : null;
  return { models: model || studio, audio: !!args.audio, res: ['360p', '1080p'].includes(args.res) ? args.res : '720p',
    tier: args.final ? 'final' : args.quality ? 'quality' : 'draft', over: !!args.over || !!args.final || !!args.quality, native: !!args.native };
}

// studio credits [--refresh] — the live balance (+ reset date) and the cost of every model; --refresh re-reads costs.
async function credits(args) {
  const bal = await flowBalance();
  console.log(bal.credits != null
    ? `Flow balance: ${bal.credits} credits · ${bal.plan || ''} · resets ${bal.resets || '?'}`
    : `Flow balance: not read (${bal.error}) — run \`gflow doctor\` once, then retry`);
  if (args.refresh || !fs.existsSync(CREDITS)) {
    const ratio = args.ratio && args.ratio !== true ? args.ratio : '16:9';
    const res = await run('gflow', ['probe-video', '--ratio', ratio]);
    writeJson(CREDITS, { checkedAt: new Date().toISOString(), ratio, ok: res.code === 0, raw: tail(res.out, 6000) });
  }
  console.log('clips (x1, budget ≤ 10 credits, ≤ 15 for 10 s; * = over budget):');
  for (const res of ['720p', '360p']) {
    const by = {};
    for (const o of clipOptions({ res, tier: 'draft' }).concat(res === '720p' ? clipOptions({ tier: 'quality' }) : []).filter((o) => o.res === res)) (by[o.model] ||= []).push(`${o.seconds}s ${o.credits}${withinBudget(o) ? '' : '*'}`);
    for (const [m, list] of Object.entries(by)) console.log(`  ${res} ${m.padEnd(16)} ${list.join(' · ')}`);
  }
  console.log('images on Flow: 0 credits (Nano Banana Pro 100 / day, 2.1 + 2 Lite 1,000 / day)');
  const st = readJson(FLOW_STATE, { history: [] });
  const spent = (st.history || []).reduce((n, h) => n + (h.spent || 0), 0);
  if (st.history?.length) console.log(`ledger: ${st.history.length} Flow jobs, ${spent} credits spent (data/flow.json)`);
}

function jobs(args) {
  const limit = Number(args.limit) || 10;
  for (const j of readJson(JOBS, []).slice(0, limit)) {
    console.log(`${String(j.status || '?').padEnd(7)} ${(j.client || 'general').padEnd(10)} ${j.id}  ${j.engine || '?'}/${j.model || '?'}  ${(j.files || []).length} file(s)  ${String(j.prompt || j.title || '').slice(0, 60)}`);
  }
}

// ---------- Pinterest → reference folder ----------
// Uses `pin` (install the pin CLI). Read-only, logged-out, no key.
// Saved pins land in the reference folder unsorted; Claude studies each, renames it NN-slug.png
// and writes its card. library/posters/pinterest.json keeps the source of every saved pin.

const REF_DIR = path.join(ROOT, 'posters', '.codex', 'skills', 'poster-art-director', 'references', 'images');
const PIN_LOG = path.join(ROOT, 'library', 'posters', 'pinterest.json');
const PIN_BIN = process.env.PIN_BIN
  || [path.join(os.homedir(), 'go', 'bin', 'pin')].find((p) => fs.existsSync(p))
  || 'pin';
const PIN_MAX = 30;          // owner rule: small reference pulls, 10–30 images, never bulk
const PIN_DAY_MAX = 90;      // saves per day across runs
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN_MODES = {
  search: (q) => ['search', q],
  board: (r) => ['board', 'pins', r],
  get: (r) => ['get', r],
  related: (r) => ['related', r],
  user: (r) => ['user', 'pins', r],
  topic: (r) => ['topic', r],
};

async function pins(args) {
  const [, mode, ref] = args._;
  if (!PIN_MODES[mode] || !ref) throw new Error(`Usage: studio pins <${Object.keys(PIN_MODES).join('|')}> "<query or ref>" [--limit 12] [--save]`);
  const asked = Number(args.limit) || 12;
  if (asked > PIN_MAX) console.log(`limit ${asked} capped to ${PIN_MAX} (small reference pulls only)`);
  const limit = String(Math.min(asked, PIN_MAX));
  const res = await run(PIN_BIN, [...PIN_MODES[mode](ref), '--limit', limit, '-o', 'jsonl']);
  if (res.code === 127) throw new Error('pin not installed: install the pin CLI');
  if (res.code === 3) throw new Error('Pinterest returned no pins (feed withheld for this network, or nothing found).');
  if (res.code !== 0) throw new Error(tail(res.out));
  const found = res.out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((p) => p.image);
  const log = readJson(PIN_LOG, []);
  const seen = new Set(log.flatMap((e) => [e.pin, e.image]));
  let saved = 0;
  const today = new Date().toISOString().slice(0, 10);
  let left = PIN_DAY_MAX - log.filter((e) => (e.savedAt || '').startsWith(today)).length;
  if (args.save && left <= 0) throw new Error(`Daily cap reached (${PIN_DAY_MAX} pins saved today). Try again tomorrow.`);
  for (const p of found) {
    const known = seen.has(p.id) || seen.has(p.image);
    const label = `${p.image_width}×${p.image_height}`.padEnd(11);
    console.log(`${known ? 'have ' : '     '}${label} ${(p.board || '').slice(0, 24).padEnd(24)} ${(p.title || p.alt_text || '').slice(0, 60)}\n      ${p.url}`);
    if (!args.save || known) continue;
    if (left <= 0) { console.log(`      daily cap of ${PIN_DAY_MAX} reached, stopping`); break; }
    if (saved) await pause(1500 + Math.random() * 1500);   // gentle: 1.5–3 s between downloads
    const ext = (path.extname(new URL(p.image).pathname) || '.jpg').toLowerCase();
    const file = `pin-${slug(p.title || p.alt_text || p.id).slice(0, 40) || 'untitled'}-${p.id.slice(-6).toLowerCase()}${ext}`;
    const r = await fetch(p.image);
    if (!r.ok) { console.log(`      ! download failed (${r.status})`); continue; }
    fs.writeFileSync(path.join(REF_DIR, file), Buffer.from(await r.arrayBuffer()));
    log.push({ pin: p.id, url: p.url, image: p.image, title: p.title || '', alt: p.alt_text || '', pinner: p.pinner || '', board: p.board || '', file, savedAt: new Date().toISOString() });
    seen.add(p.id); seen.add(p.image); saved++; left--;
    console.log(`      saved → ${rel(path.join(REF_DIR, file))}`);
  }
  if (args.save) {
    writeJson(PIN_LOG, log);
    console.log(`\n${saved} new pin(s) in the reference folder — they show as "new" on Image → Art Direction until sorted.`);
  } else console.log(`\n${found.length} pin(s). Add --save to drop them into the reference folder.`);
}

// ---------- doctor (law 37) ----------
// Checks every tool in library/connections.json: installed, signed in, ready. Prints the exact install / sign-in
// command for anything missing, so any agent (Claude, Codex, Qwen, a local model) can connect a new machine.
// Exit 1 when a required tool is not ready. --json for machines, --quick skips the slow sign-in checks (Flow).
function doctor(a) {
  const reg = readJson(path.join(ROOT, 'library', 'connections.json'), null);
  if (!reg) throw new Error('library/connections.json missing');
  const PATHX = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), 'go', 'bin'), path.join(os.homedir(), '.local', 'bin')].join(':');
  const probe = (argv, timeout = 15000) => {
    const [cmd0, ...rest] = argv.map((x) => (x === '$BLENDER' ? BLENDER : x));
    // stdout AND stderr: some CLIs (codex login status) print their answer on stderr
    const r = spawnSync(cmd0, rest, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: PATHX } });
    return { ok: !r.error && r.status === 0, missing: r.error?.code === 'ENOENT', out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  };
  const rows = [];
  for (const t of reg.tools) {
    const r = probe(t.check);
    const installed = t.ready ? new RegExp(t.ready, 'im').test(r.out) : r.ok;
    let signedIn = null;
    if (installed && t.login && !(a.quick && t.id === 'flow')) {
      const l = probe(t.login, t.loginTimeout || 20000);
      signedIn = new RegExp(t.loggedIn, 'i').test(l.out);
    }
    const ready = installed && signedIn !== false;
    const version = t.version === false ? '' : (r.out.match(/\d+\.\d+(\.\d+)?/) || [''])[0];
    const fix = !installed ? t.install : signedIn === false ? t.signin : null;
    rows.push({ id: t.id, name: t.name, group: t.group, required: t.required, ready, installed, signedIn, version, for: t.for, fix });
  }
  if (a.json) { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), tools: rows }, null, 2)); }
  else {
    console.log('Open TAN doctor — library/connections.json (law 37)\n');
    for (const r of rows) {
      const mark = r.ready ? 'ready  ' : r.required ? 'MISSING' : 'off    ';
      const login = r.signedIn === null ? '' : r.signedIn ? ' · signed in' : ' · NOT signed in';
      console.log(`${mark}  ${r.name}${r.version ? ` ${r.version}` : ''}${login}${r.required ? '' : '  (optional)'}  — ${r.for}`);
      if (r.fix) console.log(`         fix: ${r.fix}`);
    }
    const bad = rows.filter((r) => r.required && !r.ready);
    console.log(bad.length ? `\n${bad.length} required tool(s) not ready. Fix them in order, then run doctor again.` : '\nCore ready. Optional rows: connect only when a job needs them.');
    if (a.quick) console.log('(--quick: Google Flow sign-in not checked)');
  }
  if (rows.some((r) => r.required && !r.ready)) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const commands = {
  image: () => generate('image', args),
  poster: () => poster(args),
  direct: () => directCmd(args),
  vdirect: () => vdirect(args),
  sec: () => sec(args),
  laws: () => laws(args),
  where: () => where(args),
  verify: () => verify(args),
  ref: () => reference(args),
  video: () => generate('video', args),
  credits: () => credits(args),
  vplan: () => vplan(args),
  jobs: () => jobs(args),
  pins: () => pins(args),
  blender: () => blender(args),
  texture: () => texture(args),
  ddirect: () => ddirect(args),
  shot: () => shot(args),
  unmark: () => unmarkCmd(args),
  upscale: () => upscaleCmd(args),
  doctor: () => doctor(args),
};

if (!commands[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exitCode = cmd ? 1 : 0;
} else {
  // a job this process left running is marked failed with the error, never left "running" forever
  Promise.resolve().then(commands[cmd]).catch((err) => { console.error(err.message); failRunning(err.message); process.exitCode = 1; });
}
