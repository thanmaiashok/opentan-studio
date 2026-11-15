// Live status of every tool the studio drives (ChatGPT, Flow, Pinterest, CLI Hub, Blender). Cheap checks (version, login) every time;
// the Flow browser check runs headless (~4 s) and is cached for 2 minutes.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

const HOME = os.homedir();
const PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, 'go', 'bin'), path.join(HOME, '.local', 'bin')].join(':');

function sh(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, env: { ...process.env, PATH } }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim(), missing: err?.code === 'ENOENT' });
    });
  });
}

const firstLine = (s) => s.split('\n').find(Boolean) || '';
let flowCache = null; // { at, result }

async function codex() {
  const v = await sh('codex', ['--version']);
  if (v.missing) return { state: 'off', detail: 'Codex CLI not installed' };
  const login = await sh('codex', ['login', 'status']);
  const signedIn = /logged in/i.test(login.out);
  return { state: signedIn ? 'live' : 'off', version: firstLine(v.out).replace('codex-cli ', ''), detail: signedIn ? firstLine(login.out) : 'Not signed in · run codex login' };
}

async function flow(fresh) {
  const v = await sh('gflow', ['--version']);
  if (v.missing) return { state: 'off', detail: 'gflow not installed' };
  const version = firstLine(v.out);
  const busy = readState().jobs.some((j) => j.status === 'running' && j.engine === 'flow');
  if (busy) return { state: 'busy', version, detail: `Running a Flow job right now${balanceNote()}` };
  if (!fresh && flowCache && Date.now() - flowCache.at < 120000) return { ...flowCache.result, version };
  const doc = await sh('gflow', ['doctor', '--no-headed'], 30000);
  const ready = doc.ok && /ready/i.test(doc.out);
  const result = { state: ready ? 'live' : 'off', detail: ready ? 'Signed in · browser session ready' : (firstLine(doc.out) || 'Session not ready · run gflow auth login').slice(0, 90) };
  flowCache = { at: Date.now(), result };
  return { ...result, detail: `${result.detail}${balanceNote()}`, version };
}

// law 34: the last balance Claude read (data/flow.json) — the board never opens Flow's account panel itself
function balanceNote() {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'flow.json'), 'utf8')).balance;
    if (b?.credits == null) return '';
    const day = new Date(b.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return ` · ${b.credits} credits (read ${day}${b.resets ? `, resets ${b.resets.replace(/ at .*/, '')}` : ''})`;
  } catch { return ''; }
}

async function pinterest() {
  const v = await sh('pin', ['version']);
  if (v.missing) return { state: 'off', detail: 'pin not installed' };
  let saved = 0;
  try { saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'library', 'posters', 'pinterest.json'), 'utf8')).length; } catch {}
  return { state: 'live', detail: `Reads logged out · ${saved} pin${saved === 1 ? '' : 's'} saved · backup only` };
}

async function cliHub() {
  const v = await sh('cli-hub', ['--version']);
  if (v.missing) return { state: 'off', detail: 'cli-hub not installed' };
  return { state: 'live', version: firstLine(v.out).replace('cli-hub ', ''), detail: 'Catalogue of agent CLIs' };
}

// Blender: the app (CLI, headless renders) + whether it is open now (the live MCP bridge needs it open).
const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
async function blender() {
  if (!fs.existsSync(BLENDER)) return { state: 'off', detail: 'Blender not found in /Applications' };
  const v = await sh(BLENDER, ['--version'], 15000);
  const version = firstLine(v.out).replace('Blender ', '');
  const busy = readState().jobs.some((j) => j.status === 'running' && j.engine === 'blender');
  if (busy) return { state: 'busy', version, detail: 'Rendering right now' };
  const open = await sh('pgrep', ['-f', 'Blender.app/Contents/MacOS/Blender']);
  return { state: v.ok ? 'live' : 'off', version, detail: open.ok ? 'Open · live scene via MCP + headless CLI' : 'Headless CLI ready · Claude opens the app when a job needs it' };
}

// TAN Upscaler (law 29): one ffmpeg filter graph, so it is ready whenever ffmpeg is
async function tanUpscaler() {
  const v = await sh('ffmpeg', ['-hide_banner', '-filters']);
  if (!v.ok || !/\bcas\b/.test(v.out || '')) return { state: 'off', detail: 'ffmpeg with the cas filter not found' };
  return { state: 'live', detail: 'Lanczos + CAS + deband in ffmpeg · free, runs on this Mac · used only for 2K / 4K' };
}

export async function GET(request) {
  const fresh = new URL(request.url).searchParams.has('fresh');
  const [a, b, c, d, e, f] = await Promise.all([codex(), flow(fresh), pinterest(), cliHub(), blender(), tanUpscaler()]);
  return Response.json({
    checkedAt: new Date().toISOString(),
    tools: [
      { id: 'codex', name: 'ChatGPT', role: 'Images · Codex CLI', ...a },
      { id: 'flow', name: 'Google Flow', role: 'Video and bulk images · gflow', ...b },
      { id: 'pinterest', name: 'Pinterest', role: 'Reference search · pin', ...c },
      { id: 'cli-hub', name: 'CLI Hub', role: 'Tool catalogue · cli-hub', ...d },
      { id: 'blender', name: 'Blender', role: '3D models and renders · Blender CLI + MCP', ...e },
      { id: 'tan', name: 'TAN Upscaler', role: 'Upscale images and videos · bin/upscale.py', ...f },
    ],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
