# EDIT — the Video → Edit page (law 27)

Owner 2026-11-14: "add one more page, which is edits … adding clips, adding some small transition … not major
editing … not about motion graphic, it is just about clipping, timings … maybe one or two, a smooth transition and a
sudden cut transition … just like Google Flow … if I go to any of my generations I can see a simple editing tool."

Status: BUILT 2026-11-14, optimised the same day (ingest + proxies, 3-slot player, export card, parallel cached render) (owner: "i want simple editing ui … go for it"). Code: `components/EditView.js` (page), `lib/edits.js`
(model, export, frames), `app/api/edits` (list · create · save · delete · export), `app/api/frame` (filmstrip stills).

## What it is
A minimal clip editor, like the editor Google Flow opens on a generation: one big preview, transport under it, one
timeline strip of clips with a `+` to add the next clip. Not FoxMotion (no motion graphics, type, camera, glass).

## The model — an edit is data
One edit = one JSON file (`data/edits/<id>.json`); the source videos are never touched.
```json
{ "id": "…", "title": "…", "client": "…", "ratio": "16:9", "fps": 30,
  "clips": [
    { "src": "outputs/clients/…/a.mp4", "in": 0.0, "out": 4.0 },
    { "src": "outputs/clients/…/b.mp4", "in": 0.5, "out": 3.5, "join": "smooth" }
  ] }
```
- **clip** = a source video + `in` / `out` (trim). Length on the timeline = `out − in`.
- **order** = position in `clips`. Reorder = move the row.
- **join** = how a clip meets the one before it: `cut` (default) or `smooth`. Only these two.
- **timeline time** = sum of clip lengths, minus the overlap of each `smooth` join.

## The operations (all of them)
| op | what | notes |
|---|---|---|
| add | append a clip from All Videos (`+` after the last clip) · or the video viewer's **Edit** button = new edit with that video | starts as the full clip |
| trim | drag a clip's left / right handle = set `in` / `out` | min length 0.5 s; never past the source |
| split | cut one clip in two at the playhead (button or S) | two rows, same `src`; each half ≥ 0.5 s |
| remove | remove a clip (button or ⌫) | quick undo pill, no dialog |
| reorder | drag a clip left / right; a lime bar marks the drop slot | the first clip's join is always cut |
| join | per joint: cut ⇄ smooth | round chip on the seam's top edge (lime = smooth), clear of the trim handles |
| play | play / pause, prev / next clip, scrub, loop, mute, fullscreen | timecode `00:00:00` |
| zoom | timeline zoom in / out; fits the edit until you zoom, a drag or trim freezes it | seconds ruler `00 01 02 …` |
| export | card: resolution · fps · enhance (default 2K · 60 · on), then one MP4 (progress in the button) | `outputs/clients/<first clip's client>/<date>/edit-<title>-<time>.mp4`, job `engine: edit` in `data/jobs.json`, shows in All Videos |
| edits | Edits menu: switch · New · Rename… · Delete Edit | autosave 350 ms after every change |

## The two transitions
- **Cut** — the next clip starts on the frame after the last frame of the one before. No overlap. Cut on motion, not
  on a still frame (FoxMotion CRAFT §8.2: a cut at rest looks like an error).
- **Smooth** — cross-dissolve of **0.5 s**; the two clips overlap by that much. Audio crossfades the same length.
  With a short clip the dissolve shrinks to half the shorter clip, so it never eats a whole clip.
- Nothing else: no wipes, irises, zooms, whips — those are FoxMotion's job.

## Ingest — every clip is made ready first (law 28 + 27)
`lib/ingest.js`, `/api/ingest`. When a clip enters an edit (or any finished video job appears on the board — the
`/api/jobs` sweep, every 15 s), two at a time in the board's server:
1. **Gemini / Veo mark off FIRST** — `bin/unmark.py` in place, original to `<dir>/.raw/`, the job gets an `unmark`
   report (`by: board`). Skipped when Settings → Video → Remove Gemini watermark is off, the job already has a report,
   a `.raw/` original exists, or the job is an Edit export (made from clean sources).
2. **Proxy** — 960 px long side, H.264 `-g 6 -bf 0 -tune fastdecode`, AAC 48 k, in `.run/proxies/`; served with byte
   ranges from `/api/ingest?proxy=`. State in `.run/ingest.json` (keyed by file size + mtime).
The clip shows a lime shimmer + "Removing mark" / "Preparing" badge until ready; Export waits for all clips.

## Playback (no glitch)
- THREE `<video>` slots; clip i plays in slot i % 3, so the next two clips always wait loaded at their first frame.
- The oldest visible clip's own video drives the clock: the clock catches up with it, waits only when it is a hair
  behind, and moves a video that is far behind (`components/EditView.js` tick). Smooth = opacity + volume ramp.
- The playhead and the time text follow a tiny clock store (`useSyncExternalStore`), so the page does not re-render
  every frame; the rest reads the time 5× a second. The timeline scrolls to keep the playhead in view.
- Tested 2026-11-14 in a visible Chrome: 9 s edit, cut + smooth + a vertical clip — clock 1:1 with the video, page at
  58.5 fps, longest frame gap 34 ms, the cut lands with the next clip already playing.

## Export (law 27: default 2K · 60 fps · Enhance)
Card from the Export button: Resolution (Source · 1080p · 2K · 4K, long side 1920 / 2560 / 3840) · Frame rate (30 · 60)
· Enhance (TAN Upscaler Clean, only when the picture grows). Defaults from `data/settings.json → edit` (Settings → Video →
Edit export). Pipeline (`lib/edits.js`), built like FoxMotion's render (MISTAKES R03, R07):
- **A. pieces, in parallel** (CORES/2, max 6): per clip `-ss in -t len` → fit to the first clip's shape (letterbox)
  → `tpad` + `minterpolate` (mci, obmc, bilat, epzs) when the clip is slower than the target fps, else `fps=` →
  Lanczos to size, or TAN Upscaler (`bin/upscale.py --scale`) when Enhance → AAC 48 k stereo (silence for mute clips).
  Cached in `.run/render-cache/<hash>.mp4` by source + in/out + size + fps + enhance (pruned after 7 days).
- **B. join**: all cuts and same size → concat demuxer `-c copy` (seconds); else one `xfade` / `acrossfade` pass,
  x264 medium CRF 16, `+faststart`.
- Progress in memory → `/api/edits?progress=<job>` → the button fills ("Exporting 42%", "Joining 90%", "Saved to Videos").
- Timings (M5, 10 cores): 9 s, 3 clips 720p24 → 2K60 enhanced = 40 s; the same again (cached) = 6 s;
  1080p30 all cuts = 9 s. Exact length: 540 frames for 9.000 s.
- Lesson: `minterpolate` drops ~4 frames at a clip's end (nothing to interpolate towards) → `tpad=stop_mode=clone`
  before it, then `-t len`.

## Export graph (reference)
- Export: ffmpeg (installed, has `trim`, `xfade`, `acrossfade`, `concat`). Each clip → `trim`/`atrim` + `setpts`;
  normalise size / fps / sample rate first; `cut` joins → `concat`; `smooth` joins → `xfade=transition=fade` +
  `acrossfade`. A clip with no audio gets silence (`anullsrc`) so streams stay in step.
- Mixed ratios: the edit takes the FIRST clip's size / shape; others are letterboxed, never stretched.
- Tested 2026-11-14: 4 clips (cut, smooth, cut, smooth, one vertical) → 12.5 s exactly; dissolves at the joins, the cut
  lands on the frame, the vertical clip letterboxed.
