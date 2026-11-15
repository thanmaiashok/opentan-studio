// Read access to what the studio CLI writes (data/ and outputs/), plus the one locked way to change data/jobs.json.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const OUTPUTS = path.join(ROOT, 'outputs');
export const JOBS = path.join(ROOT, 'data', 'jobs.json');
export const REF_DIR = path.join(ROOT, 'posters', '.codex', 'skills', 'poster-art-director', 'references', 'images');
const SERVABLE = [OUTPUTS, path.join(ROOT, 'posters'), path.join(ROOT, 'library', 'clients')];
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i;
// Hidden folders the board may read from: video originals, the trash, the art-direction references (posters/.codex)
const DOT_OK = new Set(['.raw', '.trash', '.codex']);

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Local calendar day (the Mac's clock, IST), never the UTC one: date folders follow the owner's day.
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function readState() {
  return {
    jobs: readJson(JOBS, []),
    credits: readJson(path.join(ROOT, 'data', 'credits.json'), null),
    // each client folder carries its logo icon when the kit has one (library/clients/<id>/icon.png, law 5)
    clients: readJson(path.join(ROOT, 'library', 'clients.json'), []).map((c) => {
      const icon = path.join(ROOT, 'library', 'clients', c.id, 'icon.png');
      return fs.existsSync(icon) ? { ...c, icon: path.relative(ROOT, icon) } : c;
    }),
  };
}

// ---------- data/jobs.json lock (shared protocol with bin/studio.mjs) ----------
// Lock file data/jobs.json.lock made with open(…, 'wx') holding our pid; busy → retry every 25 ms for up to 3 s;
// a lock older than 10 s is stale (its writer died): unlink and retry. Released by unlink.
const LOCK = `${JOBS}.lock`;
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let holding = false;

function lockJobs() {
  const until = Date.now() + 3000;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    try {
      if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) { fs.unlinkSync(LOCK); continue; }
    } catch { continue; } // vanished between open and stat: try again at once
    if (Date.now() > until) throw new Error('data/jobs.json is busy (locked by another writer)');
    nap(25);
  }
}

// Read data/jobs.json, let fn change the array IN PLACE (sync only), write it back atomically (tmp + rename) when it
// changed — all under the lock. Returns what fn returns. Never nest: fn must not call withJobs again.
export function withJobs(fn) {
  if (holding) throw new Error('withJobs is not re-entrant');
  fs.mkdirSync(path.dirname(JOBS), { recursive: true });
  lockJobs();
  holding = true;
  try {
    let before = '[]';
    try { before = fs.readFileSync(JOBS, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const jobs = JSON.parse(before); // a broken file throws here, so it is never overwritten with []
    if (!Array.isArray(jobs)) throw new Error('data/jobs.json is not a list');
    const result = fn(jobs);
    const after = JSON.stringify(jobs, null, 2) + '\n';
    if (after !== before) {
      const tmp = `${JOBS}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, after);
      fs.renameSync(tmp, JOBS);
    }
    return result;
  } finally {
    holding = false;
    try { fs.unlinkSync(LOCK); } catch {}
  }
}

// Put a job in its createdAt place in a newest-first list (the CLI unshifts new jobs).
export function insertJob(jobs, job) {
  const at = jobs.findIndex((j) => String(j.createdAt) < String(job.createdAt));
  if (at < 0) jobs.push(job); else jobs.splice(at, 0, job);
}

// After files moved: rewrite every path a job keeps (files, assets, and the file/raw of its unmark/upscale records).
export function retargetJob(job, moves) {
  const m = (p) => (p && moves[p]) || p;
  if (Array.isArray(job.files)) job.files = job.files.map(m);
  if (Array.isArray(job.assets)) job.assets = job.assets.map(m);
  for (const k of ['unmark', 'upscale', 'flowUpscale']) {
    if (!Array.isArray(job[k])) continue;
    job[k] = job[k].map((r) => (r && typeof r === 'object' ? { ...r, ...(r.file ? { file: m(r.file) } : {}), ...(r.raw ? { raw: m(r.raw) } : {}) } : r));
  }
  return job;
}

// ---------- serving ----------
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

// Resolve a path like "outputs/clients/general/2026-11-14/x.png" safely inside outputs/, posters/ or library/clients/.
// The REAL path (symlinks followed) must stay inside too; no hidden files or folders except .raw, .trash (media only)
// and .codex (the art-direction references).
export function resolveOutput(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const abs = path.resolve(ROOT, rel);
  if (!SERVABLE.some((dir) => abs.startsWith(dir + path.sep))) return null;
  const segs = path.relative(ROOT, abs).split(path.sep);
  if (segs.slice(0, -1).some((s) => s.startsWith('.') && !DOT_OK.has(s)) || segs[segs.length - 1].startsWith('.')) return null;
  if (segs.includes('.trash') && !MEDIA.test(abs) && !/\.(glb|gltf|blend|fbx|obj|usdz)$/i.test(abs)) return null; // never the trash index
  if (!fs.existsSync(abs)) return null;
  const roots = SERVABLE.map(real).filter(Boolean);
  const r = real(abs);
  if (!r || !roots.some((dir) => r.startsWith(dir + path.sep))) return null;
  return abs;
}

// The art-direction map: every reference card, plus any new image dropped into the
// reference folder (shown as "unsorted" until Claude writes its card), plus the
// posters we generated from each recipe.
export function readArtMap() {
  const cards = readJson(path.join(ROOT, 'library', 'posters', 'references.json'), []);
  const families = readJson(path.join(ROOT, 'library', 'posters', 'families.json'), { regions: [] });
  const known = new Set(cards.map((c) => c.file));
  const unsorted = (fs.existsSync(REF_DIR) ? fs.readdirSync(REF_DIR) : [])
    .filter((f) => IMAGE.test(f) && !known.has(f))
    .sort()
    .map((file) => ({ id: file.replace(/\..*$/, ''), file, family: 'unsorted', path: path.relative(ROOT, path.join(REF_DIR, file)) }));
  const made = {};
  for (const job of readState().jobs) {
    if (job.recipe && job.status === 'done') (made[job.recipe] ||= []).push(...job.files);
  }
  return { regions: families.regions, cards: [...cards, ...unsorted], made };
}
