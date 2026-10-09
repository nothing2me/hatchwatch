"""Post-hoc audit of cross-view evidence for single-camera stress candidates."""
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json
from fuse import fuse


def maps(run, view):
    with np.load(run / f'view-{view}/signals.npz', allow_pickle=False) as data:
        motion = data['motion']
        background = data['background']
        fps = 1 / np.median(np.diff(data['timestamps']))
    activity = cv2.GaussianBlur((motion > 7).mean(axis=0).astype(np.float32), (0, 0), 4)
    persistent = cv2.GaussianBlur((background[-round(4 * fps):] > 14).mean(axis=0).astype(np.float32), (0, 0), 3)
    return activity, persistent


def local_peak(image, point, bounds=(-12, 12, -8, 8), radius_m=.9):
    x0, x1, z0, z1 = bounds
    h, w = image.shape
    x = round((point[0] - x0) * (w - 1) / (x1 - x0))
    y = round((point[1] - z0) * (h - 1) / (z1 - z0))
    r = round(radius_m * w / (x1 - x0))
    window = image[max(0, y-r):min(h, y+r+1), max(0, x-r):min(w, x+r+1)]
    return float(window.max()) if window.size else 0.0


cfg = read_json(ROOT / 'config/fusion-registration.json')
for seed in (607, 613, 617, 619, 631):
    run_id = f'A-swarm-stress-{seed}'
    run = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    fused = fuse(read_json(run / 'view-0/detection/predictions.json'), read_json(run / 'view-1/detection/predictions.json'), cfg)['methods']['fusion']
    paired = [p for p in fused if len(p['source_views']) == 2]
    signals = {view: maps(run, view) for view in (0, 1)}
    print('seed', seed)
    for p in fused:
        if len(p['source_views']) != 1:
            continue
        view = p['source_views'][0]
        other = 1 - view
        distance = min(math.dist(p['point'], site['point']) for site in truth['sites'])
        nearest_pair = min((math.dist(p['point'], q['point']) for q in paired), default=99)
        activity, persistent = signals[other]
        print(view, 'true' if distance <= .9 else 'extra', 'd', round(distance, 2),
              'to_pair', round(nearest_pair, 2), 'own_score', round(p['score'], 3),
              'other_activity', round(local_peak(activity, p['point']), 3),
              'other_persistent', round(local_peak(persistent, p['point']), 3))
