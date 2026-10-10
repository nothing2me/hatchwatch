import json

import numpy as np

from scripts import track_paths

FPS = 8
CAL = {'ground_bounds': [-12, 12, -8, 8]}


def _row(y):
    return int(round((y + 8) * 119 / 16))


def _col(x):
    return int(round((x + 12) * 159 / 24))


def _grid(seconds, blobs):
    """blobs: list of (x, y0, y1, t0, t1) moving linearly in y at fixed x."""
    t_len = int(seconds * FPS)
    m = np.zeros((t_len, 120, 160), np.uint8)
    for x, y0, y1, t0, t1 in blobs:
        for f in range(t_len):
            t = f / FPS
            if t0 <= t <= t1:
                y = y0 + (y1 - y0) * (t - t0) / max(t1 - t0, 1e-9)
                r, c = _row(y), _col(x)
                m[f, r - 1:r + 2, c - 1:c + 2] = 50
    return m, [f / FPS for f in range(t_len)]


def _pin(pid, x, y, t0, t1):
    return {'id': pid, 'point': [x, y], 'interval': [t0, t1]}


def _build(m, times, pins):
    return track_paths.build_tracks([{'motion': m}, {'motion': m.copy()}], CAL, pins, times, 7)


def test_single_track_matched():
    m, ts = _grid(10, [(0, -7, 2, 0.5, 8.5)])
    doc = _build(m, ts, [_pin('pin-1', 0, 2, 7, 9)])
    assert len(doc['tracks']) == 1
    tr = doc['tracks'][0]
    assert tr['points'][-1][0] - tr['points'][0][0] >= 3
    assert tr['points'][0][2] <= -5
    assert tr['pin_id'] == 'pin-1'


def test_two_lanes_two_pins():
    m, ts = _grid(10, [(-6, -7, 1, 0.5, 8.5), (6, -7, 3, 0.5, 8.5)])
    doc = _build(m, ts, [_pin('a', -6, 1, 7, 9), _pin('b', 6, 3, 7, 9)])
    assert len(doc['tracks']) == 2
    by_x = {round(t['points'][0][1]): t['pin_id'] for t in doc['tracks']}
    assert by_x == {-6: 'a', 6: 'b'}


def test_rejects_short_and_non_water_start():
    m, ts = _grid(10, [(-6, -7, -6, 1, 2), (6, 3, 6, 0.5, 8.5)])
    assert _build(m, ts, [])['tracks'] == []


def test_gap_keeps_one_track():
    m, ts = _grid(10, [(0, -7, 2, 0.5, 8.5)])
    m[40:43] = 0
    assert len(_build(m, ts, [])['tracks']) == 1


def test_decimated_and_schema_shape():
    m, ts = _grid(10, [(0, -7, 2, 0.5, 8.5)])
    doc = _build(m, ts, [])
    pts = doc['tracks'][0]['points']
    assert len(pts) <= 4 * (pts[-1][0] - pts[0][0]) + 2
    schema = json.loads((track_paths.ROOT / 'schemas' / 'tracks.v1.json').read_text())
    try:
        import jsonschema
        jsonschema.validate(doc, schema)
    except ImportError:
        assert set(doc) == set(schema['required'])
        assert doc['schema'] == 'hatchwatch.tracks' and doc['version'] == 1
        assert isinstance(doc['note'], str)
        for tr in doc['tracks']:
            assert set(tr) == {'id', 'pin_id', 'points'}
            assert tr['pin_id'] is None or isinstance(tr['pin_id'], str)
            assert len(tr['points']) >= 2 and all(len(p) == 3 for p in tr['points'])


def test_unmatched_surf_dropped_inland_kept_matched_kept():
    m, ts = _grid(10, [(-8, -6.5, -4, 0.5, 8.5), (0, -7, -1, 0.5, 8.5), (8, -7, -4, 0.5, 8.5)])
    doc = _build(m, ts, [_pin('p', 8, -4, 7, 9)])
    by_x = {round(t['points'][0][1]): t['pin_id'] for t in doc['tracks']}
    assert by_x == {0: None, 8: 'p'}


def test_refuses_private_run_dir(tmp_path):
    import pytest
    with pytest.raises(SystemExit):
        track_paths.run(tmp_path / 'artifacts' / 'private' / 'run-1')
