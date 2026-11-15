"""Brass lota — step 2 dimension sheet as code (metres). Shared by build.py and the capacity check."""
import math

# key points of the OUTER wall, bottom to rim (r, z). From the reference sheet (reference.md).
KEYS = [
    (0.0300, 0.0000),  # base edge (flat base Ø 60 mm)
    (0.0330, 0.0035),  # foot turns out
    (0.0410, 0.0130),
    (0.0460, 0.0300),
    (0.0470, 0.0450),  # widest belly Ø 94 mm at 45 mm
    (0.0455, 0.0600),
    (0.0410, 0.0720),
    (0.0340, 0.0790),  # flattened shoulder: turns in almost flat
    (0.0285, 0.0830),
    (0.0262, 0.0880),  # neck waist Ø 52 mm
    (0.0272, 0.0980),
    (0.0315, 0.1100),  # flare
    (0.0370, 0.1220),
    (0.0395, 0.1300),  # everted rim Ø 79 mm, height 130 mm
]
WALL = 0.0009     # sheet brass 0.9 mm
LIP = 0.0016      # rolled rim thickness


def catmull(pts, n=6):
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * ((2 * p[i][d]) + (-p[i - 1][d] + p[i + 1][d]) * t +
                                    (2 * p[i - 1][d] - 5 * p[i][d] + 4 * p[i + 1][d] - p[i + 2][d]) * t * t +
                                    (-p[i - 1][d] + 3 * p[i][d] - 3 * p[i + 1][d] + p[i + 2][d]) * t ** 3) for d in (0, 1)))
    out.append(pts[-1])
    return out


def outer():
    return [(0.0, 0.0)] + catmull(KEYS)


def inner_volume_ml():
    v = 0.0
    prof = [(max(0.0, r - WALL), z) for r, z in catmull(KEYS)]
    for (r1, z1), (r2, z2) in zip(prof, prof[1:]):
        h = z2 - z1
        if h > 0:
            v += math.pi * h * (r1 * r1 + r1 * r2 + r2 * r2) / 3
    return v * 1e6


if __name__ == '__main__':
    print(f'brim capacity {inner_volume_ml():.0f} ml (spec 550 ml) · height {KEYS[-1][1]*1000:.0f} mm · widest Ø {max(r for r, _ in KEYS)*2000:.1f} mm')
