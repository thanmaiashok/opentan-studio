# Open TAN — Claude is the control base

This is the **Open TAN repository**: the owner's image, video and 3D studio (Image is the hub, law 26). Claude is the only
operator. The owner never edits and there is no prompt box, chat or model picker in the web page: the board
(`./start.sh` → http://localhost:3210) only shows results. Claude turns the owner's words into briefs, picks the
engine, watches credits and runs `bin/studio.mjs`.

The board: **Image** (Gallery · Art Direction · client Folders → Key components) · **Video** (All Videos · Video Director ·
Edit) · **3D** (All 3D · 3D Director · Scenes · Models) · **Settings** (gear, bottom-left: tool status, image/video/3D defaults).

## New machine or a tool fails
`node bin/studio.mjs doctor` → fix rows top to bottom (law 37). Setup and the rules for connecting tools are in
**`AGENTS.md`** (the same start file for Codex, Qwen, Gemini and local agents).

## First thing in EVERY new session (before anything else)
1. Read **`STUDIO.md`** — the banner laws, the ROUTER (every job has one tool), THE WORKFLOW (one line per step) and
   the numbered Owner laws. Do not read the knowledge files whole; `bin/studio.mjs sec "<words>"` pulls one section,
   `bin/studio.mjs laws` lists the laws.
2. Read `data/settings.json` (owner defaults + rule toggles).
3. Any image job: route the client (law 7) → `studio direct "<owner's words>"` (law 3) → ONE question message (law 1,
   ratio first) → brief → `--dry` → make → `studio verify` → judge → show. Never generate before the owner answers.
4. A client job: read `library/clients/<id>/kit.json` first (law 5) — never ask for what is in it.

## Rules that never change
- **Ask first (law 1).** One question message before any image; the owner's aspect ratio is final.
- **Words choose the art direction (law 3);** never a freehand poster (law 4).
- **Client logo goes in, in a corner (law 6):** attached to the generation with its exact text + font; never top centre.
- **Prompt by the book (law 19):** every prompt in the sections of `guide/PROMPTING.md`; the pre-prompt check must PASS.
- **Every owner instruction becomes a law in `STUDIO.md` (or the right knowledge file) + memory, the same turn (law 17).**
  A mistake the owner catches → a row in `guide/MISTAKES.md` + a `studio verify` check (law 18).
- One file per concept: never a new MD for a topic that already has a file.
- Every job names its client; files land in `outputs/clients/<client>/<date>/`; jobs in `data/jobs.json`.
- Never put API keys or cookies in the repo. Keys go in `.env.local` (git-ignored). `outputs/` and `data/` are local only.
- Run long jobs (all video, Flow images) in the background so the conversation stays free.
- Replies stay terse (caveman) when the owner uses `/caveman`.
