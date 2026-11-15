// One way to send a file from the board's server: byte ranges (videos seek), ETag + Last-Modified (size + mtime),
// 304 when the browser already has this version. Files rewritten in place (unmark, upscale) get a new tag, so with
// Cache-Control: no-cache the browser revalidates and never shows a stale picture.
import fs from 'node:fs';

// file: what is sent; tagFrom: the file whose size + mtime name this version (the source behind a cached thumb/frame)
export function serveFile(request, file, { type = 'application/octet-stream', cache = 'private, no-cache', tagFrom = file, headers = {} } = {}) {
  const st = fs.statSync(file);
  const src = tagFrom === file ? st : fs.statSync(tagFrom);
  const size = st.size;
  const etag = `"${src.size.toString(16)}-${Math.round(src.mtimeMs).toString(16)}${tagFrom === file ? '' : `-${size.toString(16)}`}"`;
  const lastModified = new Date(Math.max(src.mtimeMs, st.mtimeMs)).toUTCString();
  const meta = { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': cache };

  const inm = request.headers.get('if-none-match');
  const ims = request.headers.get('if-modified-since');
  const fresh = inm
    ? inm.split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === etag || t === '*')
    : !!ims && Date.parse(ims) >= Math.floor(Math.max(src.mtimeMs, st.mtimeMs) / 1000) * 1000;
  if (fresh) return new Response(null, { status: 304, headers: meta });

  const base = { ...meta, 'Content-Type': type, 'Accept-Ranges': 'bytes', ...headers };
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  const rangeOk = range && (!ifRange || ifRange === etag || ifRange === lastModified);
  const m = rangeOk ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start; let end;
    if (!m[1]) { // suffix: the last N bytes
      const n = Number(m[2]);
      start = Math.max(0, size - n);
      end = size - 1;
      if (n === 0) start = size; // "bytes=-0" can never be satisfied
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    return new Response(fs.createReadStream(file, { start, end }), {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    });
  }
  // no range, a malformed one or a multi-range: the whole file (allowed by RFC 9110)
  return new Response(fs.createReadStream(file), { headers: { ...base, 'Content-Length': String(size) } });
}
