// Open TAN · download ONE Flow clip, the right one, straight into the library (law 7, law 34; MISTAKES G06).
// A Flow project can hold older clips (Flow sometimes reopens the last project), so the clip is never taken as
// "the first tile". frames.mjs snapshots the video tiles before Start and passes the new tile's key (matched by the media
// id in its URL, so a re-signed URL still matches). Without a key, or when the key matches nothing, a clip is taken only
// when it is the ONE video in the project; with more than one candidate it refuses rather than guess (another job's
// clip, an older take). The clip is opened in Flow's editor and saved with its
// "Download media" button: "<tier> Upscaled" (Flow's free upscale), or "Original size" when the clip is already at
// that tier or `tier` is "original".
import fs from 'node:fs';
import path from 'node:path';
import { wait } from './cdp.mjs';

const center = (f, expr) => f.js(`(() => { const e = ${expr}; if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
const MENU = `[...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option]')].filter((x) => x.getBoundingClientRect().width > 0)`;

// Every visible video tile on the project grid, newest first: { key (its media src), index }.
export async function videoTiles(f) {
  return f.js(`[...document.querySelectorAll('button')]
    .filter((b) => /play_circle/.test(b.textContent || '') && b.getBoundingClientRect().width > 0)
    .map((b, index) => { let t = b; for (let i = 0; i < 8 && t.parentElement; i++) { t = t.parentElement; if (t.querySelector('video,img')) break; }
      const m = t.querySelector('video,img'); return { key: (m && (m.currentSrc || m.getAttribute('src'))) || '', index }; })`);
}

// A clip's stable identity: Flow's media id (the name= of its media URL; same rule as gflow), else the URL without its
// query (the signature changes, the path does not). Pure.
export function clipId(src) {
  const s = String(src || '');
  const m = s.match(/[?&]name=([0-9a-f-]+)/i);
  return m ? m[1] : s.split('?')[0] || null;
}

// Which tile is ours. Pure, so it can be tested without Flow.
export function pickTile(tiles, key = null) {
  const id = key ? clipId(key) : null;
  const mine = key ? tiles.find((t) => t.key === key || (id && clipId(t.key) === id)) : null;
  if (mine) return mine;
  if (tiles.length === 1) return tiles[0];
  throw new Error(`${tiles.length} clips in the open Flow project and ${key ? `none is ours (${id})` : 'no clip identity'} — refusing to guess which to download (MISTAKES G06)`);
}

// Which download row to click. Pure, so it can be tested without Flow.
export function pickTier(offered, tier = 'original') {
  if (tier === 'original') return offered.find((t) => /Original size/.test(t)) || null;
  return offered.find((t) => new RegExp(`^${tier}\\s*Upscaled`).test(t))
    || offered.find((t) => new RegExp(`^${tier}\\s*Original size`).test(t)) // already made at that tier
    || null;
}

export async function downloadClip(f, { dir, name, tier = 'original', key = null, dry = false }) {
  const tiles = await videoTiles(f);
  if (!tiles.length) throw new Error('no video tile in the open Flow project');
  const tile = pickTile(tiles, key);
  // open the clip's editor: click the tile's picture (the play button only plays it inline)
  const media = await center(f, `(() => { let t = [...document.querySelectorAll('button')].filter((b) => /play_circle/.test(b.textContent || '') && b.getBoundingClientRect().width > 0)[${tile.index}];
    for (let i = 0; i < 8 && t.parentElement; i++) { t = t.parentElement; if (t.querySelector('video,img')) break; } return t.querySelector('video,img'); })()`);
  await f.clickAt(media);
  let dl = null;
  for (let i = 0; i < 30 && !dl; i++) { await wait(500); dl = await center(f, `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Download media' && b.getBoundingClientRect().width > 0)`).catch(() => null); } // the editor may reload the page
  if (!dl) throw new Error('the clip editor did not open (no Download media button)');
  const back = async () => {
    await f.escape();
    const b = await center(f, `[...document.querySelectorAll('button')].find((x) => /^Back button/.test(x.getAttribute('aria-label') || ''))`);
    if (b) { await f.clickAt(b); await wait(1500); }
  };
  await f.clickAt(dl); await wait(800);
  const offered = await f.js(`${MENU}.map((x) => x.textContent.trim())`);
  const want = pickTier(offered, tier);
  if (!want || dry) { await back(); if (dry) return { ok: true, dry: true, offered, picked: want }; throw new Error(`no ${tier} download for this clip (offered: ${offered.join(' · ')})`); }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(dir, '.flow-dl-'));
  try {
    await f.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp });
    await f.clickAt(await center(f, `${MENU}.find((x) => x.textContent.trim() === ${JSON.stringify(want)})`));
    const t0 = Date.now();
    let got = null;
    for (let i = 0; i < 600 && !got; i++) { await wait(1000); got = fs.readdirSync(tmp).find((n) => /\.(mp4|mov|webm)$/i.test(n)); }
    if (!got) throw new Error('download did not arrive within 10 min');
    const dest = path.join(dir, name);
    fs.renameSync(path.join(tmp, got), dest);
    return { ok: true, file: dest, offered, picked: want, seconds: Math.round((Date.now() - t0) / 1000) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await back();
  }
}
