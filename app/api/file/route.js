import path from 'node:path';
import { resolveOutput } from '@/lib/store';
import { serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';

const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
};

// Videos need byte ranges so the browser can seek; no-cache + ETag so a file rewritten in place is never stale.
export function GET(request) {
  const file = resolveOutput(new URL(request.url).searchParams.get('p'));
  if (!file) return new Response('Not found', { status: 404 });
  return serveFile(request, file, { type: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
}
