// Video ingest for the Edit page (laws 27 + 28): GET ?p=<file> → status · POST { files: [...] } → start + status
// · GET ?proxy=<name> → the fast-seek proxy (byte ranges, so the player can seek).
import { ensure, status, proxyFile } from '@/lib/ingest';
import { serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';

export function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get('proxy')) {
    const file = proxyFile(q.get('proxy'));
    if (!file) return new Response('Not found', { status: 404 });
    // proxy names are content-addressed (source + its size/mtime), so they may be cached for good
    return serveFile(request, file, { type: 'video/mp4', cache: 'private, max-age=604800, immutable' });
  }
  return Response.json(status(q.get('p')), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const files = Array.isArray(body.files) ? body.files.slice(0, 200) : [];
  return Response.json(Object.fromEntries(files.map((f) => [f, ensure(f)])), { headers: { 'Cache-Control': 'no-store' } });
}
