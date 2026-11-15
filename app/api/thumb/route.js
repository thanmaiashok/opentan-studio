// Small JPEG thumbnails for the art-direction map, made once with macOS `sips` and cached in .run/thumbs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, resolveOutput } from '@/lib/store';
import { serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';
const CACHE = path.join(ROOT, '.run', 'thumbs');
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function GET(request) {
  const src = resolveOutput(new URL(request.url).searchParams.get('p'));
  if (!src) return new Response('Not found', { status: 404 });
  const stat = fs.statSync(src);
  const key = crypto.createHash('sha1').update(`${src}:${stat.mtimeMs}`).digest('hex');
  const out = path.join(CACHE, `${key}.jpg`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(CACHE, { recursive: true });
    try {
      execFileSync('sips', ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', src, '--out', out], { stdio: 'ignore' });
    } catch {
      fs.rmSync(out, { force: true });
      // sips could not read it: an image we know goes out whole with its own type; anything else has no thumbnail
      const type = IMAGES[path.extname(src).toLowerCase()];
      if (type) return serveFile(request, src, { type });
      return new Response('No thumbnail for this file type', { status: 415 });
    }
  }
  return serveFile(request, out, { type: 'image/jpeg', tagFrom: src });
}
