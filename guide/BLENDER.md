# BLENDER — how a 3D job is made (law 30)

The owner, 2026-11-14: *"make a model in perfect sense … first search for reference and understand the reference,
then get perfection of its length and all the things, then modeling, then smoothing, then textures, then lights,
perfect lighting."* This file is that pipeline. It is internal craft: the board only shows the results (law 24).

Our toolkit: **`tools/blender/kit.py`** (load it with the two lines from `studio blender kit`): every object, material
and light procedural, driven from Python in Blender 5.2. QC with **`studio blender check <still.png>`**.

## The six steps — always this order, never skip one

| # | step | do | done when |
|---|---|---|---|
| 1 | **Reference** | sources in this order (law 26, Image is the hub): the owner's images · images made in Image (their job files) · key frames the owner's reference video gives (`ffmpeg -ss <t> -i ref.mp4 -frames:v 1 f-<t>.png` at start, each cut, end — a few, never every frame; note the camera move, light and timing for the 3D Director shot) · then real photos found for the missing views. Aim for 3–6 views (front, side, top, detail, the material up close); a missing view of an owner's product → `studio ref product … --ref <photo>`. Write what makes it THAT object: silhouette, the 3 defining shapes, every small part (screws, seams, lips, labels), each material and its finish | a reference note in the job folder: list of parts + materials + finishes |
| 2 | **Measure** | write a **dimension sheet** in metres from real specs (maker's page, standard sizes) or derived from one known size by pixel ratio in the photos. `units_metric()`; `ref_box()` = wire box of the real size to model inside | every part has a number; nothing is "about right" |
| 3 | **Model** | big shapes first, then medium, then small. Build from profiles: lathe/revolve for round things, sweep for rails/handles, extrude for plates, loft for bodies. Real thickness (solidify), real gaps between panels (2–7 mm), parts parented to empties. `prim(size=…)` bakes real size, scale stays 1 | `check_dims()` within 3 % of the sheet; silhouette matches the reference side by side (`look`) |
| 4 | **Smooth** | `bevel()` on EVERY hard edge (no razor edges exist; the bevel catches the light), `harden_normals`, then `weighted_normals()` last. `shade()` = smooth + sharp by angle (30–40° hard parts, 50–60° tyres/tiles, 80°+ organic). `subsurf()` only for soft forms, with creases / support loops | no shading smears on flat faces; edges show a thin highlight in the render |
| 5 | **Texture** | procedural materials from the kit, never one flat colour. Every material = colour drift + roughness breakup + bump + **cavity darkening** (AO) — see recipes below. The client's real label/logo goes on as an image on UVs (`mat_image`, law 6) | close-up still looks like the reference material, not plastic |
| 6 | **Light** | `render_setup()` (AgX), a world (`world_hdri` bundled, no download), a rig (`rig_product` packshot, `rig_studio` three-point), a floor/cyclorama, `compositor()` (highlight shoulder). Warm key vs cool fill. Then `still()` → `look` → `studio blender check` | check PASS (or the failure is named and deliberate) and it looks right by eye |

After step 6: `studio blender scene|render|export` so it lands on the board (Renders / Scenes / Models; every download
is a GLB — `/api/model`).

## After step 6: the shot (3D Director, law 32)
`studio ddirect "<words>"` → `studio shot <studio> <scene.blend>`. The studios are our shot types
(`library/3d-studios.json`); `tools/blender/shots.py` replaces camera / lights / world and animates, scaled to the
hero's real size (largest non-scenery object, or one named `Hero`). Animations: 30 fps, 16 EEVEE samples
(~1.6 s a 1080p frame), motion blur on. Test 3 frames small before a full render.

## Step 5 — how shaders work (the part that makes it look real)

A Principled BSDF has four inputs that matter: **Base Color, Metallic, Roughness, Normal** (+ Coat, Transmission,
Subsurface, Sheen for special finishes). Real surfaces vary in ALL of them. The kit's `NB` builder wires the pattern:

```
Texture Coordinate (Object = real metres on the object)
  → Noise / Voronoi / Wave fields at 2–3 scales (big blotches, medium wear, micro grain)
  → Map Range / Color Ramp (turn 0–1 noise into a narrow, controlled band)
  → Base Color   (two close colours mixed, never one)
  → Roughness    (e.g. 0.18–0.5 band, so highlights break up)
  → Bump → Normal (tiny: strength 0.03–0.1, distance 0.5–5 mm)
  + Ambient Occlusion node → darken creases (dust, grime, depth for free)
```

Rules:
- **Object coordinates, scale 1** (apply scale). Textures then have real-world size; a scaled object stretches them.
  UV only for printed art (labels, photos, logos).
- **Scale the pattern to the object.** A pattern sized for a 2 m wall turns into zebra stripes on a 10 cm box
  (the first kit test did exactly this — see B03).
- **Metal**: Metallic 1, colour in Base Color, look comes from roughness variation + what it reflects → always give
  it something to reflect (HDRI or strip lights). Scratches = noise stretched ×40–160 along one axis, oblique, masked
  by a low noise patch (orthogonal stretched scratches read as carbon-fibre weave).
- **Glossy paint / ceramic / enamel**: Coat Weight 1, Coat Roughness 0.02–0.05 over a slightly mottled base.
  Car paint flakes = Voronoi scale ~900–1400 into a 0.001 m bump.
- **Wood**: FINE growth lines (3–6 mm pitch) + fibres stretched ~60× along the grain + pores in the bump; per-board
  tone shift. Never wide bands.
- **Stone / marble**: veins = a THIN band in a color ramp over distorted noise; a little subsurface.
- **Liquids (milk, juice)**: subsurface + glossy, not glass. **Glass**: Transmission 1, IOR 1.45–1.52, `BLENDED`.
- **Fabric**: sheen + crossed wave bump, roughness 0.8+.
- **Edge wear without Pointiness** (EEVEE has none): Texture Coordinate Normal, pick the bevel band
  (|n| around 0.7) → lighter + less rough there.
- **Per-copy variation**: Object Info → Random offsets the coordinates or mixes hue, so 50 copies are not clones.
- Kit recipes: `mat_plastic, mat_metal(brushed=), mat_brass, mat_gold, mat_carpaint, mat_glass, mat_liquid,
  mat_rubber, mat_ceramic, mat_marble, mat_wood(axis=), mat_fabric, mat_concrete(wet=), mat_image, mat_emission`.

## Step 6 — how light works

- **Colour management AgX** (Medium High Contrast). Render clean, not crushed.
- **Light size = softness.** Big area light = soft shadow + broad highlight; small = hard. Products: big soft key from
  above-front + two tall thin strips left/right that draw clean vertical highlights on glossy edges + a kicker behind.
- **Warm key vs cool fill** (3200 K vs 6500 K, `kelvin()`); fill = key / 2 (bright) to key / 4 (moody).
  Rim light behind/high separates the silhouette from the background.
- **Energy is in watts at real scale**: a 30 cm product needs ~10–20 W area lights, not 300. Too bright is the most
  common failure: highlights belong to edges and small speculars, not to big areas.
- **Practicals** (screens, LED strips, lamps): emission 2–8 with a gradient, never a white bar with a halo; real
  lights do the lighting.
- **Reflections need a world**: bundled HDRIs (`studio`, `interior`, `city`, `courtyard`, `forest`, `sunrise`,
  `sunset`, `night`) at 0.1–0.6; `visible=False` keeps the reflections and shows a dark background.
- **Fog/haze** only as local volumes (a box, a shaft), never a global soup that lifts the blacks. EEVEE world volumes
  are infinite and swallow the sky.
- `compositor()` = highlight shoulder (no channel clips, hues survive) + bloom ≤ 0.12.
- **Gate**: `studio blender check still.png [--day]` — clipped ≤ 0.5 %, near-white ≤ 2 %, median 0.12–0.45
  (≤ 0.58 daylight), p5 < 0.08, contrast p95−p5 > 0.45, colourful > 25. Packshots on a light cyclorama may fail
  "washed out" on purpose — say so.

## GLB carries geometry, not procedural shaders
glTF has no node graph: a GLB export keeps the shape, UVs and flat base colour / metallic / roughness, but drops
every procedural pattern (noise, rings, tarnish, grain). For a GLB that looks like the render, **bake** the
procedural material to image textures (Cycles bake: Base Color, Roughness, Normal onto a UV map) before export.
The board's renders always show the full shader.

## Blender 5.2 facts (look up, never assume)

- Smooth by angle: `mesh.shade_smooth(); mesh.set_sharp_from_angle(angle=…)` (`set_sharpness_by_angle` does not
  exist; Auto Smooth is gone).
- Principled inputs: `Coat Weight`, `Transmission Weight`, `Specular IOR Level`, `Subsurface Weight`, `Sheen Weight`.
  `ShaderNodeMix` RGBA: inputs 6/7, output 2. Find nodes by `type`, never by name. Enums: read, then try/except.
- Gradient texture enum `SPHERICAL`. Crease = float edge attribute `crease_edge`.
- Material: `surface_render_method` `DITHERED`/`BLENDED`, `use_raytrace_refraction`.
- EEVEE: no Pointiness; a PLANE light probe kills screen-space reflections; motion-blur steps can't be keyed.
- Speed: thousands of small parts → one numpy `foreach_set` mesh or linked duplicates, not thousands of bmesh ops.
- Always absolute paths for output.
- Modeling without `bpy.ops` (bmesh / from_pydata) works headless and live alike.

## Mistakes (3D mistakes we never repeat; ours go in guide/MISTAKES.md B-rows)

| symptom | fix |
|---|---|
| milky, washed-out frames | lower light energy + fog; local haze, not global; shadows stay dark |
| blown highlights on strips / paint / glints | emission 2–8, smaller highlights, rougher material, compositor shoulder |
| comb streaks on faces | zero-length edges → even spacing + `dissolve_degenerate` / `remove_doubles` |
| "carbon fibre" pattern on metal | orthogonal stretched scratches → oblique, masked scratches |
| polka dots / camouflage | finish pattern too big or too contrasty → smaller cells, narrow roughness band |
| pillowy, blobby hard surfaces | wrong smoothing API / no sharp edges → `set_sharp_from_angle`, bevels |
| sparkling panel seams | glossy rim faces → matte material on gap rims + dark inner hull |
| zebra-striped wood | wide bands → fine grain, fibres, planks |
| boulders like blobs / turtle shells | per-instance colour + noise-ridge cracks, not Voronoi cells |
| broken textures on scaled objects | apply scale (Object coordinates) |
| a spike through the floor | Solidify even-offset on slivers → off, `thickness_clamp` 1.0 |
