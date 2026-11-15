# Open TAN — start here (any agent)

Open TAN is an image, video and 3D studio driven by a coding agent: Claude Code, Codex, Qwen Code, Gemini CLI,
or a local model (opencode, aider, …). The agent is the only operator. It turns the owner's words into briefs, picks
the tool, watches credits and runs `bin/studio.mjs`. The board (`./start.sh` → http://localhost:3210) only shows
results: there is no prompt box in it. macOS only.

Claude Code also reads `CLAUDE.md`. Qwen Code (`QWEN.md`) and Gemini CLI (`GEMINI.md`) read this file through a
link. Any other agent: read this file first.

## 1. First time on a machine: connect the tools

Run this, from the repo folder:

```bash
node bin/studio.mjs doctor
```

It reads `library/connections.json` (the list of every tool, with its install, sign-in and check command) and prints
one line per tool: `ready`, `MISSING` (required) or `off` (optional), with the exact `fix:` command under it.

Then do this loop until doctor says **Core ready**:

1. Take the first row that is not ready.
2. Run its `fix:` command. If it is an install, run it. If it is a sign-in (`codex login`, `gflow auth login`), start
   it and tell the human what to do in the browser. **The human signs in, never the agent.**
3. Run `node bin/studio.mjs doctor` again.

Core (required) = Node.js, the repo packages (`npm install`), Python with numpy and OpenCV, ffmpeg, Google Chrome,
ChatGPT through the Codex CLI. Optional = Google Flow (video), Blender (3D), Pinterest, CLI Hub. Connect an
optional tool only when the human asks for that kind of job.

Then start the board: `./start.sh` (stop: `./kill.sh`). Settings (gear, bottom-left) shows the same tool status.

## 2. Rules for connecting tools (law 37)

1. **doctor first.** On a new machine, and whenever a job fails on a tool. Never start a job on a tool doctor marks
   not ready.
2. **One tool per job.** The ROUTER at the top of `STUDIO.md` names the tool for each job. Install that one, with
   the exact command in `library/connections.json`. Never swap in another tool for the same job.
3. **The human signs in.** The agent runs the sign-in command; the human finishes it. The agent never types a
   password, a code or a card number.
4. **No secrets in the repo.** Sessions live in each tool's own folder (`~/.codex`, `~/.gflow`). Keys go in
   `.env.local` (git-ignored). Never in a prompt, a log, a commit or a file under `outputs/`.
5. **Money is the human's call.** A plan, credits or a paid CLI: ask first. Google Flow spends credits on every
   clip: follow law 34 (x1, budget per clip, price check before each clip, live balance with `studio credits`).
6. **A new tool** only when a job needs it and no row covers it: `cli-hub can "<job>"`, ask the human, then add a
   row to `library/connections.json` (install, sign-in, check) and a row to the ROUTER.
7. **The board stays on this Mac.** It listens on 127.0.0.1 only and has no login; never expose it.

## Routing at a glance (full table: the ROUTER in `STUDIO.md`)

| job | tool | start with |
|---|---|---|
| poster, ad, hero still, text in an image | ChatGPT (Codex CLI) | `studio direct "<words>"` → `studio poster <brief>` |
| many drafts, variations, characters | Google Flow | `studio image "<prompt>" --engine flow` |
| video clip | Google Flow (credits, law 34) | `studio vdirect "<words>"` → `studio credits` → `studio video … --dry` |
| join, trim, cut clips | the board's Video → Edit page | law 27 |
| upscale (only when the use needs more pixels) | TAN Upscaler (ffmpeg) | `studio upscale <file> --to 2k|4k` |
| 3D model, scene, render | Blender | `studio ddirect "<words>"` → `studio shot …` |
| reference search (backup only) | Pinterest (`pin`) | `studio pins search "<words>"` |
| a job no row covers | CLI Hub | `cli-hub can "<job>"` → ask the human |

## 3. Every session

1. Read `STUDIO.md`: the banner, the ROUTER, THE WORKFLOW and the numbered laws. Pull one section with
   `node bin/studio.mjs sec "<words>"`; list the laws with `node bin/studio.mjs laws`.
2. Read `data/settings.json` (owner defaults and rule switches; missing on a new machine = defaults, made on first save).
3. Route every job through the ROUTER and say which row you used. Image: `studio direct` → one question message
   (aspect ratio first) → brief → `--dry` → make → `studio verify` → show. Video: `studio vdirect` → `studio
   credits` → `studio video … --dry` → make. 3D: `studio ddirect` → `studio shot`. Never generate before the owner
   answers the question message (law 1).
4. Client job: read `library/clients/<id>/kit.json` first (law 5). Files land in `outputs/clients/<client>/<date>/`.
5. Every new owner instruction becomes a numbered law in `STUDIO.md` the same turn (law 17); a caught mistake becomes
   a row in `guide/MISTAKES.md` plus a `studio verify` check (law 18).
6. Long jobs (all video, Flow images, Blender renders) run in the background.

Map of every file: `INDEX.md`. All commands: `node bin/studio.mjs` with no arguments.
