"""Registered fresh-seed daylight evaluation of blind two-camera site pins."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
sys.path.insert(0, str(ROOT / 'scripts'))
from batch import summarize
from common import read_json, sha, write_json


def ready(run_id, settings_hash, pin_hash):
    public = ROOT / 'artifacts/public' / run_id
    private = ROOT / 'artifacts/private' / run_id
    required = [public / 'analysis.json', public / 'pins/predictions.json', private / 'pin-evaluation.json']
    if not all(path.is_file() for path in required):
        return False
    return (read_json(public / 'analysis.json')['settings_sha256'] == settings_hash
            and read_json(public / 'pins/predictions.json')['registration_sha256'] == pin_hash)


def run(reuse):
    plan = read_json(ROOT / 'config/pin-registration.json')
    for name, relative in plan['source_files'].items():
        if sha(ROOT / relative) != plan['source_sha256'][name]:
            raise SystemExit(f'{relative} changed after pin registration; use fresh seeds.')
    rows = []
    baseline = []
    run_ids = []
    for seed in plan['seeds']:
        run_id = f'A-swarm-pin-{seed}'
        run_ids.append(run_id)
        public = ROOT / 'artifacts/public' / run_id
        private = ROOT / 'artifacts/private' / run_id
        if not (reuse and ready(run_id, plan['source_sha256']['settings'], plan['source_sha256']['pin_settings'])):
            subprocess.run(['node', 'scripts/record.mjs', '--seed', str(seed), '--scenario', 'swarm', '--model', 'A', '--id', run_id], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'scripts/analyze.py', run_id, '--both', '--settings', 'config/settings-swarm.json'], cwd=ROOT, check=True)
            (public / 'pins').mkdir(parents=True, exist_ok=True)
            subprocess.run([sys.executable, 'pipeline/pin_fuse.py', '--camera-0', str(public / 'view-0/detection/predictions.json'), '--camera-1', str(public / 'view-1/detection/predictions.json'), '--registration', 'config/pin-settings.json', '--output', str(public / 'pins/predictions.json')], cwd=ROOT, check=True)
            subprocess.run([sys.executable, 'pipeline/evaluate.py', '--predictions', str(public / 'pins/predictions.json'), '--truth', str(private / 'truth.json'), '--registration', 'config/registration.json', '--output', str(private / 'pin-evaluation.json')], cwd=ROOT, check=True)
        row = read_json(private / 'pin-evaluation.json')
        rows.append(row)
        baseline.append(read_json(private / 'evaluation-1.json'))
        print(run_id, 'pins', row['methods']['pins']['tp'], 'extra', row['methods']['pins']['fp'], flush=True)
    rng = np.random.default_rng(91)
    samples = [summarize([rows[i] for i in rng.integers(0, len(rows), len(rows))], 'pins') for _ in range(2000)]
    intervals = {key: [float(x) for x in np.percentile([sample[key] for sample in samples], [2.5, 97.5])] for key in ('recall', 'false_alerts_per_run')}
    pins = summarize(rows, 'pins')
    report = {'protocol': plan['protocol'], 'run_ids': run_ids, 'pins': pins, 'camera_1_full': summarize(baseline, 'full'), 'gate_passed': pins['tp'] == 60 and pins['fp'] == 0, 'whole_run_bootstrap_95ci': intervals, 'rows': [{'id': id, 'pins': row['methods']['pins'], 'camera_1_full': base['methods']['full']} for id, row, base in zip(run_ids, rows, baseline)], 'source_sha256': plan['source_sha256'], 'note': 'Fresh synthetic daylight seeds; pin grouping was chosen after auditing earlier stress seeds. No nighttime or field claim.'}
    write_json(ROOT / 'artifacts/reports/pin-v4.json', report)
    print(json.dumps({'pins': pins, 'camera_1_full': report['camera_1_full'], 'gate_passed': report['gate_passed']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--reuse', action='store_true')
    args = parser.parse_args()
    run(args.reuse)
