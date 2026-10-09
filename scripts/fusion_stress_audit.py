"""Exploratory post-hoc paired/single-view audit on already reported stress runs."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json
from evaluate import evaluate
from fuse import fuse
from pin_fuse import group_pins

cfg = read_json(ROOT / 'config/fusion-registration.json')
registration = read_json(ROOT / 'config/registration.json')
totals = {name: {'tp': 0, 'fp': 0, 'fn': 0} for name in ('paired', 'single')}
for seed in (607, 613, 617, 619, 631):
    run_id = f'A-swarm-stress-{seed}'
    public = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    fused = fuse(read_json(public / 'view-0/detection/predictions.json'), read_json(public / 'view-1/detection/predictions.json'), cfg)['methods']['fusion']
    for name in ('paired', 'single'):
        selected = [pin for pin in fused if (len(pin['source_views']) == 2) == (name == 'paired')]
        score = evaluate({'methods': {name: selected}}, truth, registration)['methods'][name]
        for key in totals[name]:
            totals[name][key] += score[key]
print(totals)
pin_settings = read_json(ROOT / 'config/pin-settings.json')
pin_totals = {'tp': 0, 'fp': 0, 'fn': 0, 'two_camera': 0, 'single_camera': 0}
for seed in (607, 613, 617, 619, 631):
    run_id = f'A-swarm-stress-{seed}'
    public = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    pins = group_pins(read_json(public / 'view-0/detection/predictions.json'), read_json(public / 'view-1/detection/predictions.json'), pin_settings)
    result = evaluate(pins, truth, registration)['methods']['pins']
    for key in ('tp', 'fp', 'fn'):
        pin_totals[key] += result[key]
    for pin in pins['methods']['pins']:
        pin_totals[pin['evidence_tier']] += 1
    print(run_id, result['tp'], result['fp'], result['fn'], len(pins['suppressed_nearby_candidates']))
print(pin_totals)
