"""Development-only threshold sweep on enhanced video-derived signals.

Never use registered validation/test seeds here. This ranks settings for a
future frozen experiment; it does not establish nighttime accuracy.
"""
import argparse
import itertools
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json, write_json
from detect import detect
from evaluate import evaluate


def run(run_id, variant):
    if '-dev-' not in run_id:
        raise SystemExit('Threshold sweeps are limited to development recordings.')
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    registration = read_json(ROOT / 'config/registration.json')
    base = read_json(ROOT / 'config/settings-swarm.json')
    rows = []
    for motion_threshold, pixel_threshold in itertools.product((7, 10, 14, 18, 22, 28, 36), (14, 22, 30, 40)):
        cfg = dict(base, motion_threshold=motion_threshold, pixel_threshold=pixel_threshold)
        row = {'motion_threshold': motion_threshold, 'pixel_threshold': pixel_threshold, 'views': {}}
        with tempfile.TemporaryDirectory(prefix='nesttrace-lowlight-grid-') as temp:
            work = Path(temp)
            settings = work / 'settings.json'
            write_json(settings, cfg)
            for view in (0, 1):
                signals = ROOT / 'artifacts/probes' / run_id / f'view-{view}' / variant / 'signals/signals.npz'
                if not signals.is_file():
                    raise SystemExit(f'Missing enhanced development signals: {signals}')
                calibration = ROOT / 'artifacts/public' / run_id / f'calibration-{view}.json'
                prediction = detect(signals, calibration, settings, work / f'view-{view}')
                result = evaluate(prediction, truth, registration)['methods']['full']
                row['views'][str(view)] = {'tp': result['tp'], 'fp': result['fp'], 'fn': result['fn'], 'error_m': sum(result['localization_errors_m']) / len(result['localization_errors_m']) if result['tp'] else None}
        row['tp'] = sum(v['tp'] for v in row['views'].values())
        row['fp'] = sum(v['fp'] for v in row['views'].values())
        rows.append(row)
    rows.sort(key=lambda row: (-row['tp'], row['fp'], row['motion_threshold'], row['pixel_threshold']))
    output = ROOT / 'artifacts/probes' / run_id / f'{variant}-threshold-grid.json'
    write_json(output, {'development_run': run_id, 'variant': variant, 'note': 'Exploratory parameter search; fresh reserved seeds are required for validation.', 'rows': rows})
    print(json.dumps(rows[:10], indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='A-swarm-night-dev-601')
    parser.add_argument('--variant', default='gain4')
    args = parser.parse_args()
    run(args.run, args.variant)
