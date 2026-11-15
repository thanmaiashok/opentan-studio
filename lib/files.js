// File-management helpers for the board: client folders and moving outputs between them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUTPUTS, readState, withJobs, retargetJob, slug } from '@/lib/store';
import { retargetClips } from '@/lib/edits';
import { renameIngest } from '@/lib/ingest';

const CLIENTS = path.join(ROOT, 'library', 'clients.json');
const CLIENT_DIR = path.join(OUTPUTS, 'clients');

export { slug };

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export const readClients = () => readState().clients;
export const writeClients = (list) => writeJson(CLIENTS, list);
// A real folder to move into: a plain slug that is General or a client in library/clients.json.
export const isClient = (id) => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && (id === 'general' || readClients().some((c) => c.id === id));

const rel = (abs) => path.relative(ROOT, abs);
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
// never overwrite: x.png → x-2.png → x-3.png
function freePath(p) {
  if (!exists(p)) return p;
  const ext = path.extname(p);
  const stem = p.slice(0, p.length - ext.length);
  let i = 2;
  while (exists(`${stem}-${i}${ext}`)) i += 1;
  return `${stem}-${i}${ext}`;
}
// outputs/clients/<client>/<date>/… → the same place under toClient (null when not a client output or already there)
function destFor(abs, toClient) {
  if (!abs.startsWith(CLIENT_DIR + path.sep)) return null;
  const parts = path.relative(CLIENT_DIR, abs).split(path.sep);
  if (parts.length < 2 || parts[0] === toClient) return null;
  return path.join(CLIENT_DIR, toClient, ...parts.slice(1));
}
function moveTo(abs, dest, moves) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const to = freePath(dest);
  fs.renameSync(abs, to);
  moves[rel(abs)] = rel(to);
  return to;
}

// Move one output file into another client folder, keeping its date sub-folder; its original in .raw/ (same name,
// law 28) goes with it and follows a -2 rename. Returns the new project path (or the old one when nothing moved).
export function moveFile(relPath, toClient, moves = {}) {
  const abs = path.resolve(ROOT, relPath);
  const dest = destFor(abs, toClient);
  if (!dest || !exists(abs)) return relPath;
  const to = moveTo(abs, dest, moves);
  const raw = path.join(path.dirname(abs), '.raw', path.basename(abs));
  if (exists(raw)) moveTo(raw, path.join(path.dirname(to), '.raw', path.basename(to)), moves);
  return rel(to);
}

// Everything one job keeps on disk moves: files, assets (.blend/.glb), recorded .raw originals, Blender frames,
// a leftover prompt file. Paths in the job follow (retargetJob).
function moveJob(job, toClient, moves) {
  const dirs = new Set();
  for (const f of [...(job.files || []), ...(job.assets || [])]) {
    const abs = path.resolve(ROOT, f);
    if (abs.startsWith(CLIENT_DIR + path.sep)) dirs.add(path.dirname(abs));
    if (!moves[f]) moveFile(f, toClient, moves);
  }
  for (const k of ['unmark', 'upscale', 'flowUpscale']) {
    for (const r of Array.isArray(job[k]) ? job[k] : []) {
      if (!r?.raw || moves[r.raw]) continue;
      const abs = path.resolve(ROOT, r.raw);
      const dest = destFor(abs, toClient);
      if (dest && exists(abs)) moveTo(abs, dest, moves);
    }
  }
  if (typeof job.id === 'string' && job.id && path.basename(job.id) === job.id && !job.id.startsWith('.')) {
    for (const dir of dirs) {
      for (const name of [path.join('.raw', `${job.id}-frames`), `.${job.id}.prompt.txt`]) {
        const abs = path.join(dir, name);
        const dest = destFor(abs, toClient);
        if (dest && exists(abs)) moveTo(abs, dest, moves);
      }
    }
  }
}

// Move whole jobs into a client folder. select: a list of job ids, or a test (job) => boolean.
// Edits and ingest records follow the moved files.
export function moveJobs(select, toClient) {
  if (!isClient(toClient)) throw new Error('No such folder');
  const pick = typeof select === 'function' ? select : (j) => Array.isArray(select) && select.includes(j.id);
  const moves = {};
  let failed = null;
  const moved = withJobs((jobs) => {
    let n = 0;
    for (const job of jobs) {
      if (!pick(job)) continue;
      try {
        moveJob(job, toClient, moves);
        job.client = toClient;
        n += 1;
      } catch (e) { failed ||= e; }
      retargetJob(job, moves); // even after a failure: the record matches what really moved
    }
    return n;
  });
  if (Object.keys(moves).length) {
    try { retargetClips(moves); } catch {}
    try { renameIngest(moves); } catch {}
  }
  if (failed) throw new Error(`moved ${moved}, then: ${failed.message}`);
  return moved;
}
