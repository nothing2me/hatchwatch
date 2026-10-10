"""HatchWatch camera-housing reference design -> printable STL.

Generates three ASCII STL files under artifacts/housing/:

  hatchwatch-housing-body.stl   - main shell: walls, camera window ring +
                                   plexiglass insert lip, internal phone/battery
                                   bay steps, cable-lip, pole socket (40 mm),
                                   solar-panel standoffs, lid screw bosses.
  hatchwatch-housing-lid.stl    - flat lid plate with screw holes.
  hatchwatch-housing-solar.stl  - tilted solar-panel plate.

Dimensions in millimetres; all solids are unions of oriented hexahedra so the
model is a single printable object with no supports-free geometry by design
(the window ring and internal steps are sized for FDM at 0.2 mm layers).

This is a reference design for the hackathon demo, not a field-certified
enclosure: weather sealing, thermal behaviour and salt-air durability must be
tested before any real deployment.
"""

import math
import os
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "housing"

# ---------------- geometry helpers -------------------------------------------

def _emit_tris(stream, a, b, c, centroid):
    normal = _face_normal(a, b, c, centroid)
    for vertex in (a, b, c):
        stream.write(
            f"facet normal {normal[0]:.6f} {normal[1]:.6f} {normal[2]:.6f}\n"
            f"  outer loop\n"
            f"    vertex {vertex[0]:.3f} {vertex[1]:.3f} {vertex[2]:.3f}\n"
            f"  endloop\nendfacet\n"
        )


def _face_normal(a, b, c, centroid):
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    )
    # point the normal away from the solid's own body
    body = (
        (a[0] + b[0] + c[0]) / 3 - centroid[0],
        (a[1] + b[1] + c[1]) / 3 - centroid[1],
        (a[2] + b[2] + c[2]) / 3 - centroid[2],
    )
    if n[0] * body[0] + n[1] * body[1] + n[2] * body[2] < 0:
        n = (-n[0], -n[1], -n[2])
    length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
    return (n[0] / length, n[1] / length, n[2] / length)


def _quad(stream, corners, p0, p1, p2, p3, centroid):
    _emit_tris(stream, corners[p0], corners[p1], corners[p2], centroid)
    _emit_tris(stream, corners[p0], corners[p2], corners[p3], centroid)


def hexahedron(stream, corners):
    """8 corners as (x, y, z); emits the 6 outward-facing quads (12 tris)."""
    centroid = tuple(sum(c[i] for c in corners) / 8 for i in range(3))
    f0, f1, f2, f3, b0, b1, b2, b3 = corners
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 0, 1, 2, 3, centroid)          # far
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 3, 2, 1, 0, centroid)          # near (flipped)
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 0, 3, 7, 4, centroid)          # left
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 1, 2, 6, 5, centroid)          # right
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 3, 2, 6, 7, centroid)          # top
    _quad(stream, (f0, f1, f2, f3, b0, b1, b2, b3), 0, 1, 5, 4, centroid)          # bottom


def box(stream, cx, cy, cz, w, h, d, rot_x=0.0, rot_z=0.0):
    """Axis-aligned (or rotated) solid box centred at (cx, cy, cz)."""
    corners = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                x, y, z = sx * w / 2, sy * h / 2, sz * d / 2
                # rotate about Z then X so any orientation is expressible
                if rot_z:
                    x, y = x * math.cos(rot_z) - y * math.sin(rot_z), x * math.sin(rot_z) + y * math.cos(rot_z)
                if rot_x:
                    y, z = y * math.cos(rot_x) - z * math.sin(rot_x), y * math.sin(rot_x) + z * math.cos(rot_x)
                corners.append((cx + x, cy + y, cz + z))
    # reorder to the f0..b3 convention used by hexahedron
    ordered = [
        corners[0], corners[1], corners[3], corners[2],
        corners[4], corners[5], corners[7], corners[6],
    ]
    hexahedron(stream, ordered)


def ring_z(stream, cx, cy, z0, z1, r_in, r_out, segments=24):
    """Vertical ring (e.g. pole socket) around the Z axis."""
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        corners = [
            (cx + r_in * math.cos(a0), cy + r_in * math.sin(a0), z0),
            (cx + r_out * math.cos(a0), cy + r_out * math.sin(a0), z0),
            (cx + r_out * math.cos(a1), cy + r_out * math.sin(a1), z0),
            (cx + r_in * math.cos(a1), cy + r_in * math.sin(a1), z0),
            (cx + r_in * math.cos(a0), cy + r_in * math.sin(a0), z1),
            (cx + r_out * math.cos(a0), cy + r_out * math.sin(a0), z1),
            (cx + r_out * math.cos(a1), cy + r_out * math.sin(a1), z1),
            (cx + r_in * math.cos(a1), cy + r_in * math.sin(a1), z1),
        ]
        hexahedron(stream, corners)


def ring_x(stream, cy, cz, x0, x1, r_in, r_out, segments=24):
    """Horizontal ring around the X axis (cable tunnel / bosses)."""
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        corners = [
            (x0, cy + r_in * math.cos(a0), cz + r_in * math.sin(a0)),
            (x0, cy + r_out * math.cos(a0), cz + r_out * math.sin(a0)),
            (x0, cy + r_out * math.cos(a1), cz + r_out * math.sin(a1)),
            (x0, cy + r_in * math.cos(a1), cz + r_in * math.sin(a1)),
            (x1, cy + r_in * math.cos(a0), cz + r_in * math.sin(a0)),
            (x1, cy + r_out * math.cos(a0), cz + r_out * math.sin(a0)),
            (x1, cy + r_out * math.cos(a1), cz + r_out * math.sin(a1)),
            (x1, cy + r_in * math.cos(a1), cz + r_in * math.sin(a1)),
        ]
        hexahedron(stream, corners)


def write_stl(path, solids):
    with open(path, "w", encoding="ascii") as f:
        f.write(f"solid hatchwatch {path.stem}\n")
        for solid in solids:
            solid(f)
        f.write("endsolid hatchwatch\n")


# ---------------- part builders -----------------------------------------------

WALL = 3.2
BODY_W, BODY_H, BODY_D = 120.0, 92.0, 58.0


def body_parts(f):
    """Main shell: walls, window ring + insert lip, internal bay, pole socket,
    solar standoffs, cable lip and lid screw bosses."""
    w, h, d = BODY_W, BODY_H, BODY_D
    t = WALL
    iw, ih, id_ = w - 2 * t, h - 2 * t, d - 2 * t
    cy = h / 2  # box centre in y (height)

    # Six wall plates: front(+z), back(-z), top(+y), bottom, left(-x), right(+x)
    box(f, 0, cy, d / 2, w, h, t)                       # front wall
    box(f, 0, cy, -d / 2, w, h, t)                      # back wall
    box(f, 0, h - t / 2, 0, w, t, d)                    # top wall
    box(f, 0, t / 2, 0, w, t, d)                        # bottom wall
    box(f, (-w / 2 + t / 2), cy, 0, t, ih, id_)         # left wall
    box(f, (w / 2 - t / 2), cy, 0, t, ih, id_)          # right wall

    # Camera window: outer ring on the front-top face + inner plexiglass lip.
    wind_cy = h - 26.0
    wind_cz = d / 2 - 1.0
    ring_z(f, 0, wind_cy, wind_cz + 0, wind_cz + 7.0, 5.2, 9.0, 24)   # raised rim
    ring_z(f, 0, wind_cy, wind_cz - 2.5, wind_cz + 0, 5.2, 8.2, 24)   # insert lip

    # Internal phone/battery bay: two steps divide the volume.
    box(f, 0, (t + 22), 0, iw, 10, id_, rot_x=0.05)      # phone tray ledge
    box(f, 0, (t + 36), 0, iw, 10, id_, rot_x=-0.05)     # battery shelf

    # Pole socket at the bottom centre: 40 mm pole, 4 mm wall, 45 mm deep.
    ring_z(f, 0, 0, -h / 2, -h / 2 + 45, 18.0, 22.0, 28)

    # Cable exit lip at the rear-bottom (half-height bushing).
    ring_x(f, 0, -h / 2 + 8, -w / 2 - 1, w / 2 + 1, 3.8, 6.0, 20)

    # Solar-panel standoffs: two vertical pads on the top wall.
    for sx in (-22.0, 22.0):
        box(f, sx, h, -10.0, 14, 8, 14)

    # Lid screw bosses on the inner top wall corners.
    for sx in (-(w / 2 - 14), (w / 2 - 14)):
        for sz in (-(d / 2 - 14), (d / 2 - 14)):
            box(f, sx, h - t, sz, 9, t + 2, 9)


def lid_parts(f):
    """Flat lid plate with 4 screw holes approximated as ring gaps."""
    w, d = BODY_W, BODY_D
    t = 2.6
    box(f, 0, 0, 0, w, t, d)
    for sx in (-(w / 2 - 14), (w / 2 - 14)):
        for sz in (-(d / 2 - 14), (d / 2 - 14)):
            ring_z(f, sx, 0, -t / 2, t / 2, 0, 2.4, 12)


def solar_parts(f):
    """Tilted solar panel plate orientable at ~25 degrees via standoffs in body."""
    box(f, 0, 0, 0, 96, 2.4, 54, rot_x=math.radians(25))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_stl(OUT_DIR / "hatchwatch-housing-body.stl", [body_parts])
    write_stl(OUT_DIR / "hatchwatch-housing-lid.stl", [lid_parts])
    write_stl(OUT_DIR / "hatchwatch-housing-solar.stl", [solar_parts])
    for name in ("hatchwatch-housing-body.stl", "hatchwatch-housing-lid.stl", "hatchwatch-housing-solar.stl"):
        path = OUT_DIR / name
        triangles = sum(1 for _ in open(path) if _.startswith("  vertex"))
        size_kb = round(path.stat().st_size / 1024, 1)
        print(f"{name}: {triangles // 3} triangles, {size_kb} kB")

    size_mm = (BODY_W, BODY_H, BODY_D)
    print(f"Body bounding box (WÃ—HÃ—D): {size_mm[0]} Ã— {size_mm[1]} Ã— {size_mm[2]} mm")
    print("Artifacts in:", OUT_DIR)


if __name__ == "__main__":
    main()