"""Exploratory pin behavior on historical no-nest and disturbance demonstrations."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json
from pin_fuse import group_pins

cfg = read_json(ROOT / 'config/pin-settings.json')
for index, scenario in enumerate(('travel', 'rest', 'abandoned', 'obstructed', 'weak', 'unrelated', 'no-eggs'), 401):
    run_id = f'A-{scenario}-{index}'
    public = ROOT / 'artifacts/public' / run_id
    if not (public / 'view-1/detection/predictions.json').is_file():
        print(run_id, 'missing camera predictions')
        continue
    first = read_json(public / 'view-0/detection/predictions.json')
    second = read_json(public / 'view-1/detection/predictions.json')
    pins = group_pins(first, second, cfg)['methods']['pins']
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    print(run_id, 'pins', len(pins), 'observable digging sites', len(truth['sites']), 'hidden eggs', len(truth['eggs']))
