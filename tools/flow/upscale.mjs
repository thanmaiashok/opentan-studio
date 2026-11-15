#!/usr/bin/env node
// Open TAN · Flow's own (free) upscale of the clip just made, downloaded straight into our library (law 34, law 7).
//   node tools/flow/upscale.mjs --dir <outputs/clients/x/date> --name <file.mp4> [--tier 720p|1080p] [--key <media url|id>] [--dry]
// Works on THIS job's clip (MISTAKES G06): --key = the clip's media URL or id; without one, only when the clip is the one
// video in the open Flow project — with several candidates it refuses (ok: false), never guesses. Opens it in Flow's
// editor → Download media → "<tier> Upscaled" (or "<tier> Original size" when the clip is already at that tier),
// routes Chrome's download into --dir and renames it to --name. Flow upscales ≤ 10 s clips for free.
import path from 'node:path';
import { connect } from './cdp.mjs';
import { downloadClip } from './download.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []));
const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok ? 0 : 3); };
const f = await connect();
try {
  const r = await downloadClip(f, { dir: path.resolve(a.dir || '.'), name: a.name || 'flow-upscaled.mp4', tier: a.tier || '720p', key: a.key && a.key !== true ? String(a.key) : null, dry: !!a.dry });
  out({ ...r, tier: a.tier || '720p' });
} catch (err) {
  await f.escape().catch(() => {});
  out({ ok: false, error: err.message });
}
