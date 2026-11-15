// Client folders: create, rename, delete. Deleting a folder never deletes images:
// they move to General.
import { readClients, writeClients, moveJobs, slug } from '@/lib/files';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(readClients());
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request body' }, { status: 400 });
  const { action, id, name, note } = body;
  const clients = readClients();

  if (action === 'create') {
    const clean = String(name || '').trim();
    if (!clean) return Response.json({ ok: false, error: 'Name is empty' }, { status: 400 });
    let newId = slug(clean) || 'folder';
    while (newId === 'general' || clients.some((c) => c.id === newId)) newId += '-2';
    writeClients([...clients, { id: newId, name: clean, note: note || '' }]);
    return Response.json({ ok: true, id: newId });
  }

  if (action === 'rename') {
    const c = clients.find((x) => x.id === id);
    if (!c) return Response.json({ ok: false, error: 'No such folder' }, { status: 404 });
    if (name !== undefined) c.name = String(name).trim() || c.name;
    if (note !== undefined) c.note = String(note).trim();
    writeClients(clients);
    return Response.json({ ok: true });
  }

  if (action === 'delete') {
    if (id === 'general') return Response.json({ ok: false, error: 'General is the default folder and stays' }, { status: 400 });
    if (!clients.some((c) => c.id === id)) return Response.json({ ok: false, error: 'No such folder' }, { status: 404 });
    // same path as a board move: files, assets, .raw originals, edits and ingest records all follow (lib/files.js)
    let moved;
    try { moved = moveJobs((j) => (j.client || 'general') === id, 'general'); } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500 });
    }
    writeClients(clients.filter((c) => c.id !== id));
    return Response.json({ ok: true, movedToGeneral: moved });
  }

  return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
