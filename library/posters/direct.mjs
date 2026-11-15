// Words → art direction. The owner describes a poster in their own words ("funny Diwali poster with
// big type", "hand lettering around a creator"); this ranks the families and the reference recipes
// that fit, so every poster starts from the owner's taste library instead of a freehand prompt.
//
// Vocabulary lives in families.json (`words`, `use` per family); card text in references.json.
// Claude still makes the final call — this is the map, not the decision.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));

const STOP = new Set('a an the and or of for with to in on at by from my our your this that poster posters image images make create design want need some like style look vibe type kind one two very more less into about using use please'.split(' '));

// Generic words that fit many families count less than specific ones ("glitch" beats "face").
const WEAK = new Set(['face', 'person', 'portrait', 'model', 'bold', 'loud', 'premium', 'luxury', 'clean', 'minimal', 'playful',
  'summer', 'digital', 'cold', 'story', 'quiet', 'street', 'pop', 'local', 'night', 'date', 'time', 'post', 'fresh', 'hand',
  'cute', 'aesthetic', 'fashion', 'paper', 'print', 'cover', 'pack', 'drink', 'launch', 'app', 'idea poster', 'concept']);

// Occasions and formats say what the poster IS, so they outweigh treatment words ("diwali" > "big type").
const STRONG = new Set(['festival', 'diwali', 'deepavali', 'holi', 'pongal', 'sankranti', 'ugadi', 'onam', 'dasara', 'navratri',
  'ganesh', 'eid', 'film poster', 'movie poster', 'first look', 'happy hour', 'saas', 'event', 'magazine cover', 'street photo']);

const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9%ऀ-෿]+/g, ' ').trim()} `;
const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const tokens = (s) => norm(s).trim().split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

// Does the phrase contain this vocabulary word/phrase (whole words, light plural tolerance)?
function hit(phrase, word) {
  const w = norm(word).trim();
  if (phrase.includes(` ${w} `)) return true;
  if (!w.includes(' ')) return phrase.split(' ').some((p) => p && stem(p) === stem(w));
  return false;
}

export function direct(words, { top = 3, perFamily = 3 } = {}) {
  const phrase = norm(words);
  const asked = new Set(tokens(words));
  const { regions } = read('families.json');
  const cards = read('references.json');

  const cardScore = (c) => {
    const text = new Set(tokens([c.idea, c.field, c.light, c.type, c.layout, c.copy, c.file].join(' ')));
    return [...asked].filter((t) => text.has(t)).length;
  };

  const ranked = [];
  for (const region of regions) {
    for (const fam of region.families) {
      const hits = (fam.words || []).filter((w) => hit(phrase, w));
      const famCards = cards.filter((c) => c.family === fam.id)
        .map((c) => ({ id: c.id, file: c.file, idea: c.idea, score: cardScore(c) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const wordScore = hits.reduce((n, w) => n + (STRONG.has(w) ? 4 : WEAK.has(w) ? 1 : 2) + (w.trim().split(' ').length - 1) * 1.5, 0);
      const best = famCards[0]?.score || 0;
      const score = wordScore + 0.5 * best;
      if (hits.length || best >= 2) ranked.push({ family: fam.id, name: fam.name, region: region.name, rule: fam.rule, use: fam.use, hits, score: Math.round(score * 10) / 10, recipes: famCards.slice(0, perFamily) });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return { words, matches: ranked.slice(0, top) };
}

export function formatDirect({ words, matches }) {
  if (!matches.length) {
    return `Words: "${words}"\nNo family matched. Ask what the poster is for (product, person, event, festival, app) or pick from the Art Direction page.`;
  }
  const out = [`Words: "${words}"`, ''];
  matches.forEach((m, i) => {
    out.push(`${i + 1}. ${m.name}  (${m.region} · ${m.family})  score ${m.score}`);
    out.push(`   ${m.rule}`);
    out.push(`   when: ${m.use}`);
    if (m.hits.length) out.push(`   your words: ${m.hits.join(', ')}`);
    out.push(`   recipes: ${m.recipes.map((r) => `${r.id} ${r.file.replace(/^\d+-|\.\w+$/g, '')}`).join(' · ')}`);
    out.push('');
  });
  out.push(`Next: brief in briefs/<name>.json with "recipe": "${matches[0].recipes[0]?.id}", then studio poster <brief> --dry.`);
  return out.join('\n');
}
