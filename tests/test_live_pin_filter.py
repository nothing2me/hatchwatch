import runpy
from pathlib import Path


filter_pins = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/filter-live-pins.py'))['filter_pins']


def test_live_quality_gate_keeps_persistent_sites_and_rejects_shoreline_motion():
    predictions = {'methods': {'pins': [
        {'id': 'pin-1', 'point': [0, -4], 'evidence': {'camera_0': {'persistent': .5}, 'camera_1': {'persistent': .4}}},
        {'id': 'pin-2', 'point': [2, -5], 'evidence': {'camera_0': {'persistent': .5}, 'camera_1': {'persistent': 0}}},
        {'id': 'pin-3', 'point': [4, -12.2], 'evidence': {'persistent': .6}},
    ]}, 'suppressed_nearby_candidates': [{'candidate_id': 'x', 'kept_pin_id': 'pin-2'}]}
    settings = {'minimum_persistent_evidence': .2, 'minimum_inland_z_m': -12}
    result = filter_pins(predictions, settings)
    assert [pin['id'] for pin in result['methods']['pins']] == ['pin-1']
    assert result['live_quality_gate']['before'] == 3
    assert result['live_quality_gate']['after'] == 1
    assert result['suppressed_nearby_candidates'] == []


def test_live_quality_gate_adds_independent_persistent_motion_pair():
    settings = {'minimum_persistent_evidence': .2, 'minimum_inland_z_m': -12,
                'same_site_distance_m': 2.8, 'frozen_fallback_min_score': .55,
                'frozen_fallback_min_activity': .015, 'frozen_fallback_min_persistent': .4,
                'frozen_fallback_pair_distance_m': 1.5, 'pair_min_temporal_overlap_seconds': 1,
                'frozen_fallback_single_min_z_m': 7}
    candidate = {'id': 'frozen-1', 'point': [12, 9], 'interval': [10, 20], 'score': .6,
                 'radius_m': .9, 'area_m2': 2.54,
                 'evidence': {'persistent': .55, 'activity': .03}}
    cameras = [{'methods': {'frozen': [candidate]}},
               {'methods': {'frozen': [{**candidate, 'point': [12.3, 9.2]}]}}]
    result = filter_pins({'methods': {'pins': []}}, settings, cameras)
    assert result['live_quality_gate']['frozen_fallbacks'] == 1
    assert result['methods']['pins'][0]['source_views'] == [0, 1]
    assert result['methods']['pins'][0]['point'] == [12.15, 9.1]
