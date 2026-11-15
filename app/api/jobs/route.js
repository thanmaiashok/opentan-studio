import { readState, withJobs } from '@/lib/store';
import { trashJobFiles, sweepTrash } from '@/lib/trash';
import { sweepVideos } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

// A running job whose CLI process is gone (crash, Ctrl-C, reboot) would spin forever: the CLI writes `pid` on
// running jobs, so a dead pid ends it. Jobs without a pid are left alone.
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
};
function endDeadJobs() {
  const dead = (j) => j.status === 'running' && Number.isInteger(j.pid) && j.pid > 0 && !alive(j.pid);
  if (!readState().jobs.some(dead)) return; // cheap check first: no lock on every poll
  withJobs((jobs) => {
    const now = new Date().toISOString();
    for (const j of jobs) if (dead(j)) Object.assign(j, { status: 'failed', error: 'process ended without finishing', finishedAt: now });
  });
}

export function GET() {
  try { endDeadJobs(); } catch { /* never blocks the board */ }
  try { sweepTrash(); } catch { /* the trash sweep never blocks the board */ }
  try { sweepVideos(); } catch { /* law 28: every video loses the Gemini mark in the background; never blocks */ }
  return Response.json(readState(), { headers: { 'Cache-Control': 'no-store' } });
}

// Delete one output (or a whole job). Files are moved to outputs/.trash/ with a note of where they
// came from (lib/trash.js): restorable for 1 day, then they go to the Mac Trash. When the job's last file goes, its
// assets (.blend/.glb), .raw originals and prompt file go into the trash with it.
export function DELETE(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id');
  const file = q.get('file');
  try {
    const res = withJobs((jobs) => {
      const at = jobs.findIndex((j) => j.id === id);
      if (at < 0) return { status: 404, body: { ok: false, error: 'not found' } };
      const job = jobs[at];
      if (file && !(job.files || []).includes(file)) return { status: 400, body: { ok: false, error: 'file is not part of this job' } };
      const targets = file ? [file] : [...(job.files || [])];
      const left = (job.files || []).filter((f) => !targets.includes(f));
      const trashed = trashJobFiles(job, targets, left.length === 0);
      if (left.length) job.files = left; else jobs.splice(at, 1);
      return { status: 200, body: { ok: true, trashed } };
    });
    return Response.json(res.body, { status: res.status });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
