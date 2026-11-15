#!/usr/bin/env python3
"""unmark — remove the visible AI mark (the Veo wordmark in Flow clips) from our own videos (law 28).

    python3 bin/unmark.py <in.mp4> [--out clean.mp4] [--json] [--keep-if-none]

How:
  The visible mark is white, alpha-blended into the bottom-right corner:
      marked = a * 255 + (1 - a) * original
  so with the mark's alpha map `a` the frame is put back:
      original = (marked - a * 255) / (1 - a)
  Maps are OURS, measured by bin/markmap.py from a pure-black clip we made; library/watermarks/marks.json lists
  each one with the box it sat in at its measured size.
  1. find: scale every measured mark to this frame size, try small shifts around its box and a range of strengths
     on ~16 frames spread over the clip; keep the best only if the mark is clearly there (else the video is left
     as it is and the report says so).
  2. remove: reverse the blend on every frame, then soften only the mark's thin edges (where codec noise survives
     the reverse); nothing else in the frame is touched.
  3. write: same size and frame rate (an odd side gets one edge pixel, x264 needs even), H.264 high quality,
     the input's colour matrix / range / tags kept (untagged → BT.709); audio copied when MP4 takes it, else AAC.
Only the VISIBLE mark is removed. Invisible SynthID stays in the video — never try to remove it.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import cv2
import numpy as np

MAPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'library', 'watermarks')
INDEX = os.path.join(MAPS, 'marks.json')
MIN_SCORE = 0.35  # correlation the mark must reach to count as present


# ffprobe colour names → swscale matrix names; anything else (unknown / unset) is read and written as BT.709
MATRIX = {'bt709': 'bt709', 'smpte170m': 'smpte170m', 'bt470bg': 'bt470', 'fcc': 'fcc', 'smpte240m': 'smpte240m',
          'bt2020nc': 'bt2020', 'bt2020c': 'bt2020'}
MP4_AUDIO = {'aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac'}  # copied as is; anything else (PCM …) is encoded to AAC


def rotation(s):
    """Degrees the player turns this stream (display matrix, or the old `rotate` tag); ffmpeg autorotates by it."""
    for sd in s.get('side_data_list') or []:
        if 'rotation' in sd:
            return int(float(sd['rotation']))
    return int(float((s.get('tags') or {}).get('rotate') or 0))


def probe(path):
    d = json.loads(subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'stream=codec_type,codec_name,width,height,avg_frame_rate,color_space,color_primaries,color_transfer,color_range'
         ':stream_tags=rotate:stream_side_data=rotation:format=duration',
         '-of', 'json', path], capture_output=True, text=True, check=True).stdout)
    vid = next(s for s in d['streams'] if s.get('codec_type') == 'video')
    rate = vid.get('avg_frame_rate') or '30/1'
    num, den = (float(x) for x in rate.split('/'))
    w, h = int(vid['width']), int(vid['height'])
    if abs(rotation(vid)) % 180 == 90:  # ffmpeg hands us the frames turned upright, so the frame is h x w
        w, h = h, w
    known = lambda k: vid.get(k) if vid.get(k) not in (None, '', 'unknown', 'reserved') else None
    space = known('color_space') if known('color_space') in MATRIX else None
    colour = {'matrix': MATRIX[space] if space else 'bt709', 'space': space or 'bt709',
              'primaries': known('color_primaries') or 'bt709', 'trc': known('color_transfer') or 'bt709',
              'range': 'pc' if vid.get('color_range') == 'pc' else 'tv'}
    audio = [s.get('codec_name') or '' for s in d['streams'] if s.get('codec_type') == 'audio']
    return (w, h, rate, num / den if den else 30.0, float(d.get('format', {}).get('duration') or 0), audio, colour)


def to_rgb(colour):
    """Decode filter: the input's own YUV matrix and range → RGB (never ffmpeg's BT.601 guess)."""
    return f"scale=in_color_matrix={colour['matrix']}:in_range={colour['range']}"


def measured_marks():
    """Every measured map: name, alpha (float32), the box it sat in and the frame size it was measured at."""
    if not os.path.exists(INDEX):
        return []
    out = []
    for m in json.load(open(INDEX)):
        img = cv2.imread(os.path.join(MAPS, m['file']), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            out.append({**m, 'alpha': img.astype(np.float32) / 255.0})
    return out


def placed(mark, w, h):
    """The mark's alpha and box for a w x h frame (scaled from the size it was measured at)."""
    rw, rh = mark['ref']
    k = min(w, h) / min(rw, rh)  # the mark scales with the frame's short side (9:16 clips carry the same mark as 16:9)
    bx, by, bw, bh = mark['box']
    mw, mh = max(4, round(bw * k)), max(4, round(bh * k))
    a = mark['alpha'] if (mw, mh) == (bw, bh) else cv2.resize(
        mark['alpha'], (mw, mh), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    # keep the measured distance from the right / bottom edges, scaled
    x = w - round((rw - bx - bw) * k) - mw
    y = h - round((rh - by - bh) * k) - mh
    return np.clip(a, 0, 0.95), x, y, mw, mh, k


def read_frames(path, w, h, at, colour):
    frames = []
    for t in at:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf', to_rgb(colour),
                              '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        if len(raw) == w * h * 3:
            frames.append(np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.float32))
    return frames


def detail(x, sigma):
    return x - cv2.GaussianBlur(x, (0, 0), sigma)


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 1e-6 else 0.0


def restore(roi, a, gain):
    ag = np.clip(a * gain, 0, 0.92)[..., None]
    return np.clip((roi - ag * 255.0) / (1.0 - ag), 0, 255)


def edge_mask(a):
    g = cv2.magnitude(cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3))
    g = cv2.GaussianBlur(g, (0, 0), 0.8)
    return np.clip(g / (g.max() + 1e-6) * 1.4, 0, 1)[..., None] * 0.65


def find_mark(frames, w, h, marks):
    best = None
    # use only the map measured nearest this frame size (an AI upscale redraws the mark, so sizes differ in shape too)
    near = {}
    for m in marks:
        d = abs(min(m['ref']) - min(w, h))
        if m['name'] not in near or d < near[m['name']][0]:
            near[m['name']] = (d, m)
    marks = [m for _, m in near.values()]
    for mark in marks:
        a, x0, y0, mw, mh, k = placed(mark, w, h)
        sigma = max(1.0, min(mw, mh) / 6)
        da = detail(a, sigma)
        reach = max(2, round(3 * k))
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                x, y = x0 + dx, y0 + dy
                if x < 0 or y < 0 or x + mw > w or y + mh > h:
                    continue
                rois = [f[y:y + mh, x:x + mw] for f in frames]
                score = float(np.median([corr(detail(r.mean(axis=2), sigma), da) for r in rois]))
                if best and score <= best['score']:
                    continue
                best = {'mark': mark['name'], 'ring': int(mark.get('ring', 0)), 'x': x, 'y': y, 'w': mw, 'h': mh, 'score': round(score, 3), '_a': a,
                        '_rois': rois, '_sigma': sigma}
    if not best:
        return None
    # strength: the gain that leaves the least mark-shaped detail behind
    a, rois, sigma = best.pop('_a'), best.pop('_rois'), best.pop('_sigma')
    gains = np.arange(0.6, 1.36, 0.05)
    da = detail(a, sigma)
    left = [np.median([abs(corr(detail(restore(r, a, g).mean(axis=2), sigma), da)) for r in rois]) for g in gains]
    best.update({'gain': round(float(gains[int(np.argmin(left))]), 2), 'residual': round(float(min(left)), 3)})
    best['size'] = f"{best['w']}x{best['h']}"
    best['profile'] = best['mark']
    return best, a


def main():
    ap = argparse.ArgumentParser(description='Remove the visible AI mark from our own video (not SynthID).')
    ap.add_argument('input')
    ap.add_argument('--out')
    ap.add_argument('--json', action='store_true', help='print the report as JSON')
    ap.add_argument('--keep-if-none', action='store_true', help='no mark found → leave the input alone, write nothing')
    args = ap.parse_args()

    started = time.time()
    src = os.path.abspath(args.input)
    out = os.path.abspath(args.out or os.path.splitext(src)[0] + '-clean.mp4')
    w, h, rate, fps, dur, audio, colour = probe(src)
    marks = measured_marks()
    report = {'input': src, 'output': out, 'size': f'{w}x{h}', 'fps': round(fps, 3), 'mark': None}
    found = None
    if not marks:
        report['reason'] = 'no mark map measured yet (library/watermarks/)'
    else:
        at = [dur * (i + 0.5) / 16 for i in range(16)] if dur > 0 else [0]
        frames = read_frames(src, w, h, at, colour)
        found = find_mark(frames, w, h, marks) if frames else None
        report['mark'] = found[0] if found else None

    if not found or found[0]['score'] < MIN_SCORE:
        report['found'] = False
        if args.keep_if_none:
            report['output'] = None
        elif out != src:
            shutil.copyfile(src, out)
        report['seconds'] = round(time.time() - started, 1)
        score = report['mark'] and report['mark']['score']
        print(json.dumps(report, indent=2) if args.json else
              f'no visible mark found (best score {score}){" — " + report["reason"] if "reason" in report else ""} — video left as is')
        return 0

    mark, a = found
    report['found'] = True
    x, y, mw, mh = mark['x'], mark['y'], mark['w'], mark['h']
    soft = edge_mask(a)
    # a mark redrawn solid by an AI upscale (peak alpha ≥ 0.9) is painted in over its whole shape; else only its solid core
    hard = ((a >= 0.12) if a.max() >= 0.9 else (a * mark['gain'] >= 0.8)).astype(np.uint8)
    # a map measured without a black clip (markmap --min, the Omni sparkle) leaves a hair-thin outline where its edge is
    # a pixel off: marks.json "ring": N paints that edge band (N px each side) in from around (MISTAKES G07)
    if mark.get('ring'):
        k = np.ones((2 * mark['ring'] + 1, 2 * mark['ring'] + 1), np.uint8)
        shape = (a > 0.02).astype(np.uint8)
        hard = np.maximum(hard, cv2.dilate(shape, k) - cv2.erode(shape, k))
    opaque = cv2.dilate(hard, np.ones((3, 3), np.uint8)) * 255 if hard.any() else None
    tmp = out + '.part.mp4'
    # libx264 4:2:0 needs an even frame: an odd side grows by one edge-copied pixel, nothing else changes
    pw, ph = w % 2, h % 2
    dec_log, enc_log = tempfile.TemporaryFile(), tempfile.TemporaryFile()
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-vf', to_rgb(colour), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           stdout=subprocess.PIPE, stderr=dec_log)
    enc_cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w + pw}x{h + ph}', '-r', rate,
               '-i', '-']
    if audio:
        copy = all(c in MP4_AUDIO for c in audio)
        enc_cmd += ['-i', src, '-map', '0:v', '-map', '1:a'] + (['-c:a', 'copy'] if copy else ['-c:a', 'aac', '-b:a', '192k'])
    # write back in the input's own matrix / range and tag it (untagged input → BT.709), so colours do not shift
    tags = f"colorspace={colour['space']}:color_primaries={colour['primaries']}:color_trc={colour['trc']}:range={colour['range']}"
    enc_cmd += ['-vf', f"scale=in_range=pc:out_color_matrix={colour['matrix']}:out_range={colour['range']},format=yuv420p,"
                       f"setparams={tags}",
                '-colorspace', colour['space'], '-color_primaries', colour['primaries'], '-color_trc', colour['trc'],
                '-color_range', colour['range'],
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', '-shortest', tmp]
    enc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=enc_log)

    def fail(why):
        for p in (dec, enc):
            if p.poll() is None:
                p.kill()
            p.wait()
        if os.path.exists(tmp):
            os.remove(tmp)
        last = ''
        for log in (enc_log, dec_log):
            log.seek(0)
            lines = [x for x in log.read().decode('utf-8', 'replace').splitlines() if x.strip()]
            if lines:
                last = lines[-1].strip()
                break
        print(f'unmark failed: {why}{" — " + last if last else ""}', file=sys.stderr)
        return 1

    n, frame_bytes = 0, w * h * 3
    try:
        while True:
            raw = dec.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break
            f = np.frombuffer(raw, np.uint8).reshape(h, w, 3).copy()
            r = restore(f[y:y + mh, x:x + mw].astype(np.float32), a, mark['gain'])
            r = r * (1 - soft) + cv2.GaussianBlur(r, (0, 0), 1.0) * soft
            if opaque is not None:  # where the mark is (almost) solid there is nothing to recover: paint it in from around
                pad = 6
                y0, x0 = max(0, y - pad), max(0, x - pad)
                big = f[y0:y + mh + pad, x0:x + mw + pad].copy()
                big[y - y0:y - y0 + mh, x - x0:x - x0 + mw] = np.clip(r + 0.5, 0, 255).astype(np.uint8)
                m = np.zeros(big.shape[:2], np.uint8)
                m[y - y0:y - y0 + mh, x - x0:x - x0 + mw] = opaque
                big = cv2.inpaint(big, m, 3, cv2.INPAINT_TELEA)
                r = big[y - y0:y - y0 + mh, x - x0:x - x0 + mw].astype(np.float32)
            f[y:y + mh, x:x + mw] = np.clip(r + 0.5, 0, 255).astype(np.uint8)
            if pw or ph:
                f = np.pad(f, ((0, ph), (0, pw), (0, 0)), mode='edge')
            enc.stdin.write(f.tobytes())
            n += 1
        enc.stdin.close()
    except (BrokenPipeError, OSError) as e:
        return fail(f'encoder stopped after {n} frames ({e.__class__.__name__})')
    except Exception as e:
        return fail(f'{e.__class__.__name__}: {e}')
    if dec.wait() != 0:
        return fail('could not decode the input')
    if enc.wait() != 0 or not os.path.exists(tmp):
        return fail('encode failed')
    if n == 0:
        return fail('no frames decoded')
    os.replace(tmp, out)
    report.update({'frames': n, 'seconds': round(time.time() - started, 1)})
    if pw or ph:
        report['size_out'] = f'{w + pw}x{h + ph}'
    print(json.dumps(report, indent=2) if args.json else
          f'removed {mark["mark"]} mark ({mark["size"]} at {x},{y}, gain {mark["gain"]}, score {mark["score"]}) '
          f'from {n} frames → {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
