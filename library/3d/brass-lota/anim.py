"""Brass lota — one 4 s shot (law 30 scope: a single short shot, our shot methods).
Out of darkness, a soft light strip sweeps across the brass (its reflection travels over the belly), the camera
pushes in with a small orbit (ease in/out), a few dust motes drift through the light, motion blur on.
Run: Blender -b --python anim.py [-- --stills 1,60,120 --outdir /abs/dir --pct 50]
Writes brass-lota-anim.blend; render it with: bin/studio.mjs blender render <blend> --frames 1-120"""
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
MYARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
sys.argv = [a for a in sys.argv if a not in MYARGS]          # build.py must not see our flags
exec(open(os.path.join(HERE, 'build.py')).read())           # the finished still scene (steps 1-6)

FPS, N = 30, 120
sc = bpy.context.scene
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, N
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
L = bpy.data.objects


def key(obj_or_data, path, frame, value, idx=None):
    setattr(obj_or_data, path, value) if idx is None else getattr(obj_or_data, path).__setitem__(idx, value)
    obj_or_data.keyframe_insert(path, frame=frame, index=-1 if idx is None else idx)

# ---------- camera: pivot orbit -14° -> +6° and dolly 1.08 m -> 0.92 m, eased ----------
cam = sc.camera
target = (0.0, 0.0, 0.058)
pivot = empty('CamPivot', loc=target)
cam.constraints.clear()
dist0, dist1, h = 1.08, 0.92, 0.24 - target[2]
cam.parent = pivot
cam.location = (0.0, -dist0, h)
tt = cam.constraints.new('TRACK_TO')
look = empty('LookAt', loc=target)
tt.target, tt.track_axis, tt.up_axis = look, 'TRACK_NEGATIVE_Z', 'UP_Y'
pivot.rotation_euler = (0, 0, math.radians(-14)); pivot.keyframe_insert('rotation_euler', frame=1, index=2)
pivot.rotation_euler = (0, 0, math.radians(6));   pivot.keyframe_insert('rotation_euler', frame=N, index=2)
cam.location = (0.0, -dist0, h);       cam.keyframe_insert('location', frame=1)
cam.location = (0.0, -dist1, h - 0.02); cam.keyframe_insert('location', frame=N)
focus = empty('Focus', loc=(0.0, -0.045, 0.06))                # front skin of the belly
cam.data.dof.focus_object = focus
cam.data.dof.aperture_fstop = 8.0

# ---------- light: out of darkness, then a strip sweeps left -> right in front ----------
base = {n: L[n].data.energy for n in ('Key', 'StripL', 'StripR', 'Kicker')}
for n, e in base.items():
    d = L[n].data
    d.energy = e * (0.04 if n != 'Kicker' else 0.35); d.keyframe_insert('energy', frame=1)
    d.energy = e * (0.04 if n != 'Kicker' else 0.35); d.keyframe_insert('energy', frame=14)
    d.energy = e;                                    d.keyframe_insert('energy', frame=78)
# the world fades up too, or the reflections keep the frame lit at the start
bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
s0 = bg.inputs['Strength'].default_value
for f, k in ((1, 0.1), (14, 0.1), (78, 1.0)):
    bg.inputs['Strength'].default_value = s0 * k
    bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
sweep = light('AREA', 'Sweep', loc=(-0.45, -0.42, 0.10), target=(0, 0, 0.06), energy=9.0, color=kelvin(3600),
              size=0.03, size_y=0.5)
sweep.location = (-0.45, -0.42, 0.10); sweep.keyframe_insert('location', frame=10)
sweep.location = (0.45, -0.42, 0.10);  sweep.keyframe_insert('location', frame=96)
tsw = sweep.constraints.new('TRACK_TO'); tsw.target = look
tsw.track_axis, tsw.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'

# ---------- dust motes: few, tiny, mostly out of focus, catching the light (never glowing bits) ----------
random.seed(7)
mote_mat = mat_plastic('Mote', color=(0.3, 0.27, 0.22), rough=0.9, gloss_var=0.05)
for i in range(14):
    r = random.uniform(0.00025, 0.0006)
    # only in the light, between camera and lota, mostly in front of focus (soft discs, not stars)
    x, y, z = random.uniform(-0.12, 0.12), random.uniform(-0.45, -0.12), random.uniform(0.03, 0.15)
    m = prim('ico', f'Mote{i:02d}', loc=(x, y, z), size=(r * 2,) * 3, sub=1)
    set_mat(m, mote_mat)
    m.keyframe_insert('location', frame=1)
    m.location = (x + random.uniform(-0.02, 0.02), y + random.uniform(-0.015, 0.015), z + random.uniform(0.008, 0.03))
    m.keyframe_insert('location', frame=N)
    for fc in (m.animation_data.action.fcurves if hasattr(m.animation_data.action, 'fcurves') else []):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'                     # motes drift, they don't ease

out = os.path.join(HERE, 'brass-lota-anim.blend')
bpy.ops.wm.save_as_mainfile(filepath=out)
print('[saved]', out)

if '--stills' in MYARGS:
    outdir = MYARGS[MYARGS.index('--outdir') + 1] if '--outdir' in MYARGS else HERE
    sc.render.resolution_percentage = int(MYARGS[MYARGS.index('--pct') + 1]) if '--pct' in MYARGS else 100
    for f in [int(x) for x in MYARGS[MYARGS.index('--stills') + 1].split(',')]:
        sc.frame_set(f)
        still(os.path.join(outdir, f'anim_f{f:03d}.png'))
