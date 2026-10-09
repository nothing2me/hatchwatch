"""Post-hoc audit of old, already reported stress runs; never a validation gate."""
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json


for seed in (607, 613, 617, 619, 631):
    run_id = f'A-swarm-stress-{seed}'
    public = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    print('seed', seed)
    for view in (0, 1):
        preds = read_json(public / f'view-{view}/detection/predictions.json')['methods']['full']
        for p in preds:
            distance, site = min(((math.dist(p['point'], s['point']), s) for s in truth['sites']), key=lambda item: item[0])
            overlap = min(p['interval'][1], site['interval'][1]) - max(p['interval'][0], site['interval'][0])
            ev = p['evidence']
            print(view, site['turtle_id'], 'true' if distance <= .9 and overlap >= 1 else 'extra',
                  'distance', round(distance, 2), 'score', round(p['score'], 3),
                  'activity', ev['activity'], 'persistent', ev['persistent'],
                  'dwell', ev['dwell'], 'continuous', ev['travel_continuity'])
