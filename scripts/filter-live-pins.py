"""Live-demo quality gate using only public pin evidence and a public watch boundary.

This runs after blind two-camera fusion. It never reads simulator state or evaluator truth.
Registered experiment pin files are unaffected.
"""
import argparse
import json
import math
from pathlib import Path


def persistent_evidence(pin):
    evidence = pin.get('evidence', {})
    views = [value for key, value in evidence.items() if key.startswith('camera_') and isinstance(value, dict)]
    return min((view.get('persistent', 0) for view in views), default=evidence.get('persistent', 0))


def filter_pins(predictions, settings, cameras=None):
    keep = [pin for pin in predictions['methods']['pins']
            if pin['point'][1] >= settings['minimum_inland_z_m']
            and persistent_evidence(pin) >= settings['minimum_persistent_evidence']]
    filtered_count = len(keep)

    def candidate_ok(pin):
        return (pin['score'] >= settings['frozen_fallback_min_score']
                and pin['evidence'].get('persistent', 0) >= settings['frozen_fallback_min_persistent']
                and pin['evidence'].get('activity', 0) >= settings['frozen_fallback_min_activity'])

    def separate(point):
        return all(math.dist(point, pin['point']) >= settings['same_site_distance_m'] for pin in keep)

    if cameras:
        first, second = [[pin for pin in camera['methods']['frozen'] if candidate_ok(pin)] for camera in cameras]
        pairs = sorted(((math.dist(a['point'], b['point']), a, b) for a in first for b in second
                        if math.dist(a['point'], b['point']) <= settings['frozen_fallback_pair_distance_m']
                        and min(a['interval'][1], b['interval'][1]) - max(a['interval'][0], b['interval'][0]) >= settings['pair_min_temporal_overlap_seconds']),
                       key=lambda item: (item[0], -(item[1]['score'] + item[2]['score'])))
        for distance, a, b in pairs:
            point = [(x + y) / 2 for x, y in zip(a['point'], b['point'])]
            if point[1] < settings['minimum_inland_z_m'] or not separate(point):
                continue
            keep.append({**a, 'id': f'pin-live-frozen-{len(keep)+1}', 'point': point,
                         'interval': [min(a['interval'][0], b['interval'][0]), max(a['interval'][1], b['interval'][1])],
                         'score': (a['score'] + b['score']) / 2, 'evidence_tier': 'two_camera', 'source_views': [0, 1],
                         'evidence': {'camera_0': a['evidence'], 'camera_1': b['evidence'], 'camera_disagreement_m': distance},
                         'label': 'Digging activity detected; nesting unresolved.',
                         'confidence_note': 'Both views show localized motion and persistent ground change; review source video.'})
        for view, candidates in enumerate((first, second)):
            for candidate in candidates:
                if candidate['point'][1] < settings['frozen_fallback_single_min_z_m'] or not separate(candidate['point']):
                    continue
                keep.append({**candidate, 'id': f'pin-live-frozen-{len(keep)+1}',
                             'evidence_tier': 'single_camera', 'source_views': [view],
                             'label': 'Digging activity detected; nesting unresolved.',
                             'confidence_note': 'One view shows localized motion and persistent ground change; review source video.'})
    result = dict(predictions)
    result['methods'] = {**predictions['methods'], 'pins': keep}
    ids = {pin['id'] for pin in keep}
    result['suppressed_nearby_candidates'] = [row for row in predictions.get('suppressed_nearby_candidates', [])
                                               if row['kept_pin_id'] in ids]
    result['status'] = 'Digging activity pins for review; nesting unresolved.' if keep else 'No site pin detected.'
    result['live_quality_gate'] = {'minimum_persistent_evidence': settings['minimum_persistent_evidence'],
                                   'minimum_inland_z_m': settings['minimum_inland_z_m'],
                                   'before': len(predictions['methods']['pins']), 'after_filter': filtered_count,
                                   'frozen_fallbacks': len(keep) - filtered_count, 'after': len(keep)}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--predictions', required=True)
    parser.add_argument('--settings', required=True)
    parser.add_argument('--camera-0')
    parser.add_argument('--camera-1')
    args = parser.parse_args()
    path = Path(args.predictions)
    settings = json.loads(Path(args.settings).read_text())
    if bool(args.camera_0) != bool(args.camera_1):
        parser.error('Both camera prediction files are required together')
    cameras = [json.loads(Path(source).read_text()) for source in (args.camera_0, args.camera_1)] if args.camera_0 else None
    result = filter_pins(json.loads(path.read_text()), settings, cameras)
    path.write_text(json.dumps(result, indent=2))
    print(f"Live evidence gate: {result['live_quality_gate']['before']} -> {result['live_quality_gate']['after']} pins")
