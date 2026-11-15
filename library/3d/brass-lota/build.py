"""Brass lota test model — the six steps of guide/BLENDER.md (law 30). Run: bin/studio.mjs blender run <this file>.
Optional: -- --still /abs/path.png   (renders one look-still too)"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "tools", "blender"))
sys.path.insert(0, HERE)
from kit import *
import lota_profile as P

reset(fps=30)
render_setup('eevee', res=(1920, 1080), samples=96)

# ---------- 3 model ----------
lota = lathe('Lota', P.outer(), segments=128, sharp_angle=70)
solidify(lota, P.WALL, offset=-1.0)
r_rim, z_rim = P.KEYS[-1]
rim = prim('torus', 'RolledRim', loc=(0, 0, z_rim), R=r_rim - P.LIP / 2, r=P.LIP / 2, su=128, sv=16)
bead = prim('torus', 'NeckBead', loc=(0, 0, 0.0832), R=0.0288, r=0.0008, su=128, sv=12)
for o in (rim, bead):
    parent(o, lota)

# ---------- 4 smooth ----------
bevel(lota, 0.0003, 2, angle=40)
weighted_normals(lota)
check_dims(lota, (0.094, 0.094, 0.130))

# ---------- 5 texture ----------
def mat_lota_brass():
    b = NB('LotaBrass')
    v = b.coord('Object')
    xyz = b.n('ShaderNodeSeparateXYZ'); b.link(v, xyz.inputs[0])
    # lathe rings: 0.25 mm pitch around the axis (z bands), very low bump
    rings = b.math('ADD', b.math('MULTIPLY', b.math('SINE', b.math('MULTIPLY', xyz.outputs[2], 25000.0)), 0.5), 0.5)
    tarn = b.noise(v, 18.0, 6, 0.6)              # tarnish patches (a few cm)
    smudge = b.noise(b.coord('Object', 1.0), 70.0, 4, 0.7)   # finger marks / dull spots
    micro = b.noise(v, 900.0, 2, 0.5)
    polished, tarnish = (0.80, 0.56, 0.24), (0.36, 0.22, 0.08)
    col = b.mix(polished, tarnish, b.maprange(tarn.outputs['Fac'], 0.42, 0.72, 0.0, 0.9))
    col = b.cavity(col, (0.16, 0.09, 0.03), dist=0.012, lo=0.2, hi=0.95)
    b.set('Base Color', col)
    b.set('Metallic', 1.0)
    rough = b.maprange(b.math('ADD', b.math('MULTIPLY', smudge.outputs['Fac'], 1.0), b.math('MULTIPLY', rings, 0.15)), 0.45, 1.05, 0.2, 0.42)
    b.set('Roughness', b.mix(rough, (0.5, 0.5, 0.5), b.maprange(tarn.outputs['Fac'], 0.45, 0.75, 0.0, 0.7)))
    b.set('Normal', b.bump(b.math('ADD', rings, b.math('MULTIPLY', micro.outputs['Fac'], 0.3)), 0.025, 0.0001))
    try:
        b.set('Anisotropic', 0.35)
    except Exception:
        pass
    return b.mat

brass = mat_lota_brass()
for o in (lota, rim, bead):
    set_mat(o, brass)

board = prim('cube', 'TeakBoard', loc=(0.0, 0.0, -0.014), size=(0.32, 0.20, 0.028), smooth=False)
bevel(board, 0.002, 3); weighted_normals(board)
# real wood photo (Texturelabs wood_142, law 31), a little darker + oiled like teak
set_mat(board, mat_photo('wood_142', name='TeakPhoto', size_m=0.6, rough=(0.35, 0.65), bump=0.04, coat=0.25, tint=(0.62, 0.5, 0.42)))
drop_to_ground(lota, 0.0)

cyc = floor(3.0, mat_plastic('Backdrop', color=(0.02, 0.018, 0.016), rough=0.8, gloss_var=0.05), curve=True)
cyc.location = (0, 0.35, -0.028)

# ---------- 6 light ----------
world_hdri('interior', 0.1, visible=False)
rig_product(target=(0, 0, 0.065), size=0.13, key=5.0, warm=4300)
camera('Cam', loc=(0.0, -1.0, 0.24), target=(0, 0, 0.058), lens=85, fstop=11, focus=0.98)
compositor()

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'brass-lota.blend'))
print('[saved]', os.path.join(HERE, 'brass-lota.blend'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if '--still' in argv:
    still(argv[argv.index('--still') + 1])
