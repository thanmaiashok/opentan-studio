import { readArtMap } from '@/lib/store';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(readArtMap(), { headers: { 'Cache-Control': 'no-store' } });
}
