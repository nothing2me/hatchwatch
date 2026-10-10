"""Preview renderer for the HatchWatch housing STLs -> PNG.

Minimal dependency (numpy + cv2 are already in the dev venv): parses an ASCII
STL, fits it to a unit box, projects an isometric view, shades per-triangle by
normal dot light, sorts by depth (painter) and writes a PNG.

Usage: python scripts/preview_stl.py <input.stl> <output.png> [--color RRGGBB]
"""

import argparse
import math
import re
from pathlib import Path

import cv2
import numpy as np

VERTEX = re.compile(r"vertex\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)")


def load_ascii_stl(path):
    facets = []
    current = []
    for line in Path(path).read_text(encoding="ascii").splitlines():
        if line.strip().startswith(("facet", "outer", "endloop", "endsolid", "solid")):
            continue
        match = VERTEX.search(line)
        if match:
            current.append(np.array([float(match[1]), float(match[2]), float(match[3])]))
            if len(current) == 3:
                facets.append(np.stack(current))
                current = []
    if current:
        facets.append(np.stack(current))
    return np.stack(facets)


def rotation(yaw_deg, pitch_deg):
    yaw = np.deg2rad(yaw_deg)
    pitch = np.deg2rad(pitch_deg)
    ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
    return rx @ ry


def render(facets, size=960, color=(232, 230, 223), background=(13, 23, 30)):
    rot = rotation(35, 24)
    facets = facets @ rot.T
    center = facets.reshape(-1, 3).mean(axis=0)
    facets = facets - center
    extent = np.abs(facets).max()
    facets = facets / (extent * 1.35)
    light = np.array([0.5, 0.7, 0.9])
    light = light / np.linalg.norm(light)
    scale = size * 0.86

    tris, depths = [], []
    for tri in facets:
        normal = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        norm = np.linalg.norm(normal)
        if norm == 0:
            continue
        normal = normal / norm
        shade = 0.28 + 0.72 * max(0.0, float(normal @ light))
        r, g, b = color
        tris.append([(int(size / 2 + tri[i][0] * scale), int(size / 2 - tri[i][1] * scale)) for i in range(3)])
        depths.append((tri[0][2] + tri[1][2] + tri[2][2]) / 3)
        tris[-1] = (tris[-1], (int(r * shade), int(g * shade), int(b * shade)))

    order = np.argsort(depths)[::-1]  # far to near
    canvas = np.full((size, size, 3), background, dtype=np.uint8)
    for idx in order:
        poly, fill = tris[idx]
        pts = np.array([poly], dtype=np.int32)
        cv2.fillConvexPoly(canvas, pts, fill)
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stl")
    parser.add_argument("out")
    parser.add_argument("--color", default="E8E6DF")
    args = parser.parse_args()
    color_hex = args.color.lstrip("#")
    color = tuple(int(color_hex[i:i + 2], 16) for i in (4, 2, 0))
    facets = load_ascii_stl(args.stl)
    canvas = render(facets, color=color)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(args.out, canvas)
    print(f"{Path(args.out).name}: {len(facets)} triangles -> {args.out}")


if __name__ == "__main__":
    main()