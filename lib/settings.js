// Owner settings for the studio: written by the board's Settings panel, read by bin/studio.mjs
// (defaults when a flag is left out) and by Claude (the rule toggles). Local only: data/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '@/lib/store';

const FILE = path.join(ROOT, 'data', 'settings.json');

export const DEFAULTS = {
  image: { engine: 'codex', ratio: '4:5', judgePosters: true, pinterestBackup: true },
  video: { ratio: '16:9', resolution: '720p', draftFirst: true, removeWatermark: true },
  // upscaler (law 29): TAN Upscaler locally (free) or Flow's own upscale for Flow jobs
  upscale: { engine: 'tan', preset: 'ai' },
  // Video → Edit export (law 27, owner 2026-11-14: "default … 2K 60fps"); enhance = TAN Upscaler when it grows the picture
  edit: { resolution: '2k', fps: 60, enhance: true },
  // 3D (Blender): live = the running Blender through MCP, cli = headless Blender (bin/studio.mjs blender …)
  blender: {
    bridge: 'live', engine: 'eevee', device: 'gpu', samples: 128, ratio: '16:9', resolution: '1080p', fps: 30, export: 'glb',
    fullAccess: true, openBlender: true, saveBlend: true, lookEachStep: true, askBeforeGenerate: true,
  },
};

// Allowed values per setting, so a bad POST can never write junk.
const ALLOWED = {
  image: { engine: ['codex', 'flow'], ratio: ['1:1', '4:5', '9:16', '16:9'], judgePosters: 'bool', pinterestBackup: 'bool' },
  video: { ratio: ['16:9', '9:16'], resolution: ['720p', '1080p'], draftFirst: 'bool', removeWatermark: 'bool' },
  upscale: { engine: ['tan', 'flow'], preset: ['ai', 'restore'] },
  edit: { resolution: ['source', '1080p', '2k', '4k'], fps: [30, 60], enhance: 'bool' },
  blender: {
    bridge: ['live', 'cli'], engine: ['eevee', 'cycles', 'workbench'], device: ['gpu', 'cpu'], samples: [64, 128, 256, 512],
    ratio: ['1:1', '4:5', '9:16', '16:9'], resolution: ['1080p', '1440p', '4k'], fps: [24, 30, 60], export: ['glb', 'fbx', 'obj', 'usdz', 'blend'],
    fullAccess: 'bool', openBlender: 'bool', saveBlend: 'bool', lookEachStep: 'bool', askBeforeGenerate: 'bool',
  },
};

export function readSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  return {
    image: { ...DEFAULTS.image, ...saved.image },
    video: { ...DEFAULTS.video, ...saved.video },
    upscale: { ...DEFAULTS.upscale, ...saved.upscale },
    edit: { ...DEFAULTS.edit, ...saved.edit },
    blender: { ...DEFAULTS.blender, ...saved.blender },
  };
}

export function patchSettings(section, key, value) {
  const rule = ALLOWED[section]?.[key];
  if (!rule) throw new Error(`Unknown setting ${section}.${key}`);
  if (rule === 'bool' ? typeof value !== 'boolean' : !rule.includes(value)) throw new Error(`Bad value for ${section}.${key}`);
  const next = readSettings();
  next[section][key] = value;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  return next;
}
