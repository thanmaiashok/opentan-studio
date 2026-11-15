// One still from a video at ?t= seconds (filmstrip tiles on the Edit timeline), cached in .run/frames.
import { frameAt } from '@/lib/edits';
import { resolveOutput } from '@/lib/store';
import { serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';

export function GET(request) {
  const q = new URL(request.url).searchParams;
  const out = frameAt(q.get('p'), q.get('t') || 0, Math.min(360, Number(q.get('h')) || 120));
  if (!out) return new Response('Not found', { status: 404 });
  // tagged by the source video, so a clip cleaned or upscaled in place revalidates to its new frame
  return serveFile(request, out, { type: 'image/jpeg', tagFrom: resolveOutput(q.get('p')) || out });
}
