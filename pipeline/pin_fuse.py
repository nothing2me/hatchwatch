"""Blind two-camera site-pin grouping with explicit evidence tiers.

Inputs are public, calibrated camera predictions only. A pin marks an
inspection region for digging activity, never a confirmed egg or nest.
"""
import argparse
import math

from common import read_json, write_json, sha
from fuse import fuse


def overlap(a, b):
    return min(a['interval'][1], b['interval'][1]) - max(a['interval'][0], b['interval'][0])


def group_pins(first, second, registration):
    combined = fuse(first, second, registration)['methods']['fusion']
    paired = sorted((p for p in combined if len(p['source_views']) == 2), key=lambda p: -p['score'])
    single = sorted((p for p in combined if len(p['source_views']) == 1), key=lambda p: -p['score'])
    pins = []
    suppressed = []
    for candidate in paired + single:
        nearby = next((pin for pin in pins if math.dist(pin['point'], candidate['point']) <= registration['same_site_distance_m'] and overlap(pin, candidate) >= registration['same_site_overlap_seconds']), None)
        if nearby:
            suppressed.append({'candidate_id': candidate['id'], 'kept_pin_id': nearby['id'], 'distance_m': math.dist(nearby['point'], candidate['point'])})
            continue
        pin = dict(candidate)
        pin['id'] = f'pin-{len(pins)+1}'
        pin['evidence_tier'] = 'two_camera' if len(pin['source_views']) == 2 else 'single_camera'
        pin['label'] = 'Digging activity pin; nesting unresolved.'
        pin['confidence_note'] = 'Both camera detections agree within the registered distance and time window.' if len(pin['source_views']) == 2 else 'Only one camera supplied a detection; review source video before inspection.'
        pins.append(pin)
    return {'schema_version': 1, 'methods': {'pins': pins}, 'suppressed_nearby_candidates': suppressed, 'status': 'Digging activity pins for review; nesting unresolved.' if pins else 'No site pin detected.', 'input_contract': 'Two public camera prediction JSON files and fixed registration only; no RGB, simulator state, eggs, or truth.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--camera-0', required=True)
    parser.add_argument('--camera-1', required=True)
    parser.add_argument('--registration', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = group_pins(read_json(args.camera_0), read_json(args.camera_1), read_json(args.registration))
    result['registration_sha256'] = sha(args.registration)
    result['camera_prediction_sha256'] = [sha(args.camera_0), sha(args.camera_1)]
    write_json(args.output, result)
