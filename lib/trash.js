// The board's trash ("Recently deleted"), owner 2026-11-14.
//
// - Deleting an image moves it into outputs/.trash/ and writes an entry in outputs/.trash/index.json
//   ({ name, from, job, client, deletedAt, extra }) so it can be put back exactly where it was.
// - What belongs to it goes along in outputs/.trash/.extra/<name>/ (entry.extra): its .raw original, and with a job's
//   last file the job's assets (.blend/.glb), Blender frames and prompt file. Restore puts them back too.
// - It stays there for RETENTION_MS (1 day). After that sweepTrash() hands it to the Mac's own Trash
//   with /usr/bin/trash (Finder Trash, "Put Back" still works there).
// - Restore moves the file back to its folder and puts its job back in data/jobs.json.
// - Delete from the trash (purge / empty) erases the file for good. The board guards it with a 5 s undo.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, OUTPUTS, readState, withJobs, insertJob, retargetJob, localDay } from '@/lib/store';

export const RETENTION_MS = 24 * 60 * 60 * 1000;
export const TRASH = path.join(OUTPUTS, '.trash');
const INDEX = path.join(TRASH, 'index.json');
const EXTRA = path.join(TRASH, '.extra');
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
const MODEL = /\.(glb|gltf|blend|fbx|obj|usdz)$/i;
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v|glb|gltf|blend|fbx|obj|usdz)$/i;
// Image, Video and 3D keep separate trashes on the board (owner 2026-11-14: "keep everything separate")
export const kindOf = (name) => (VIDEO.test(name) ? 'video' : MODEL.test(name) ? 'model' : 'image');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const readIndex = () => readJson(INDEX, { items: {} });
const rel = (abs) => path.relative(ROOT, abs);
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
// A name is only ever a plain file name inside outputs/.trash.
const safeName = (name) => (typeof name === 'string' && name === path.basename(name) && MEDIA.test(name) ? name : null);
// Only our own outputs ever move (never the trash itself)
const ownPath = (p) => {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(ROOT, p);
  return abs.startsWith(OUTPUTS + path.sep) && !abs.startsWith(TRASH + path.sep) && exists(abs) ? abs : null;
};

function freeName(dir, base) {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let name = base;
  for (let i = 2; exists(path.join(dir, name)); i++) name = `${stem}-${i}${ext}`;
  return name;
}

// What goes with one output: its original(s) in .raw/ (same name, or the one its unmark/upscale record names).
function companionsOf(job, fileRel, abs) {
  const out = new Set();
  const same = path.join(path.dirname(abs), '.raw', path.basename(abs));
  if (exists(same)) out.add(same);
  for (const k of ['unmark', 'upscale', 'flowUpscale']) {
    for (const r of Array.isArray(job?.[k]) ? job[k] : []) {
      const raw = r?.file === fileRel && ownPath(r.raw);
      if (raw) out.add(raw);
    }
  }
  return [...out].map((p) => ({ abs: p, role: 'raw' }));
}

// What goes with a job's last output: its assets, Blender frames and a leftover prompt file.
function leftoversOf(job, skip = []) {
  const out = [];
  const dirs = new Set();
  for (const f of [...(job.files || []), ...(job.assets || [])]) dirs.add(path.dirname(path.resolve(ROOT, f)));
  for (const a of job.assets || []) {
    const abs = ownPath(a);
    if (abs && !skip.includes(abs)) out.push({ abs, role: 'asset' });
  }
  if (typeof job.id === 'string' && job.id && path.basename(job.id) === job.id && !job.id.startsWith('.')) {
    for (const dir of dirs) {
      for (const [name, role] of [[path.join('.raw', `${job.id}-frames`), 'frames'], [`.${job.id}.prompt.txt`, 'prompt']]) {
        const abs = ownPath(path.join(dir, name));
        if (abs) out.push({ abs, role });
      }
    }
  }
  return out;
}

// Move one output into the trash and remember where it came from. extras: [{ abs, role }] that go with it.
export function trashFile(abs, job, extras = []) {
  fs.mkdirSync(TRASH, { recursive: true });
  const name = freeName(TRASH, path.basename(abs));
  fs.renameSync(abs, path.join(TRASH, name));
  const from = rel(abs);
  const extra = [];
  if (extras.length) {
    const dir = path.join(EXTRA, name);
    fs.rmSync(dir, { recursive: true, force: true }); // a stale folder from an erased item of the same name
    fs.mkdirSync(dir, { recursive: true });
    for (const x of extras) {
      try {
        const stored = freeName(dir, path.basename(x.abs));
        fs.renameSync(x.abs, path.join(dir, stored));
        extra.push({ file: stored, from: rel(x.abs), role: x.role });
      } catch { /* left in place: still on disk, just not in the trash */ }
    }
  }
  const index = readIndex();
  index.items[name] = {
    name, from, client: job?.client || null, deletedAt: new Date().toISOString(),
    // the job copy keeps only what this entry can bring back
    job: job ? { ...job, files: [from], assets: extra.filter((x) => x.role === 'asset').map((x) => x.from) } : null,
    ...(extra.length ? { extra } : {}),
  };
  writeJson(INDEX, index);
  return name;
}

// Delete outputs of one job (DELETE /api/jobs). targets: the files to go; last: the job goes with them, so its
// assets and companions go into the trash with the last file (or, when it has no file left on disk, with its first
// asset). Returns how many trash entries were made.
export function trashJobFiles(job, targets, last) {
  const live = targets.map((f) => ({ f, abs: ownPath(f) })).filter((t) => t.abs);
  let made = 0;
  live.forEach(({ f, abs }, i) => {
    const extras = companionsOf(job, f, abs);
    if (last && i === live.length - 1) extras.push(...leftoversOf(job));
    trashFile(abs, job, extras);
    made += 1;
  });
  if (last && !live.length) {
    const rest = leftoversOf(job);
    const main = rest.find((x) => x.role === 'asset');
    if (main) { trashFile(main.abs, job, rest.filter((x) => x !== main)); made += 1; }
  }
  return made;
}

// Every file in the trash, newest first. Files that arrived without an entry (older deletes) get one
// now, so their day starts from when the board first saw them.
export function listTrash() {
  if (!fs.existsSync(TRASH)) return [];
  const index = readIndex();
  const names = fs.readdirSync(TRASH).filter((f) => MEDIA.test(f));
  let changed = false;
  for (const name of names) {
    if (!index.items[name]) { index.items[name] = { name, from: null, client: null, job: null, deletedAt: new Date().toISOString() }; changed = true; }
  }
  for (const name of Object.keys(index.items)) if (!names.includes(name)) { delete index.items[name]; changed = true; }
  if (changed) writeJson(INDEX, index);
  return names.map((name) => {
    const it = index.items[name];
    const deleted = new Date(it.deletedAt).getTime();
    return {
      name,
      kind: it.job?.type === 'model' ? 'model' : kindOf(name), // 3D renders keep their own trash
      file: rel(path.join(TRASH, name)),
      from: it.from,
      client: it.client,
      prompt: it.job?.prompt || null,
      ratio: it.job?.ratio || null,
      deletedAt: it.deletedAt,
      expiresAt: new Date(deleted + RETENTION_MS).toISOString(),
    };
  }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// After a day, hand expired files to the Mac Trash. Throttled: the board polls often.
let lastSweep = 0;
export function sweepTrash({ force = false } = {}) {
  if (!force && Date.now() - lastSweep < 10 * 60 * 1000) return 0;
  lastSweep = Date.now();
  let moved = 0;
  const items = listTrash(); // first: it may add entries to the index
  const index = readIndex();
  for (const item of items) {
    if (new Date(item.expiresAt).getTime() > Date.now()) continue;
    try {
      execFileSync('/usr/bin/trash', [path.join(TRASH, item.name)], { stdio: 'ignore' });
      const extra = path.join(EXTRA, item.name);
      if (exists(extra)) { try { execFileSync('/usr/bin/trash', [extra], { stdio: 'ignore' }); } catch {} }
      delete index.items[item.name];
      moved++;
    } catch { /* leave it; try again next sweep */ }
  }
  if (moved) writeJson(INDEX, index);
  return moved;
}

// Put one file back in its folder and its job back on the board. When its client folder was deleted meanwhile,
// it goes to General (same date folder) instead of bringing a dead client back.
export function restoreItem(name) {
  if (!safeName(name)) throw new Error('bad name');
  const src = path.join(TRASH, name);
  if (!fs.existsSync(src)) throw new Error('not in trash');
  const index = readIndex();
  const it = index.items[name] || {};
  const clients = new Set(['general', ...readState().clients.map((c) => c.id)]);
  const job = it.job;
  let client = job?.client || it.client || 'general';
  if (!clients.has(client)) client = 'general';

  const okFrom = it.from && it.from.startsWith('outputs/') && !it.from.startsWith('outputs/.trash/');
  let destRel = okFrom ? it.from : `outputs/clients/${client}/${localDay()}/${name}`;
  // a client output whose folder is gone → the same date folder under General
  const parts = destRel.split('/');
  if (parts[0] === 'outputs' && parts[1] === 'clients' && parts.length >= 4 && !clients.has(parts[2])) {
    parts[2] = 'general';
    client = 'general';
    destRel = parts.join('/');
  }
  let dest = path.join(ROOT, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (exists(dest)) { dest = path.join(path.dirname(dest), freeName(path.dirname(dest), path.basename(dest))); destRel = rel(dest); }
  fs.renameSync(src, dest);

  // what went with it comes back next to it; moves records old → new so the job's paths follow
  const moves = {};
  if (it.from) moves[it.from] = destRel;
  const oldDir = it.from ? path.dirname(path.resolve(ROOT, it.from)) : null;
  const restoredAssets = [];
  for (const x of Array.isArray(it.extra) ? it.extra : []) {
    const stored = path.join(EXTRA, name, path.basename(String(x.file)));
    if (!exists(stored)) continue;
    const fromAbs = path.resolve(ROOT, String(x.from || ''));
    let to = oldDir && fromAbs.startsWith(oldDir + path.sep)
      ? path.join(path.dirname(dest), path.relative(oldDir, fromAbs)) // same folder layout next to the file
      : fromAbs;
    // the original of a renamed file takes its new name (.raw/<name>, law 28)
    if (x.role === 'raw' && it.from && path.basename(fromAbs) === path.basename(it.from)) to = path.join(path.dirname(to), path.basename(dest));
    if (!to.startsWith(OUTPUTS + path.sep) || to.startsWith(TRASH + path.sep)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (exists(to)) to = path.join(path.dirname(to), freeName(path.dirname(to), path.basename(to)));
    try { fs.renameSync(stored, to); } catch { continue; }
    moves[x.from] = rel(to);
    if (x.role === 'asset') restoredAssets.push(rel(to));
  }
  try { fs.rmdirSync(path.join(EXTRA, name)); } catch {}

  withJobs((jobs) => {
    const live = job && jobs.find((j) => j.id === job.id);
    if (live) {
      live.files = [...new Set([...(live.files || []), destRel])];
      if (restoredAssets.length) live.assets = [...new Set([...(live.assets || []), ...restoredAssets])];
      retargetJob(live, moves); // its unmark/upscale records follow a renamed or re-homed file
    } else if (job) {
      insertJob(jobs, retargetJob({ ...job, client, files: [destRel], assets: restoredAssets, status: job.status || 'done' }, moves));
    } else {
      const made = fs.statSync(dest).mtime.toISOString();
      const type = kindOf(name);
      insertJob(jobs, {
        id: name.replace(/\.[^.]+$/, ''), type, engine: 'restored', model: 'Restored file',
        prompt: `Restored · ${name}`, status: 'done', files: [destRel], createdAt: made, finishedAt: made,
        client, note: 'restored from the trash; its original job record was not kept',
      });
    }
  });
  delete index.items[name];
  writeJson(INDEX, index);
  return { file: destRel, client };
}

// Erase for good (the owner's "delete from the trash").
export function purgeItems(names) {
  const index = readIndex();
  let gone = 0;
  for (const name of names) {
    if (!safeName(name)) continue;
    const abs = path.join(TRASH, name);
    if (fs.existsSync(abs)) { fs.unlinkSync(abs); gone++; }
    fs.rmSync(path.join(EXTRA, name), { recursive: true, force: true });
    delete index.items[name];
  }
  writeJson(INDEX, index);
  return gone;
}
