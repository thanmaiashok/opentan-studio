# OpenTan Studio

Part of **OpenTan**, an open-source library by Thanmai Ashok.


Open TAN is an image, video and 3D studio that a coding agent runs (Claude Code, Codex, Qwen, any). You talk to the
agent. It writes the briefs and prompts, picks the engine, watches credits and runs the jobs. The board in the browser only shows results.

- **Image (the hub):** Art Direction picks the look from your words. Posters and stills come from ChatGPT (Codex CLI);
  drafts in bulk come from Google Flow.
- **Video:** Video Director picks the studio. Clips come from Google Flow (Veo). The Edit page trims and joins them.
- **3D:** 3D Director picks the shot. Models, scenes and renders come from Blender.

## Set up a new machine (any agent)
Open the repo in your agent (Claude Code, Codex, Qwen Code, Gemini CLI, a local model) and tell it: *"read AGENTS.md
and connect the tools"*. Or run it yourself:
```bash
node bin/studio.mjs doctor   # every tool: ready / MISSING / off, with the exact fix command
```
Fix the rows top to bottom; you sign in (ChatGPT, Google), the agent installs. Tool list: `library/connections.json`.

## Run the board
```bash
./start.sh   # http://localhost:3210
./kill.sh
```

## Make things (Claude runs these)
```bash
bin/studio.mjs direct "<your words>"     # Image: art direction
bin/studio.mjs vdirect "<your words>"    # Video: studio
bin/studio.mjs ddirect "<your words>"    # 3D: shot
bin/studio.mjs laws image|video|3d|shared
```

Rules for the agent: `AGENTS.md` (any agent), `CLAUDE.md` (Claude) and `STUDIO.md`. Map of every file: `INDEX.md`.

## Not in this repo
Client kits, briefs and posters, licensed textures, study references and the measured AI-mark maps stay on the owner's
machine (git-ignored). Your own: `--client "<name>"` makes a client folder; `bin/markmap.py` measures a mark map from
a clip you made (law 28).

MIT licence © 2026 Thanmai Ashok (OpenTan). See `LICENSE`.
