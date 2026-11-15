# INDEX — every part of Open TAN, what it is for, and its law
`bin/studio.mjs where "<topic>"` searches this file. Laws are numbered in `STUDIO.md` (Owner laws). Update this file in
the same turn as any new file, command, route or board part (law 17).

## Start here
| path | what | law |
|---|---|---|
| `AGENTS.md` (+ `QWEN.md`, `GEMINI.md` links) | start file for ANY agent: connect the tools on a new machine, rules for connecting CLIs, every-session steps | 37 |
| `CLAUDE.md` | first thing every session (Claude); rules that never change | 17 |
| `README.md` · `docs/readme/` | public front page: animated OpenTan Studio banner (the board intro's reveal ending on the title), board screenshots without client data | 36 |
| `library/connections.json` · `studio doctor` | every tool: what for, required/optional, install, sign-in, check · doctor prints ready / MISSING / off + the fix | 37 |
| `STUDIO.md` | banner laws · ROUTER · THE WORKFLOW (image · video · 3D) · Laws by director · GitHub repos · knowledge map · defaults · Owner laws 1–37 · law map · limits · commands | all |
| `INDEX.md` | this map | 17 |
| `guide/MISTAKES.md` | never-again rows: A01–A03, L01–L03, K01, P01, Q01, T01, R01–R02 → `studio verify` / pre-prompt check | 18 |
| `guide/PROMPTING.md` | how to prompt the image model (OpenAI guide → sections, image roles, photo rules, text, iteration, pre-prompt check) | 10, 19 |
| `guide/EDIT.md` | the Video → Edit page: clip model, ops, cut / smooth joins, ffmpeg export | 27 |
| `components/EditView.js` · `lib/edits.js` | Edit page (preview, transport, timeline) · edit model, ffmpeg export, filmstrip frames | 27 |
| `app/api/edits` · `app/api/frame` | edits list / create / save / delete / export (`options`) · `?progress=<job>` · `?defaults=1` · one still from a video at ?t= (cached in `.run/frames`) | 27 |
| `lib/ingest.js` · `app/api/ingest` | every video made ready: Gemini mark off first, then a fast-seek proxy (`.run/proxies`, `.run/ingest.json`); `sweepVideos()` from `/api/jobs` | 27, 28 |
| `.run/render-cache/` | Edit export pieces, cached by what made them (7 days) | 27 |
| `guide/BLENDER.md` | 3D pipeline: reference → measure → model → smooth → texture → light; shaders, light, Blender 5.2 facts | 30 |
| `tools/blender/kit.py` · `tools/blender/exposure_check.py` | Blender craft toolkit (materials, smoothing, measure, lights, compositor; load line `studio blender kit`) · render exposure/colour QC (`studio blender check`) | 30 |
| `app/api/model` | 3D download = GLB (job's .glb, or exported once from its .blend) | 30 |
| `library/3d-studios.json` · `tools/blender/shots.py` · `components/ModelDirector.js` | 3D Director: our shot types as studios · shot engine (`studio shot`) · 3D Director page + studio galleries | 32 |
| `library/textures/<source>/<slug>/` | textures for Blender: albedo + meta.json (Texturelabs via `studio texture get`, ChatGPT-made via `add`) | 31 |
| `data/edits/<id>.json` | one edit: clips (src, in, out, join) | 27 |
| memory (`~/.claude/projects/…open-studio/memory/`) | ask-before-image · client-logo-in-corner · words-choose-art-direction · prompt-by-the-book | 17 |

## Commands — `bin/studio.mjs <command>`
| command | what | law |
|---|---|---|
| `direct "<words>"` | owner words → ranked families + recipes (generates nothing) | 3 |
| `vdirect "<words>"` | owner words → ranked video studios (Video Director; generates nothing) | 25 |
| `poster <brief.json> [--dry] [--count N] [--no-logo] [--logo-place …] [--logo-overlay] [--force]` | poster from a brief + recipe; asks-first gate, pre-prompt check, logo as input | 1, 4, 6, 19 |
| `verify <job-id\|brief.json>` | never-again checks (MISTAKES ids) | 18 |
| `laws [image|video|3d|shared]` · `sec "<words>"` · `where "<topic>"` | list laws tagged by director (or one director's) · print one knowledge section · search this index | 17 · 26 |
| `image "<prompt>" [--engine codex\|flow] [--ratio] [--count] [--cinema] [--upscale] [--ref]` | free image (prompt written in law-19 sections) | 8, 10, 12 |
| `ref <kind> "<subject>" [--ref photo]` | raw-material reference image (product, ingredient, character, location, style, start-frame) | `library/REFERENCE-IMAGES.md` |
| `video "<prompt>" --seconds N [--studio <page>] [--model M] [--res 360p\|720p\|1080p] [--ratio 16:9\|9:16] [--audio] [--quality\|--final] [--over] [--native] [--start-frame img] [--end-frame img] [--many --count N] [--cost] [--no-balance] [--dry]` | Google Flow video, x1, cheapest clip in budget for exactly N s; `--studio` puts it on a Video sidebar page | 8, 9, 25, 34 |
| `credits [--ratio]` | Flow video credit costs (generates nothing) → `data/credits.json` | 9 |
| `jobs [--limit]` | recent jobs | — |
| `pins <search\|board\|get\|related\|user\|topic> "<q>" [--limit ≤30] [--save]` | Pinterest backup references (caps: 30/pull, 90/day, pause) | 13 |
| `blender status\|open [file]\|run <py> [--file]\|render <blend> […]\|export <blend> [--format]` | Blender: headless renders (3D segment) + exports; defaults from Settings → 3D | 24 |
| `unmark <video> [--out]` | remove the visible Veo mark (reverse alpha blend, `bin/unmark.py`); also automatic after every video | 28 |
| `bin/markmap.py <black.mp4> --name <mark>` | measures our own alpha map of a visible AI mark from a pure-black clip we made → `library/watermarks/marks.json` + `<name>-<height>.png` | 28 |
| `vplan <seconds> [--studio id] [--model M] [--audio] [--res 360p] [--over]` | cheapest set of Flow clips in budget for a length + credits + balance after (generates nothing) | 34 |
| `tools/flow/balance.mjs` | reads the live Flow credit balance + reset date from the signed-in Flow window (opens and closes the account panel) | 9, 34 |
| `tools/flow/cdp.mjs` · `set.mjs` · `panel.mjs` | talk to the signed-in Flow window: set the create panel to one choice and read its price (`set`), map every model × option × price read-only (`panel` → `data/flow-panel.json`) | 34 |
| `tools/flow/frames.mjs` | one Flow clip from a start (and end) frame, end to end: fresh project → panel → upload frames → prompt → price check → Start → download | 34, 35 |
| `tools/flow/download.mjs` | download THIS job's clip (never a guessed tile) from Flow's editor straight into the job folder; used by `frames` and `upscale` | 7, 34 |
| `tools/flow/upscale.mjs` | Flow's free upscale (720p / 1080p) of the job's clip, downloaded into the job folder | 29, 34 |
| `library/flow-video.json` | Flow video panel map: models, lengths, resolutions, credits, account facts | 34 |
| `upscale <file> [--to 2k|4k] [--preset ai|restore]` | TAN Upscaler (ffmpeg: Lanczos + CAS + deband; restore adds deblock + BM3D); `--upscale 2k|4k` on any make-command runs it last | 12, 29 |
| every make-command: `--client "<name>"` | client folder | 7 |

## Knowledge and data (`library/`)
| path | what | law |
|---|---|---|
| `library/posters/ART-DIRECTION.md` | poster grammar from the owner's references, rules 1–18, slop list, likeness | 4, 11 |
| `library/posters/references.json` | one card per reference (75): id, file, family, idea, field, light, type, layout, copy, path | 4, 13 |
| `library/posters/families.json` | 6 regions → 25 families: rule, use, owner words | 3, 13 |
| `library/posters/direct.mjs` | the words matcher (STRONG / WEAK words, card overlap) | 3 |
| `library/prompts.mjs` | `buildPosterPrompt` (law-19 sections, image roles, logo), `lintPosterPrompt` (pre-prompt check), `FAMILY_AVOID`, `buildReferencePrompt` | 4, 6, 10, 19 |
| `library/clients.json` | client folders: General (fixed) + one per client, with notes (local only, git-ignored) | 7 |
| `library/clients/<id>/kit.json` + files | key components: logo (+ transparent cut-out), placement, exact text + fonts, colours, type, rules, products | 5, 6 |
| `library/clients/<id>/` | a client kit: kit.json, logo.png, logo-transparent.png, icon.png, products/ (local only, git-ignored) | 5 |
| `library/REFERENCE-IMAGES.md` | rules for raw-material images | — |
| `library/cinema.mjs` | camera / lens / focal / aperture prompt builder (`--cinema`) | 10 |
| `library/apps.json` | 68 app ideas to build on top | — |
| `library/posters/pinterest.json` | source of every saved pin (created on first `pins --save`) | 13 |
| `notes/CAMERA-MAP.md` | camera moves / effects for video | — |
| `library/video-studios.json` | Video sidebar map: classic video studios → engine today, options, presets | 25 |
| `briefs/*.json` | poster briefs (with `asked`, `refLayout`) | 1, 4, 19 |

## Reference images
| path | what | law |
|---|---|---|
| `posters/.codex/skills/poster-art-director/references/images/NN-slug.png` | the owner's 75 references (new drops show as "new" on Art Direction) | 13 |
| `posters/.codex/skills/poster-art-director/references/reference-catalog.md` | batch tables per added set | 13 |
| `posters/*` generated posters (Diwali templates, milk splashes, plush foxes) | what NOT to do | 11 |

## Local data (git-ignored)
| path | what | law |
|---|---|---|
| `outputs/clients/<client>/<date>/` | every generated file | 7 |
| `data/jobs.json` | every job (prompt, refs, recipe, brief, asked, logo mode/place, files) | 7, 18 |
| `data/settings.json` | owner defaults + rule switches (Settings panel) | 20 |
| `data/credits.json` | last Flow credit probe | 9 |
| `.run/thumbs/` | thumbnail cache · `.run/dev.log` board log | — |

## Board (Next.js, `./start.sh` → http://localhost:3210, `./kill.sh`)
| part | file | law |
|---|---|---|
| page shell, dock (Image / Video), sidebar, gallery, routing (`?p=gallery\|art-direction\|folder:<id>\|kit:<id>`, `?s=video`) | `app/page.js` | 16 |
| Art Direction: **Glance** (default, all 75 on one screen: region columns, family names + counts, hover peek, click → card) and **Map** (roomy, rules + words, "new"); toggle top-right, remembered | `components/ArtMap.js` (`Glance`, `stacks`, `Detail`) · `.glance*` in `app/globals.css` | 3, 13, 16 |
| client folder grid (select, move, delete to `.trash`, sort, sizes) + Key components chip | `components/FolderView.js` | 7, 16 |
| Key components page | `components/KitView.js` | 5, 6 |
| Settings gear + panel (General status, Image / Video / 3D defaults + rules) | `components/Settings.js` | 16, 20, 21 |
| top bar, theme toggle, intro, job card, menus | `components/PageTop.js` · `ThemeToggle.js` · `Intro.js` · `JobCard.js` · `Menu.js` | 16 |
| styles: tokens (`--accent` lime), lime selection, settings, kit, map | `app/globals.css` | 16 |
| Next config (`devIndicators: false`) | `next.config.mjs` | 16 |
| data readers / file actions / settings store | `lib/store.js` · `lib/files.js` · `lib/settings.js` | 7, 20 |
| motion: sliding lime pill for every `.tabs` / `.set-seg` (timer-scheduled, works in background views) · `smooth()` View-Transition wrapper with a 250 ms safety fallback · `::view-transition-*` styles | `components/SlidingPills.js` · `lib/motion.js` · end of `app/globals.css` | 16 |

## API routes (`app/api/…/route.js`)
| route | what | law |
|---|---|---|
| `/api/jobs` | jobs + credits + clients (GET), delete output (DELETE → `outputs/.trash`) | 7 |
| `/api/clients` | create / rename / delete client folders | 7 |
| `/api/files` | move jobs between folders, reveal in Finder | 7 |
| `/api/file?p=` · `/api/thumb?p=` | serve a file / cached JPEG thumbnail (outputs, posters, library/clients) | 16 |
| `/api/art` | reference cards + regions + unsorted | 3, 13 |
| `/api/kit?client=` | a client's key components | 5 |
| `/api/settings` | read / change defaults (validated) + library numbers | 20 |
| `/api/status[?fresh]` | live tool status (codex login, gflow doctor cached 2 min, pin, cli-hub) | 21 |

## Tools on this machine
| tool | what | law |
|---|---|---|
| `codex` 0.169 | ChatGPT images (`image_generation`), refs passed with `--image` in Image-number order | 8, 19 |
| `gflow` 1.1.1 | Google Flow (video, bulk images, `--upscale`, extend) | 8, 9, 12 |
| `pin` (`~/go/bin/pin`, Go via Homebrew) | public Pinterest, logged out | 13, 21 |
| `cli-hub` 0.4.1 (pipx) | CLI Hub catalogue; can build new CLIs | 21 |
| `sharp` (node_modules) · `sips` · Python PIL | logo placement / image checks · thumbnails + conversions · logo cut-outs | 6, 13 |
