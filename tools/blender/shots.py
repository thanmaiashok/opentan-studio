"""3D Director shot engine (law 32) — our shot types, applied to any finished model.

Called by `bin/studio.mjs shot <studio> <scene.blend>` as:
    Blender -b scene.blend --python shots.py -- <studio> --out /abs/new.blend [--seconds 4] [--hero Name]
                                                 [--motes] [--wet] [--turns 0.5] [--fps 30]
    Blender -b --factory-startup --python shots.py -- title --text "WORD" --out /abs/new.blend [--font file.ttf]
It keeps the scene's models and materials (law 30 steps 1-5 are done before this), replaces cameras, lights and
the world with the studio's own (step 6), animates, and saves a new .blend that the CLI renders.
Studios live in library/3d-studios.json; a studio marked none has no function here yet.
"""
import sys, os, math, random, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *
from mathutils import Vector

SCENERY = re.compile(r'floor|cyclo|backdrop|ground|plane|board|plinth|table|wall|Mote', re.I)


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'studio': a[0] if a else None}
    i = 1
    while i < len(a):
        k = a[i].lstrip('-')
        if i + 1 < len(a) and not a[i + 1].startswith('--'):
            out[k] = a[i + 1]; i += 2
        else:
            out[k] = True; i += 1
    return out

# ---------------------------------------------------------------- scene reading

def roots():
    return [o for o in bpy.context.scene.objects if o.parent is None]


def family(o):
    return [o] + [c for c in o.children_recursive]


def world_box(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != 'MESH' and o.type != 'CURVE' and o.type != 'FONT':
            continue
        ev = o.evaluated_get(dg)
        pts += [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    if not pts:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def find_hero(name=None):
    """The product: --hero Name, an object called Hero, or the biggest non-scenery mesh family."""
    if name:
        return bpy.data.objects[name]
    if 'Hero' in bpy.data.objects:
        return bpy.data.objects['Hero']
    best, size = None, -1
    for o in roots():
        if o.type not in ('MESH', 'EMPTY', 'FONT', 'CURVE') or SCENERY.search(o.name):
            continue
        lo, hi = world_box(family(o))
        s = (hi - lo).length
        if s > size:
            best, size = o, s
    if best is None:
        raise RuntimeError('no hero object found (name it Hero or pass --hero)')
    return best


def hero_frame(hero):
    lo, hi = world_box(family(hero))
    centre = (lo + hi) / 2
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    return lo, hi, centre, size


def clear_rig():
    """Remove cameras + lights: the studio brings its own (step 6). Models, floors and materials stay."""
    for o in list(bpy.context.scene.objects):
        if o.type in ('CAMERA', 'LIGHT') or o.name in ('CamPivot', 'LookAt', 'Focus') or o.name.startswith('Mote'):
            bpy.data.objects.remove(o, do_unlink=True)


def has_floor():
    return any(SCENERY.search(o.name) for o in bpy.context.scene.objects if o.type == 'MESH')


def ensure_floor(hero_lo, size):
    if not has_floor():
        cyc = floor(size * 30, mat_plastic('Backdrop', color=(0.02, 0.018, 0.016), rough=0.8, gloss_var=0.05), curve=True)
        cyc.location = (hero_lo.x * 0, size * 2.5, hero_lo.z)

# ---------------------------------------------------------------- shared pieces

def frames(a, default=4):
    fps = int(a.get('fps', 30))
    n = max(2, int(round(float(a.get('seconds', default)) * fps)))
    sc = bpy.context.scene
    sc.render.fps, sc.frame_start, sc.frame_end = fps, 1, n
    return n


def fill_distance(size, lens=85, fill=0.55):
    """Camera distance so the hero's biggest side fills `fill` of the frame height (16:9, 36 mm sensor)."""
    half = math.atan((36 * 9 / 16) / 2 / lens)
    return size / fill / (2 * math.tan(half))


def cam_rig(target, dist, el_deg=12, az_deg=0, lens=85, fstop=None):
    """Camera on a pivot (orbit by turning the pivot), always looking at a target empty."""
    pivot = empty('CamPivot', loc=target)
    look = empty('LookAt', loc=target)
    cd = bpy.data.cameras.new('Cam')
    cd.lens, cd.sensor_width = lens, 36.0
    cd.clip_start, cd.clip_end = 0.001, 200
    cam = link(bpy.data.objects.new('Cam', cd))
    cam.parent = pivot
    e = math.radians(el_deg)
    cam.location = (0, -dist * math.cos(e), dist * math.sin(e))
    tt = cam.constraints.new('TRACK_TO')
    tt.target, tt.track_axis, tt.up_axis = look, 'TRACK_NEGATIVE_Z', 'UP_Y'
    pivot.rotation_euler = (0, 0, math.radians(az_deg))
    if fstop:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fstop
        cd.dof.aperture_blades = 7
    bpy.context.scene.camera = cam
    return cam, pivot, look


def focus_on(cam, loc):
    f = empty('Focus', loc=loc)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_object = f
    return f


def keyv(obj, path, frame, value):
    setattr(obj, path, value)
    obj.keyframe_insert(path, frame=frame)


def ease(obj, kind='BEZIER'):
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    curves = getattr(ad.action, 'fcurves', None)
    if curves is None:  # Blender 5 layered actions
        curves = [fc for layer in ad.action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = kind


def studio_light(hero_c, size, key=None, warm=4300):
    """Product rig scaled to the hero (kit.rig_product). Energy grows with size² so a mug and a car read the same."""
    key = key if key is not None else 5.0 * (size / 0.13) ** 2
    return {o.name: o for o in rig_product(target=tuple(hero_c), size=size, key=key, warm=warm)}


def dark_world(strength=0.1, hdri='interior'):
    world_hdri(hdri, strength, visible=False)
    return next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == 'BACKGROUND')


def add_motes(centre, size, cam_loc, n=14, seed=7, frames_n=120):
    """Few tiny motes in the light between camera and hero, mostly out of focus."""
    random.seed(seed)
    m_mat = mat_plastic('Mote', color=(0.3, 0.27, 0.22), rough=0.9, gloss_var=0.05)
    c, cl = Vector(centre), Vector(cam_loc)
    for i in range(n):
        t = random.uniform(0.15, 0.7)                       # mostly in front of focus
        p = c.lerp(cl, t) + Vector((random.uniform(-1, 1), random.uniform(-0.3, 0.3), random.uniform(-0.6, 0.8))) * size * 0.9
        r = size * random.uniform(0.002, 0.005)
        m = prim('ico', f'Mote{i:02d}', loc=tuple(p), size=(r * 2,) * 3, sub=1)
        set_mat(m, m_mat)
        m.keyframe_insert('location', frame=1)
        m.location = tuple(p + Vector((random.uniform(-0.15, 0.15), random.uniform(-0.1, 0.1), random.uniform(0.06, 0.25))) * size)
        m.keyframe_insert('location', frame=frames_n)
        ease(m, 'LINEAR')


def wet_studio(size, hero_lo):
    """Dark studio (Act II): wet puddled concrete floor, cool overhead strips, warm door spill from behind."""
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and re.search(r'floor|cyclo|ground', o.name, re.I):
            set_mat(o, mat_concrete('WetConcrete', base=(0.05, 0.052, 0.056), wet=0.7, scale=1.0 / max(size, 0.05)))
    if not has_floor():
        f = floor(size * 40, mat_concrete('WetConcrete', base=(0.05, 0.052, 0.056), wet=0.7, scale=1.0 / max(size, 0.05)))
        f.location.z = hero_lo.z
    for i, x in enumerate((-1.2, 0.0, 1.2)):
        light('AREA', f'Strip{i}', loc=(x * size, 0.3 * size, 2.6 * size), target=(x * size, 0.3 * size, 0), energy=8.0 * (size / 0.13) ** 2,
              color=kelvin(5600), size=size * 0.06, size_y=size * 2.2, specular=1.0)
    light('AREA', 'DoorSpill', loc=(0, 4 * size, 0.8 * size), target=(0, 0, 0.3 * size), energy=25.0 * (size / 0.13) ** 2,
          color=kelvin(2700), size=size * 1.5)

# ---------------------------------------------------------------- studios

def packshot(a, hero):
    lo, hi, c, size = hero_frame(hero)
    ensure_floor(lo, size)
    dark_world(0.12)
    studio_light(c, size)
    if a.get('wet'):
        wet_studio(size, lo)
    cam, _, _ = cam_rig(tuple(c), fill_distance(size), el_deg=12, az_deg=-8, lens=85, fstop=8)
    focus_on(cam, (c.x, c.y - size * 0.35, c.z))
    bpy.context.scene.frame_start = bpy.context.scene.frame_end = 1
    return 1


def reveal(a, hero):
    n = frames(a)
    lo, hi, c, size = hero_frame(hero)
    ensure_floor(lo, size)
    bg = dark_world(0.1)
    s0 = bg.inputs['Strength'].default_value
    rig = studio_light(c, size)
    d0, d1 = fill_distance(size, fill=0.48), fill_distance(size, fill=0.58)
    cam, pivot, look = cam_rig(tuple(c), d0, el_deg=13, az_deg=-14, lens=85, fstop=8)
    focus_on(cam, (c.x, c.y - size * 0.35, c.z))
    keyv(pivot, 'rotation_euler', 1, (0, 0, math.radians(-14)))
    keyv(pivot, 'rotation_euler', n, (0, 0, math.radians(6)))
    e = math.radians(13)
    keyv(cam, 'location', 1, (0, -d0 * math.cos(e), d0 * math.sin(e)))
    keyv(cam, 'location', n, (0, -d1 * math.cos(e), d1 * math.sin(e) * 0.9))
    up0, up1 = int(n * 0.12), int(n * 0.65)
    for name, o in rig.items():
        en = o.data.energy
        low = 0.35 if name == 'Kicker' else 0.04
        for f, k in ((1, low), (up0, low), (up1, 1.0)):
            o.data.energy = en * k
            o.data.keyframe_insert('energy', frame=f)
    for f, k in ((1, 0.1), (up0, 0.1), (up1, 1.0)):
        bg.inputs['Strength'].default_value = s0 * k
        bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
    sw = light('AREA', 'Sweep', loc=(c.x - size * 3.5, c.y - size * 3.2, c.z + size * 0.3), energy=9.0 * (size / 0.13) ** 2,
               color=kelvin(3600), size=size * 0.25, size_y=size * 4)
    t = sw.constraints.new('TRACK_TO'); t.target = look; t.track_axis, t.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'
    keyv(sw, 'location', int(n * 0.08), (c.x - size * 3.5, c.y - size * 3.2, c.z + size * 0.3))
    keyv(sw, 'location', int(n * 0.8), (c.x + size * 3.5, c.y - size * 3.2, c.z + size * 0.3))
    return n


def turntable(a, hero):
    n = frames(a)
    lo, hi, c, size = hero_frame(hero)
    ensure_floor(lo, size)
    dark_world(0.14)
    studio_light(c, size)
    spin = empty('Spin', loc=(c.x, c.y, lo.z))
    mw = hero.matrix_world.copy()
    hero.parent = spin
    hero.matrix_parent_inverse = spin.matrix_world.inverted()
    hero.matrix_world = mw
    turns = float(a.get('turns', 0.5))
    keyv(spin, 'rotation_euler', 1, (0, 0, 0))
    keyv(spin, 'rotation_euler', n + 1, (0, 0, 2 * math.pi * turns))
    ease(spin, 'LINEAR')
    cam, _, _ = cam_rig(tuple(c), fill_distance(size, fill=0.6), el_deg=16, lens=85, fstop=8)
    focus_on(cam, tuple(c))
    return n


def orbit(a, hero):
    n = frames(a)
    lo, hi, c, size = hero_frame(hero)
    ensure_floor(lo, size)
    dark_world(0.08, 'city')
    studio_light(c, size, warm=3800)
    if a.get('wet', True):
        wet_studio(size, lo)
    dist = fill_distance(size, lens=50, fill=0.5)
    cam, pivot, look = cam_rig((c.x, c.y, lo.z + size * 0.35), dist, el_deg=6, az_deg=-35, lens=50, fstop=5.6)
    focus_on(cam, tuple(c))
    keyv(pivot, 'rotation_euler', 1, (0, 0, math.radians(-35)))
    keyv(pivot, 'rotation_euler', n, (0, 0, math.radians(25)))
    return n


def macro(a, hero):
    n = frames(a)
    lo, hi, c, size = hero_frame(hero)
    ensure_floor(lo, size)
    dark_world(0.12)
    studio_light(c, size, warm=3600)
    d = fill_distance(size, lens=100, fill=1.6)            # closer than the whole object: a detail fills the frame
    cam, pivot, look = cam_rig((c.x, c.y, c.z), d, el_deg=8, az_deg=-10, lens=100, fstop=2.8)
    near = Vector((c.x - size * 0.25, c.y - size * 0.45, c.z))
    far = Vector((c.x + size * 0.25, c.y + size * 0.1, c.z + size * 0.15))
    f = focus_on(cam, tuple(near))
    keyv(f, 'location', int(n * 0.15), tuple(near))
    keyv(f, 'location', int(n * 0.85), tuple(far))
    keyv(look, 'location', 1, (c.x - size * 0.2, c.y, c.z))
    keyv(look, 'location', n, (c.x + size * 0.2, c.y, c.z + size * 0.05))
    keyv(pivot, 'location', 1, (c.x - size * 0.2, c.y, c.z))
    keyv(pivot, 'location', n, (c.x + size * 0.2, c.y, c.z + size * 0.05))
    return n


def exploded(a, hero):
    n = frames(a)
    lo, hi, c, size = hero_frame(hero)
    meshes = [o for o in family(hero) if o.type == 'MESH']
    if len(meshes) < 2:
        raise RuntimeError('exploded needs a model made of separate parts (this hero is one mesh)')
    # only the top parts fly: a mesh root with mesh children stays home as the base, and a part riding on another
    # part (its parent is also a part) moves with it — keying both would offset it twice
    parts = [o for o in meshes if o is not hero or not any(c.type == 'MESH' for c in hero.children_recursive)]
    parts = [o for o in parts if o.parent not in parts]
    ensure_floor(lo, size)
    dark_world(0.12)
    studio_light(c, size)
    random.seed(3)
    order = sorted(parts, key=lambda o: -(o.matrix_world.translation - c).length)
    span = int(n * 0.55)
    for i, o in enumerate(order):
        home = o.location.copy()
        w = o.matrix_world.translation
        out = (w - c)
        out = out.normalized() if out.length > 1e-6 else Vector((random.uniform(-1, 1), random.uniform(-1, 1), 1)).normalized()
        start = home + out * size * 0.9                    # (parts are children of the hero root, which is not rotated)
        land = int(n * 0.15) + int(span * i / max(1, len(order) - 1))
        keyv(o, 'location', 1, start)
        keyv(o, 'location', max(2, land - 8), home + out * size * 0.25)
        keyv(o, 'location', land, home - out * size * 0.01)    # slam: a hair past home
        keyv(o, 'location', land + 3, home)
    cam, pivot, _ = cam_rig(tuple(c), fill_distance(size, fill=0.42), el_deg=18, az_deg=-30, lens=70, fstop=8)
    focus_on(cam, tuple(c))
    keyv(pivot, 'rotation_euler', 1, (0, 0, math.radians(-30)))
    keyv(pivot, 'rotation_euler', n, (0, 0, math.radians(10)))
    return n


def title(a, hero=None):
    """6A: a word in machined brass. Text -> mesh, extruded + bevelled (clamped: no spikes on acute corners)."""
    text = str(a.get('text') or 'STUDIO')
    reset(fps=int(a.get('fps', 30)))
    render_setup('eevee', res=(1920, 1080), samples=64)
    cu = bpy.data.curves.new('Title', 'FONT')
    cu.body = text
    if a.get('font'):
        cu.font = bpy.data.fonts.load(str(a['font']))
    cu.align_x, cu.align_y = 'CENTER', 'CENTER'
    cu.size = 1.0
    cu.extrude = 0.12
    cu.offset = 0.0                                         # negative offset + bevel = light spike
    t = link(bpy.data.objects.new('Hero', cu))
    t.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.objects.active = t
    t.select_set(True)
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.view_layer.objects.active
    t.name = 'Hero'
    b = bevel(t, 0.012, 4, angle=30)
    b.use_clamp_overlap = True
    weighted_normals(t)
    set_mat(t, mat_brass('TitleBrass', scale=3.0, worn=0.3))
    drop_to_ground(t, 0.0)
    return reveal(a, t)


STUDIOS = {'packshot': packshot, 'reveal': reveal, 'turntable': turntable, 'orbit': orbit, 'macro': macro,
           'exploded': exploded, 'title': title}


def main():
    a = args()
    sid = a.get('studio')
    if sid not in STUDIOS:
        raise SystemExit(f'studio {sid} has no shot yet (ready: {", ".join(STUDIOS)})')
    if sid == 'title':
        n = title(a)
    else:
        hero = find_hero(a.get('hero'))
        clear_rig()
        n = STUDIOS[sid](a, hero)
    if a.get('motes') and sid != 'packshot':
        lo, hi, c, size = hero_frame(find_hero('Hero') if sid == 'title' else find_hero(a.get('hero')))
        add_motes(tuple(c), size, tuple(bpy.context.scene.camera.matrix_world.translation), frames_n=n)
    sc = bpy.context.scene
    sc.render.use_motion_blur = n > 1
    compositor()
    out = str(a['out'])
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print(f'[shot] {sid} frames {n} -> {out}')


if __name__ == '__main__':
    main()
