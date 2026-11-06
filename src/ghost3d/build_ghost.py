"""Builds GHOST.glb in Blender:
   * body = the 360-degree model carved from Steven's turnaround video (hood, visor, cape, torso, legs, boots), arms removed
   * arms = built here: shoulder, upper arm, elbow, armoured forearm with gold band, wrist, hand with jointed fingers, cyan palm light
   * skeleton: root, spine, head, and per side upper arm, forearm, hand, 5 fingers (3 joints each, thumb 2)
   * moves: Idle (loops), Wave (right hand, after Steven's waving video), HandsUp (both hands, after his hands-up video)
Units: 1.0 = his full height. Blender is Z-up; the .glb comes out Y-up for the web."""
import bpy, bmesh, json, math, sys
from mathutils import Vector, Matrix, Quaternion

HERE = '/home/claude/ghost'
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else f'{HERE}/GHOST.glb'
H = 314.0                                   # his height in video pixels
def P(x, y, z):                             # video units (x right, y up, z his front) -> Blender (x, -z, y) / H ; his front faces -Y
    return Vector((x / H, -z / H, y / H))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials
def mat(name, base, metal, rough, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if coat: b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    return m
lin = lambda h: tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (1, 3, 5))
CHROME = mat('Chrome', (0.56, 0.57, 0.6), 1.0, 0.2)   # darker chrome so the new arms match the carved body
DARK = mat('DarkMetal', (0.05, 0.05, 0.06), 0.9, 0.35)
GOLD = mat('Gold', lin('#ffc94a'), 1.0, 0.22)
CYAN = mat('CyanLight', lin('#22e4ff'), 0.0, 0.3, lin('#22e4ff'), 8.0)

# ---------------------------------------------------------------- body (carved)
bpy.ops.wm.ply_import(filepath=f'{HERE}/ghost_body_noarms.ply')
body = bpy.context.selected_objects[0]; body.name = 'GhostBody'
me = body.data
# carve space (x, y up, z front) -> Blender
for v in me.vertices:
    x, y, z = v.co
    v.co = P(x, y, z)
dec = body.modifiers.new('Decimate', 'DECIMATE'); dec.ratio = 0.28
bpy.context.view_layer.objects.active = body; bpy.ops.object.modifier_apply(modifier='Decimate')
bpy.ops.object.shade_smooth()
bm_ = bpy.data.materials.new('GhostBody'); bm_.use_nodes = True
nt = bm_.node_tree; bsdf = nt.nodes['Principled BSDF']
ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = me.color_attributes[0].name if me.color_attributes else 'Col'
nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.55; bsdf.inputs['Metallic'].default_value = 0.0
me.materials.append(bm_)
print('body faces', len(me.polygons))

# ---------------------------------------------------------------- skeleton
arm_path = json.load(open(f'{HERE}/arms.json'))['path']   # shoulder, elbow, wrist, fingertips (x, y, z, r)
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.object; rig.name = 'GhostRig'; rig.data.name = 'GhostRig'
eb = rig.data.edit_bones
eb.remove(eb[0])
def bone(name, head, tail, parent=None, roll=0.0):
    b = eb.new(name); b.head = head; b.tail = tail; b.roll = roll
    if parent: b.parent = eb[parent]; b.use_connect = False
    return b
bone('root', Vector((0, 0, 0)), Vector((0, 0, 0.08)))
bone('spine', P(0, 120, 0), P(0, 190, 0), 'root')
bone('head', P(0, 196, 0), P(0, 300, 0), 'spine')
HAND = {}
for side, s in (('L', 1), ('R', -1)):   # L = his left (screen right when he faces you: +x), R = his right
    (sx, sy, sz, _), (ex, ey, ez, _), (wx, wy, wz, _), (fx, fy, fz, _) = arm_path
    sh, el, wr, tip = P(s * sx, sy, sz), P(s * ex, ey, ez), P(s * wx, wy, wz), P(s * fx, fy, fz)
    bone(f'upper_arm.{side}', sh, el, 'spine')
    bone(f'forearm.{side}', el, wr, f'upper_arm.{side}')
    knuckle = wr + (tip - wr) * 0.45
    bone(f'hand.{side}', wr, knuckle, f'forearm.{side}')
    down = (tip - wr).normalized()
    inward = Vector((-s, 0, 0))                         # palm faces his body
    across = down.cross(inward).normalized()            # across the knuckles (front to back)
    HAND[side] = (wr, knuckle, down, inward, across)
    # four fingers spread across the knuckles, thumb on the front side
    for i, off in enumerate((-1.5, -0.5, 0.5, 1.5)):
        base = knuckle + across * (off * 3.1 * 1.5 / H)
        lens = [7.0, 5.6, 4.8] if i in (1, 2) else [6.2, 5.0, 4.3]
        p = base; par = f'hand.{side}'
        for j, L in enumerate(lens):
            q = p + down * (L / H)
            bone(f'f{i}_{j}.{side}', p, q, par); par = f'f{i}_{j}.{side}'; p = q
    tb = wr + down * (5 / H) + across * (9.5 / H) + inward * (3.5 / H)
    tdir = (down * 0.6 + across * 0.8).normalized()
    p = tb; par = f'hand.{side}'
    for j, L in enumerate((5.8, 5.0)):
        q = p + tdir * (L / H); bone(f'thumb_{j}.{side}', p, q, par); par = f'thumb_{j}.{side}'; p = q
bpy.ops.object.mode_set(mode='OBJECT')

# body weights: head bone for the hood and head, spine below, smooth blend at the neck
vg_head = body.vertex_groups.new(name='head'); vg_sp = body.vertex_groups.new(name='spine'); vg_root = body.vertex_groups.new(name='root')
for v in me.vertices:
    z = v.co.z * H
    wh = min(1, max(0, (z - 186) / 22))
    wr_ = min(1, max(0, (110 - z) / 40))      # legs/boots stay planted
    vg_head.add([v.index], wh, 'REPLACE'); vg_root.add([v.index], wr_ * (1 - wh), 'REPLACE'); vg_sp.add([v.index], (1 - wh) * (1 - wr_), 'REPLACE')
body.parent = rig
am = body.modifiers.new('Armature', 'ARMATURE'); am.object = rig

# ---------------------------------------------------------------- arm parts (built in place, then pinned to their bones)
def finish(o, m, bone_name, smooth=True, bevel=None, sub=0):
    o.data.materials.append(m)
    if bevel:
        bv = o.modifiers.new('Bevel', 'BEVEL'); bv.width = bevel; bv.segments = 3
    if sub:
        ss = o.modifiers.new('Sub', 'SUBSURF'); ss.levels = sub; ss.render_levels = sub
    bpy.context.view_layer.objects.active = o
    for md in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)
    if smooth: bpy.ops.object.shade_smooth()
    w = o.matrix_world.copy(); o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bone_name; o.matrix_world = w
    return o
def capsule(a, b, r0, r1, m, bone_name, name, verts=24):
    d = b - a; L = d.length
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r0, radius2=r1, depth=L, location=(a + b) / 2)
    o = bpy.context.object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, m, bone_name, bevel=min(r0, r1) * 0.45)
def ball(c, r, m, bone_name, name, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=r, location=c)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, m, bone_name)
def ring(c, axis, r, thick, m, bone_name, name):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=thick, major_segments=40, minor_segments=10, location=c)
    o = bpy.context.object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, m, bone_name)
def disc(c, axis, r, depth, m, bone_name, name):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=depth, location=c)
    o = bpy.context.object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, m, bone_name, bevel=depth * 0.3)
u = 1 / H
T = 1.45   # arm thickness (his arms are chunky in the art)
HS = 1.5  # hand and finger size
for side, s in (('L', 1), ('R', -1)):
    B = rig.data.bones
    sh, el = B[f'upper_arm.{side}'].head_local, B[f'upper_arm.{side}'].tail_local
    wr = B[f'forearm.{side}'].tail_local
    out = Vector((s, 0, 0))
    ball(sh, 12.5 * T * u, CHROME, f'upper_arm.{side}', f'Shoulder.{side}', (1.05, 1, 0.95))
    ring(sh + out * 6 * T * u, out, 7.5 * T * u, 1.4 * T * u, GOLD, f'upper_arm.{side}', f'ShoulderRing.{side}')
    disc(sh + out * 11.5 * T * u, out, 4.2 * T * u, 2 * T * u, DARK, f'upper_arm.{side}', f'ShoulderCap.{side}')
    capsule(sh, el, 8.6 * T * u, 7.6 * T * u, CHROME, f'upper_arm.{side}', f'UpperArm.{side}')
    ball(el, 8.4 * T * u, DARK, f'forearm.{side}', f'Elbow.{side}')
    disc(el + out * 7.5 * T * u, out, 4.6 * T * u, 2.2 * T * u, GOLD, f'forearm.{side}', f'ElbowCap.{side}')
    disc(el + out * 8.7 * T * u, out, 2.2 * T * u, 1.2 * T * u, CYAN, f'forearm.{side}', f'ElbowLight.{side}')
    fa = el + (wr - el) * 0.12
    capsule(fa, wr - (wr - el) * 0.1, 12.5 * T * u, 10.2 * T * u, CHROME, f'forearm.{side}', f'Forearm.{side}')
    ring(el + (wr - el) * 0.78, wr - el, 10.6 * T * u, 1.3 * T * u, GOLD, f'forearm.{side}', f'ForearmBand.{side}')
    capsule(wr - (wr - el) * 0.08, wr + (wr - el).normalized() * 3 * u, 6.8 * T * u, 6.2 * T * u, DARK, f'hand.{side}', f'Wrist.{side}')
    # hand: palm block, palm light, fingers, thumb
    wr_, knuckle, down, inward, across = HAND[side]
    pc = wr_ + (knuckle - wr_) * 0.55
    bpy.ops.mesh.primitive_cube_add(size=1, location=pc)
    palm = bpy.context.object; palm.name = f'Palm.{side}'
    m3 = Matrix((across, inward, down)).transposed()          # columns: across, inward, down
    palm.matrix_world = Matrix.Translation(pc) @ m3.to_4x4() @ Matrix.Diagonal((13.5 * HS * u, 6.2 * HS * u, (knuckle - wr_).length * 1.05, 1))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    finish(palm, CHROME, f'hand.{side}', bevel=1.6 * HS * u)
    disc(pc + inward * 3.3 * HS * u, inward, 3.4 * HS * u, 0.9 * u, CYAN, f'hand.{side}', f'PalmLight.{side}')
    ring(pc + inward * 3.25 * HS * u, inward, 4.1 * HS * u, 0.55 * HS * u, CHROME, f'hand.{side}', f'PalmRing.{side}')
    import re
    for name in [b.name for b in B if re.match(r'^(f\d_\d|thumb_\d)\.' + side + '$', b.name)]:
        bb = B[name]; a, b2 = bb.head_local, bb.tail_local
        r = (2.15 if not name.startswith('thumb') else 2.5) * HS * u * (0.9 if name.split('_')[1].startswith('2') else 1)
        capsule(a + (b2 - a) * 0.12, b2 - (b2 - a) * 0.06, r, r * 0.92, CHROME, name, f'Finger_{name}')
        ball(a, r * 1.08, DARK, name, f'Joint_{name}')

# ---------------------------------------------------------------- moves
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
PB = rig.pose.bones
for pb in PB: pb.rotation_mode = 'QUATERNION'
def reset():
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
def aim(name, d, twist=0.0):
    """Turn bone `name` so it points along world direction d (parents already posed)."""
    bpy.context.view_layer.update()
    pb = PB[name]; bb = pb.bone
    if pb.parent:
        A = (pb.parent.matrix @ bb.parent.matrix_local.inverted() @ bb.matrix_local).to_3x3()
    else:
        A = bb.matrix_local.to_3x3()
    dl = (A.inverted() @ d.normalized()).normalized()
    q = Vector((0, 1, 0)).rotation_difference(dl)
    if twist: q = q @ Quaternion((0, 1, 0), twist)
    pb.rotation_quaternion = q
def curl(side, amount, spread=0.0):
    for i in range(4):
        for j in range(3):
            n = f'f{i}_{j}.{side}'
            ax = Vector((1, 0, 0))
            PB[n].rotation_quaternion = Quaternion(ax, amount * (0.55 if j == 0 else 0.75)) @ Quaternion((0, 0, 1), spread * (i - 1.5) * 0.18 if j == 0 else 0)
    for j in range(2): PB[f'thumb_{j}.{side}'].rotation_quaternion = Quaternion((1, 0, 0), amount * 0.4)
def key_all(frame):
    for pb in PB:
        pb.keyframe_insert('rotation_quaternion', frame=frame); pb.keyframe_insert('location', frame=frame)
def new_action(name):
    act = bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action = act; return act
def push(act):
    tr = rig.animation_data.nla_tracks.new(); tr.name = act.name
    st = tr.strips.new(act.name, 1, act); st.name = act.name
    rig.animation_data.action = None
FPS = 30; scene.render.fps = FPS
W = lambda x, y, z: Vector((x, -z, y))      # direction helper in his space (x right, y up, z front)

# Idle: breathing, slow head look, relaxed arms swinging a touch (4 s loop)
act = new_action('Idle')
for f, t in ((1, 0), (31, 1), (61, 2), (91, 3), (121, 4)):
    reset()
    PB['spine'].rotation_quaternion = Quaternion((1, 0, 0), 0.025 * math.sin(t * math.pi / 2))
    PB['head'].rotation_quaternion = Quaternion((0, 1, 0), 0.22 * math.sin(t * math.pi / 2)) @ Quaternion((1, 0, 0), 0.04 * math.cos(t * math.pi / 2))
    for side, s in (('L', 1), ('R', -1)):
        aim(f'upper_arm.{side}', W(s * 0.18, -1, 0.10 + 0.05 * math.sin(t * math.pi / 2 + (0 if s > 0 else math.pi))))
        aim(f'forearm.{side}', W(s * 0.1, -1, 0.35))
        curl(side, 0.35)
    key_all(f)
push(act)

# Wave: right arm up, hand waving side to side three times, then back down (3.5 s)
act = new_action('Wave')
def wave_pose(lift, sway):
    reset()
    PB['head'].rotation_quaternion = Quaternion((0, 1, 0), -0.12 * lift) @ Quaternion((0, 0, 1), 0.05 * lift)
    aim('upper_arm.L', W(0.18, -1, 0.12)); aim('forearm.L', W(0.1, -1, 0.35)); curl('L', 0.35)
    up = W(-0.15, -1, 0.1).lerp(W(-1, 0.35, 0.15), lift)
    aim('upper_arm.R', up)
    fore = W(-0.1, -1, 0.35).lerp(W(-0.25 + sway, 1, 0.12), lift)
    aim('forearm.R', fore)
    aim('hand.R', fore)
    curl('R', 0.35 * (1 - lift), spread=lift)
for f, lift, sway in ((1, 0, 0), (16, 1, 0), (24, 1, 0.45), (32, 1, -0.35), (40, 1, 0.45), (48, 1, -0.35), (56, 1, 0.45), (64, 1, -0.2), (80, 1, 0), (105, 0, 0)):
    wave_pose(lift, sway); key_all(f)
push(act)

# HandsUp: both hands up and open, a little bounce (2.5 s), after his hands-up video
act = new_action('HandsUp')
for f, lift, bob in ((1, 0, 0), (14, 1, 0), (26, 1, 1), (38, 1, 0), (50, 1, 1), (62, 1, 0), (76, 0, 0)):
    reset()
    PB['spine'].location = (0, 0.012 * bob, 0)
    PB['head'].rotation_quaternion = Quaternion((1, 0, 0), -0.08 * lift)
    for side, s in (('L', 1), ('R', -1)):
        aim(f'upper_arm.{side}', W(s * 0.18, -1, 0.12).lerp(W(s * 1, 0.3 + 0.1 * bob, 0.12), lift))
        aim(f'forearm.{side}', W(s * 0.1, -1, 0.35).lerp(W(s * 0.3, 1, 0.15), lift))
        aim(f'hand.{side}', W(s * 0.1, -1, 0.35).lerp(W(s * 0.25, 1, 0.05), lift))
        curl(side, 0.35 * (1 - lift), spread=lift)
    key_all(f)
push(act)
reset()
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- export
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_skins=True, export_apply=False,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print('wrote', OUT)
