# Reference images — how to generate good ones

A reference image is raw material for a later poster or video: a product plate, a character, a place,
a texture, a look, a first frame. It is judged by how *useful and true* it is, not how dramatic.
Same light rules as `posters/ART-DIRECTION.md`: hard or clean studio light, no golden hour, no bokeh,
no flare, no particles, no text.

Run: `bin/studio.mjs ref <kind> "<subject>" [--ratio 4:5] [--ref real-photo.jpg]`

| Kind | Use | Rules baked into the prompt |
|---|---|---|
| `product` | hero source for posters and videos | Product alone, front label square to camera and readable, true shape and material, on a seamless neutral or its own colour field, soft key from the upper left + clean contact shadow, 70 % of frame height, nothing else in frame. With `--ref`: reproduce the photographed pack exactly. |
| `ingredient` | fills, macro textures, torn-reveal insides | The ingredient edge to edge, real, cut and whole mixed, natural imperfections, droplets only if fresh, even daylight from above, no product, no props. |
| `character` | same person across many images/videos | One person, neutral expression, plain clothes in one solid colour, grey seamless, flat even light, three views side by side (front, three-quarter, profile), full head and shoulders, real skin texture, no retouching, no text. |
| `location` | backgrounds, video plates | Empty real place, no people, eye-level 35 mm, real daylight or practical light, lived-in detail, straight verticals, nothing stylised. |
| `style` | the look of a campaign | One frame that shows field colour, light, shadow length and finish (grain/halftone) on a simple stand-in object; no product, no text. |
| `start-frame` | first frame of a Flow video | Final aspect ratio, subject placed with room for the planned motion, sharp, no motion blur, no text, light that can continue for 8 s. |

Rules for every kind
- No typography, logos, watermarks or borders unless the subject *is* a label.
- Physically plausible: real contact shadows, real scale, real materials.
- One subject. Neutral composition. Detail over drama.
- Save useful outputs: they land in `outputs/<date>/`; reuse them with `--ref` or as `--start-frame`.
