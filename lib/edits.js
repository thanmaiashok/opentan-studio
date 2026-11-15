// The Video → Edit page (law 27, guide/EDIT.md): an edit is data — a list of clips (source + in/out) and how each
// clip joins the one before it (cut or smooth). Sources are never touched; export renders one MP4 with ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, resolveOutput, readState, withJobs, slug, localDay } from '@/lib/store';
import { readSettings } from '@/lib/settings';
import { probeFile } from '@/lib/ingest';

const DIR = path.join(ROOT, 'data', 'edits');
export const SMOOTH = 0.5; // seconds of cross-dissolve for a smooth join
export const MIN_CLIP = 0.5; // shortest clip a trim may leave

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// Sources moved to another folder while an Edit page was open (lib/files.js → retargetClips): the page's next
// autosave still sends the old paths, so they are mapped here instead of the clips being dropped.
const MOVED = (globalThis.__studioMovedSources ||= {});

const fileOf = (id) => path.join(DIR, `${String(id).replace(/[^a-z0-9-]/gi, '')}.json`);

export function listEdits() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function readEdit(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
}

export function createEdit({ title, clips = [] } = {}) {
  const now = new Date().toISOString();
  const id = `edit-${now.replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const edit = { id, title: title || 'Untitled edit', createdAt: now, updatedAt: now, clips: clips.map(cleanClip).filter(Boolean) };
  writeJson(fileOf(id), edit);
  return edit;
}

function cleanClip(c) {
  if (c && MOVED[c.src] && !resolveOutput(c.src)) c = { ...c, src: MOVED[c.src] };
  if (!c || !resolveOutput(c.src)) return null;
  const dur = Number(c.dur) || 0;
  const inn = Math.max(0, Number(c.in) || 0);
  const out = Math.min(dur || Infinity, Number(c.out) || dur);
  if (!(out - inn >= MIN_CLIP - 1e-6)) return null;
  return {
    id: String(c.id || crypto.randomBytes(4).toString('hex')),
    src: c.src, dur, in: +inn.toFixed(3), out: +out.toFixed(3),
    join: c.join === 'smooth' ? 'smooth' : 'cut',
  };
}

export function saveEdit(edit) {
  const prev = readEdit(edit.id);
  if (!prev) return null;
  const next = {
    ...prev,
    title: String(edit.title || prev.title).slice(0, 80),
    clips: (edit.clips || []).map(cleanClip).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  writeJson(fileOf(edit.id), next);
  return next;
}

// Files moved (moves: { oldRel: newRel }): every edit's clips follow them.
export function retargetClips(moves) {
  for (const [from, to] of Object.entries(moves)) {
    MOVED[from] = to;
    for (const k of Object.keys(MOVED)) if (MOVED[k] === from) MOVED[k] = to; // moved twice
  }
  if (!fs.existsSync(DIR)) return 0;
  let changed = 0;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const file = path.join(DIR, f);
    let edit;
    try { edit = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!Array.isArray(edit.clips) || !edit.clips.some((c) => moves[c?.src])) continue;
    edit.clips = edit.clips.map((c) => (c && moves[c.src] ? { ...c, src: moves[c.src] } : c));
    writeJson(file, edit);
    changed += 1;
  }
  return changed;
}

export function deleteEdit(id) {
  const f = fileOf(id);
  if (fs.existsSync(f)) fs.rmSync(f);
}

// ---------- export (law 27: default 2K · 60 fps · enhance) ----------
// Built like FoxMotion's render (R03, R07): the work is split, run in parallel and never done twice.
//   A. every clip on its own ffmpeg, up to CORES/2 at once: trim → fit to the first clip's shape (letterbox, never
//      stretch) → frame rate (motion-interpolated when the clip is slower than the target: 24 → 60 looks smooth,
//      not stuttered) → size (TAN Upscaler "enhance" when the picture grows, else Lanczos). Each result is cached by
//      what made it (.run/render-cache), so a re-export after one trim only redoes that clip.
//   B. join: all cuts → stream copy (seconds); any smooth join → one xfade / acrossfade pass.
// Progress lives in memory (globalThis) and the Edit page reads it from /api/edits?progress=<job>.

const CACHE = path.join(ROOT, '.run', 'render-cache');
const LONG = { '1080p': 1920, '2k': 2560, '4k': 3840 };
const PROG = (globalThis.__studioExport ||= {});
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

export const exportProgress = (job) => PROG[job] || null;

// The dissolve a smooth join really gets: 0.5 s, never more than half of either clip.
export function smoothFor(clips, i) {
  if (i < 1 || clips[i].join !== 'smooth') return 0;
  const a = clips[i - 1].out - clips[i - 1].in, b = clips[i].out - clips[i].in;
  return +Math.min(SMOOTH, a / 2, b / 2).toFixed(3);
}

export function planExport(edit, opts = {}) {
  const set = readSettings().edit;
  const resolution = LONG[opts.resolution] || opts.resolution === 'source' ? opts.resolution : set.resolution;
  const fps = [30, 60].includes(Number(opts.fps)) ? Number(opts.fps) : set.fps;
  const clips = edit.clips.map((c) => {
    const abs = resolveOutput(c.src);
    if (!abs) throw new Error(`source missing: ${c.src}`);
    return { ...c, abs, info: probeFile(abs), len: +(c.out - c.in).toFixed(3) };
  });
  const bw = even(clips[0].info.w), bh = even(clips[0].info.h);
  const k = resolution === 'source' ? 1 : LONG[resolution] / Math.max(bw, bh);
  const W = even(bw * k), H = even(bh * k);
  const enhance = (opts.enhance ?? set.enhance) !== false && W > bw; // only when the picture grows (law 29)
  return { clips, bw, bh, W, H, fps, enhance, resolution };
}

// run a command; onTime(seconds) from ffmpeg's -progress output
function run(cmd, args, onTime) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => {
      if (!onTime) return;
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m) onTime(Number(m[m.length - 1].split('=')[1]) / 1e6);
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err: err.trim() }));
  });
}

async function pool(items, limit, fn) {
  let i = 0;
  const go = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, go));
}

// Stage A: one clip → one finished piece at the target size and frame rate (cached).
async function renderClip(c, P, onP) {
  const st = fs.statSync(c.abs);
  const preset = readSettings().upscale.preset || 'ai';
  const key = crypto.createHash('sha1').update(JSON.stringify([c.abs, st.size, st.mtimeMs, c.in, c.out, P.bw, P.bh, P.W, P.H, P.fps, P.enhance, preset, 3])).digest('hex').slice(0, 24);
  const out = path.join(CACHE, `${key}.mp4`);
  if (fs.existsSync(out)) { onP(1); return out; }
  fs.mkdirSync(CACHE, { recursive: true });

  const vf = [`scale=${P.bw}:${P.bh}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${P.bw}:${P.bh}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1'];
  // tpad: minterpolate needs a frame after the last one, else the clip comes out ~4 frames short
  vf.push('tpad=stop_mode=clone:stop_duration=0.25');
  vf.push(c.info.fps < P.fps - 0.5 ? `minterpolate=fps=${P.fps}:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=epzs` : `fps=${P.fps}`);
  if (!P.enhance && (P.W !== P.bw || P.H !== P.bh)) vf.push(`scale=${P.W}:${P.H}:flags=lanczos`);
  vf.push('format=yuv420p');

  const audioIn = c.info.audio ? [] : ['-f', 'lavfi', '-t', String(c.len), '-i', 'anullsrc=r=48000:cl=stereo'];
  const base = P.enhance ? path.join(CACHE, `${key}.base.mp4`) : `${out}.tmp.mp4`;
  const args = ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-ss', String(c.in), '-t', String(c.len), '-i', c.abs, ...audioIn,
    '-map', '0:v:0', '-map', c.info.audio ? '0:a:0' : '1:a:0', '-vf', vf.join(','),
    '-af', 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo', '-t', String(c.len),
    '-c:v', 'libx264', '-preset', P.enhance ? 'veryfast' : 'medium', '-crf', P.enhance ? '12' : '16', '-r', String(P.fps),
    '-c:a', 'aac', '-b:a', '192k', base];
  const r = await run('ffmpeg', args, (t) => onP(Math.min(1, t / c.len) * (P.enhance ? 0.5 : 1)));
  if (r.code !== 0) throw new Error(`clip ${path.basename(c.abs)}: ${r.err.split('\n').pop()}`);

  if (P.enhance) {
    const u = await run('python3', [path.join(ROOT, 'bin', 'upscale.py'), base, '--out', `${out}.tmp.mp4`, '--scale', (P.W / P.bw).toFixed(4), '--preset', preset, '--json']);
    fs.rmSync(base, { force: true });
    if (u.code !== 0) throw new Error(`enhance: ${u.err.split('\n').pop()}`);
  }
  fs.renameSync(`${out}.tmp.mp4`, out);
  onP(1);
  return out;
}

// Stage B: join the pieces.
async function joinPieces(pieces, P, out, onP) {
  const sizes = pieces.map((f) => probeFile(f));
  const same = sizes.every((s) => s.w === P.W && s.h === P.H);
  const anySmooth = P.clips.some((c, i) => smoothFor(P.clips, i) > 0);
  if (!anySmooth && same) {
    const list = `${out}.list.txt`;
    fs.writeFileSync(list, pieces.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const r = await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
    fs.rmSync(list, { force: true });
    onP(1);
    if (r.code !== 0) throw new Error(`join: ${r.err.split('\n').pop()}`);
    return;
  }
  const parts = [];
  pieces.forEach((_, i) => {
    parts.push(`[${i}:v]scale=${P.W}:${P.H}:flags=lanczos,setsar=1,fps=${P.fps},format=yuv420p,settb=AVTB[v${i}]`);
    parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  let v = 'v0', a = 'a0', total = P.clips[0].len;
  for (let i = 1; i < pieces.length; i += 1) {
    const d = Math.round(smoothFor(P.clips, i) * P.fps) / P.fps;
    if (d > 0) {
      parts.push(`[${v}][v${i}]xfade=transition=fade:duration=${d.toFixed(4)}:offset=${(total - d).toFixed(4)}[vj${i}]`);
      parts.push(`[${a}][a${i}]acrossfade=d=${d.toFixed(4)}[aj${i}]`);
      total += P.clips[i].len - d;
    } else {
      parts.push(`[${v}][v${i}]concat=n=2:v=1:a=0[vj${i}]`);
      parts.push(`[${a}][a${i}]concat=n=2:v=0:a=1[aj${i}]`);
      total += P.clips[i].len;
    }
    v = `vj${i}`; a = `aj${i}`;
  }
  const r = await run('ffmpeg', ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...pieces.flatMap((f) => ['-i', f]),
    '-filter_complex', parts.join(';'), '-map', `[${v}]`, '-map', `[${a}]`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(P.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], (t) => onP(Math.min(1, t / total)));
  if (r.code !== 0) throw new Error(`join: ${r.err.split('\n').pop()}`);
}

function jobsSet(id, patch) {
  withJobs((jobs) => {
    const j = jobs.find((x) => x.id === id);
    if (j) Object.assign(j, patch);
  });
}

function pruneCache() {
  try {
    const week = Date.now() - 7 * 864e5;
    for (const f of fs.readdirSync(CACHE)) {
      const p = path.join(CACHE, f);
      if (fs.statSync(p).mtimeMs < week) fs.rmSync(p, { force: true });
    }
  } catch {}
}

export function exportEdit(id, opts = {}) {
  const edit = readEdit(id);
  if (!edit || !edit.clips.length) throw new Error('nothing to export');
  const P = planExport(edit, opts);

  const firstJob = readState().jobs.find((j) => (j.files || []).includes(edit.clips[0].src));
  const client = edit.client || firstJob?.client || 'general';
  const now = new Date();
  const day = localDay(now);
  const stamp = now.toISOString().replace(/\D/g, '').slice(8, 14);
  const tag = P.resolution === 'source' ? `${P.H}p` : P.resolution;
  const outRel = path.join('outputs', 'clients', client, day, `edit-${slug(edit.title) || 'untitled'}-${tag}${P.fps}-${stamp}.mp4`);
  const out = path.join(ROOT, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const jobId = `video-${now.toISOString().replace(/\D/g, '').slice(0, 14)}-edit-${crypto.randomBytes(2).toString('hex')}`;
  const g = (x, y) => (y ? g(y, x % y) : x);
  const k = g(P.W, P.H);
  const record = {
    id: jobId, type: 'video', engine: 'edit', model: `Edit · ${P.W}×${P.H} · ${P.fps} fps${P.enhance ? ' · TAN Upscaler' : ''}`, studio: 'make',
    prompt: `Edit · ${edit.title}`, client, status: 'running', ratio: `${P.W / k}:${P.H / k}`,
    createdAt: now.toISOString(), files: [], edit: edit.id, clips: edit.clips.length,
    export: { resolution: P.resolution, fps: P.fps, enhance: P.enhance, size: `${P.W}x${P.H}` },
    unmark: [{ file: outRel, found: false, skipped: 'made from clean sources' }],
  };
  withJobs((jobs) => { jobs.unshift(record); });

  const each = P.clips.map(() => 0);
  const A = 0.88; // share of the bar for the clips; the join is the rest
  PROG[jobId] = { phase: 'clips', p: 0, started: Date.now() };
  const tick = () => { PROG[jobId] = { ...PROG[jobId], p: (each.reduce((s, x) => s + x, 0) / each.length) * A }; };
  const limit = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));

  (async () => {
    const pieces = [];
    await pool(P.clips, limit, async (c, i) => { pieces[i] = await renderClip(c, P, (x) => { each[i] = x; tick(); }); });
    PROG[jobId] = { ...PROG[jobId], phase: 'join', p: A };
    const tmp = `${out}.part.mp4`;
    await joinPieces(pieces, P, tmp, (x) => { PROG[jobId] = { ...PROG[jobId], p: A + x * (1 - A) }; });
    fs.renameSync(tmp, out);
    PROG[jobId] = { ...PROG[jobId], phase: 'done', p: 1 };
    jobsSet(jobId, { status: 'done', files: [outRel], finishedAt: new Date().toISOString() });
    pruneCache();
  })().catch((e) => {
    PROG[jobId] = { ...PROG[jobId], phase: 'failed', error: String(e.message || e).slice(0, 300) };
    jobsSet(jobId, { status: 'failed', error: String(e.message || e).slice(0, 300), finishedAt: new Date().toISOString() });
    fs.rmSync(`${out}.part.mp4`, { force: true });
  });
  return { job: jobId, file: outRel, plan: { W: P.W, H: P.H, fps: P.fps, enhance: P.enhance } };
}

// ---------- filmstrip frames ----------

const FRAMES = path.join(ROOT, '.run', 'frames');
export function frameAt(rel, t, h = 120) {
  const src = resolveOutput(rel);
  if (!src) return null;
  const stat = fs.statSync(src);
  const tt = Math.max(0, Math.floor(Number(t) * 4) / 4); // quarter-second grid keeps the cache small
  const key = crypto.createHash('sha1').update(`${src}:${stat.mtimeMs}:${tt}:${h}`).digest('hex');
  const out = path.join(FRAMES, `${key}.jpg`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(FRAMES, { recursive: true });
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(tt), '-i', src, '-frames:v', '1', '-vf', `scale=-2:${h}`, '-q:v', '5', out], { stdio: 'ignore' });
    } catch { return null; }
    if (!fs.existsSync(out) || !fs.statSync(out).size) {
      // past the last frame: take the very last one
      try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-0.1', '-i', src, '-frames:v', '1', '-vf', `scale=-2:${h}`, '-q:v', '5', out], { stdio: 'ignore' }); } catch { return null; }
    }
  }
  return fs.existsSync(out) && fs.statSync(out).size ? out : null;
}

