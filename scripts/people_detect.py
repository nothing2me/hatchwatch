"""Blind people detector: a calibrated height rule on moving blobs in public camera video.

Reads only camera-N.mp4, calibration-N.json and timestamps.json from a run's public
folder. Writes people/people.json. Separate from the digging detector (pipeline/*):
nothing is imported from it and nothing here feeds it. Assumes two frame-synchronised
cameras (camera-0/1, one shared timestamps.json); a person track must be confirmed by both
views or, where only one camera covers it, by dense single-view hits.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

BACKGROUND_FRAMES = 16   # per-pixel median of the first 2 s at 8 fps
DIFF_THRESHOLD = 25      # grey-level absolute difference (background and recent motion)
MOTION_GAP_FRAMES = 2    # recent motion: difference from the frame this many frames earlier ...
MOTION_DILATE_PX = 25    # ... dilated by this much; static trails and dug pits drop out
OPEN_PX = 3              # morphology kernels (pixel sizes are at 720 px image height)
CLOSE_PX = 7
SPLIT_OPEN_PX = 5        # stronger opening that splits a tall-but-wide blob (person touching a turtle)
MIN_AREA_PX = 150        # smallest blob kept, at 1280x720
PERSON_HEIGHT_M = 1.2    # person = moving blob at least this tall above its ground contact
MIN_ASPECT = 1.5         # ... and at least this many times taller than its ground width (turtles are wide)
FOOT_REF_FRACTION = 0.5  # top share of a person blob that sets its reference width
FOOT_WIDEN = 3.0         # a lower row this many times wider ends the person (turtle in front)
FUSE_M = 1.0             # same-frame detections from two views closer than this are merged
LINK_M = 1.5             # max step between linked detections
MAX_GAP_FRAMES = 4
ABSORB_M = 2.0           # an unmatched detection this close to a track updated in the same frame is dropped
STITCH_OVERLAP_M = 2.0   # merge overlapping tracks whose mean separation over the overlap is at most this
STITCH_GAP_S = 2.5       # merge a track into one starting at most this long after it ends ...
STITCH_BASE_M = 1.5      # ... when its extrapolated end lands within STITCH_BASE_M + STITCH_PER_S * gap
STITCH_PER_S = 1.0
STITCH_VELOCITY_S = 1.0  # velocity for extrapolation: over the track's last second
MIN_BOTH_VIEW_FRAMES = 2    # keep a track with this many frames where both cameras agree (within FUSE_M) ...
SINGLE_VIEW_MIN_HITS = 6    # ... or, single-camera coverage: at least this many hits
SINGLE_VIEW_MIN_DENSITY = 0.5  # ... filling at least this share of the frames the track spans
MIN_DURATION_S = 1.0
DECIMATE_HZ = 4.0
NOTE = ('Blind height-rule detections from public video; not identity, not intent. '
        'Very dark or low-contrast video is not supported; people may be missed.')
REQUIRED_CALIBRATION = ('width', 'height', 'mount_position_m', 'orientation_quaternion_xyzw',
                        'vertical_fov_degrees', 'reference_points')


def _rotate(q, v):
    x, y, z, w = q
    u = np.array([x, y, z], float)
    v = np.asarray(v, float)
    return v + 2 * w * np.cross(u, v) + 2 * np.cross(u, np.cross(u, v))


def pixel_ray(calibration, u, v):
    """World-space ray (origin, unit direction) through pixel (u, v); three.js camera conventions."""
    w, h = calibration['width'], calibration['height']
    t = np.tan(np.radians(calibration['vertical_fov_degrees']) / 2)
    nx, ny = 2 * u / w - 1, 1 - 2 * v / h
    d = np.array([nx * t * w / h, ny * t, -1.0])
    d = _rotate(calibration['orientation_quaternion_xyzw'], d / np.linalg.norm(d))
    return np.asarray(calibration['mount_position_m'], float), d / np.linalg.norm(d)


_HOMOGRAPHIES = {}


def _homography(calibration):
    """Pixel -> ground (x, z) homography fitted to the calibration's reference points."""
    refs = calibration['reference_points']
    key = tuple((*r['pixel'], *r['world']) for r in refs)
    if key not in _HOMOGRAPHIES:
        src = np.array([r['pixel'] for r in refs], np.float64)
        dst = np.array([r['world'] for r in refs], np.float64)
        _HOMOGRAPHIES[key] = cv2.findHomography(src, dst)[0]
    return _HOMOGRAPHIES[key]


def _ground(calibration, u, v):
    p = _homography(calibration) @ np.array([u, v, 1.0])
    return float(p[0] / p[2]), float(p[1] / p[2])


def blob_height(calibration, foot_uv, top_uv):
    """Ground contact (x, z) of the foot pixel and the height of the top pixel above it, in metres."""
    x, z = _ground(calibration, *foot_uv)

    def y_at(uv):
        c, d = pixel_ray(calibration, *uv)
        s = ((x - c[0]) * d[0] + (z - c[2]) * d[2]) / (d[0] ** 2 + d[2] ** 2)
        return c[1] + s * d[1]

    return (x, z), float(y_at(top_uv) - y_at(foot_uv))


def _own_foot(crop):
    """(foot row, centre column) of the upright part of a blob, both relative to its bounding box.

    The upper part of the blob (head and torso) sets a reference width; going down, the first
    row that is FOOT_WIDEN times wider marks something else in front (a turtle), and the
    person's foot is taken just above it. Returns (height, centre) when nothing widens.
    """
    rows = [np.flatnonzero(r) for r in crop]
    ext = np.array([(r[-1] - r[0] + 1) if len(r) else 0 for r in rows], float)
    upper = max(1, int(len(rows) * FOOT_REF_FRACTION))
    ref = float(np.median(ext[:upper][ext[:upper] > 0])) if np.any(ext[:upper] > 0) else 0.0
    mids = [(r[0] + r[-1]) / 2.0 for r in rows[:upper] if len(r)]
    col = float(np.median(mids)) + 0.5 if mids else crop.shape[1] / 2.0
    if ref <= 0:
        return crop.shape[0], col
    for i in range(upper, len(rows)):
        if ext[i] > FOOT_WIDEN * ref:
            return i, col
    return crop.shape[0], col


def _frame_blobs(calibration, frames):
    """Yield (frame index, frame, blobs); blob = (left, top, w, h, x, z, height_m, is_person)."""
    h = calibration['height']
    scale = h / 720.0
    k_open = max(1, int(round(OPEN_PX * scale)))
    k_close = max(1, int(round(CLOSE_PX * scale)))
    k_motion = max(1, int(round(MOTION_DILATE_PX * scale)))
    min_area = max(4, MIN_AREA_PX * scale * scale)
    k_split = max(1, int(round(SPLIT_OPEN_PX * scale)))
    x0, x1, z0, z1 = calibration.get('ground_bounds', [-12, 12, -8, 8])

    def measure(left, top, bw, bh, crop):
        cx = left + bw / 2.0
        (gx, gz), hm = blob_height(calibration, (cx, top + bh), (cx, top))
        wm = float(np.hypot(*np.subtract(_ground(calibration, left, top + bh),
                                         _ground(calibration, left + bw, top + bh))))
        person = (hm >= PERSON_HEIGHT_M and hm >= MIN_ASPECT * wm
                  and x0 <= gx <= x1 and z0 <= gz <= z1)
        if person:
            # a person standing behind a turtle: the blob's bottom is the turtle's, not the feet
            foot_row, col = _own_foot(crop)
            if foot_row < bh:
                cx = left + col
                (gx, gz), hm = blob_height(calibration, (cx, top + foot_row), (cx, top))
                person = hm >= PERSON_HEIGHT_M and x0 <= gx <= x1 and z0 <= gz <= z1
        return (left, top, bw, bh, gx, gz, hm, person)

    head, background, recent = [], None, []
    for idx, frame in enumerate(frames):
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        if background is None:
            head.append((frame, g))
            if len(head) < BACKGROUND_FRAMES:
                continue
            background = np.median(np.stack([hg for _, hg in head]), axis=0).astype(np.uint8)
            pending = [(i, f, hg) for i, (f, hg) in enumerate(head)]
        else:
            pending = [(idx, frame, g)]
        for i, f, grey in pending:
            recent = (recent + [grey])[-(MOTION_GAP_FRAMES + 1):]
            if len(recent) <= MOTION_GAP_FRAMES:
                yield i, f, []
                continue
            moving = (cv2.absdiff(grey, recent[0]) > DIFF_THRESHOLD).astype(np.uint8)
            if k_motion > 1:
                moving = cv2.dilate(moving, np.ones((k_motion, k_motion), np.uint8))
            raw = (cv2.absdiff(grey, background) > DIFF_THRESHOLD).astype(np.uint8) & moving
            mask = raw
            if k_open > 1:
                mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k_open, k_open), np.uint8))
            if k_close > 1:
                mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k_close, k_close), np.uint8))
            n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
            blobs = []
            for c in range(1, n):
                left, top, bw, bh, area = (int(v) for v in stats[c])
                if area < min_area:
                    continue
                blob = measure(left, top, bw, bh, labels[top:top + bh, left:left + bw] == c)
                if blob[-1] or blob[6] < PERSON_HEIGHT_M or k_split <= k_open:
                    blobs.append(blob)
                    continue
                # tall but too wide: maybe a person touching a turtle; split with a stronger opening
                sub = raw[top:top + bh, left:left + bw] & (labels[top:top + bh, left:left + bw] == c)
                sub = cv2.morphologyEx(sub.astype(np.uint8), cv2.MORPH_OPEN, np.ones((k_split, k_split), np.uint8))
                m, slabels, sstats, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
                parts = [measure(left + int(sl), top + int(st), int(sw), int(sh),
                                 slabels[st:st + sh, sl:sl + sw] == j)
                         for j, (sl, st, sw, sh, sa) in enumerate(sstats) if j and sa >= min_area]
                blobs.extend(parts if any(b[-1] for b in parts) else [blob])
            yield i, f, blobs


def _view_detections(calibration, frames):
    """Per-frame list of (x, z, height) for person blobs in one view."""
    out = []
    for i, _, blobs in _frame_blobs(calibration, frames):
        while len(out) < i:
            out.append([])
        out.append([(b[4], b[5], b[6]) for b in blobs if b[7]])
    return out


def _fuse(per_view):
    """Per frame: [x, z, height, both] where both = 1 when the two views agree within FUSE_M."""
    fused = []
    for t in range(max(len(v) for v in per_view)):
        pts = [(np.array([*d, 0.0], float), vi) for vi, view in enumerate(per_view) if t < len(view) for d in view[t]]
        used = [False] * len(pts)
        frame = []
        for i, (p, v) in enumerate(pts):
            if used[i]:
                continue
            used[i] = True
            best, bd = None, FUSE_M
            for j, (q, u) in enumerate(pts):
                if not used[j] and u != v:
                    dist = float(np.hypot(*(p[:2] - q[:2])))
                    if dist <= bd:
                        best, bd = j, dist
            if best is not None:
                used[best] = True
                q = pts[best][0]
                p = np.array([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, max(p[2], q[2]), 1.0])
            frame.append(p)
        fused.append(frame)
    return fused


def _link(frames, times):
    tracks = []  # {'pts': [(frame, x, z, height, both)]}
    for t, dets in enumerate(frames):
        open_tracks = [tr for tr in tracks if 0 < t - tr['pts'][-1][0] <= MAX_GAP_FRAMES + 1]
        pairs = []
        for ti, tr in enumerate(open_tracks):
            lp = np.array(tr['pts'][-1][1:3])
            for di, d in enumerate(dets):
                dist = float(np.hypot(*(lp - d[:2])))
                if dist <= LINK_M:
                    pairs.append((dist, ti, di))
        pairs.sort()
        used_t, used_d = set(), set()
        for _, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            d = dets[di]
            open_tracks[ti]['pts'].append((t, *map(float, d[:4])))
        updated = [np.array(open_tracks[ti]['pts'][-1][1:3]) for ti in used_t]
        for di, d in enumerate(dets):
            if di in used_d:
                continue
            # the other view's off-position foot for a person already tracked: absorb, don't spawn
            if any(float(np.hypot(*(u - d[:2]))) <= ABSORB_M for u in updated):
                continue
            tracks.append({'pts': [(t, *map(float, d[:4]))]})
    return [tr['pts'] for tr in tracks]


def _confirmed(track):
    """Cross-view agreement, or dense hits where only one camera covers the person."""
    if sum(1 for p in track if p[4]) >= MIN_BOTH_VIEW_FRAMES:
        return True
    span = track[-1][0] - track[0][0] + 1
    return len(track) >= SINGLE_VIEW_MIN_HITS and len(track) / span >= SINGLE_VIEW_MIN_DENSITY


def _xz_at(track, t):
    ts = [p[0] for p in track]
    return np.array([np.interp(t, ts, [p[1] for p in track]), np.interp(t, ts, [p[2] for p in track])])


def _line_fit(points, t):
    """Least-squares position at time t and velocity over points; robust to a single foot jump."""
    ts = np.array([q[0] for q in points])
    xz = np.array([q[1:3] for q in points], float)
    if len(points) < 2 or np.ptp(ts) == 0:
        return xz.mean(axis=0), np.zeros(2)
    A = np.column_stack([ts - t, np.ones_like(ts)])
    (v, pos), *_ = np.linalg.lstsq(A, xz, rcond=None)
    return pos, v


def _should_stitch(a, b):
    """a starts no later than b; points are (t, x, z, height)."""
    a0, a1, b0, b1 = a[0][0], a[-1][0], b[0][0], b[-1][0]
    if b0 <= a1:  # overlapping spans
        ts = [p[0] for p in b if p[0] <= a1] + [p[0] for p in a if p[0] >= b0]
        sep = [float(np.linalg.norm(_xz_at(a, t) - _xz_at(b, t))) for t in ts]
        return bool(sep) and float(np.mean(sep)) <= STITCH_OVERLAP_M
    gap = b0 - a1
    if gap > STITCH_GAP_S:
        return False
    end, v = _line_fit([q for q in a if q[0] >= a1 - STITCH_VELOCITY_S], a1)
    start, _ = _line_fit([q for q in b if q[0] <= b0 + STITCH_VELOCITY_S], b0)
    return float(np.linalg.norm(end + v * gap - start)) <= STITCH_BASE_M + STITCH_PER_S * gap


def _merge(a, b):
    by_t = {}
    for p in a + b:
        q = by_t.get(p[0])
        by_t[p[0]] = p if q is None else (p[0], (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, max(p[3], q[3]))
    return [by_t[t] for t in sorted(by_t)]


def _stitch(tracks):
    """Merge fragments of one person: overlapping close tracks, or a short gap bridged by extrapolation."""
    tracks = sorted(tracks, key=lambda tr: tr[0][0])
    merged = True
    while merged:
        merged = False
        for i in range(len(tracks)):
            for j in range(i + 1, len(tracks)):
                if _should_stitch(tracks[i], tracks[j]):
                    tracks[i] = _merge(tracks[i], tracks[j])
                    del tracks[j]
                    merged = True
                    break
            if merged:
                break
    return tracks


def _people_tracks(per_view, times):
    """Kept person tracks as [(t, x, z, height)], sorted by start time."""
    kept = []
    for tr in _link(_fuse(per_view), times):
        if len(tr) < 2 or times[tr[-1][0]] - times[tr[0][0]] < MIN_DURATION_S or not _confirmed(tr):
            continue
        kept.append([(times[f], x, z, hm) for f, x, z, hm, _ in tr])
    return _stitch(kept)


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


def _check_calibration(cal):
    missing = [k for k in REQUIRED_CALIBRATION if k not in cal]
    if missing:
        raise SystemExit(f'calibration for camera {cal.get("camera", "?")} lacks {", ".join(missing)}')
    if len(cal['reference_points']) < 4:
        raise SystemExit(f'calibration for camera {cal.get("camera", "?")} needs at least 4 reference_points')


def detect_in_frames(views, times):
    """views: [(calibration, iterable of BGR or grey frames)]; times: seconds per frame."""
    for cal, _ in views:
        _check_calibration(cal)
    per_view = [_view_detections(cal, frames) for cal, frames in views]
    kept = _people_tracks(per_view, list(times))
    people = [{'id': f'person-{n + 1}',
               'points': _decimate([(t, x, z) for t, x, z, _ in tr]),
               'max_height_m': round(float(max(hm for *_, hm in tr)), 2)}
              for n, tr in enumerate(kept)]
    return {'schema': 'hatchwatch.people', 'version': 1, 'people': people, 'note': NOTE}


def _video_frames(path):
    cap = cv2.VideoCapture(str(path))
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            yield frame
    finally:
        cap.release()


def _refuse_private(run_dir):
    if 'private' in Path(run_dir).resolve().parts or 'private' in Path(run_dir).parts:
        raise SystemExit(f'refusing private run directory: {run_dir}')


def detect_people(run_dir):
    _refuse_private(run_dir)
    run_dir = Path(run_dir)
    views = []
    for v in range(2):
        video, calf = run_dir / f'camera-{v}.mp4', run_dir / f'calibration-{v}.json'
        if video.exists() and calf.exists():
            views.append((json.loads(calf.read_text()), _video_frames(video)))
    if not views:
        raise SystemExit(f'no camera-N.mp4 with calibration-N.json under {run_dir}')
    times = json.loads((run_dir / 'timestamps.json').read_text())
    return detect_in_frames(views, times)


def run(run_dir):
    doc = detect_people(run_dir)
    out = Path(run_dir) / 'people' / 'people.json'
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
    print(f"{len(doc['people'])} people")


if __name__ == '__main__':
    main()
