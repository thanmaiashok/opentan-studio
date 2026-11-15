# PROMPTING — how we talk to the image model (law 19)

Source: OpenAI's image-prompting guide (https://developers.openai.com/api/docs/guides/image-prompting, read 2026-11-14),
turned into our rules. The owner's verdict that started this file: the "ಹಾಲು ಬಂತು!" test looked painted and not like its
reference, and they said the problem was our prompting technique. `library/prompts.mjs` builds every poster prompt to this file;
`lintPosterPrompt()` is the pre-prompt check that blocks a bad prompt before anything is generated.

## 1. Structure — labelled sections, always this order
| # | section | holds | guide rule behind it |
|---|---|---|---|
| 1 | `USE:` | what it is, its use, ratio, "real photograph" at its heart | start by defining the result: subject + intended use + format |
| 2 | `IMAGES:` | every input image numbered, each with ONE role | identify each input by number and purpose; say how they combine |
| 3 | `LAYOUT` | the reference's geometry in words + "preserve the layout and proportions of Image 1" | sketch-to-photo: "preserve the exact layout, proportions and perspective" |
| 4 | `IDEA:` | the one idea, in a sentence | scene / subject |
| 5 | `BACKGROUND:` | field, palette, its medium (printed graphic or photographed set) | name colours and medium |
| 6 | `PRODUCT:` / `SUBJECT:` | the hero: what, angle, state (condensation, wear) | describe the subject's physical state |
| 7 | `STYLE:` | finish of the graphics + "the product is a REAL PHOTOGRAPH … not painted, not illustrated, not a 3D render" | say "photorealistic / real photograph" when that is the goal |
| 8 | `LIGHT & CAMERA:` | light direction and quality + lens, eye level, focus, colour balance | camera specs are appearance cues |
| 9 | `TYPOGRAPHY:` | voice, weight, colour, size as % of width, placement | describe typography + placement |
| 10 | `TEXT (EXACT, verbatim, each exactly once …):` | every string in quotes, nothing else | quote exact copy, count occurrences, "no extra text" |
| 11 | `LOGO:` | which image, corner, size, exact letters and fonts | preserve label/identity exactly |
| 12 | `CONSTRAINTS:` | what must not change + no extra text / watermarks / other logos + a short avoid list | state exclusions; list what must stay the same |
Full sentences in each section, never keyword stacks.

## 2. Photographic elements stay photographs (the "painted packet" fix)
- Every product / person / place that comes from a real photo is called **a real photograph** in USE and STYLE.
- A graphic poster (pop stripes, print, collage) is mixed media: say which parts are flat printed graphics and that the
  photographic parts stay photographic. Never let a finish line ("printed pop poster, flat ink") cover the product.
- Style traps — never in a section that describes a photographic element: illustration / illustrated, painted / painterly,
  cartoon, vector, stylized, cinematic, movie-poster, concept art, CGI, 3D render, clay, anime. (They may appear only in
  CONSTRAINTS as things to avoid.) Allowed only when the owner asks for that look (`brief.allowStyle`).
- Photo cues that pull toward real: lens + eye level, crisp focus on the label, natural colour balance, true whites,
  real condensation / wear / texture, natural contact shadow, "no heavy retouching".

## 3. Input images — numbered roles, nothing left to guess
- Image 1 is always the reference poster, **LAYOUT ONLY**: composition, sizes, proportions, type scale, empty field.
  It never gives objects, people, words, colours or its drawing/rendering style (an illustrated reference must not
  turn our photo into an illustration).
- Product photo: "the exact product — preserve shape, proportions, label layout, printed text and colours exactly; it stays a
  real photograph; only light polishing; match lighting, shadows and colour temperature to the scene".
- Subject photo: preserve identity, face, clothes, surroundings; no retouching.
- Logo: the real logo, reproduced exactly; its text letter for letter with each line's font; one corner, one size.
- Order of `--image` files = the numbers in the prompt (`posterRefImages()` and the IMAGES section use the same order).

## 4. Copying the reference ("not like the reference" fix)
- LOOK at the reference before writing the brief, then write `refLayout`: its geometry in words — where each element sits
  (in thirds or % of width/height), how big it is, what is empty, where the type sits and how big. The card's one-line
  `layout` is a fallback, not enough.
- Keep the reference's proportions: if the hero fills 40 % of the height there, it fills 40 % here.
- What we change from the reference is said in the same section: "For this poster: …".

## 5. Text
- Every string quoted once under TEXT, "no other words". Short lines (≤ ~34 characters) — long lines garble.
- Typography: weight, colour, size as % of the poster width, placement ("centred in the lower third").
- Non-Latin (Kannada, Hindi): a real display face for that script, large (≥ ~45 % of the width per line), simple
  conjuncts when we can choose the words, "spell letter for letter as given"; judge every letter by eye (T01).

## 6. Iteration — one change at a time
- Fix one thing per pass and say what changed. Keep everything else in the brief identical.
- When the image is right except one detail, edit instead of regenerating: pass the previous output as the input image
  ("change ONLY …; keep the layout, product, logo, text and light exactly"), and restate the critical constraints.
- If a region must be pixel-exact (logo, pack), composite the real file back (`--logo-overlay`) instead of more prompting.

## 7. What our tool can and can't set
ChatGPT through Codex exposes no `quality`, `size`, `background` or `input_fidelity` switches — so ratio, size intent and
"high detail on small lettering" are said in the prompt. Flow images have `--upscale`.

## 8. Pre-prompt check (runs on every `studio poster`; `--dry` prints it)
ERROR: a missing section (USE, IMAGES, LAYOUT, LIGHT & CAMERA, TEXT, CONSTRAINTS) · product not called a real photograph ·
product photo without its preserve line · a style trap describing a photographic element.
WARN: no `refLayout` · a text line longer than 34 characters.
