// The board's API answers only this Mac (owner's own studio, no login): every /api request must name a local Host
// (stops DNS rebinding and LAN devices), carry no foreign Origin (stops other websites, even no-cors POSTs) and,
// when it changes something, send JSON (a cross-site form or text/plain beacon cannot).
import { NextResponse } from 'next/server';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostPort(host) {
  const m = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d+))?$/i.exec(String(host || '').trim());
  return m ? { name: m[1].toLowerCase(), port: m[2] || '' } : null;
}

const deny = (why) => new NextResponse(JSON.stringify({ ok: false, error: `forbidden: ${why}` }), {
  status: 403, headers: { 'Content-Type': 'application/json' },
});

export function middleware(request) {
  const h = hostPort(request.headers.get('host'));
  if (!h || !LOCAL.has(h.name)) return deny('host');

  const origin = request.headers.get('origin');
  if (origin !== null) {
    let ok = false;
    try {
      const u = new URL(origin);
      ok = u.protocol === 'http:' && LOCAL.has(u.hostname.toLowerCase()) && u.port === h.port;
    } catch {}
    if (!ok) return deny('origin');
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return deny('cross-site');

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // every POST route takes JSON; DELETE /api/jobs takes no body at all
    const bodyless = method === 'DELETE' && !type;
    if (type !== 'application/json' && !bodyless) return deny('content-type');
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
