// Every video that enters the studio is made ready once (owner 2026-11-14, laws 27 + 28):
//   1. the visible Veo mark comes off FIRST (bin/unmark.py, in place, original to <dir>/.raw/) —
//      unless Settings → Video → Remove Gemini watermark is off or the job already carries an unmark report;
//   2. a small fast-seek PROXY is made for the Edit page (960 px long side, keyframe every 6 frames, no B-frames),
//      so scrubbing and cuts never wait on a full-size decode.
// Runs in the board's server process, two videos at a time; state lives on globalThis so hot reloads keep it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, resolveOutput, readState, withJobs } from '@/lib/store';
import { readSettings } from '@/lib/settings';

const RUN = path.join(ROOT, '.run');
const PROXIES = path.join(RUN, 'proxies');
const DB = path.join(RUN, 'ingest.json');
const CONCURRENCY = 2;
export const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
// a failed source is tried again after RETRY_MS × tries (or at once when the file changes), at most MAX_TRIES times
const RETRY_MS = 60 * 1000;
const MAX_TRIES = 4;

const G = (globalThis.__studioIngest ||= { live: {}, queue: [], running: 0, db: null, swept: 0 });
G.fails ||= {}; // rel -> { tries, at, key }

function db() {
  if (!G.db) { try { G.db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { G.db = {}; } }
  return G.db;
}
function saveDb() {
  fs.mkdirSync(RUN, { recursive: true });
  const tmp = `${DB}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db(), null, 1));
  fs.renameSync(tmp, DB);
}

export function probeFile(abs) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', abs], { encoding: 'utf8' }));
  const v = j.streams.find((s) => s.codec_type === 'video') || {};
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find((x) => x.rotation != null)?.rotation || 0)) % 180 === 90;
  return {
    w: rot ? v.height : v.width, h: rot ? v.width : v.height,
    fps: d ? +(n / d).toFixed(3) : 30,
    dur: +Number(j.format?.duration || v.duration || 0).toFixed(3),
    audio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

const keyOf = (abs) => { const st = fs.statSync(abs); return `${st.size}-${Math.round(st.mtimeMs)}`; };
const keyOrNull = (abs) => { try { return keyOf(abs); } catch { return null; } };
const proxyPath = (rel, key) => path.join(PROXIES, `${crypto.createHash('sha1').update(`${rel}:${key}`).digest('hex').slice(0, 20)}.mp4`);

// What the Edit page needs to know about one source right now.
export function status(rel) {
  const abs = resolveOutput(rel);
  if (!abs) return { state: 'missing' };
  if (!VIDEO.test(abs)) return { state: 'error', error: 'not a video file' };
  let live = G.live[rel];
  // an error is not forever: the file changed, or the backoff passed and tries are left → start again
  if (live?.state === 'error') {
    const f = G.fails[rel];
    const changed = !f || f.key !== keyOrNull(abs);
    if (changed) delete G.fails[rel];
    if (changed || (f.tries < MAX_TRIES && Date.now() - f.at > RETRY_MS * f.tries)) { delete G.live[rel]; live = null; }
  }
  if (live) return { ...live, ...(db()[rel]?.info ? { info: db()[rel].info } : {}) };
  const rec = db()[rel];
  if (rec && rec.key === keyOf(abs) && rec.proxy && fs.existsSync(path.join(PROXIES, rec.proxy))) {
    return { state: 'ready', proxy: rec.proxy, info: rec.info, unmark: rec.unmark, v: rec.key };
  }
  return { state: 'new' };
}

// Make sure a source is clean + has a proxy; returns its status at once (work goes on in the background).
export function ensure(rel) {
  const s = status(rel);
  if (s.state === 'new') {
    let info = null;
    try { info = probeFile(resolveOutput(rel)); } catch {}
    G.live[rel] = { state: 'queued', info };
    G.queue.push(rel);
    pump();
    return G.live[rel];
  }
  return s;
}

function pump() {
  while (G.running < CONCURRENCY && G.queue.length) {
    const rel = G.queue.shift();
    G.running += 1;
    work(rel).then(() => { delete G.fails[rel]; }, (e) => {
      const key = keyOrNull(resolveOutput(rel) || '');
      const prev = G.fails[rel];
      const tries = prev && prev.key === key ? prev.tries + 1 : 1;
      G.fails[rel] = { tries, at: Date.now(), key };
      G.live[rel] = { state: 'error', error: String(e.message || e).slice(0, 200), tries, retry: tries < MAX_TRIES };
    })
      .finally(() => { G.running -= 1; if (G.live[rel]?.state !== 'error') delete G.live[rel]; pump(); });
  }
}

const runP = (cmd, args) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

// The job that owns this file (if any) and whether it already went through unmark.
function jobFor(rel) {
  return readState().jobs.find((j) => (j.files || []).includes(rel)) || null;
}
function alreadyUnmarked(rel, abs) {
  const job = jobFor(rel);
  if (job?.engine === 'edit') return true; // made from clean sources
  // a check made before we had a measured mark map does not count: retry once a map exists (law 28)
  if ((job?.unmark || []).some((u) => u.file === rel && !u.noMap)) return true;
  if (fs.existsSync(path.join(path.dirname(abs), '.raw', path.basename(abs)))) return true;
  const seen = db()[rel]?.unmark;
  return !!seen && !seen.noMap;
}

async function unmark(rel, abs) {
  G.live[rel] = { ...G.live[rel], state: 'cleaning' };
  const tmp = abs.replace(VIDEO, '.clean.mp4');
  if (tmp === abs) throw new Error('not a video file'); // never let the clean copy be the source itself
  const res = await runP('python3', [path.join(ROOT, 'bin', 'unmark.py'), abs, '--out', tmp, '--json', '--keep-if-none']);
  let report = null;
  try { report = JSON.parse(res.out.slice(res.out.indexOf('{'), res.out.lastIndexOf('}') + 1)); } catch {}
  let entry;
  if (res.code !== 0 || !report) entry = { file: rel, found: null, error: true };
  else if (!report.found) entry = { file: rel, found: false, ...(report.reason ? { noMap: true } : {}) };
  else {
    const raw = path.join(path.dirname(abs), '.raw');
    fs.mkdirSync(raw, { recursive: true });
    fs.renameSync(abs, path.join(raw, path.basename(abs)));
    fs.renameSync(tmp, abs);
    const m = report.mark || {};
    entry = { file: rel, found: true, profile: m.profile, size: m.size, gain: m.gain, score: m.score, raw: path.relative(ROOT, path.join(raw, path.basename(abs))), by: 'board' };
  }
  if (tmp !== abs && fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  // the job remembers it, like a CLI job does (law 28)
  withJobs((jobs) => {
    const job = jobs.find((j) => (j.files || []).includes(rel));
    if (job) job.unmark = [...(job.unmark || []).filter((u) => u.file !== rel), entry];
  });
  return entry;
}

async function makeProxy(rel, abs, key) {
  G.live[rel] = { ...G.live[rel], state: 'proxy' };
  fs.mkdirSync(PROXIES, { recursive: true });
  const out = proxyPath(rel, key);
  const tmp = `${out}.tmp.mp4`;
  const res = await runP('ffmpeg', ['-v', 'error', '-y', '-i', abs,
    '-vf', "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))':flags=bicubic,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'fastdecode', '-crf', '23', '-g', '6', '-keyint_min', '6', '-bf', '0', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', tmp]);
  if (res.code !== 0 || !fs.existsSync(tmp)) throw new Error(`proxy failed: ${res.out.trim().split('\n').pop()}`);
  fs.renameSync(tmp, out);
  return path.basename(out);
}

async function work(rel) {
  const abs = resolveOutput(rel);
  if (!abs) throw new Error('source missing');
  if (!VIDEO.test(abs)) throw new Error('not a video file');
  let unmarkEntry = db()[rel]?.unmark || null;
  if (readSettings().video.removeWatermark !== false && !alreadyUnmarked(rel, abs)) unmarkEntry = await unmark(rel, abs);
  const key = keyOf(abs); // after unmark: the clean file is the one we keep
  const info = probeFile(abs);
  const old = db()[rel]?.proxy;
  const proxy = await makeProxy(rel, abs, key);
  if (old && old !== proxy) fs.rmSync(path.join(PROXIES, old), { force: true });
  db()[rel] = { key, proxy, info, unmark: unmarkEntry || { file: rel, found: false, skipped: true } };
  saveDb();
}

export function proxyFile(name) {
  const abs = path.join(PROXIES, path.basename(String(name || '')));
  return fs.existsSync(abs) ? abs : null;
}

// "As soon as the clip enters anywhere" (owner 2026-11-14): every finished video job on the board is made ready
// in the background, so a video added by hand or by any tool also loses the mark before anyone edits it.
export function sweepVideos() {
  const now = Date.now();
  if (now - G.swept < 15000) return;
  G.swept = now;
  for (const job of readState().jobs) {
    if (job.type !== 'video' || job.status !== 'done') continue;
    for (const f of job.files || []) {
      if (!VIDEO.test(f)) continue;
      if (status(f).state === 'new') ensure(f);
    }
  }
}

// Files moved to another folder (lib/files.js): carry their ingest records along, so a clean file is never unmarked
// twice (law 28) and its proxy is kept. moves: { oldRel: newRel }.
export function renameIngest(moves) {
  const d = db();
  let changed = false;
  for (const [from, to] of Object.entries(moves)) {
    if (!d[from]) continue;
    d[to] = { ...d[from], ...(d[from].unmark ? { unmark: { ...d[from].unmark, file: to } } : {}) };
    delete d[from];
    if (G.fails[from]) { G.fails[to] = G.fails[from]; delete G.fails[from]; }
    changed = true;
  }
  if (changed) saveDb();
}
