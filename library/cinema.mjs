// Open TAN camera language for photographic stills and video shots (`studio image … --cinema "cam|lens|mm|f"`).
// Written as a real camera report: body, glass, focal length and stop, each saying what it does to the picture.

// Camera bodies: short name the owner may say -> how a cinematographer would write it in a prompt.
export const BODIES = {
  'large format': 'large-format digital cinema camera, wide latitude, gentle highlight roll-off',
  'full frame': 'full-frame digital cinema camera, clean shadows',
  'super 35': 'Super 35 digital cinema camera, classic film framing',
  '65mm film': '65mm motion-picture film, fine grain, deep colour',
  '35mm film': '35mm motion-picture film, organic grain, soft halation',
  '16mm film': '16mm film, visible grain, documentary texture',
  'mirrorless': 'mirrorless stills camera, crisp detail',
};

// Glass: the character each lens family adds.
export const GLASS = {
  'modern prime': 'modern cinema prime, even sharpness edge to edge',
  'vintage prime': 'vintage prime, lower contrast, warm flare',
  'anamorphic': 'anamorphic lens, oval bokeh, horizontal streak flares',
  'macro': 'macro lens, life-size detail, razor-thin focus',
  'tilt-shift': 'tilt-shift lens, a narrow plane of focus across the frame',
  'soft diffusion': 'prime with a light diffusion filter, glowing highlights',
  'portrait prime': 'fast portrait prime, smooth falloff behind the subject',
};

// Focal length -> how the space reads. Any number works; the nearest band is used.
const FOCAL_BANDS = [
  [12, 'very wide, exaggerated depth, close foreground'],
  [20, 'wide, the subject in its surroundings'],
  [30, 'slightly wide, an honest documentary view'],
  [45, 'close to the eye, natural proportions'],
  [70, 'gentle compression, flattering for faces'],
  [120, 'long lens, compressed background, isolated subject'],
];

// Stop -> depth of field.
const STOPS = [
  [2, 'very shallow focus, background melts into soft shapes'],
  [4, 'moderate depth, the subject sharp and the background readable'],
  [8, 'deep focus, most of the scene sharp'],
  [99, 'everything sharp from front to back'],
];

const pick = (bands, n) => (bands.find(([limit]) => n <= limit) || bands[bands.length - 1])[1];
const fStop = (s) => Number(String(s || '').replace(/^f\//i, '')) || 4;
const lookup = (table, key) => table[String(key || '').toLowerCase()] || key || '';

// Old board names still arrive from saved jobs; map them onto the tables above.
const ALIASES = {
  'modular 8k digital': 'large format', 'premium large format digital': 'large format',
  'full-frame cine digital': 'full frame', 'studio digital s35': 'super 35', 'grand format 70mm film': '65mm film',
  'classic 16mm film': '16mm film', 'premium modern prime': 'modern prime', 'clinical sharp prime': 'modern prime',
  'vintage prime': 'vintage prime', '70s cinema prime': 'vintage prime', 'warm cinema prime': 'vintage prime',
  'classic anamorphic': 'anamorphic', 'compact anamorphic': 'anamorphic', 'extreme macro': 'macro',
  'creative tilt lens': 'tilt-shift', 'halation diffusion': 'soft diffusion', 'swirl bokeh portrait': 'portrait prime',
};
const norm = (k) => ALIASES[String(k || '').toLowerCase()] || k;

export function buildCinemaPrompt(idea, camera, lens, focal = 35, stop = 'f/4') {
  const mm = Number(focal) || 35;
  const f = fStop(stop);
  return [
    idea,
    `photographed on a ${lookup(BODIES, norm(camera))}`,
    `${lookup(GLASS, norm(lens))} at ${mm} mm (${pick(FOCAL_BANDS, mm)})`,
    `f/${f}: ${pick(STOPS, f)}`,
    'motivated natural light, true-to-life colour, rich but not crushed shadows',
  ].filter((part) => part && String(part).trim()).join(', ');
}
