// Settings panel: read and change the owner's defaults, plus a few library numbers for the panel.
import fs from 'node:fs';
import path from 'node:path';
import { readSettings, patchSettings } from '@/lib/settings';
import { readState, REF_DIR, ROOT } from '@/lib/store';

export const dynamic = 'force-dynamic';

function info() {
  const { jobs, credits, clients } = readState();
  const done = jobs.filter((j) => j.status === 'done');
  let families = 0;
  try {
    const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', 'posters', 'families.json'), 'utf8'));
    families = f.regions.reduce((n, r) => n + r.families.length, 0);
  } catch {}
  let refs = 0;
  try { refs = fs.readdirSync(REF_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length; } catch {}
  return {
    images: done.filter((j) => j.type === 'image').reduce((n, j) => n + (j.files?.length || 0), 0),
    videos: done.filter((j) => j.type === 'video').reduce((n, j) => n + (j.files?.length || 0), 0),
    models: done.filter((j) => j.type === 'model').reduce((n, j) => n + (j.files?.length || 0), 0),
    modelAssets: done.filter((j) => j.type === 'model').reduce((n, j) => n + (j.assets?.length || 0), 0),
    refs, families, clients: clients.length,
    creditsCheckedAt: credits?.checkedAt || null,
  };
}

export function GET() {
  return Response.json({ settings: readSettings(), info: info() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Bad request body' }, { status: 400 });
  const { section, key, value } = body;
  try {
    return Response.json({ ok: true, settings: patchSettings(section, key, value) });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 400 });
  }
}
