// A client's key components (logo, website, colours, rules, products): library/clients/<id>/kit.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '@/lib/store';

export const dynamic = 'force-dynamic';

export function GET(request) {
  const id = String(new URL(request.url).searchParams.get('client') || '').replace(/[^a-z0-9-]/g, '');
  const dir = path.join(ROOT, 'library', 'clients', id);
  let kit = null;
  try { kit = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8')); } catch {}
  if (!kit) return Response.json({ client: id, kit: null }, { headers: { 'Cache-Control': 'no-store' } });
  // Turn kit-relative file names into project paths the file/thumb routes can serve.
  const at = (f) => (f ? path.relative(ROOT, path.resolve(dir, f)) : null);
  return Response.json({
    client: id,
    dir: path.relative(ROOT, dir),
    kit: {
      ...kit,
      logo: kit.logo ? { ...kit.logo, path: at(kit.logo.file), originalPath: at(kit.logo.original) } : null,
      products: (kit.products || []).map((p) => ({ ...p, path: at(p.image) })),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
