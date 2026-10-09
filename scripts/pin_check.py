"""Focused checks for distinct-site pin grouping and evidence tiers."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json
from pin_fuse import group_pins


def candidate(x, z, start, end, score=.7):
    return {'id': 'candidate', 'point': [x, z], 'interval': [start, end], 'score': score,
            'radius_m': .9, 'area_m2': 2.544690049, 'evidence': {}}


cfg = read_json(ROOT / 'config/pin-settings.json')
first = {'methods': {'full': [candidate(0, 0, 10, 16), candidate(1.6, 0, 11, 17, .55), candidate(4, 0, 12, 18)]}}
second = {'methods': {'full': [candidate(.4, 0, 11, 16), candidate(4.3, 0, 13, 18), candidate(8, 0, 20, 25)]}}
result = group_pins(first, second, cfg)
pins = result['methods']['pins']
assert len(pins) == 3, pins
assert [p['evidence_tier'] for p in pins] == ['two_camera', 'two_camera', 'single_camera']
assert len(result['suppressed_nearby_candidates']) == 1
assert any(abs(p['point'][0] - .2) < 1e-9 for p in pins)
assert all(p['radius_m'] == .9 for p in pins)

separate_times = group_pins({'methods': {'full': [candidate(0, 0, 1, 3), candidate(.5, 0, 8, 10)]}}, {'methods': {'full': []}}, cfg)
assert len(separate_times['methods']['pins']) == 2
print('Pin grouping checks passed.')
