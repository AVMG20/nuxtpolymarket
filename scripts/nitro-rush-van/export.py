"""Writes the van built by `build.py` as the mesh module the game loads (run inside Blender, after `build.py`).

The game builds its cars synchronously, so the mesh ships inside the bundle rather than as a file to fetch:
each material slot becomes one indexed mesh, quantised and base64 packed, in the game's axes (+y up, -z forward).
"""
import base64
from array import array
from pathlib import Path

import bpy

SCENE = 'NitroRushVan'
P = 'NV_'
OUT = Path(bpy.app.driver_namespace['nv_mesh_out'])

scene = bpy.data.scenes[SCENE]
scene.view_layers[0].update()
dg = scene.view_layers[0].depsgraph


def collect(meshes):
    """Triangles by material slot, with matching corners welded."""
    slots = {}
    for me in meshes:
        me.calc_loop_triangles()
        normals = me.corner_normals
        uvs = me.uv_layers.active.data if me.uv_layers.active else None
        for tri in me.loop_triangles:
            slot = me.materials[tri.material_index].name[len(P):]
            part = slots.setdefault(slot, {'seen': {}, 'verts': [], 'index': [], 'uv': False})
            for li in tri.loops:
                co = me.vertices[me.loops[li].vertex_index].co
                n = normals[li].vector
                uv = tuple(uvs[li].uv) if uvs else (0.0, 0.0)
                part['uv'] = part['uv'] or uvs is not None
                # Blender's +Y forward and +Z up become the game's -z forward and +y up.
                vert = (co.x, co.z, -co.y, n.x, n.z, -n.y, uv[0], uv[1])
                key = tuple(round(v, 4) for v in vert)
                at = part['seen'].get(key)
                if at is None:
                    at = part['seen'][key] = len(part['verts'])
                    part['verts'].append(vert)
                part['index'].append(at)
    return slots


def b64(typecode, values):
    return base64.b64encode(array(typecode, values).tobytes()).decode()


def pack(part):
    verts = part['verts']
    assert len(verts) < 65536
    lo = [min(v[i] for v in verts) for i in range(3)]
    size = [max(max(v[i] for v in verts) - lo[i], 1e-6) for i in range(3)]
    fields = [
        f'count: {len(verts)}',
        f'min: [{", ".join(f"{v:.5f}" for v in lo)}]',
        f'size: [{", ".join(f"{v:.5f}" for v in size)}]',
        f"position: '{b64('H', [round((v[i] - lo[i]) / size[i] * 65535) for v in verts for i in range(3)])}'",
        f"normal: '{b64('b', [round(max(-1, min(1, v[i])) * 127) for v in verts for i in (3, 4, 5)])}'"
    ]
    if part['uv']:
        fields.append(f"uv: '{b64('H', [round(max(0, min(1, v[i])) * 65535) for v in verts for i in (6, 7)])}'")
    fields.append(f"index: '{b64('H', part['index'])}'")
    return '{ ' + ', '.join(fields) + ' }'


def group(name, slots):
    lines = [f'export const {name} = {{']
    lines.append(',\n'.join(f'    {slot}: {pack(part)}' for slot, part in sorted(slots.items())))
    lines.append('} satisfies Record<string, PackedMesh>')
    return '\n'.join(lines)


body = collect([bpy.data.objects[P + n].evaluated_get(dg).data for n in ('body', 'glass', 'details')])
# The wheel is hidden from the scene, so it is read as modelled: about its own axle, outer face along +x.
wheel = collect([bpy.data.objects[P + 'wheel'].data])

text = '\n'.join([
    '/** The van\'s mesh, written by `scripts/nitro-rush-van/export.py` from its Blender model. Don\'t edit by hand: change the model and export again. */',
    '',
    '/** One material slot\'s triangles: positions quantised to 16 bits across `min` to `min + size`, normals to 8 bits, all base64. */',
    'export interface PackedMesh {',
    '    count: number',
    '    min: number[]',
    '    size: number[]',
    '    position: string',
    '    normal: string',
    '    uv?: string',
    '    index: string',
    '}',
    '',
    group('VAN_BODY', body),
    '',
    group('VAN_WHEEL', wheel),
    ''
])
OUT.write_text(text)
for name, slots in (('body', body), ('wheel', wheel)):
    for slot, part in sorted(slots.items()):
        print(name, slot, 'verts', len(part['verts']), 'tris', len(part['index']) // 3)
print('wrote', OUT, len(text) // 1024, 'KB')
