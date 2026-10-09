"""Make retro.ttf's zero readable: the font's own "0" has a middle bar and reads
as "8" at HUD sizes. This copies the outline of its "O" glyph (a plain zero
shape, same bounding box and advance width) into the "0" glyph slot.

Pure Python, no fontTools. The "O" outline is written over the "0" outline
in place and zero-padded, so no table changes size; the LTSH entry is copied
and the glyf/LTSH table checksums and head.checkSumAdjustment are recomputed.
The source font is not modified.

    python3 tools/patch_font.py ../assets/fonts/retro.ttf game/fonts/retro.ttf
"""
import argparse
from pathlib import Path
import struct


def tables(data):
    count = struct.unpack(">H", data[4:6])[0]
    out = {}
    for i in range(count):
        record = 12 + 16 * i
        tag, _, offset, length = struct.unpack(">4sIII", data[record:record + 16])
        out[tag.decode("latin-1")] = (record, offset, length)
    return out


def cmap_glyph(data, cmap, code):
    """Glyph id for `code` from the Windows Unicode BMP (3, 1) format-4 subtable."""
    count = struct.unpack(">H", data[cmap + 2:cmap + 4])[0]
    for i in range(count):
        pid, eid, sub = struct.unpack(">HHI", data[cmap + 4 + 8 * i:cmap + 12 + 8 * i])
        if (pid, eid) != (3, 1):
            continue
        base = cmap + sub
        if struct.unpack(">H", data[base:base + 2])[0] != 4:
            raise ValueError("expected a format-4 cmap subtable")
        seg2 = struct.unpack(">H", data[base + 6:base + 8])[0]
        ends, starts = base + 14, base + 16 + seg2
        deltas, ranges = starts + seg2, starts + 2 * seg2
        for s in range(seg2 // 2):
            end = struct.unpack(">H", data[ends + 2 * s:ends + 2 * s + 2])[0]
            if code > end:
                continue
            start = struct.unpack(">H", data[starts + 2 * s:starts + 2 * s + 2])[0]
            if code < start:
                break
            delta = struct.unpack(">h", data[deltas + 2 * s:deltas + 2 * s + 2])[0]
            offset = struct.unpack(">H", data[ranges + 2 * s:ranges + 2 * s + 2])[0]
            if offset == 0:
                return (code + delta) & 0xFFFF
            at = ranges + 2 * s + offset + 2 * (code - start)
            glyph = struct.unpack(">H", data[at:at + 2])[0]
            return (glyph + delta) & 0xFFFF if glyph else 0
    raise ValueError("character %r not mapped" % chr(code))


def checksum(block):
    block = block + b"\0" * (-len(block) % 4)
    return sum(struct.unpack(">%dI" % (len(block) // 4), block)) & 0xFFFFFFFF


def patch(source, target):
    data = bytearray(Path(source).read_bytes())
    t = tables(data)
    head = t["head"][1]
    if struct.unpack(">h", data[head + 50:head + 52])[0] != 0:
        raise ValueError("expected short loca offsets")
    zero, letter = cmap_glyph(data, t["cmap"][1], 0x30), cmap_glyph(data, t["cmap"][1], 0x4F)
    loca, glyf = t["loca"][1], t["glyf"][1]

    def span(glyph):
        a, b = struct.unpack(">HH", data[loca + 2 * glyph:loca + 2 * glyph + 4])
        return glyf + 2 * a, glyf + 2 * b

    z0, z1 = span(zero)
    o0, o1 = span(letter)
    if o1 - o0 > z1 - z0:
        raise ValueError("the O outline does not fit in the 0 slot")
    if data[z0 + 2:z0 + 10] != data[o0 + 2:o0 + 10]:
        raise ValueError("0 and O bounding boxes differ")
    hhea, hmtx = t["hhea"][1], t["hmtx"][1]
    metrics = struct.unpack(">H", data[hhea + 34:hhea + 36])[0]
    advance = lambda g: struct.unpack(">H", data[hmtx + 4 * min(g, metrics - 1):][:2])[0]
    if advance(zero) != advance(letter):
        raise ValueError("0 and O advance widths differ")

    data[z0:z1] = bytes(data[o0:o1]) + b"\0" * ((z1 - z0) - (o1 - o0))
    if "LTSH" in t:
        ltsh = t["LTSH"][1]
        data[ltsh + 4 + zero] = data[ltsh + 4 + letter]

    for tag in ("glyf", "LTSH"):
        if tag in t:
            record, offset, length = t[tag]
            struct.pack_into(">I", data, record + 4, checksum(bytes(data[offset:offset + length])))
    struct.pack_into(">I", data, head + 8, 0)
    record, offset, length = t["head"]
    struct.pack_into(">I", data, record + 4, checksum(bytes(data[offset:offset + length])))
    struct.pack_into(">I", data, head + 8, (0xB1B0AFBA - checksum(bytes(data))) & 0xFFFFFFFF)

    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_bytes(bytes(data))
    return zero, letter


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    zero, letter = patch(args.source, args.target)
    print("glyph %d (\"0\") now uses the outline of glyph %d (\"O\") -> %s" % (zero, letter, args.target))
