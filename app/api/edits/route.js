// Video → Edit page (law 27). GET: every edit (newest first) or one (?id=). POST: { action: create | save | delete | export }.
import { listEdits, readEdit, createEdit, saveEdit, deleteEdit, exportEdit, exportProgress } from '@/lib/edits';
import { readSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export function GET(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id');
  if (q.get('progress')) return Response.json(exportProgress(q.get('progress')) || { phase: 'unknown' }, { headers: { 'Cache-Control': 'no-store' } });
  if (q.get('defaults')) return Response.json(readSettings().edit, { headers: { 'Cache-Control': 'no-store' } });
  if (id) {
    const e = readEdit(id);
    return e ? Response.json(e) : Response.json({ error: 'not found' }, { status: 404 });
  }
  // ?ensure=1: the Edit page always has one edit to open; made here (sync, one process) so two loads never make two
  let edits = listEdits();
  if (!edits.length && q.get('ensure')) edits = [createEdit()];
  return Response.json({ edits }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'create') return Response.json(createEdit(body));
    if (body.action === 'save') {
      const e = saveEdit(body.edit || {});
      return e ? Response.json(e) : Response.json({ error: 'not found' }, { status: 404 });
    }
    if (body.action === 'delete') { deleteEdit(body.id); return Response.json({ ok: true }); }
    if (body.action === 'export') return Response.json(exportEdit(body.id, body.options || {}));
    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
