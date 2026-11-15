#!/usr/bin/env python3
"""markmap — measure our own alpha map of a visible AI mark from a pure-black clip we made (law 28).

    python3 bin/markmap.py <black.mp4> --name veo [--pad 3]

On a black frame the blend `marked = a * 255 + (1 - a) * 0` leaves the mark's alpha in plain sight: a = pixel / 255.
The tool averages every frame (codec noise cancels out), finds the mark in the bottom-right quarter, cuts its box
(+ pad), subtracts the black level and writes:
  library/watermarks/<name>-<height>.png   grey map, value = alpha * 255
  library/watermarks/marks.json            {name, file, ref [w, h], box [x, y, w, h]} — what bin/unmark.py reads
A second measurement of the same mark at another size adds another entry; unmark picks the closest size.

No black clip (0 credits): `--min --near X,Y,R` takes each pixel's MINIMUM over a normal clip of ours, searched only in a
window around the mark. Where something dark passed under the mark at least once, min = a * 255 + (1 - a) * dark, so
the map is the same idea, slightly heavier. Used for the Omni sparkle (MISTAKES G07); a black-clip measurement replaces
it when one is made.
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT_DIR = os.path.join(ROOT, 'library', 'watermarks')
INDEX = os.path.join(OUT_DIR, 'marks.json')


def mean_frame(path, use_min=False):
    info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                      'stream=width,height', '-of', 'json', path],
                                     capture_output=True, text=True, check=True).stdout)['streams'][0]
    w, h = int(info['width']), int(info['height'])
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           stdout=subprocess.PIPE)
    total, n, size = (np.full((h, w, 3), 255.0) if use_min else np.zeros((h, w, 3), np.float64)), 0, w * h * 3
    while True:
        raw = dec.stdout.read(size)
        if len(raw) < size:
            break
        frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
        if use_min:
            np.minimum(total, frame, out=total)
        else:
            total += frame
        n += 1
    dec.wait()
    if not n:
        sys.exit('no frames decoded')
    return (total if use_min else total / n), w, h, n


def fit_alpha(path, a0, x, y, w, h, pad=12):
    """Refine a --min map: per pixel, fit marked = a*255 + (1-a)*background over every frame, with the background
    painted in from around the mark (least squares, so a pass with a bright background does not inflate a)."""
    bh, bw = a0.shape
    if x < pad or y < pad or x + bw + pad > w or y + bh + pad > h:
        return a0
    mask = np.zeros((bh + 2 * pad, bw + 2 * pad), np.uint8)
    mask[pad:pad + bh, pad:pad + bw] = cv2.dilate((a0 > 0).astype(np.uint8), np.ones((5, 5), np.uint8)) * 255
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
                           stdout=subprocess.PIPE)
    num, den = np.zeros((bh, bw)), np.zeros((bh, bw))
    while True:
        raw = dec.stdout.read(w * h * 3)
        if len(raw) < w * h * 3:
            break
        crop = np.frombuffer(raw, np.uint8).reshape(h, w, 3)[y - pad:y + bh + pad, x - pad:x + bw + pad].copy()
        o = cv2.inpaint(crop, mask, 6, cv2.INPAINT_TELEA).astype(np.float64)[pad:pad + bh, pad:pad + bw]
        m = crop.astype(np.float64)[pad:pad + bh, pad:pad + bw]
        num += ((m - o) * (255 - o)).sum(axis=2)
        den += ((255 - o) ** 2).sum(axis=2)
    dec.wait()
    a = np.clip(num / np.maximum(den, 1), 0, 1)
    a[a0 == 0] = 0
    return a


def main():
    ap = argparse.ArgumentParser(description='Measure a visible mark alpha map from a pure-black clip.')
    ap.add_argument('video')
    ap.add_argument('--name', required=True, help='mark name, e.g. veo')
    ap.add_argument('--pad', type=int, default=3)
    ap.add_argument('--min', action='store_true', help='per-pixel minimum of a normal clip instead of a black clip')
    ap.add_argument('--near', help='X,Y,R: search the mark only in this window (needed with --min)')
    a = ap.parse_args()

    avg, w, h, n = mean_frame(os.path.abspath(a.video), a.min)
    grey = avg.max(axis=2)
    if a.near:
        cx, cy, r = (int(v) for v in a.near.split(','))
        win = np.full_like(grey, np.nan)
        win[max(0, cy - r):cy + r, max(0, cx - r):cx + r] = grey[max(0, cy - r):cy + r, max(0, cx - r):cx + r]
        black = float(np.nanpercentile(win, 50))
        grey = np.nan_to_num(win, nan=black)
    else:
        black = float(np.median(grey))
    quarter = grey[h // 2:, w // 2:] - black
    peak = float(quarter.max())
    if peak < 20:
        sys.exit(f'no mark visible (brightest corner value {peak + black:.1f}, black {black:.1f})')
    ys, xs = np.nonzero(quarter > max(6.0, peak * 0.08))
    x0 = max(0, w // 2 + xs.min() - a.pad); y0 = max(0, h // 2 + ys.min() - a.pad)
    x1 = min(w, w // 2 + xs.max() + 1 + a.pad); y1 = min(h, h // 2 + ys.max() + 1 + a.pad)
    alpha = np.clip(grey[y0:y1, x0:x1] - black, 0, 255) / 255.0
    alpha[alpha < 3 / 255] = 0  # codec dust around the letters is not part of the mark
    if a.min:
        alpha = fit_alpha(os.path.abspath(a.video), alpha, x0, y0, w, h)
        alpha[alpha < 3 / 255] = 0

    os.makedirs(OUT_DIR, exist_ok=True)
    file = f'{a.name}-{h}.png'
    g = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT_DIR, file), cv2.merge([g, g, g]))
    marks = json.load(open(INDEX)) if os.path.exists(INDEX) else []
    marks = [m for m in marks if m.get('file') != file]
    entry = {'name': a.name, 'file': file, 'ref': [w, h], 'box': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
             'margin': [int(w - x1), int(h - y1)], 'peak': round(float(alpha.max()), 3), 'frames': n}
    if a.min:  # no black clip: paint the edge band in after the reverse blend (bin/unmark.py, MISTAKES G07)
        entry.update({'ring': 2, 'method': 'min + inpaint fit over a normal clip (no black clip yet)'})
    marks.append(entry)
    json.dump(marks, open(INDEX, 'w'), indent=2)
    print(json.dumps(entry, indent=2))


if __name__ == '__main__':
    main()
