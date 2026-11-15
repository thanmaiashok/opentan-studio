// File actions from the board: move jobs to another folder, show a file in Finder.
import { execFile } from 'node:child_process';
import { moveJobs, isClient } from '@/lib/files';
import { resolveOutput } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request body' }, { status: 400 });
  const { action, ids = [], to, file } = body;

  if (action === 'move') {
    if (!to) return Response.json({ ok: false, error: 'No target folder' }, { status: 400 });
    if (!isClient(to)) return Response.json({ ok: false, error: 'No such folder' }, { status: 400 });
    if (!Array.isArray(ids)) return Response.json({ ok: false, error: 'ids must be a list' }, { status: 400 });
    try {
      return Response.json({ ok: true, moved: moveJobs(ids.map(String), to) });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500 });
    }
  }

  if (action === 'reveal') {
    const abs = resolveOutput(file);
    if (!abs) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    execFile('open', ['-R', abs]);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
