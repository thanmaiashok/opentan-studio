// Prompt builders for the image stream: posters and reference images.
// Rules come from library/posters/ART-DIRECTION.md (learned from the owner's reference posters)
// and library/REFERENCE-IMAGES.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export function loadCards() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'posters', 'references.json'), 'utf8'));
}

export function findCard(recipe) {
  const id = String(recipe).padStart(2, '0');
  const card = loadCards().find((c) => c.id === id);
  if (!card) throw new Error(`Unknown recipe "${recipe}". Use a reference id from library/posters/references.json, or run studio direct "<words>".`);
  return { ...card, absPath: path.join(ROOT, card.path) };
}

// What each family tends to get wrong, so the avoid list stays short and specific.
const FAMILY_AVOID = {
  'giant-type-hero': ['medium-sized or small headline', 'type placed in a corner', 'busy background scene'],
  'witty-object': ['extra props', 'busy background', 'large headline'],
  'torn-reveal': ['clean digital cut instead of torn paper fibre', 'extra props'],
  'ingredient-macro': ['product floating above the fruit', 'empty gaps in the ingredient field'],
  'still-life-flash': ['soft diffuse light', 'props in other colours'],
  'hand-held': ['clouds or sun flare', 'manicured stock-photo hand pose'],
  'editorial-print': ['glossy digital finish', 'clip-art icons'],
  'editorial-grid': ['glossy digital finish', 'uneven margins'],
  'culture-collage': ['generic ethnic pattern', 'gold serif festival styling'],
  'culture-graphic': ['generic ethnic pattern', '3D render'],
  'culture-editorial': ['stock-photo pose', 'generic ethnic pattern'],
  'film-portrait': ['beauty retouching', 'cinematic teal-orange grade'],
  'event-flyer': ['random icons', 'tiny unreadable text'],
  'lettering-wrap': ['clean digital font instead of hand-made letters', 'letters only behind the person, no overlap in front', 'beauty retouching', 'celebrity likeness'],
  'doodle-overlay': ['doodles covering the face', 'mixed drawing styles', 'glossy 3D stickers'],
  'surreal-scale': ['more than one scale break', 'messy composite edges', 'busy background'],
  'sticker-cover': ['too many stickers', 'glossy digital finish', 'celebrity likeness'],
  'type-in-place': ['flat text pasted on top', 'letters without real shadows or reflections'],
  'floating-ui': ['invented app logos', 'unreadable UI text', 'neon glow'],
  'pixel-glitch': ['glitch over the whole image', 'RGB-split cyberpunk neon', 'blurry face'],
  'grid-swap': ['uneven cells', 'pose changing between cells', 'gutters wider than thin rules'],
  'interface-frame': ['invented UI', 'unreadable UI text', 'dark-mode neon UI'],
  'type-window': ['type too thin to read the photo through', 'subject fully inside the letters'],
  'retro-screen': ['glossy 3D render', 'cyberpunk neon', 'clean vector look'],
  illustration: ['3D render', 'vector clip-art look'],
};

const ALWAYS_AVOID = ['golden-hour backlight or sun flare', 'bokeh', 'floating particles or sparkles', 'invented logos or extra words', 'painted or illustrated product', 'CGI or 3D-render look on photographic elements'];

// Region of each family, so the medium line and finish match the kind of poster.
const REGION_OF = (() => {
  const m = {};
  try {
    const { regions } = JSON.parse(fs.readFileSync(path.join(HERE, 'posters', 'families.json'), 'utf8'));
    for (const r of regions) for (const f of r.families) m[f.id] = r.id;
  } catch {}
  return m;
})();

const MEDIUM = {
  product: 'Finished design: photography and typography made together as one image.',
  print: 'Printed editorial poster: paper, grain and type made together as one image.',
  culture: 'Finished design rooted in real Indian material culture, photography and typography as one image.',
  people: 'Finished design: a photographed person and typography made together as one image.',
  play: 'A real, unretouched photograph with ONE hand-made graphic layer (letters, doodles, stickers or a scale break) built into it.',
  digital: 'A real photograph cut with ONE screen-language device (pixels, a grid, real UI chrome or a type mask).',
};

const FINISH = {
  print: 'background and graphics printed: subtle paper grain, slight ink texture',
  culture: 'background and graphics printed: flat ink colours, subtle paper grain',
  play: 'real photography with natural light and skin; the graphic layer crisp, flat and hand-made on top',
  digital: 'real photography; the digital device sharp and exact, only where the idea needs it',
};

const shape = (ratio) => {
  const [w, h] = String(ratio).split(':').map(Number);
  return !w || !h ? 'Vertical' : w > h ? 'Horizontal' : w === h ? 'Square' : 'Vertical';
};

const PLACE_WORDS = { 'top-right': 'top-right corner', 'top-left': 'top-left corner', 'bottom-right': 'bottom-right corner', 'bottom-left': 'bottom-left corner', 'top-center': 'top centre', 'bottom-center': 'bottom centre' };

// The client's logo goes INTO the generation (owner 2026-11-14): attached image + exact text + font + corner.
function logoInputLine(logo, place) {
  const where = PLACE_WORDS[place] || place;
  const texts = (logo.text || []).map((t) => `"${t.string}" (${t.where}; ${t.font})`).join(' and ');
  return [
    `Client logo: the attached logo image is the client's real logo. Place it once, small and crisp, in the ${where}, about ${Math.round((logo.width || 0.22) * 100)}% of the poster width, with a clear margin and a calm patch of field around it — no type or props touching it.`,
    `Reproduce it exactly as the attached file: ${logo.description || 'same shapes and colours'}${texts ? ` Its text, letter for letter: ${texts}.` : ''} Do not redraw, restyle, translate or simplify it; no other logos anywhere.`,
  ].join('\n');
}

// Clear space for the client's real logo, which studio.mjs places on the finished image (--logo-overlay).
function logoSpaceLine(place, band) {
  const pct = Math.round(band * 100);
  const where = {
    'top-center': `the top ${pct}% of the poster, full width`,
    'bottom-right': `the bottom-right corner (about ${pct}% of the height and 45% of the width)`,
    'bottom-left': `the bottom-left corner (about ${pct}% of the height and 45% of the width)`,
    'top-left': `the top-left corner (about ${pct}% of the height and 45% of the width)`,
    'top-right': `the top-right corner (about ${pct}% of the height and 45% of the width)`,
    'bottom-center': `the bottom ${pct}% of the poster, full width`,
  }[place] || `the top ${pct}% of the poster`;
  return `Logo space: keep ${where} an empty, calm stretch of the field — no type, props, people or detail there; the client's real logo is placed in it afterwards. Draw no logo, emblem or brand mark anywhere in the image.`;
}

const line = (label, value) => (value ? `${label}: ${value}` : '');

/**
 * brief = {
 *   recipe: "15",                 // reference poster id to follow (layout, light, type scale)
 *   ratio: "4:5",
 *   product: "Toned Milk 500 ml pouch",     // product posters
 *   subject: "a young creator in a red tee",       // people / photo-play / digital posters (instead of product)
 *   subjectRefs: ["path/to/real-photo.jpg"],        // optional: the real person or place to keep
 *   hero: "the pouch standing, front label square to camera, slight 12° tilt",   // optional
 *   idea: "the pouch is a ...",   // one sentence: the operator applied to this product
 *   refLayout: "…",               // the reference's geometry in words (positions, sizes in %), written after LOOKING at it
 *   field, light, camera, type, layout, finish,  // optional overrides of the recipe card
 *   text: { headline: "...", sub: "...", small: ["...", "..."], brand: "..." },
 *   script: "Kannada",            // optional: non-Latin copy
 *   packRefs: ["library/clients/<id>/products/toned-milk.jpg"],
 *   avoid: ["..."]                // optional extra avoid items
 * }
 *
 * Prompt structure follows OpenAI's image-prompting guide (guide/PROMPTING.md): labelled sections in the order
 * USE → IMAGES (numbered roles) → LAYOUT → IDEA → BACKGROUND → PRODUCT/SUBJECT → STYLE → LIGHT & CAMERA →
 * TYPOGRAPHY → TEXT (EXACT) → LOGO → CONSTRAINTS. Photo elements are always called a real photograph.
 */
export function buildPosterPrompt(brief) {
  const card = findCard(brief.recipe);
  const ratio = brief.ratio || '4:5';
  const text = brief.text || {};
  const quoted = [
    text.headline && `Headline: "${text.headline}"`,
    text.sub && `Second line: "${text.sub}"`,
    ...(text.small || []).map((s) => `Small line: "${s}"`),
    text.brand && `Brand line: "${text.brand}"`,
  ].filter(Boolean);

  const avoid = [...new Set([...ALWAYS_AVOID, ...(FAMILY_AVOID[card.family] || []), ...(brief.avoid || [])])].slice(0, 10);
  const packs = brief.packRefs || [];
  const subjects = brief.subjectRefs || [];
  const region = REGION_OF[card.family] || 'product';
  if (!brief.product && !brief.subject) throw new Error('Brief needs "product" (product poster) or "subject" (person, place, idea).');
  const isProduct = !!brief.product;

  // Numbered image roles — same order as posterRefImages().
  let n = 1;
  const images = [`Image ${n++} — reference poster (LAYOUT ONLY): copy its composition — where things sit, their sizes and proportions, the type scale and the amount of empty field. Do NOT copy its objects, people, words, colours or its drawing/rendering style.`];
  for (const p of packs) images.push(`Image ${n++} — product photo (${path.basename(p)}): the exact product. Preserve its shape, proportions, label layout, printed text and colours exactly. It stays a real photograph — do not restyle, redraw, repaint or illustrate it; only light polishing. Match its lighting, shadows and colour temperature to the scene so it does not look pasted on.`);
  for (const p of subjects) images.push(`Image ${n++} — subject photo (${path.basename(p)}): the real person or place. Preserve identity, face, clothes and surroundings exactly; real photograph, no retouching.`);
  const logoNo = brief.logoInput?.path ? n++ : null;
  if (logoNo) images.push(`Image ${logoNo} — client logo: the real brand logo. Reproduce it exactly (see LOGO).`);

  const where = PLACE_WORDS[brief.logoPlace || 'top-right'] || brief.logoPlace;
  const logo = brief.logoInput ? [
    `LOGO: Image ${logoNo}, placed once in the ${where}, about ${Math.round((brief.logoInput.width || 0.22) * 100)}% of the poster width, clear margin, a calm patch of background around it; no type or props touching it.`,
    `It must match Image ${logoNo} exactly: ${brief.logoInput.description || 'same shapes and colours'}${(brief.logoInput.text || []).length ? ` Its text, letter for letter: ${(brief.logoInput.text).map((t) => `"${t.string}" (${t.where}; ${t.font})`).join(' and ')}.` : ''} Do not redraw, restyle, translate or simplify it.`,
  ].join('\n') : (brief.logoBand ? logoSpaceLine(brief.logoPlace || 'top-right', brief.logoBand).replace(/^Logo space:/, 'LOGO SPACE:') : '');

  const graphicGround = /(print|culture|illustration)/.test(region) || card.family === 'illustration';
  const style = [
    `${String(brief.finish || FINISH[region] || 'clean commercial photography, crisp edges, true colour').replace(/[.\s]+$/, '')}.`,
    isProduct ? 'The product is a REAL PHOTOGRAPH composited into the design: true material sheen, real condensation and printed label, natural contact shadow — photorealistic, not painted, not illustrated, not a 3D render.' : 'The subject is a real photograph: natural skin and materials, no heavy retouching.',
    graphicGround ? 'Only the background and graphic shapes are flat printed graphics; the photographic elements stay photographic.' : '',
  ].filter(Boolean).join(' ');

  return [
    `USE: A finished ${shape(ratio).toLowerCase()} ${ratio} advertising poster${brief.client ? ` for ${brief.client}` : ''}, with ${isProduct ? 'a real product photograph' : 'a real photograph'} at its heart. ${MEDIUM[region] || MEDIUM.product}`,
    `IMAGES:\n${images.join('\n')}`,
    `LAYOUT (preserve the layout and proportions of Image 1): ${brief.refLayout || card.layout}${brief.layout ? `. For this poster: ${brief.layout}` : ''}`,
    line('IDEA', brief.idea || `the reference's idea, applied to this brief's ${isProduct ? 'product' : 'subject'} (not its people or props): ${card.idea}`),
    line('BACKGROUND', brief.field || (isProduct ? `${card.field}, adapted to the product's own colour` : card.field)),
    isProduct
      ? `PRODUCT: ${brief.product}${brief.hero ? ` — ${brief.hero}` : ''}. ${packs.length ? 'Exactly as in the product photo; label sharp and readable.' : 'Sharp, real materials, readable front label.'}`
      : `SUBJECT: ${brief.subject}${brief.hero ? ` — ${brief.hero}` : ''}. Real, sharp, natural.`,
    line('STYLE', style),
    line('LIGHT & CAMERA', [brief.light || card.light, brief.camera || (isProduct ? 'product photographed with a 70mm lens at eye level, crisp focus across the label, natural colour balance, true whites' : 'shot like a 35mm photograph at eye level, natural colour balance')].join('; ')),
    line('TYPOGRAPHY', [brief.type || card.type, brief.script ? `all ${brief.script} copy in a real ${brief.script} display typeface, large and clear` : ''].filter(Boolean).join('; ')),
    quoted.length ? `TEXT (EXACT, verbatim, each exactly once, perfectly legible, no other words):\n${quoted.join('\n')}${brief.script ? `\nSpell the ${brief.script} letter for letter as given.` : ''}` : 'TEXT: none added — only the text printed on the product itself.',
    logo,
    `CONSTRAINTS: no extra text, no watermarks, no other logos or brand marks; do not change the product's or logo's design. Avoid: ${avoid.join(', ')}.`,
  ].filter(Boolean).join('\n\n');
}

// Pre-prompt check (guide/PROMPTING.md): run before every generation; errors block the run.
const STYLE_TRAPS = /\b(illustrat\w*|painted|painterly|cartoon\w*|vector|stylized|stylised|cinematic|movie-poster|concept art|cgi|3d render\w*|clay|anime)\b/i;
export function lintPosterPrompt(prompt, brief = {}) {
  const errors = []; const warns = [];
  const sections = prompt.split('\n\n');
  const need = ['USE:', 'IMAGES:', 'LAYOUT', 'LIGHT & CAMERA:', 'CONSTRAINTS:'];
  for (const k of need) if (!sections.some((s) => s.startsWith(k))) errors.push(`missing section ${k}`);
  if (!sections.some((s) => s.startsWith('TEXT'))) errors.push('missing TEXT section');
  if (brief.product && !/real photograph/i.test(prompt)) errors.push('product not called a real photograph');
  if ((brief.packRefs || []).length && !/Preserve its shape/.test(prompt)) errors.push('product photo has no preserve line');
  // Style words that push toward painting/CGI, outside CONSTRAINTS and outside the STYLE disclaimer.
  for (const sec of sections) {
    if (sec.startsWith('CONSTRAINTS') || sec.startsWith('IMAGES')) continue;
    const body = sec.startsWith('STYLE') ? sec.replace(/not painted, not illustrated, not a 3D render/g, '') : sec;
    const m = body.replace(/"[^"]*"/g, '').match(STYLE_TRAPS);
    if (m && !brief.allowStyle) (isPhotoHeavy(brief) ? errors : warns).push(`style word "${m[0]}" in ${sec.split(':')[0]} pushes toward a painted/CGI look (set brief.allowStyle if intended)`);
  }
  if (!brief.refLayout) warns.push('no refLayout — describe the reference geometry in words after looking at it');
  if (Object.values(brief.text || {}).flat().some((t) => String(t).length > 34)) warns.push('a text line is longer than 34 characters — long lines garble');
  return { errors, warns };
}
const isPhotoHeavy = (brief) => !!(brief.product || (brief.subjectRefs || []).length);

export function posterRefImages(brief) {
  const card = findCard(brief.recipe);
  return [card.absPath, ...[...(brief.packRefs || []), ...(brief.subjectRefs || []), ...(brief.logoInput?.path ? [brief.logoInput.path] : [])].map((p) => path.resolve(ROOT, p))];
}

const REF_KINDS = {
  product: (s) => `Product reference photograph of ${s}. The product alone, front label square to the camera and fully readable, true shape and materials. Seamless neutral light-grey studio backdrop. Soft key light from the upper left, clean contact shadow. Product fills about 70% of the frame height, centred. Nothing else in the frame. No added text.`,
  ingredient: (s) => `Reference photograph of ${s} filling the whole frame edge to edge, top-down. A natural mix of whole and cut pieces, real imperfections. Even overhead daylight. No product, no props, no text.`,
  character: (s) => `Character reference sheet of ${s}. Three views side by side of the same person: front, three-quarter, profile, head and shoulders. Neutral expression, plain clothes in one solid colour, grey seamless backdrop, flat even light. Real skin texture, no retouching. No text.`,
  location: (s) => `Location reference photograph of ${s}. Empty, no people. Eye level, 35mm lens, straight verticals. Real daylight or the place's own practical lights. Lived-in, specific detail. Not stylised. No text.`,
  style: (s) => `Style frame showing the look: ${s}. A simple stand-in object on the field colour that shows the light direction, shadow length, colour and finish. No product, no text.`,
  'start-frame': (s) => `First frame for a video: ${s}. Sharp, no motion blur, subject placed with room for the planned motion, light that can stay constant. No text.`,
};

export function buildReferencePrompt(kind, subject, { hasRef = false } = {}) {
  const build = REF_KINDS[kind];
  if (!build) throw new Error(`Unknown kind "${kind}". Use: ${Object.keys(REF_KINDS).join(', ')}`);
  return [
    build(subject),
    hasRef ? 'The attached photo is the real subject: match it exactly (shape, label, colours, identity).' : '',
    `Avoid: ${ALWAYS_AVOID.join(', ')}, dramatic lighting, stylisation.`,
  ].filter(Boolean).join('\n');
}

export const REFERENCE_KINDS = Object.keys(REF_KINDS);
