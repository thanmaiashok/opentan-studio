#!/usr/bin/env python3
"""upscale — the TAN Upscaler (law 29): one ffmpeg filter graph for our images and videos.

    python3 bin/upscale.py <in> [--out file] [--to 2k|4k | --scale 2] [--preset ai|restore] [--json]

Everything runs inside ffmpeg, no extra engine. Video keeps its frame rate and audio (copied); images come out as
PNG (or JPEG / WebP when --out says so).

Presets
  ai       (default) for our own generations, which are already clean: Lanczos resize, light CAS sharpening, deband.
  restore  for compressed or old footage: deblock, BM3D denoise, Lanczos resize, CAS, deband, a touch of grain.
--to 2k / 4k sets the scale so the long side reaches 2560 / 3840 px; --scale sets it directly (1 to 4).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

VIDEO = re.compile(r'\.(mp4|mov|webm|m4v)$', re.I)
LONG_SIDE = {'2k': 2560, '4k': 3840}


def chain(preset, ow, oh):
    """The filter graph for one preset, ending at ow x oh."""
    size = f'scale={ow}:{oh}:flags=lanczos+accurate_rnd+full_chroma_int'
    sharp = 'cas=strength=0.3'
    band = 'deband=1thr=0.015:2thr=0.015:3thr=0.015:range=12'
    if preset == 'restore':
        return ','.join(['deblock=filter=weak:block=8', 'bm3d=sigma=3:block=8:bstep=4:group=8:estim=basic',
                         size, 'cas=strength=0.4', band, 'noise=alls=3:allf=t'])
    return ','.join([size, sharp, band])


def rotation(s):
    """Degrees the player turns this stream (display matrix, or the old `rotate` tag); ffmpeg autorotates by it."""
    for sd in s.get('side_data_list') or []:
        if 'rotation' in sd:
            return int(float(sd['rotation']))
    return int(float((s.get('tags') or {}).get('rotate') or 0))


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                          'stream=codec_type,width,height,avg_frame_rate:stream_tags=rotate:stream_side_data=rotation',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    streams = json.loads(out)['streams']
    vid = next(s for s in streams if s.get('codec_type') == 'video')
    w, h = int(vid['width']), int(vid['height'])
    if abs(rotation(vid)) % 180 == 90:  # ffmpeg turns the frames upright before our graph, so size it as h x w
        w, h = h, w
    return w, h, vid.get('avg_frame_rate') or '30/1', \
        any(s.get('codec_type') == 'audio' for s in streams)


def even(n):
    return max(2, int(round(n / 2)) * 2)


def main():
    ap = argparse.ArgumentParser(description='Upscale an image or video with the TAN Upscaler.')
    ap.add_argument('input')
    ap.add_argument('--out')
    ap.add_argument('--to', choices=list(LONG_SIDE))
    ap.add_argument('--scale', type=float)
    ap.add_argument('--preset', choices=['ai', 'restore'], default='ai')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    started = time.time()
    src = os.path.abspath(a.input)
    if not os.path.isfile(src):
        print(f'no such file: {src}', file=sys.stderr)
        return 2
    is_video = bool(VIDEO.search(src))
    w, h, rate, has_audio = probe(src)
    factor = a.scale or (LONG_SIDE[a.to] / max(w, h) if a.to else 2.0)
    factor = round(max(1.0, min(factor, 4.0)), 4)
    ow, oh = even(w * factor), even(h * factor)
    base = os.path.splitext(src)[0]
    out = os.path.abspath(a.out or f'{base}-{a.to or f"x{factor:g}"}{".mp4" if is_video else ".png"}')
    graph = chain(a.preset, ow, oh)

    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', graph]
    if is_video:
        cmd += ['-map', '0:v:0'] + (['-map', '0:a:0', '-c:a', 'copy'] if has_audio else [])
        cmd += ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    else:
        cmd += ['-frames:v', '1']
        if out.lower().endswith(('.jpg', '.jpeg')):
            cmd += ['-q:v', '2', '-pix_fmt', 'yuvj444p']
    res = subprocess.run(cmd + [out], capture_output=True, text=True)
    if res.returncode != 0 or not os.path.exists(out):
        print('upscale failed:', res.stderr.strip()[-600:], file=sys.stderr)
        return 1

    report = {'input': src, 'output': out, 'from': f'{w}x{h}', 'to': f'{ow}x{oh}', 'scale': factor, 'preset': a.preset,
              'filters': graph, 'fps': rate if is_video else None, 'seconds': round(time.time() - started, 1)}
    print(json.dumps(report, indent=2) if a.json else f'upscaled {w}x{h} → {ow}x{oh} ({a.preset}, {report["seconds"]} s) → {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
