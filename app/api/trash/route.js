// The board's trash: list (and sweep expired files to the Mac Trash), restore, erase.
import { listTrash, sweepTrash, restoreItem, purgeItems, RETENTION_MS } from '@/lib/trash';

export const dynamic = 'force-dynamic';

export function GET(request) {
  // ?sweep=1 forces the 1-day hand-off to the Mac Trash now (testing / after a long sleep)
  try { sweepTrash({ force: new URL(request.url).searchParams.get('sweep') === '1' }); } catch {}
  // ?kind=image|video: each segment sees only its own trash (law 22)
  const kind = new URL(request.url).searchParams.get('kind');
  const items = listTrash().filter((i) => !kind || i.kind === kind);
  return Response.json({ items, retentionMs: RETENTION_MS }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'restore') return Response.json({ ok: true, ...restoreItem(body.name) });
    if (body.action === 'purge') return Response.json({ ok: true, erased: purgeItems(Array.isArray(body.names) ? body.names : []) });
    // Empty Trash empties only the segment it was pressed in
    if (body.action === 'empty') return Response.json({ ok: true, erased: purgeItems(listTrash().filter((i) => !body.kind || i.kind === body.kind).map((i) => i.name)) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
  return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
