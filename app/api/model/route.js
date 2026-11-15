// Every 3D download is a GLB (owner 2026-11-14: "the download … should be in the 3D … in the format of GLB").
// GET /api/model?job=<id>: the job's .glb asset; when it has none yet, Blender exports one from the job's
// saved .blend (headless, once), the GLB is added to the job's assets and then sent.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT, JOBS, resolveOutput, withJobs } from '@/lib/store';

export const dynamic = 'force-dynamic';

const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const busy = new Map(); // job id -> export promise, so two clicks never run two Blenders

function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS, 'utf8')); } catch { return []; }
}

function addAsset(id, rel) {
  withJobs((jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (job) job.assets = [...new Set([...(job.assets || []), rel])];
  });
}

function exportGlb(blend, out) {
  const py = `import bpy\nbpy.ops.export_scene.gltf(filepath=${JSON.stringify(out)}, export_format='GLB', export_apply=True)`;
  return new Promise((resolve) => {
    execFile(BLENDER, ['-b', blend, '--python-exit-code', '1', '--python-expr', py], { timeout: 180000, maxBuffer: 1 << 24 },
      (err, stdout, stderr) => resolve(!err && fs.existsSync(out) ? null : String(stderr || stdout || err).slice(-400)));
  });
}

const fileName = (job) => `${String(job.prompt || job.id).replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '-') || job.id}.glb`;

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('job');
  const inline = q.get('inline') === '1'; // the board's 3D stage reads it in place; a download saves it
  const job = readJobs().find((j) => j.id === id && j.type === 'model');
  if (!job) return Response.json({ error: 'no such 3D job' }, { status: 404 });

  let glb = (job.assets || []).map(resolveOutput).find((a) => a && a.endsWith('.glb'));
  if (!glb) {
    const blend = (job.assets || []).map(resolveOutput).find((a) => a && a.endsWith('.blend'));
    if (!blend) return Response.json({ error: 'this 3D job kept no .blend, so there is nothing to export' }, { status: 404 });
    const out = blend.replace(/\.blend$/, '.glb');
    if (!busy.has(id)) busy.set(id, exportGlb(blend, out).finally(() => busy.delete(id)));
    const err = await busy.get(id);
    if (err) return Response.json({ error: `GLB export failed: ${err}` }, { status: 500 });
    addAsset(id, path.relative(ROOT, out));
    glb = out;
  }
  return new Response(fs.createReadStream(glb), {
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(fs.statSync(glb).size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName(job)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
