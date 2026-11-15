"""Open TAN still-image QC (law 30, step 6 gate): is a render too bright, too flat or too grey?

  python3 tools/blender/exposure_check.py [--day] still.png [more.png ...]   (or: bin/studio.mjs blender check still.png)

The client rule behind it: never too bright, always rich and detailed colour. For each image it prints one line
of measurements (luma percentiles, clipped and near-white area, saturation, colourfulness, hue spread) and then
either PASS or one line per problem. Exit code 0 when every image passes, 2 otherwise.

--day relaxes the brightness and black-level limits for daylight exteriors, which sit brighter and hazier.
The limits are for ordinary shots: a deliberate flash frame, or a frame inside smoke or dust, may fail on
purpose; say so in the notes when that happens.
"""
import subprocess
import sys

import numpy as np

WORK_WIDTH = 640                     # every image is judged at this width so results compare across sizes
REC709 = np.array([0.2126, 0.7152, 0.0722], np.float32)

# limits (normal, daylight)
MEDIAN_MAX = {False: 0.45, True: 0.58}
BLACK_MAX = {False: 0.08, True: 0.15}
CLIPPED_MAX_PCT = 0.5
WHITE_MAX_PCT = 2.0
CONTRAST_MIN = 0.35
COLOURFUL_MIN = 18
SATURATION_MIN = 0.12


def read_rgb(path):
    """Decode any image ffmpeg can read into float RGB in 0..1, resized to WORK_WIDTH (height kept even)."""
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-frames:v', '1', '-vf', f'scale={WORK_WIDTH}:-2',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    pixels = np.frombuffer(raw, np.uint8)
    height = pixels.size // (WORK_WIDTH * 3)
    return pixels[: height * WORK_WIDTH * 3].reshape(height, WORK_WIDTH, 3).astype(np.float32) / 255.0


def measure(rgb):
    """All the numbers the verdict needs, as a dict."""
    luma = rgb @ REC709
    hi, lo = rgb.max(axis=2), rgb.min(axis=2)
    stats = dict(zip(('p1', 'p5', 'p50', 'p95', 'p99'), np.percentile(luma, [1, 5, 50, 95, 99])))

    stats['clipped'] = float(np.mean(hi > 0.985) * 100)       # any channel at the ceiling
    stats['white'] = float(np.mean(luma > 0.92) * 100)        # bright enough to read as white

    chroma = np.divide(hi - lo, hi, out=np.zeros_like(hi), where=hi > 1e-3)
    lit = luma > 0.08                                          # ignore near-black, where saturation is noise
    stats['sat'] = float(chroma[lit].mean()) if lit.any() else 0.0

    # colourfulness on opponent axes (red-green, yellow-blue): spread plus a little of the mean, in 0..255 units
    red_green = rgb[..., 0] - rgb[..., 1]
    yellow_blue = (rgb[..., 0] + rgb[..., 1]) / 2 - rgb[..., 2]
    spread = np.hypot(red_green.std(), yellow_blue.std())
    offset = np.hypot(red_green.mean(), yellow_blue.mean())
    stats['colourful'] = float((spread + 0.3 * offset) * 255)

    vivid = chroma > 0.2
    if vivid.sum() > 100:
        stats['hue_spread'] = float(np.std(np.arctan2(yellow_blue[vivid], red_green[vivid])))
    else:
        stats['hue_spread'] = 0.0
    return stats


def problems(s, day):
    """Plain-language list of what is wrong (empty list = PASS)."""
    found = []
    if s['clipped'] > CLIPPED_MAX_PCT:
        found.append(f"TOO BRIGHT: {s['clipped']:.1f}% of pixels clipped (limit {CLIPPED_MAX_PCT}%; "
                     'only a pinpoint highlight may clip)')
    if s['white'] > WHITE_MAX_PCT:
        found.append(f"TOO BRIGHT: {s['white']:.1f}% of the frame is near-white (limit {WHITE_MAX_PCT}%)")
    if s['p50'] > MEDIAN_MAX[day]:
        found.append(f"OVEREXPOSED: median luma {s['p50']:.2f} (aim 0.12-0.45 for interiors and macro, "
                     'up to 0.58 in daylight)')
    if s['p50'] < 0.04 and s['p95'] < 0.25:
        found.append(f"UNDEREXPOSED / MURKY: median {s['p50']:.2f}, p95 {s['p95']:.2f}")
    if s['p5'] > BLACK_MAX[day]:
        found.append(f"WASHED OUT: blacks lifted to p5 luma {s['p5']:.2f} (want < {BLACK_MAX[day]:.2f}); "
                     'too much haze or fog, or the light is flat')
    if s['p95'] - s['p5'] < CONTRAST_MIN:
        found.append(f"LOW CONTRAST: p95-p5 = {s['p95'] - s['p5']:.2f} (want > {CONTRAST_MIN:.2f})")
    if s['colourful'] < COLOURFUL_MIN:
        found.append(f"DULL COLOUR: colourfulness {s['colourful']:.0f} (want > {COLOURFUL_MIN}); build colour contrast: warm key "
                     'against cool fill, coloured practicals, hue variation in the materials')
    if s['sat'] < SATURATION_MIN:
        found.append(f"DESATURATED: mean saturation {s['sat']:.2f}")
    return found


def report(path, day=False):
    """Print the measurements and verdict for one image; True when it passes."""
    s = measure(read_rgb(path))
    print(f"{path}\n  luma p1 {s['p1']:.2f} p5 {s['p5']:.2f} p50 {s['p50']:.2f} p95 {s['p95']:.2f} p99 {s['p99']:.2f}"
          f" | clipped {s['clipped']:.1f}% white {s['white']:.1f}%"
          f" | sat {s['sat']:.2f} colourful {s['colourful']:.0f} hue-spread {s['hue_spread']:.2f}")
    issues = problems(s, day)
    print('  PASS' if not issues else '\n'.join('  ' + line for line in issues))
    return not issues


def main(argv):
    day = '--day' in argv
    paths = [a for a in argv if a != '--day']
    if not paths:
        print(__doc__.strip().splitlines()[2].strip())
        return 1
    results = [report(p, day) for p in paths]          # judge every image, even after a failure
    return 0 if all(results) else 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
