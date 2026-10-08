#!/usr/bin/env python3
"""
Strip a .glb to its geometry: textures, images and materials' texture
references go, and the binary buffer is rebuilt with only the bufferViews
still used. The lock screen draws edges, so a texture is dead weight.

    python3 scripts/strip-glb.py in.glb out.glb
"""
import json, struct, sys


def read(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + bl]


def strip(j, binary):
    for k in ('images', 'textures', 'samplers'):
        j.pop(k, None)
    for m in j.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for k in list(pbr):
            if k.endswith('Texture'):
                del pbr[k]
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            m.pop(k, None)
        m.pop('extensions', None)
    j.pop('extensionsUsed', None)
    j.pop('extensionsRequired', None)
    # Only positions and indices are drawn; drop UVs, colours, tangents too.
    for mesh in j.get('meshes', []):
        for p in mesh['primitives']:
            p['attributes'] = {k: v for k, v in p['attributes'].items() if k in ('POSITION', 'NORMAL')}
            p.pop('targets', None)
    used_acc = set()
    for mesh in j.get('meshes', []):
        for p in mesh['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p:
                used_acc.add(p['indices'])
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            used_acc.add(s['inverseBindMatrices'])
    for a in j.get('animations', []):
        for s in a['samplers']:
            used_acc.update([s['input'], s['output']])
    # Renumber accessors and bufferViews, copying the bytes still used.
    acc_map, accessors = {}, []
    for i, a in enumerate(j['accessors']):
        if i in used_acc:
            acc_map[i] = len(accessors)
            accessors.append(a)
    bv_map, views, out = {}, [], bytearray()
    for a in accessors:
        if 'bufferView' not in a:
            continue
        old = a['bufferView']
        if old not in bv_map:
            v = dict(j['bufferViews'][old])
            data = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
            while len(out) % 4:
                out.append(0)
            v['byteOffset'] = len(out)
            v['buffer'] = 0
            out += data
            bv_map[old] = len(views)
            views.append(v)
        a['bufferView'] = bv_map[old]
    for mesh in j.get('meshes', []):
        for p in mesh['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
    for a in j.get('animations', []):
        for s in a['samplers']:
            s['input'], s['output'] = acc_map[s['input']], acc_map[s['output']]
    j['accessors'], j['bufferViews'] = accessors, views
    j['buffers'] = [{'byteLength': len(out)}]
    return j, bytes(out)


def write(path, j, binary):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


if __name__ == '__main__':
    j, b = read(sys.argv[1])
    write(sys.argv[2], *strip(j, b))
