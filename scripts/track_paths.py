"""Blind turtle trail tracks from a run's public ground-grid motion signals.

Reads only view-N/signals.npz, calibration-0.json, pins/predictions.json and
timestamps.json from a run's public folder. Writes tracks/tracks.json.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

MIN_CELLS = 4          # smallest motion component kept (grid cells)
FUSE_M = 1.0           # same-frame detections from two views closer than this are averaged
LINK_M = 1.2           # max step between linked detections
MAX_GAP_FRAMES = 4     # missing frames tolerated inside a track
MIN_DURATION_S = 3.0
UNMATCHED_MIN_INLAND_Y = -2.5  # unmatched trails must reach this y (drops surf/foam motion)
START_Y_MAX = -5.0     # a trail must begin near the water
PIN_MATCH_M = 2.0
PIN_PAD_S = 2.0
DECIMATE_HZ = 4.0
NOTE = 'Blind motion trail from public ground-grid signals; not a nesting claim.'


def _detections(motion, bounds, threshold):
    x0, x1, z0, z1 = bounds
    t_len, h, w = motion.shape
    out = []
    for t in range(t_len):
        mask = (motion[t] > threshold).astype(np.uint8)
        n, _, stats, cents = cv2.connectedComponentsWithStats(mask, connectivity=8)
        pts = []
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= MIN_CELLS:
                c, r = cents[i]
                pts.append((x0 + c * (x1 - x0) / (w - 1), z0 + r * (z1 - z0) / (h - 1)))
        out.append(pts)
    return out


def _fuse(per_view):
    fused = []
    for t in range(len(per_view[0])):
        pts = []
        for v, view in enumerate(per_view):
            for p in view[t]:
                pts.append((np.array(p, float), v))
        used = [False] * len(pts)
        frame = []
        for i, (p, v) in enumerate(pts):
            if used[i]:
                continue
            used[i] = True
            best, bd = None, FUSE_M
            for j, (q, u) in enumerate(pts):
                if not used[j] and u != v:
                    d = float(np.hypot(*(p - q)))
                    if d <= bd:
                        best, bd = j, d
            if best is not None:
                used[best] = True
                p = (p + pts[best][0]) / 2
            frame.append(p)
        fused.append(frame)
    return fused


def _link(frames, times):
    tracks = []  # each: {'pts': [(frame, x, y)]}
    for t, dets in enumerate(frames):
        open_tracks = [tr for tr in tracks if 0 < t - tr['pts'][-1][0] <= MAX_GAP_FRAMES + 1]
        pairs = []
        for ti, tr in enumerate(open_tracks):
            lp = np.array(tr['pts'][-1][1:])
            for di, d in enumerate(dets):
                dist = float(np.hypot(*(lp - d)))
                if dist <= LINK_M:
                    pairs.append((dist, ti, di))
        pairs.sort()
        used_t, used_d = set(), set()
        for dist, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            open_tracks[ti]['pts'].append((t, float(dets[di][0]), float(dets[di][1])))
        for di, d in enumerate(dets):
            if di not in used_d:
                tracks.append({'pts': [(t, float(d[0]), float(d[1]))]})
    return [[(times[f], x, y) for f, x, y in tr['pts']] for tr in tracks]


def _decimate(points):
    out, last = [], None
    for t, x, y in points:
        if last is None or t - last >= 1.0 / DECIMATE_HZ - 1e-9:
            out.append([round(t, 3), round(x, 3), round(y, 3)])
            last = t
    if points and out[-1][0] != round(points[-1][0], 3):
        t, x, y = points[-1]
        out.append([round(t, 3), round(x, 3), round(y, 3)])
    return out


def build_tracks(signals, calibration, pins, timestamps, motion_threshold):
    bounds = calibration.get('ground_bounds', [-12, 12, -8, 8])
    per_view = [_detections(np.asarray(s['motion']), bounds, motion_threshold) for s in signals]
    frames = _fuse(per_view)
    raw = _link(frames, list(timestamps))
    kept = [tr for tr in raw
            if len(tr) >= 2 and tr[-1][0] - tr[0][0] >= MIN_DURATION_S and tr[0][2] <= START_Y_MAX]
    kept.sort(key=lambda tr: tr[0][0])

    # best (distance, pin, track) pairs, each pin and track used once
    cands = []
    for pin in pins:
        t0, t1 = pin['interval']
        p = np.array(pin['point'], float)
        for ti, tr in enumerate(kept):
            ds = [float(np.hypot(x - p[0], y - p[1])) for t, x, y in tr
                  if t0 - PIN_PAD_S <= t <= t1 + PIN_PAD_S]
            if ds and min(ds) <= PIN_MATCH_M:
                cands.append((min(ds), pin['id'], ti))
    cands.sort()
    pin_of, used_pins = {}, set()
    for d, pid, ti in cands:
        if pid not in used_pins and ti not in pin_of:
            pin_of[ti] = pid
            used_pins.add(pid)

    keep = [i for i, tr in enumerate(kept)
            if i in pin_of or max(y for _, _, y in tr) >= UNMATCHED_MIN_INLAND_Y]
    tracks = [{'id': f'track-{n + 1}', 'pin_id': pin_of.get(i), 'points': _decimate(kept[i])}
              for n, i in enumerate(keep)]
    return {'schema': 'hatchwatch.tracks', 'version': 1, 'tracks': tracks, 'note': NOTE}


def _refuse_private(run_dir):
    if 'private' in Path(run_dir).resolve().parts or 'private' in Path(run_dir).parts:
        raise SystemExit(f'refusing private run directory: {run_dir}')


def run(run_dir, threshold=None):
    _refuse_private(run_dir)
    run_dir = Path(run_dir)
    if threshold is None:
        threshold = json.loads((ROOT / 'config' / 'settings-swarm.json').read_text())['motion_threshold']
    signals = []
    for view in ('view-0', 'view-1'):
        f = run_dir / view / 'signals.npz'
        if f.exists():
            with np.load(f) as z:
                signals.append({'motion': z['motion']})
    if not signals:
        raise SystemExit(f'no view-N/signals.npz under {run_dir}; run analysis first')
    cal = json.loads((run_dir / 'calibration-0.json').read_text())
    pf = run_dir / 'pins' / 'predictions.json'
    pins = json.loads(pf.read_text())['methods']['pins'] if pf.exists() else []
    times = json.loads((run_dir / 'timestamps.json').read_text())
    doc = build_tracks(signals, cal, pins, times, threshold)
    out = run_dir / 'tracks' / 'tracks.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + '.tmp')
    tmp.write_text(json.dumps(doc, indent=2))
    tmp.replace(out)  # atomic: watchers never see a half-written file
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_dir')
    args = ap.parse_args()
    doc = run(args.run_dir)
    matched = sum(1 for t in doc['tracks'] if t['pin_id'])
    print(f"{len(doc['tracks'])} tracks, {matched} matched to pins")


if __name__ == '__main__':
    main()
