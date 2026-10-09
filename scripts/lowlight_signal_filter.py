"""Development-only noise-gate probe on brightness-enhanced difference signals."""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json, write_json
from detect import detect
from evaluate import evaluate


def filtered_motion(raw, threshold, mode):
    active = raw > threshold
    if 'temporal' in mode:
        previous = np.concatenate([active[:1], active[:-1]])
        following = np.concatenate([active[1:], active[-1:]])
        active &= previous | following
    if 'spatial' in mode:
        kernel = np.ones((3, 3), np.uint8)
        active = np.asarray([cv2.morphologyEx(frame.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool) for frame in active])
    return np.where(active, raw, 0).astype(np.uint8)


def run(run_id, variant):
    if '-dev-' not in run_id:
        raise SystemExit('Noise-gate probes are limited to development runs.')
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    registration = read_json(ROOT / 'config/registration.json')
    settings = read_json(ROOT / 'config/settings-swarm.json')
    settings.update(motion_threshold=10, pixel_threshold=14)
    root = ROOT / 'artifacts/probes' / run_id / f'{variant}-signal-filter'
    root.mkdir(parents=True, exist_ok=True)
    write_json(root / 'settings.json', settings)
    results = {}
    for mode in ('temporal', 'spatial', 'temporal-spatial'):
        results[mode] = {}
        for view in (0, 1):
            source = ROOT / 'artifacts/probes' / run_id / f'view-{view}' / variant / 'signals/signals.npz'
            if not source.is_file():
                raise SystemExit(f'Missing enhanced development signals: {source}')
            with np.load(source, allow_pickle=False) as saved:
                arrays = {name: saved[name] for name in saved.files}
            arrays['motion'] = filtered_motion(arrays['motion'], settings['motion_threshold'], mode)
            folder = root / mode / f'view-{view}'
            folder.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(folder / 'signals.npz', **arrays)
            calibration = ROOT / 'artifacts/public' / run_id / f'calibration-{view}.json'
            prediction = detect(folder / 'signals.npz', calibration, root / 'settings.json', folder / 'detection')
            score = evaluate(prediction, truth, registration)['methods']['full']
            results[mode][str(view)] = {'matched': score['tp'], 'extra': score['fp'], 'missed': score['fn']}
        print(mode, results[mode], flush=True)
    write_json(root / 'summary.json', {'development_run': run_id, 'variant': variant, 'settings': settings, 'results': results, 'note': 'Exploratory filtering on one development seed; not registered accuracy.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='A-swarm-night-dev-601')
    parser.add_argument('--variant', default='gain4')
    args = parser.parse_args()
    run(args.run, args.variant)
