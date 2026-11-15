"""Open TAN Blender kit (law 30): the studio's own toolkit for every 3D job. Blender 5.2, EEVEE or Cycles.

How to load it (both bridges use the same two lines):
    headless : bin/studio.mjs blender run my_scene.py           (my_scene.py starts with the 2 lines below)
    live     : mcp__blender-mcp__execute_blender_code with the same 2 lines first
        import sys; sys.path.insert(0, "<repo>/tools/blender")   # <repo> = this repo's absolute path
        from kit import *

Where each of the six steps in guide/BLENDER.md lives:
    1 reference  -> (outside Blender: study + measure the reference, write the dimension sheet)
    2 measure    -> units_metric(), ref_box(), check_dims()
    3 model      -> prim(), mesh_obj(), from_bmesh(), solidify(), mirror(), array()
    4 smooth     -> bevel(), subsurf(), weighted_normals(), shade(), apply_mods()
    5 textures   -> NB node builder + mat_* recipes (procedural: noise / voronoi / AO cavity / bump)
    6 light      -> render_setup(), world_*(), light(), rig_studio(), rig_product(), compositor()
    QC           -> bin/studio.mjs blender check <still.png>  (tools/blender/exposure_check.py)

House rules baked in: every surface is procedural (no texture downloads needed unless mat_photo is asked for),
nothing is ever one flat colour, and shader nodes are always found by their type (display names are localised).
"""
import bpy, bmesh, math, os
from mathutils import Vector

BLENDER_VERSION = bpy.app.version
HDRI_DIR = os.path.join(bpy.utils.resource_path('LOCAL'), 'datafiles', 'studiolights', 'world')
HDRIS = ('city', 'courtyard', 'forest', 'interior', 'night', 'studio', 'sunrise', 'sunset')
TEXTURES = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'library', 'textures'))

# Engine aliases -> the identifiers to try, newest first.
_ENGINES = {
    'eevee': ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'),
    'cycles': ('CYCLES',),
    'workbench': ('BLENDER_WORKBENCH',),
}


# ---------------------------------------------------------------------------------------------- small helpers

def _first_valid(owner, attr, candidates):
    """Assign the first candidate the property accepts. Enum identifiers move between releases, so try a list."""
    for value in candidates:
        try:
            setattr(owner, attr, value)
        except (TypeError, ValueError):
            continue
        return value
    return getattr(owner, attr)


def _soft_set(owner, **values):
    """Set whichever of these attributes exist on this build; silently skip the rest."""
    for attr, value in values.items():
        try:
            setattr(owner, attr, value)
        except (AttributeError, TypeError, ValueError):
            pass


def _scale(rgb, k):
    """A colour multiplied by k (k < 1 = a darker shade of the same hue)."""
    return tuple(channel * k for channel in rgb)


def _point_on_sphere(centre, radius, azimuth, elevation):
    """A point `radius` away from `centre`. azimuth 0 = straight in front (-Y), +90 = camera right (+X);
    elevation in degrees above the horizon."""
    c = Vector(centre)
    az, el = math.radians(azimuth), math.radians(elevation)
    ground = radius * math.cos(el)
    return (c.x + ground * math.sin(az), c.y - ground * math.cos(az), c.z + radius * math.sin(el))


def _position_of(thing):
    """World position of an object, or the point itself."""
    if hasattr(thing, 'matrix_world'):
        return thing.matrix_world.translation.copy()
    return Vector(thing)


# ---------------------------------------------------------------------------------------------- scene

def reset(fps=30):
    """Start a brand-new empty scene (no default cube, camera or lamp). Only for NEW scenes, never the owner's file."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    units_metric()
    return scene


def units_metric():
    """Step 2: one Blender unit is one metre. Depth of field, bevel widths, light falloff and texture scale all
    assume real size, so this comes first."""
    units = bpy.context.scene.unit_settings
    units.system = 'METRIC'
    units.scale_length = 1.0
    units.length_unit = 'METERS'


def render_setup(engine='eevee', res=(1920, 1080), samples=64, fps=30, mb=False, look='AgX - Medium High Contrast',
                 exposure=0.0, transparent=False, device='gpu'):
    """Step 6 groundwork: engine, size, samples and an AgX view. EEVEE gets ray tracing, fast GI and soft
    shadows; Cycles gets denoising and the Metal GPU. Returns the scene."""
    if engine not in _ENGINES:
        raise ValueError(f'render_setup: engine must be one of {sorted(_ENGINES)}, not {engine!r}')
    scene = bpy.context.scene
    r = scene.render
    _first_valid(r, 'engine', _ENGINES[engine])
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.fps = fps
    r.film_transparent = transparent
    r.use_motion_blur = mb

    if r.engine == 'CYCLES':
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        if device == 'gpu':
            try:
                prefs = bpy.context.preferences.addons['cycles'].preferences
                prefs.compute_device_type = 'METAL'
                prefs.get_devices()
                for dev in prefs.devices:
                    dev.use = True
                scene.cycles.device = 'GPU'
            except Exception as err:  # no GPU backend on this machine: stay on CPU
                print('[kit] Cycles stays on CPU:', err)
    else:
        ee = scene.eevee
        ee.taa_render_samples = samples
        _soft_set(ee, use_raytracing=True, use_shadows=True, shadow_ray_count=2, shadow_step_count=8,
                  use_fast_gi=True, clamp_surface_indirect=10.0, use_volumetric_shadows=True)
        _soft_set(ee, ray_tracing_method='SCREEN')
        try:
            ee.ray_tracing_options.use_denoise = True
        except AttributeError:
            pass

    view = scene.view_settings
    view.view_transform = 'AgX'
    _first_valid(view, 'look', (look, 'AgX - Medium High Contrast', 'None'))
    view.exposure = exposure
    r.image_settings.file_format = 'PNG'
    return scene


# ---------------------------------------------------------------------------------------------- objects (step 3)

def link(o, coll=None):
    """Put an object into a collection (the scene's root collection by default)."""
    target = coll if coll is not None else bpy.context.scene.collection
    target.objects.link(o)
    return o


def collection(name):
    """A new collection hung under the scene root."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def shade(o, sharp_angle=30.0):
    """Smooth shading, but edges sharper than `sharp_angle` degrees stay crisp (what Auto Smooth used to do)."""
    mesh = o.data
    try:
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=math.radians(sharp_angle))
    except (AttributeError, RuntimeError, TypeError):
        for poly in mesh.polygons:
            poly.use_smooth = True
    return o


def _object_from_mesh(name, mesh, coll, smooth, sharp_angle):
    obj = link(bpy.data.objects.new(name, mesh), coll)
    return shade(obj, sharp_angle) if smooth else obj


def mesh_obj(name, verts, faces, coll=None, smooth=True, sharp_angle=30.0):
    """An object from raw vertex and face lists."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return _object_from_mesh(name, mesh, coll, smooth, sharp_angle)


def from_bmesh(name, bm, coll=None, smooth=True, sharp_angle=30.0):
    """An object from a bmesh (the bmesh is consumed and freed)."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return _object_from_mesh(name, mesh, coll, smooth, sharp_angle)


def _torus_into(bm, major, minor, ring_count, tube_count):
    """Fill `bm` with a closed quad torus lying in the XY plane."""
    rings = []
    for i in range(ring_count):
        around = 2 * math.pi * i / ring_count
        ca, sa = math.cos(around), math.sin(around)
        ring = []
        for j in range(tube_count):
            tube = 2 * math.pi * j / tube_count
            reach = major + minor * math.cos(tube)
            ring.append(bm.verts.new((reach * ca, reach * sa, minor * math.sin(tube))))
        rings.append(ring)
    for i, ring in enumerate(rings):
        nxt = rings[(i + 1) % ring_count]
        for j in range(tube_count):
            k = (j + 1) % tube_count
            bm.faces.new((ring[j], nxt[j], nxt[k], ring[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


_ROUND_KINDS = ('sphere', 'ico', 'torus', 'cylinder', 'cone')


def prim(kind, name='obj', loc=(0, 0, 0), rot=(0, 0, 0), size=(1, 1, 1), coll=None, smooth=None, **kw):
    """A primitive built straight in bmesh (no operator context needed).
    `size` is the real (x, y, z) size in metres and is baked into the vertices, so object scale stays 1 and
    bevels / textures measure true. kind: cube | cylinder | cone | sphere | ico | plane | torus.
    Extra keywords: segments (cylinder/cone), r1 + r2 (cone radii), u + v (sphere), sub (ico), xs + ys (plane),
    R + r + su + sv (torus major/minor radius and segment counts; a torus ignores `size`)."""
    bm = bmesh.new()
    segs = kw.get('segments', 48)
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=1.0)
    elif kind in ('cylinder', 'cone'):
        top, bottom = (0.5, 0.5) if kind == 'cylinder' else (kw.get('r1', 0.5), kw.get('r2', 0.0))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=top, radius2=bottom, depth=1.0)
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get('u', 64), v_segments=kw.get('v', 32), radius=0.5)
    elif kind == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 3), radius=0.5)
    elif kind == 'plane':
        bmesh.ops.create_grid(bm, x_segments=kw.get('xs', 1), y_segments=kw.get('ys', 1), size=0.5)
    elif kind == 'torus':
        _torus_into(bm, kw.get('R', 0.5), kw.get('r', 0.1), kw.get('su', 64), kw.get('sv', 16))
    else:
        bm.free()
        raise ValueError(f'prim: unknown kind {kind!r}')
    if kind != 'torus':
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if smooth is None:
        smooth = kind in _ROUND_KINDS
    obj = from_bmesh(name, bm, coll, smooth=smooth)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def lathe(name, profile, segments=96, coll=None, sharp_angle=60.0):
    """Spin an (r, z) profile, listed bottom to top in metres, around the Z axis: pots, bottles, cups, knobs.
    A point with r == 0 becomes a single pole vertex that closes the shape. The result is a skin with no
    thickness, so add solidify() for a wall. Take the profile from the dimension sheet (step 2), never by eye."""
    bm = bmesh.new()
    angles = [2 * math.pi * i / segments for i in range(segments)]
    loops = []
    for radius, height in profile:
        if radius <= 1e-6:
            loops.append([bm.verts.new((0.0, 0.0, height))])
        else:
            loops.append([bm.verts.new((radius * math.cos(a), radius * math.sin(a), height)) for a in angles])
    for lower, upper in zip(loops, loops[1:]):
        if len(lower) == 1 and len(upper) == 1:
            continue
        for i in range(segments):
            k = (i + 1) % segments
            if len(lower) == 1:
                bm.faces.new((lower[0], upper[k], upper[i]))
            elif len(upper) == 1:
                bm.faces.new((lower[i], lower[k], upper[0]))
            else:
                bm.faces.new((lower[i], lower[k], upper[k], upper[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bmesh(name, bm, coll, smooth=True, sharp_angle=sharp_angle)


def profile_volume(profile):
    """Cubic metres enclosed by an (r, z) lathe profile, summed as stacked cone frustums.
    Use it to check a vessel's capacity against its spec."""
    total = 0.0
    for (ra, za), (rb, zb) in zip(profile, profile[1:]):
        height = zb - za
        if height <= 0:
            continue
        total += math.pi * height * (ra * ra + ra * rb + rb * rb) / 3.0
    return total


def parent(child, par):
    """Parent without moving: the child keeps its current world placement."""
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()
    return child


def empty(name, loc=(0, 0, 0), coll=None, kind='PLAIN_AXES'):
    """An empty (pivot, look-at target, focus point)."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = kind
    obj.location = loc
    return link(obj, coll)


def solidify(o, thick=0.002, offset=-1.0, rim=True):
    """Give a skin real wall thickness (metres). offset -1 grows inward, so the outside keeps its measured size."""
    mod = o.modifiers.new('Solidify', 'SOLIDIFY')
    mod.thickness = thick
    mod.offset = offset
    mod.use_rim = rim
    return mod


def mirror(o, axes=(True, False, False), clip=True):
    """Model half, mirror the other half. clip keeps centre-line vertices welded."""
    mod = o.modifiers.new('Mirror', 'MIRROR')
    mod.use_axis = axes
    mod.use_clip = clip
    return mod


def array(o, count=4, offset=(1.1, 0, 0), relative=True):
    """Repeat an object. relative=True: offset in multiples of its own size; False: offset in metres."""
    mod = o.modifiers.new('Array', 'ARRAY')
    mod.count = count
    mod.use_relative_offset = relative
    mod.use_constant_offset = not relative
    if relative:
        mod.relative_offset_displace = offset
    else:
        mod.constant_offset_displace = offset
    return mod


# ---------------------------------------------------------------------------------------------- smoothing (step 4)

def bevel(o, width=0.002, segments=3, angle=35.0, harden=True, profile=0.5):
    """Round every edge sharper than `angle` degrees. Nothing real has a razor edge, and that thin rounded band
    is exactly where the highlight lands. Widths in metres: phone ~0.0008, furniture ~0.003, building ~0.02.
    harden=True keeps the big flat faces shading flat next to the bevel."""
    mod = o.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.profile = profile
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = harden
    mod.miter_outer = 'MITER_ARC'
    return mod


def subsurf(o, levels=2, render=None):
    """Subdivision for soft, organic forms. Hold the shape with support loops or crease(), or it melts."""
    mod = o.modifiers.new('Subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels if render is None else render
    return mod


def weighted_normals(o, weight=50, keep_sharp=True):
    """Stops the gradient smear that bevels and curves leave on neighbouring flat faces.
    Always the last modifier on the stack."""
    mod = o.modifiers.new('WeightedNormal', 'WEIGHTED_NORMAL')
    mod.weight = weight
    mod.keep_sharp = keep_sharp
    return mod


def crease(o, edge_indices, value=1.0):
    """Mark edges as creased for Subsurf (stored as the float edge attribute 'crease_edge')."""
    attrs = o.data.attributes
    layer = attrs.get('crease_edge')
    if layer is None:
        layer = attrs.new('crease_edge', 'FLOAT', 'EDGE')
    for index in edge_indices:
        layer.data[index].value = value


def apply_mods(o):
    """Bake the whole modifier stack into the mesh and drop the modifiers."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
    previous = o.data
    o.modifiers.clear()
    o.data = baked
    if previous.users == 0:
        bpy.data.meshes.remove(previous)
    return o


# ---------------------------------------------------------------------------------------------- measure (step 2)

def _world_corners(o):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = o.evaluated_get(depsgraph)
    return [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]


def dims(o):
    """World-space size (x, y, z) in metres, modifiers included, rounded to 0.1 mm."""
    corners = _world_corners(o)
    return tuple(round(max(c[axis] for c in corners) - min(c[axis] for c in corners), 4) for axis in range(3))


def ref_box(name, size, loc=(0, 0, 0)):
    """A wireframe box of the reference's true size standing on `loc`. Model inside it and proportions can't drift.
    Hidden from renders."""
    box = prim('cube', name, loc=(loc[0], loc[1], loc[2] + size[2] / 2), size=size, smooth=False)
    box.display_type = 'WIRE'
    box.hide_render = True
    return box


def check_dims(o, want, tol=0.03):
    """Measure an object against the dimension sheet. Axes whose `want` is 0/None are skipped.
    Prints one line and returns the misses as [(axis, got, want), ...] (empty list = within tolerance)."""
    got = dims(o)
    misses = []
    for axis, measured, target in zip('xyz', got, want):
        if target and abs(measured - target) / target > tol:
            misses.append((axis, measured, target))
    verdict = 'OK' if not misses else f'OFF {misses}'
    print(f'[dims] {o.name}: got {got} want {tuple(want)} -> {verdict}')
    return misses


def drop_to_ground(o, z=0.0):
    """Move an object up or down so its lowest point sits exactly at height z."""
    lowest = min(corner.z for corner in _world_corners(o))
    o.location.z += z - lowest


# ---------------------------------------------------------------------------------------------- materials (step 5)

def set_mat(o, mat, slot=None):
    """slot=None: the object gets this one material. slot=n: put it in slot n (empty slots up to n are filled)."""
    slots = o.data.materials
    if slot is None:
        slots.clear()
        slots.append(mat)
        return o
    while len(slots) <= slot:
        slots.append(mat)
    slots[slot] = mat
    return o


class NB:
    """Node builder for one Principled material.

    The idea behind every recipe: a handful of noise / voronoi fields, remapped into useful ranges, drive the
    Base Color, Roughness and Normal (bump) inputs, plus an ambient-occlusion 'cavity' term that pushes creases
    darker. Helpers take either a plain value or a node socket, so they chain freely.
    Attributes: mat, nt (node tree), N (nodes), L (links), bsdf, out.
    """

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        try:
            self.mat.use_nodes = True  # always on in 5.x; older builds need the switch
        except (AttributeError, TypeError):
            pass
        self.nt = self.mat.node_tree
        self.bsdf = self._find('BSDF_PRINCIPLED') or self.nt.nodes.new('ShaderNodeBsdfPrincipled')
        self.out = self._find('OUTPUT_MATERIAL')
        if self.out is None:
            self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
            self.nt.links.new(self.bsdf.outputs[0], self.out.inputs[0])

    @property
    def N(self):
        return self.nt.nodes

    @property
    def L(self):
        return self.nt.links

    def _find(self, node_type):
        return next((node for node in self.nt.nodes if node.type == node_type), None)

    def _feed(self, socket, value):
        """Link a socket into `socket`, or write a constant with the right shape for the socket type."""
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
            return
        if socket.type == 'RGBA':
            if isinstance(value, (int, float)):
                value = (value, value, value, 1.0)
            elif len(value) == 3:
                value = (*value, 1.0)
        socket.default_value = value

    # -- raw nodes

    def n(self, kind, **props):
        """Add a node of `kind`. Keywords that name an input set that input; the rest are node properties."""
        node = self.nt.nodes.new(kind)
        for key, value in props.items():
            if key in node.inputs:
                self._feed(node.inputs[key], value)
            else:
                setattr(node, key, value)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    # -- texture space and fields

    def coord(self, kind='Object', scale=1.0):
        """Texture coordinates. 'Object' sticks the pattern to the object at true size (keep object scale 1);
        'UV' for printed artwork. A scale (number or xyz tuple) stretches the space through a Mapping node."""
        tex_coord = self.n('ShaderNodeTexCoord')
        if scale == 1.0:
            return tex_coord.outputs[kind]
        mapping = self.n('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = tuple(scale) if isinstance(scale, (tuple, list)) else (scale,) * 3
        self.link(tex_coord.outputs[kind], mapping.inputs['Vector'])
        return mapping.outputs['Vector']

    def noise(self, vec, scale=5.0, detail=6.0, rough=0.55, dist=0.0):
        """Noise texture node (read .outputs['Fac'] or ['Color'])."""
        node = self.n('ShaderNodeTexNoise', Scale=scale, Detail=detail, Roughness=rough, Distortion=dist)
        if vec is not None:
            self.link(vec, node.inputs['Vector'])
        return node

    def voronoi(self, vec, scale=5.0, feature='F1', rand=1.0):
        """Voronoi texture node (cells, flakes, pebbles)."""
        node = self.n('ShaderNodeTexVoronoi', feature=feature, Scale=scale, Randomness=rand)
        if vec is not None:
            self.link(vec, node.inputs['Vector'])
        return node

    # -- remapping and blending

    def ramp(self, fac, stops):
        """Colour ramp from [(position, colour), ...]; colour may be a grey number, RGB or RGBA. Returns its colour."""
        node = self.n('ShaderNodeValToRGB')
        elements = node.color_ramp.elements
        while len(elements) > 1:
            elements.remove(elements[-1])

        def as_rgba(c):
            if isinstance(c, (int, float)):
                return (c, c, c, 1.0)
            return (*c, 1.0) if len(c) == 3 else tuple(c)

        first_pos, first_col = stops[0]
        elements[0].position, elements[0].color = first_pos, as_rgba(first_col)
        for pos, col in stops[1:]:
            elements.new(pos).color = as_rgba(col)
        self._feed(node.inputs['Fac'], fac)
        return node.outputs['Color']

    def mix(self, a, b, fac, blend='MIX'):
        """Blend colour a toward colour b by fac (number or socket). blend: MIX, MULTIPLY, OVERLAY, ..."""
        node = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        by_id = {s.identifier: s for s in node.inputs}
        self._feed(by_id['Factor_Float'], fac)
        self._feed(by_id['A_Color'], a)
        self._feed(by_id['B_Color'], b)
        return next(s for s in node.outputs if s.identifier == 'Result_Color')

    def math(self, op, a, b=None, clamp=False):
        """Scalar maths node (ADD, MULTIPLY, POWER, FRACT, ...) on numbers or sockets."""
        node = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for socket, value in zip(node.inputs, (a, b)):
            if value is not None:
                self._feed(socket, value)
        return node.outputs[0]

    def maprange(self, val, a0, a1, b0, b1, clamp=True):
        """Linearly remap val from [a0, a1] to [b0, b1]."""
        node = self.n('ShaderNodeMapRange', clamp=clamp)
        for key, value in (('From Min', a0), ('From Max', a1), ('To Min', b0), ('To Max', b1)):
            node.inputs[key].default_value = value
        self._feed(node.inputs['Value'], val)
        return node.outputs['Result']

    # -- surface detail

    def bump(self, height, strength=0.2, distance=0.01, normal=None):
        """Height field -> shading normal."""
        node = self.n('ShaderNodeBump', Strength=strength, Distance=distance)
        self._feed(node.inputs['Height'], height)
        if normal is not None:
            self._feed(node.inputs['Normal'], normal)
        return node.outputs['Normal']

    def ao(self, dist=0.3):
        """Occlusion within `dist` metres: about 0 deep in creases, 1 on open faces."""
        node = self.n('ShaderNodeAmbientOcclusion', Distance=dist)
        node.samples = 8
        return node.outputs['AO']

    def cavity(self, col, dark, dist=0.3, lo=0.15, hi=0.9):
        """Let `dark` collect in creases and grooves while open faces keep `col`: instant depth and grime."""
        openness = self.maprange(self.ao(dist), lo, hi, 0.0, 1.0)
        return self.mix(dark, col, openness)

    def set(self, name, v):
        """Drive a Principled input with a number, a colour/vector tuple or a socket. Returns self for chaining."""
        self._feed(self.bsdf.inputs[name], v)
        return self


# Recipes. The rule they all follow: no surface is one flat colour. Hue, value and roughness each drift a little,
# a fine bump breaks up reflections, and creases sit darker than open faces.

def mat_plastic(name='Plastic', color=(0.6, 0.6, 0.6), rough=0.4, gloss_var=0.15, scale=1.0, coat=0.0):
    """Moulded plastic: gentle colour drift, gloss that wanders by +-gloss_var, a very fine orange-peel bump,
    darker seams."""
    b = NB(name)
    space = b.coord('Object', scale)
    drift = b.noise(space, 3.0, 6, 0.6).outputs['Fac']
    peel = b.noise(space, 400.0, 2, 0.5).outputs['Fac']
    tone = b.mix(color, _scale(color, 0.85), drift)
    b.set('Base Color', b.cavity(tone, _scale(color, 0.45), 0.05))
    b.set('Roughness', b.maprange(drift, 0.3, 0.7, rough - gloss_var, rough + gloss_var))
    b.set('Normal', b.bump(peel, 0.03, 0.0005))
    if coat:
        b.set('Coat Weight', coat)
    return b.mat


def mat_metal(name='Steel', base=(0.56, 0.57, 0.58), rough=(0.12, 0.35), scale=1.0, bump=0.05, brushed=0.0):
    """Bare metal (Metallic 1; the metal's tint lives in Base Color, which stays bright even for dark metals).
    rough = (glossiest, dullest) spots. brushed > 0 adds fine streaks running along X plus anisotropy."""
    b = NB(name)
    space = b.coord('Object', scale)
    patches = b.noise(space, 4.0, 8, 0.6).outputs['Fac']
    height = b.noise(space, 60.0, 3, 0.6).outputs['Fac']
    if brushed:
        streak_space = b.coord('Object', (scale * 2, scale * 300, scale * 300))
        streaks = b.noise(streak_space, 20.0, 2, 0.5).outputs['Fac']
        height = b.math('ADD', height, b.math('MULTIPLY', streaks, brushed))
        b.set('Anisotropic', 0.6 * brushed)
    b.set('Base Color', b.mix(base, _scale(base, 0.7), patches))
    b.set('Metallic', 1.0)
    b.set('Roughness', b.maprange(patches, 0.3, 0.8, rough[0], rough[1]))
    b.set('Normal', b.bump(height, bump, 0.003))
    return b.mat


def mat_brass(name='Brass', base=(0.78, 0.53, 0.24), dark=(0.42, 0.26, 0.11), rough=(0.18, 0.5), scale=1.0, worn=0.5):
    """Handled brass: broad polish-to-tarnish patches, smaller worn spots (strength `worn`), and fine vertical
    scratches that show up in both the roughness and the bump. Tarnish gathers in the creases."""
    b = NB(name)
    space = b.coord('Object', scale)
    broad = b.noise(space, 3.0, 8, 0.6).outputs['Fac']
    spots = b.noise(space, 40.0, 4, 0.7).outputs['Fac']
    scratches = b.noise(b.coord('Object', (scale * 2, scale * 2, scale * 160)), 30.0, 2, 0.5).outputs['Fac']

    tone = b.ramp(broad, [(0.3, dark), (0.65, base)])
    tone = b.mix(tone, dark, b.maprange(spots, 0.55, 0.8, 0.0, worn))
    b.set('Base Color', b.cavity(tone, _scale(dark, 0.5), 0.2))
    b.set('Metallic', 1.0)
    dullness = b.math('ADD', broad, b.math('MULTIPLY', scratches, 0.4))
    b.set('Roughness', b.maprange(dullness, 0.35, 0.95, rough[0], rough[1]))
    b.set('Normal', b.bump(b.math('ADD', spots, scratches), 0.08, 0.005))
    return b.mat


def mat_gold(name='Gold', scale=1.0):
    """Polished yellow gold: the brass recipe, warmer and glossier, lightly worn."""
    return mat_brass(name, base=(1.0, 0.71, 0.3), dark=(0.5, 0.28, 0.07), rough=(0.1, 0.32), scale=scale, worn=0.25)


def mat_carpaint(name='CarPaint', color=(0.02, 0.03, 0.035), metallic=0.6, rough=0.32, flake=0.25, coat=1.0):
    """Paint base with metal flakes (a tiny voronoi bump) under a near-mirror clear coat."""
    b = NB(name)
    flakes = b.voronoi(b.coord('Object'), 900.0)
    b.set('Base Color', color).set('Metallic', metallic).set('Roughness', rough)
    b.set('Coat Weight', coat).set('Coat Roughness', 0.02)
    b.set('Normal', b.bump(flakes.outputs['Color'], flake, 0.001))
    return b.mat


def mat_glass(name='Glass', tint=(0.92, 0.96, 1.0), rough=0.0, ior=1.45):
    """Clear or frosted glass (rough > 0 frosts it). EEVEE gets blended surface + raytraced refraction."""
    b = NB(name)
    b.set('Base Color', tint).set('Roughness', rough).set('IOR', ior).set('Transmission Weight', 1.0)
    _soft_set(b.mat, surface_render_method='BLENDED', use_raytrace_refraction=True)
    return b.mat


def mat_liquid(name='Liquid', color=(0.95, 0.93, 0.85), scatter=0.6, rough=0.05):
    """Opaque drinks and creams (milk, juice, yoghurt): light scatters inside, the top stays glossy.
    For clear water use mat_glass."""
    b = NB(name)
    b.set('Base Color', color).set('Roughness', rough)
    b.set('Subsurface Weight', scatter).set('Subsurface Radius', (1.0, 0.8, 0.6))
    return b.mat


def mat_rubber(name='Rubber', color=(0.012, 0.012, 0.013), rough=0.75):
    """Matte black rubber with a fine grainy bump and slightly uneven sheen."""
    b = NB(name)
    grain = b.noise(b.coord('Object'), 80, 3, 0.6).outputs['Fac']
    b.set('Base Color', color)
    b.set('Roughness', b.maprange(grain, 0.3, 0.7, rough - 0.1, rough + 0.1))
    b.set('Normal', b.bump(grain, 0.1, 0.002))
    return b.mat


def mat_ceramic(name='Ceramic', base=(0.0, 0.42, 0.40), alt=(0.01, 0.30, 0.36), rough=0.12):
    """Glazed ceramic or enamel: the glaze pools between two close hues, sits under a glossy coat, and goes
    almost black where it runs into grooves."""
    b = NB(name)
    space = b.coord('Object')
    pooling = b.noise(space, 2.0, 6, 0.6).outputs['Fac']
    ripple = b.noise(space, 45.0, 3, 0.6).outputs['Fac']
    glaze = b.mix(base, alt, b.maprange(pooling, 0.35, 0.7, 0.0, 1.0))
    b.set('Base Color', b.cavity(glaze, _scale(alt, 0.15), 0.3, 0.1))
    b.set('Roughness', b.maprange(ripple, 0.3, 0.7, rough * 0.6, rough * 1.6))
    b.set('Coat Weight', 1.0).set('Coat Roughness', 0.05)
    b.set('Normal', b.bump(ripple, 0.05, 0.003))
    return b.mat


def mat_marble(name='Marble', base=(0.86, 0.84, 0.8)):
    """Polished marble. Each vein is a narrow grey band picked out of strongly distorted noise by a ramp,
    multiplied over a softly clouded stone colour, with a touch of subsurface."""
    b = NB(name)
    space = b.coord('Object')
    swirl = b.noise(space, 0.35, 8, 0.62, dist=4.0).outputs['Fac']
    veins = b.ramp(swirl, [(0.47, (1, 1, 1)), (0.5, (0.62, 0.62, 0.66)), (0.53, (1, 1, 1))])
    cloud = b.noise(space, 2.5, 6, 0.6).outputs['Fac']
    stone = b.mix(base, _scale(base, 0.86), cloud)
    b.set('Base Color', b.mix(stone, veins, 1.0, 'MULTIPLY'))
    b.set('Roughness', b.maprange(cloud, 0.3, 0.7, 0.22, 0.42))
    b.set('Subsurface Weight', 0.08).set('Subsurface Radius', (0.4, 0.3, 0.2))
    b.set('Normal', b.bump(cloud, 0.1, 0.01))
    return b.mat


def mat_wood(name='Wood', light=(0.30, 0.15, 0.065), dark=(0.10, 0.045, 0.02), grain=1.0, rough=0.45, axis='X',
             log=(0.03, -0.09)):
    """Sawn timber, built the way a board is cut: as a slice through a log. The log's heart runs along `axis`,
    offset `log` metres in the other two axes, and the growth rings are rings of equal distance from it, so long
    faces show near-parallel grain lines and end faces show arcs (never wavy stripes laid across a board).
    Layers: rings about 4 mm apart with uneven yearly widths and a thin dark latewood line, a slow wobble,
    fibres stretched along the axis, a tonal patch shift, and pores that only roughen and bump.
    grain > 1 = finer grain."""
    b = NB(name)
    along = 'XYZ'.index(axis)
    space = b.coord('Object')

    # distance from the log's heart, measured across the axis only
    across = tuple(0.0 if i == along else 1.0 for i in range(3))
    heart = [0.0, 0.0, 0.0]
    for i, offset in zip((i for i in range(3) if i != along), log):
        heart[i] = offset
    flat = b.n('ShaderNodeVectorMath', operation='MULTIPLY')
    b.link(space, flat.inputs[0])
    flat.inputs[1].default_value = across
    rel = b.n('ShaderNodeVectorMath', operation='SUBTRACT')
    b.link(flat.outputs['Vector'], rel.inputs[0])
    rel.inputs[1].default_value = tuple(heart)
    length = b.n('ShaderNodeVectorMath', operation='LENGTH')
    b.link(rel.outputs['Vector'], length.inputs[0])
    radius = length.outputs['Value']

    # trees never grow perfectly round: a slow wobble, stretched along the trunk
    wobble_stretch = tuple(0.6 if i == along else 6.0 for i in range(3))
    wobble = b.noise(b.coord('Object', wobble_stretch), 1.0, 3, 0.5).outputs['Fac']
    radius = b.math('ADD', radius, b.math('MULTIPLY', b.math('SUBTRACT', wobble, 0.5), 0.016))

    # good and bad years: a 1D noise read along the radius alone, so rings stay rings (no contour-map look)
    pitch = 0.0042 / grain
    years = b.n('ShaderNodeTexNoise', noise_dimensions='1D', Scale=1.0, Detail=2.0, Roughness=0.5)
    b.link(b.math('MULTIPLY', radius, 40.0 * grain), years.inputs['W'])
    radius = b.math('ADD', radius, b.math('MULTIPLY', b.math('SUBTRACT', years.outputs['Fac'], 0.5), 2.5 * pitch))

    ring_phase = b.math('FRACT', b.math('DIVIDE', radius, pitch))
    latewood = b.math('POWER', ring_phase, 4.0)  # the thin dark line at the end of each year

    stretch = tuple(1.0 if i == along else 60.0 for i in range(3))
    fibres = b.noise(b.coord('Object', tuple(s * 4 * grain for s in stretch)), 6.0, 8, 0.6).outputs['Fac']
    tone = b.ramp(fibres, [(0.25, _scale(light, 0.62)), (0.8, light)])
    tone = b.mix(tone, dark, b.math('MULTIPLY', latewood, 0.7, clamp=True))
    patch = b.noise(b.coord('Object', 2.0 * grain), 2.0, 4, 0.5).outputs['Fac']
    tone = b.mix(tone, _scale(light, 0.7), b.maprange(patch, 0.4, 0.7, 0.0, 0.5))

    pores = b.noise(b.coord('Object', tuple(s * 40 * grain for s in stretch)), 8.0, 2, 0.5).outputs['Fac']
    b.set('Base Color', b.cavity(tone, _scale(dark, 0.6), 0.05))
    b.set('Roughness', b.maprange(b.math('ADD', pores, latewood), 0.3, 1.3, rough - 0.08, rough + 0.12))
    relief = b.math('ADD', b.math('MULTIPLY', pores, 0.6), b.math('MULTIPLY', latewood, 0.4))
    b.set('Normal', b.bump(relief, 0.06, 0.0005))
    return b.mat


def mat_fabric(name='Fabric', color=(0.25, 0.22, 0.2), weave=300.0):
    """Woven cloth on UVs: warp and weft from two crossed band waves, matte, with sheen on the fibres."""
    b = NB(name)
    uv = b.coord('UV')
    threads = []
    for direction in ('X', 'Y'):
        wave = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction=direction, Scale=weave)
        b.link(uv, wave.inputs['Vector'])
        threads.append(wave.outputs['Fac'])
    b.set('Base Color', color).set('Roughness', 0.85)
    b.set('Sheen Weight', 0.6).set('Sheen Roughness', 0.4)
    b.set('Normal', b.bump(b.math('MULTIPLY', *threads), 0.15, 0.001))
    return b.mat


def mat_concrete(name='Concrete', base=(0.22, 0.23, 0.24), wet=0.0, scale=1.0):
    """Poured concrete with blotchy tone and a pitted bump. wet > 0 adds puddles: wherever a broad mask is
    high the surface darkens, turns nearly mirror-smooth and loses its bump."""
    b = NB(name)
    space = b.coord('Object', scale)
    blotch = b.noise(space, 2.0, 10, 0.6).outputs['Fac']
    pits = b.noise(space, 25.0, 6, 0.65).outputs['Fac']
    tone = b.ramp(blotch, [(0.3, _scale(base, 0.55)), (0.7, base)])
    roughness = b.maprange(pits, 0.3, 0.7, 0.55, 0.9)
    height = pits
    if wet:
        pools = b.noise(b.coord('Object', scale * 0.35), 1.5, 4, 0.5).outputs['Fac']
        edge = 0.5 - wet * 0.1
        puddle = b.maprange(pools, edge, edge + 0.06, 0.0, 1.0)
        tone = b.mix(tone, _scale(base, 0.35), puddle)
        roughness = b.mix(roughness, (0.02, 0.02, 0.02), puddle)
        height = b.math('MULTIPLY', height, b.math('SUBTRACT', 1.0, puddle))
    b.set('Base Color', tone).set('Roughness', roughness)
    b.set('Normal', b.bump(height, 0.35, 0.01))
    return b.mat


def mat_image(name, path, rough=0.5, coat=0.0, extension='CLIP'):
    """Printed artwork on UVs: a label, logo or photo (the client's real file, law 6). Returns (material, image node)."""
    b = NB(name)
    tex = b.n('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.extension = extension
    b.link(b.coord('UV'), tex.inputs['Vector'])
    b.set('Base Color', tex.outputs['Color']).set('Roughness', rough)
    if coat:
        b.set('Coat Weight', coat)
    return b.mat, tex


def texture_path(ref):
    """Albedo file for 'source/slug' or just 'slug' in library/textures (where studio texture add stores them)."""
    import glob
    pattern = ref if '/' in ref else os.path.join('*', ref)
    found = sorted(glob.glob(os.path.join(TEXTURES, pattern, 'albedo.*')))
    if not found:
        raise FileNotFoundError(f'texture {ref} is not in library/textures (use studio texture find / add)')
    return found[0]


def mat_photo(ref, name=None, size_m=None, rough=(0.35, 0.75), bump=0.08, metal=0.0, coat=0.0, tint=None,
              rotate=0.0, blend=0.2):
    """A photographed texture placed at its REAL size: one copy of the image covers size_m metres
    (from meta.json 'sizeM', default 0.5). Box-projected from Object coordinates, so it needs no UVs and does
    not stretch on any face. A lone photo has no roughness or height map, so both come from its brightness:
    darker pores and grooves read rougher (inside the `rough` band) and lower. rotate turns the pattern about Z
    (radians); tint multiplies the colour."""
    import json
    path = texture_path(ref)
    folder = os.path.dirname(path)
    meta = {}
    try:
        with open(os.path.join(folder, 'meta.json')) as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        pass
    size_m = size_m or meta.get('sizeM', 0.5)
    aspect = (meta.get('width') or 1) / (meta.get('height') or 1)

    b = NB(name or os.path.basename(folder))
    tex = b.n('ShaderNodeTexImage', projection='BOX', projection_blend=blend, extension='REPEAT')
    tex.image = bpy.data.images.load(path, check_existing=True)
    # REPEAT, not MIRROR: mirrored tiles leave butterfly seams (B05)
    place = b.n('ShaderNodeMapping')
    place.inputs['Scale'].default_value = (1 / size_m, aspect / size_m, aspect / size_m)
    place.inputs['Rotation'].default_value = (0.0, 0.0, rotate)
    place.inputs['Location'].default_value = (0.5, 0.5, 0.5)  # image centre on the object's origin: no seam on small objects
    b.link(b.coord('Object'), place.inputs['Vector'])
    b.link(place.outputs['Vector'], tex.inputs['Vector'])

    photo = tex.outputs['Color']
    colour = b.mix(photo, tint, 1.0, 'MULTIPLY') if tint else photo
    brightness = b.n('ShaderNodeRGBToBW')
    b.link(photo, brightness.inputs[0])
    value = brightness.outputs[0]

    b.set('Base Color', b.cavity(colour, (0.02, 0.015, 0.01), 0.04, 0.1, 0.9))
    b.set('Roughness', b.maprange(value, 0.0, 1.0, rough[1], rough[0]))
    b.set('Metallic', metal)
    if coat:
        b.set('Coat Weight', coat).set('Coat Roughness', 0.08)
    b.set('Normal', b.bump(value, bump, 0.001))
    return b.mat


def mat_emission(name='Emit', color=(1.0, 0.85, 0.7), strength=4.0):
    """Glowing practicals (screens, LED strips, lamp shades). Keep strength low, 2-8: area lights light the scene."""
    b = NB(name)
    b.set('Base Color', (0, 0, 0)).set('Emission Color', color).set('Emission Strength', strength)
    b.set('Roughness', 0.4)
    return b.mat


# ---------------------------------------------------------------------------------------------- light (step 6)

def kelvin(k):
    """Colour temperature -> linear RGB, brightest channel = 1. Follows the black-body (Planckian) locus in CIE xy,
    then converts XYZ to linear sRGB. Useful range 1700-25000 K: 2700 tungsten, 4500 LED strip, 5600 daylight,
    7500 open shade."""
    t = min(max(float(k), 1667.0), 25000.0)
    inv, inv2, inv3 = 1e3 / t, 1e6 / t ** 2, 1e9 / t ** 3
    if t <= 4000:
        x = -0.2661239 * inv3 - 0.2343589 * inv2 + 0.8776956 * inv + 0.179910
    else:
        x = -3.0258469 * inv3 + 2.1070379 * inv2 + 0.2226347 * inv + 0.240390
    if t <= 2222:
        y = -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    elif t <= 4000:
        y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    else:
        y = 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483
    X, Y, Z = x / y, 1.0, (1.0 - x - y) / y
    rgb = (3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
           -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
           0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z)
    rgb = [max(c, 0.0) for c in rgb]
    peak = max(rgb) or 1.0
    return tuple(c / peak for c in rgb)


def look_at(o, target):
    """Aim an object's -Z (cameras, lights) at a point or another object, Y up."""
    direction = _position_of(target) - o.location
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return o


def camera(name='Cam', loc=(0, -5, 1), target=(0, 0, 0), lens=50, fstop=None, focus=None, sensor=36.0, clip=(0.01, 500)):
    """Add a camera and make it the scene camera. Lenses: 50-85 mm for products (no distortion), 24-35 mm for
    rooms. fstop turns depth of field on (small number = shallow; needs real scale). focus: an object, a distance
    in metres, or None to focus on the target."""
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = sensor
    data.clip_start, data.clip_end = clip
    cam = link(bpy.data.objects.new(name, data))
    cam.location = loc
    if target is not None:
        look_at(cam, target)
    if fstop:
        dof = data.dof
        dof.use_dof = True
        dof.aperture_fstop = fstop
        dof.aperture_blades = 7
        if hasattr(focus, 'location'):
            dof.focus_object = focus
        elif focus is not None:
            dof.focus_distance = focus
        elif target is not None:
            dof.focus_distance = (_position_of(target) - Vector(loc)).length
    bpy.context.scene.camera = cam
    return cam


def light(kind='AREA', name='L', loc=(0, 0, 3), target=None, energy=100.0, color=(1, 1, 1), size=1.0, size_y=None,
          spot=45.0, blend=0.3, soft=0.05, volume=1.0, shadow=True, diffuse=1.0, specular=1.0):
    """Add a lamp. energy: watts for AREA / POINT / SPOT, W/m² for SUN (about 1-5).
    size: AREA side length in metres (give size_y for a rectangle / strip), SUN angular size in degrees.
    A bigger area light means softer shadows and a broader highlight. diffuse=0 or specular=0 lets a lamp do only
    one of the two jobs."""
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    _soft_set(data, volume_factor=volume, use_shadow=shadow, diffuse_factor=diffuse, specular_factor=specular)
    if kind == 'AREA':
        data.shape = 'RECTANGLE' if size_y else 'SQUARE'
        data.size = size
        if size_y:
            data.size_y = size_y
    elif kind == 'SPOT':
        data.spot_size = math.radians(spot)
        data.spot_blend = blend
        data.shadow_soft_size = soft
    elif kind == 'POINT':
        data.shadow_soft_size = soft
    elif kind == 'SUN':
        data.angle = math.radians(size)
    lamp = link(bpy.data.objects.new(name, data))
    lamp.location = loc
    if target is not None:
        look_at(lamp, target)
    return lamp


def rig_studio(target=(0, 0, 0.5), dist=3.0, key=300.0, ratio=4.0, warm=3200, cool=6500, rim=1.2):
    """Three-point lighting for a person or object in a room-sized set. Returns (key, fill, rim) lamps.
      Key  - large soft WARM area, 45 degrees to camera left, 35 degrees up.
      Fill - from the other side, COOL, key/ratio watts (4:1 moody, 2:1 bright), weak in reflections.
      Rim  - high behind, separates the silhouette from the background.
    The warm key against a cool fill is what gives the frame colour contrast."""
    key_lamp = light('AREA', 'Key', _point_on_sphere(target, dist, -45, 35), target, key, kelvin(warm), size=dist * 0.6)
    fill_lamp = light('AREA', 'Fill', _point_on_sphere(target, dist * 1.2, 60, 15), target, key / ratio, kelvin(cool),
                      size=dist * 0.9, specular=0.4)
    rim_lamp = light('AREA', 'Rim', _point_on_sphere(target, dist, 160, 50), target, key * rim, kelvin(5200),
                     size=dist * 0.25)
    return key_lamp, fill_lamp, rim_lamp


def rig_product(target=(0, 0, 0.1), size=0.3, key=12.0, warm=5200, strip=True):
    """Packshot lighting that scales with the product (`size` = its longest side in metres).
    Returns [Key, StripL, StripR, Kicker] (no strips when strip=False):
      Key    - one broad soft lamp above and slightly left of camera.
      Strips - tall thin lamps at either side that paint clean vertical highlights down glossy and metal edges.
      Kicker - low behind the product, lifts its back edge off the backdrop.
    Pair it with world_color(dark) or world_hdri('studio', strength ~0.2)."""
    reach = size * 4
    lamps = [light('AREA', 'Key', _point_on_sphere(target, reach, -20, 55), target, key, kelvin(warm), size=reach * 0.8)]
    if strip:
        for side, azimuth in (('L', -95), ('R', 95)):
            lamps.append(light('AREA', f'Strip{side}', _point_on_sphere(target, reach * 0.8, azimuth, 10), target,
                               key * 0.5, kelvin(6000), size=reach * 0.12, size_y=reach * 0.9))
    lamps.append(light('AREA', 'Kicker', _point_on_sphere(target, reach, 180, 25), target, key * 0.8, kelvin(4200),
                       size=reach * 0.3))
    return lamps


def _fresh_world():
    """A new world on the scene with an empty node tree except its output node."""
    world = bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    try:
        world.use_nodes = True
    except (AttributeError, TypeError):
        pass
    tree = world.node_tree
    tree.nodes.clear()
    return world, tree, tree.nodes.new('ShaderNodeOutputWorld')


def world_color(color=(0.012, 0.013, 0.016), strength=1.0):
    """A plain colour world (dark by default)."""
    world, tree, output = _fresh_world()
    background = tree.nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value = (*color, 1.0)
    background.inputs['Strength'].default_value = strength
    tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    return world


def world_hdri(name='studio', strength=0.6, rot_z=0.0, visible=True):
    """One of the HDRIs that ship inside Blender (nothing to download): see HDRIS.
    Shiny things need something to reflect, and an HDRI is the cheapest way to make metal and glass read right.
    visible=False keeps its light and reflections but the camera sees a flat near-black background."""
    world, tree, output = _fresh_world()
    nodes, links = tree.nodes, tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    turn = nodes.new('ShaderNodeMapping')
    turn.inputs['Rotation'].default_value = (0.0, 0.0, rot_z)
    env = nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(HDRI_DIR, f'{name}.exr'), check_existing=True)
    lit = nodes.new('ShaderNodeBackground')
    lit.inputs['Strength'].default_value = strength
    links.new(coords.outputs['Generated'], turn.inputs['Vector'])
    links.new(turn.outputs['Vector'], env.inputs['Vector'])
    links.new(env.outputs['Color'], lit.inputs['Color'])
    if visible:
        links.new(lit.outputs['Background'], output.inputs['Surface'])
        return world
    # camera rays see the dark backdrop; every other ray (reflection, diffuse bounce) still sees the HDRI
    backdrop = nodes.new('ShaderNodeBackground')
    backdrop.inputs['Color'].default_value = (0.01, 0.01, 0.012, 1.0)
    rays = nodes.new('ShaderNodeLightPath')
    pick = nodes.new('ShaderNodeMixShader')
    links.new(rays.outputs['Is Camera Ray'], pick.inputs[0])
    links.new(lit.outputs['Background'], pick.inputs[1])
    links.new(backdrop.outputs['Background'], pick.inputs[2])
    links.new(pick.outputs['Shader'], output.inputs['Surface'])
    return world


def world_sky(sun_elev=8.0, sun_rot=0.0, strength=1.0):
    """Physically based sky for exteriors. A low sun (3-10 degrees) gives long warm golden-hour light."""
    world, tree, output = _fresh_world()
    sky = tree.nodes.new('ShaderNodeTexSky')
    _first_valid(sky, 'sky_type', ('MULTIPLE_SCATTERING', 'NISHITA', 'SINGLE_SCATTERING', 'HOSEK_WILKIE'))
    _soft_set(sky, sun_elevation=math.radians(sun_elev), sun_rotation=math.radians(sun_rot))
    background = tree.nodes.new('ShaderNodeBackground')
    background.inputs['Strength'].default_value = strength
    tree.links.new(sky.outputs['Color'], background.inputs['Color'])
    tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    return world


def floor(size=20.0, mat=None, curve=False):
    """Something for the subject to stand on, `size` metres across, centred on the origin.
    curve=True builds a photo-studio cyclorama instead: the floor sweeps up into a back wall (at +Y) with a
    rounded cove, so there is no horizon line."""
    if not curve:
        ground = prim('plane', 'Floor', size=(size, size, 1))
    else:
        half = size / 2
        cove, wall_top, steps = size * 0.2, size * 0.5, 16
        section = [(-half, 0.0), (0.0, 0.0)]  # (y, z) points of the side section, front to back
        for i in range(1, steps + 1):
            a = (math.pi / 2) * i / steps
            section.append((cove * math.sin(a), cove * (1.0 - math.cos(a))))
        section.append((cove, wall_top))
        verts = []
        for y, z in section:
            verts += [(-half, y, z), (half, y, z)]
        faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(section) - 1)]  # normals face up / forward
        ground = mesh_obj('Cyclorama', verts, faces)
    if mat:
        set_mat(ground, mat)
    return ground


# ---------------------------------------------------------------------------------------------- post

def highlight_shoulder(tree, img, knee=0.5, cap=1.6):
    """Compositor highlight roll-off. Below `knee` nothing changes; above it the brightest channel eases toward
    `cap` on a smooth curve (slope 1 at the knee, never reaching cap), and all three channels are scaled by the
    same factor so hues hold instead of bleaching to white. Alpha passes through. Returns the output socket."""
    nodes, links = tree.nodes, tree.links

    def op(kind, a, b=None):
        node = nodes.new('ShaderNodeMath')
        node.operation = kind
        for socket, value in zip(node.inputs, (a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    split = nodes.new('CompositorNodeSeparateColor')
    links.new(img, split.inputs['Image'])
    red, green, blue, alpha = (split.outputs[c] for c in ('Red', 'Green', 'Blue', 'Alpha'))
    peak = op('MAXIMUM', red, op('MAXIMUM', green, blue))

    room = cap - knee
    over = op('MAXIMUM', op('SUBTRACT', peak, knee), 0.0)           # how far past the knee
    eased = op('DIVIDE', op('MULTIPLY', over, room), op('ADD', over, room))  # over * room / (over + room) < room
    target = op('ADD', op('MINIMUM', peak, knee), eased)
    gain = op('DIVIDE', target, op('MAXIMUM', peak, 1e-4))

    join = nodes.new('CompositorNodeCombineColor')
    for channel, name in ((red, 'Red'), (green, 'Green'), (blue, 'Blue')):
        links.new(op('MULTIPLY', channel, gain), join.inputs[name])
    links.new(alpha, join.inputs['Alpha'])
    return join.outputs['Image']


def _set_node_input(node, label, value):
    """Set a compositor node input found by its name or identifier; ignore it if this build lacks it."""
    for socket in node.inputs:
        if label in (socket.name, socket.identifier):
            try:
                socket.default_value = value
            except (TypeError, ValueError):
                pass
            return


def compositor(bloom=0.08, shoulder=True, knee=0.5, cap=1.6):
    """Scene-linear post: the highlight shoulder (whites never blow out) and a faint bloom (strength capped
    at 0.12). Returns the compositor node tree."""
    scene = bpy.context.scene
    tree = bpy.data.node_groups.new('Comp', 'CompositorNodeTree')
    scene.compositing_node_group = tree
    scene.render.use_compositing = True
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    layers = tree.nodes.new('CompositorNodeRLayers')
    result = tree.nodes.new('NodeGroupOutput')
    image = layers.outputs['Image']
    if shoulder:
        image = highlight_shoulder(tree, image, knee, cap)
    if bloom > 0:
        glow = tree.nodes.new('CompositorNodeGlare')
        for label, value in (('Type', 'Bloom'), ('Quality', 'High'), ('Threshold', 1.0),
                             ('Strength', min(bloom, 0.12)), ('Size', 0.6)):
            _set_node_input(glow, label, value)
        tree.links.new(image, glow.inputs['Image'])
        image = glow.outputs['Image']
    tree.links.new(image, result.inputs[0])
    return tree


# ---------------------------------------------------------------------------------------------- output

def still(path, samples=None):
    """Render the current frame to a PNG at `path`. Look at it, then run studio blender check on it."""
    scene = bpy.context.scene
    if samples:
        if scene.render.engine == 'CYCLES':
            scene.cycles.samples = samples
        else:
            scene.eevee.taa_render_samples = samples
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('[still]', path)
    return path
