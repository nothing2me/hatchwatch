"""Record, analyse and pin-group the four dashboard demo runs.

Uses fresh seeds that no registration file lists, writes only under
artifacts/public and artifacts/private, and never touches config/ or results/.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEMO_RUNS = [
    ('A-swarm-demo-901', 'swarm', 901),
    ('A-swarm-demo-907', 'swarm', 907),
    ('A-swarm-demo-911', 'swarm', 911),
    ('A-swarm-night-demo-919', 'swarm-night', 919),
]


def _ints(value):
    if isinstance(value, bool):
        return set()
    if isinstance(value, int):
        return {value}
    if isinstance(value, list):
        return set().union(*(_ints(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(_ints(item) for item in value.values())) if value else set()
    return set()


def _seed_values(node):
    found = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if 'seed' in key.lower() or key in ('splits',):
                found |= _ints(value)
            else:
                found |= _seed_values(value)
    elif isinstance(node, list):
        for item in node:
            found |= _seed_values(item)
    return found


def registered_seeds(config_dir):
    seeds = set()
    for path in Path(config_dir).glob('*registration*.json'):
        seeds |= _seed_values(json.loads(path.read_text()))
    return seeds


def check_seeds(config_dir):
    clash = sorted({seed for _, _, seed in DEMO_RUNS} & registered_seeds(config_dir))
    if clash:
        raise SystemExit(f'Demo seeds already registered: {clash}')


def complete(run_id):
    public = ROOT / 'artifacts/public' / run_id
    needed = ['camera-0.mp4', 'camera-1.mp4', 'calibration-0.json', 'calibration-1.json', 'timestamps.json',
              'analysis.json', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4', 'pins/predictions.json']
    return all((public / name).is_file() for name in needed)


def run_one(run_id, scenario, seed):
    public = ROOT / 'artifacts/public' / run_id
    subprocess.run(['node', 'scripts/record.mjs', '--seed', str(seed), '--scenario', scenario, '--model', 'A', '--id', run_id], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'scripts/analyze.py', run_id, '--both', '--settings', 'config/settings-swarm.json'], cwd=ROOT, check=True)
    (public / 'pins').mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, 'pipeline/pin_fuse.py',
                    '--camera-0', str(public / 'view-0/detection/predictions.json'),
                    '--camera-1', str(public / 'view-1/detection/predictions.json'),
                    '--registration', 'config/pin-settings.json',
                    '--output', str(public / 'pins/predictions.json')], cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Run id to (re)record')
    parser.add_argument('--force', action='store_true', help='Re-record even if complete')
    args = parser.parse_args()
    check_seeds(ROOT / 'config')
    for run_id, scenario, seed in DEMO_RUNS:
        if args.only and run_id != args.only:
            continue
        if complete(run_id) and not args.force:
            print(f'{run_id}: complete, skipping', flush=True)
            continue
        print(f'{run_id}: recording {scenario} seed {seed}', flush=True)
        run_one(run_id, scenario, seed)
        pins = json.loads((ROOT / 'artifacts/public' / run_id / 'pins/predictions.json').read_text())['methods']['pins']
        print(f'{run_id}: {len(pins)} pins', flush=True)


if __name__ == '__main__':
    main()
