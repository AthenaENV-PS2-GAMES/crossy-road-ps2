"""Export the existing chicken mesh as a PS2 browser icon.

Wire layout: https://github.com/ps2homebrew/HDLGameInstaller/blob/main/IconLoader.h
icon.sys layout matches AthenaEnv's athena_memcard_build_icon_sys.
Run from any directory; output is game/save/{chicken.icn,icon.sys}.
"""
from pathlib import Path
import math
import struct

ROOT = Path(__file__).resolve().parent.parent

def build_icon():
    materials = {}
    for line in (ROOT / 'game/models/chicken.mtl').read_text().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'newmtl':
            material = fields[1]
        elif fields[0] == 'Kd':
            materials[material] = tuple(round(float(c) * 128) for c in fields[1:4])
    vertices, normals, faces = [], [], []
    for line in (ROOT / 'game/models/chicken.obj').read_text().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'v':
            vertices.append(tuple(map(float, fields[1:4])))
        elif fields[0] == 'vn':
            normals.append(tuple(map(float, fields[1:4])))
        elif fields[0] == 'usemtl':
            material = fields[1]
        elif fields[0] == 'f':
            assert len(fields) == 4
            faces.append((fields[1:], materials[material]))
    # Browser coordinates have Y down. Rotate the game mesh about X by pi,
    # then yaw it 25 degrees to expose both the beak and a wing.
    angle = math.radians(25)
    def orient(v):
        x, y, z = v
        return x * math.cos(angle) - z * math.sin(angle), -y, -x * math.sin(angle) - z * math.cos(angle)
    data = bytearray(struct.pack('<IIIfI', 0x10000, 1, 7, 1.0, len(faces) * 3))
    for face, color in faces:
        for field in face:
            indices = field.split('/')
            position = orient(vertices[int(indices[0]) - 1])
            normal = orient(normals[int(indices[2]) - 1])
            data += struct.pack('<4h4h2h4B',
                *(round(c * 10 * 1024) for c in position), 0,
                *(round(c * 4096) for c in normal), 0,
                2048, 2048, *color, 128)
    # One static shape, held at weight 1 for the entire sequence.
    data += struct.pack('<IIfIIIIff', 1, 1, 1.0, 0, 1, 0, 1, 0.0, 1.0)
    data += struct.pack('<H', 0x7fff) * (128 * 128)
    return data

def build_sys():
    data = bytearray(964)
    struct.pack_into('<4sHHII', data, 0, b'PS2D', 0, 22, 0, 96)
    for i, rgb in enumerate(((98, 198, 220), (98, 198, 220), (180, 230, 100), (180, 230, 100))):
        struct.pack_into('<4I', data, 16 + i * 16, *rgb, 0)
    for i, direction in enumerate(((.5, .5, .5), (0, -.4, -.1), (-.5, -.5, .5))):
        struct.pack_into('<4f', data, 80 + i * 16, *direction, 0)
        struct.pack_into('<4f', data, 128 + i * 16, *([.3 + i * .1] * 3), 0)
    struct.pack_into('<4f', data, 176, .5, .5, .5, 0)
    title = 'CHICKEN HOPRECORD AND COINS'
    encoded = b''.join(struct.pack('>H', 0x8140 if c == ' ' else 0x8260 + ord(c) - ord('A')) for c in title)
    data[192:192 + len(encoded)] = encoded
    # Newline comes after CHICKEN HOP (11 characters / 22 bytes).
    for offset in (260, 324, 388):
        name = b'chicken.icn'
        data[offset:offset + len(name)] = name
    return data

def validate(icon, descriptor):
    version, shapes, flags, backface, count = struct.unpack_from('<IIIfI', icon)
    assert (version, shapes, flags, backface) == (0x10000, 1, 7, 1.0)
    assert count % 3 == 0 and count // 3 < 1500
    end = 20 + count * 24
    assert struct.unpack_from('<IIfIIIIff', icon, end) == (1, 1, 1.0, 0, 1, 0, 1, 0.0, 1.0)
    assert len(icon) == end + 36 + 32768
    assert len(descriptor) == 964 and descriptor[:4] == b'PS2D'
    assert all(descriptor[p:p + 12] == b'chicken.icn\0' for p in (260, 324, 388))
    print(f'Validated chicken icon: {count // 3} triangles, {len(icon)} bytes; icon.sys: 964 bytes')

if __name__ == '__main__':
    icon, descriptor = build_icon(), build_sys()
    validate(icon, descriptor)
    output = ROOT / 'game/save'
    output.mkdir(exist_ok=True)
    (output / 'chicken.icn').write_bytes(icon)
    (output / 'icon.sys').write_bytes(descriptor)
