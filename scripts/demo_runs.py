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
    {'id': 'A-swarm-demo-901', 'scenario': 'swarm', 'seed': 901},
    {'id': 'A-swarm-demo-907', 'scenario': 'swarm', 'seed': 907},
    {'id': 'A-swarm-demo-911', 'scenario': 'swarm', 'seed': 911},
    {'id': 'A-swarm-night-demo-919', 'scenario': 'swarm-night', 'seed': 919},
    {'id': 'A-seaward-humans-demo-929', 'scenario': 'swarm', 'seed': 929, 'layout': 'seaward', 'humans': 2},
    {'id': 'A-seaward-humans-demo-937', 'scenario': 'swarm', 'seed': 937, 'layout': 'seaward', 'humans': 2},
    {'id': 'A-seaward-demo-941', 'scenario': 'swarm', 'seed': 941, 'layout': 'seaward', 'humans': 0},
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
    clash = sorted({run['seed'] for run in DEMO_RUNS} & registered_seeds(config_dir))
    if clash:
        raise SystemExit(f'Demo seeds already registered: {clash}')


BASE_OUTPUTS = ['camera-0.mp4', 'camera-1.mp4', 'calibration-0.json', 'calibration-1.json', 'timestamps.json',
              'analysis.json', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4', 'pins/predictions.json']
EXTRA_OUTPUTS = ['tracks/tracks.json', 'people/people.json']


def _has(run_id, names):
    public = ROOT / 'artifacts/public' / run_id
    return all((public / name).is_file() for name in names)


def base_complete(run_id):
    return _has(run_id, BASE_OUTPUTS)


def complete(run_id):
    return _has(run_id, BASE_OUTPUTS + EXTRA_OUTPUTS)


def add_trails_and_people(run_id):
    for script in ('track_paths.py', 'people_detect.py'):
        subprocess.run([sys.executable, f'scripts/{script}', str(ROOT / 'artifacts/public' / run_id)], cwd=ROOT, check=True)


def run_one(run_id, scenario, seed, layout='along', humans=0):
    public = ROOT / 'artifacts/public' / run_id
    subprocess.run(['node', 'scripts/record.mjs', '--seed', str(seed), '--scenario', scenario, '--model', 'A', '--layout', layout, '--humans', str(humans), '--id', run_id], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'scripts/analyze.py', run_id, '--both', '--settings', 'config/settings-swarm.json'], cwd=ROOT, check=True)
    (public / 'pins').mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, 'pipeline/pin_fuse.py',
                    '--camera-0', str(public / 'view-0/detection/predictions.json'),
                    '--camera-1', str(public / 'view-1/detection/predictions.json'),
                    '--registration', 'config/pin-settings.json',
                    '--output', str(public / 'pins/predictions.json')], cwd=ROOT, check=True)
    add_trails_and_people(run_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Run id to (re)record')
    parser.add_argument('--force', action='store_true', help='Re-record even if complete')
    args = parser.parse_args()
    check_seeds(ROOT / 'config')
    for run in DEMO_RUNS:
        run_id = run['id']
        if args.only and run_id != args.only:
            continue
        if complete(run_id) and not args.force:
            print(f'{run_id}: complete, skipping', flush=True)
            continue
        if base_complete(run_id) and not args.force:
            print(f'{run_id}: adding trails and people', flush=True)
            add_trails_and_people(run_id)
        else:
            print(f'{run_id}: recording {run["scenario"]} seed {run["seed"]}', flush=True)
            run_one(run_id, run['scenario'], run['seed'], run.get('layout', 'along'), run.get('humans', 0))
        pins = json.loads((ROOT / 'artifacts/public' / run_id / 'pins/predictions.json').read_text())['methods']['pins']
        print(f'{run_id}: {len(pins)} pins', flush=True)


if __name__ == '__main__':
    main()
