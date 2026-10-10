import itertools

import numpy as np
import pytest

from hatchwatch_worker.tracker import END_AFTER_MS, TRAIL_POINTS, Tracker, hungarian, iou


def brute_force(cost: np.ndarray) -> float:
    rows, cols = cost.shape
    if rows <= cols:
        return min(sum(cost[r, c] for r, c in zip(range(rows), perm)) for perm in itertools.permutations(range(cols), rows))
    return brute_force(cost.T)


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou((0, 0, 10, 10), (5, 0, 10, 10)) == pytest.approx(50 / 150)
    assert iou((0, 0, 10, 10), (10, 0, 10, 10)) == 0.0


@pytest.mark.parametrize('shape', [(1, 1), (3, 3), (2, 5), (5, 2), (6, 6)])
def test_hungarian_is_optimal(shape):
    rng = np.random.default_rng(7)
    for _ in range(20):
        cost = rng.random(shape)
        pairs = hungarian(cost)
        assert len(pairs) == min(shape)
        assert len({r for r, _ in pairs}) == len({c for _, c in pairs}) == len(pairs)
        assert sum(cost[r, c] for r, c in pairs) == pytest.approx(brute_force(cost))


def test_ids_stay_with_their_objects_when_they_cross_order():
    tracker = Tracker('person')
    a, b = tracker.update([(0, 0, 20, 40), (100, 0, 20, 40)], [0.9, 0.8], 0)
    # Same objects, listed the other way round and moved a little.
    second = tracker.update([(104, 2, 20, 40), (3, 1, 20, 40)], [0.8, 0.9], 500)
    assert [t.key for t in second] == [b.key, a.key]


def test_same_label_only_and_low_iou_starts_a_new_track():
    tracker = Tracker('person')
    [first] = tracker.update([(0, 0, 20, 40)], [0.9], 0)
    [moved] = tracker.update([(15, 0, 20, 40)], [0.9], 500)  # IoU 5/35 < 0.3
    assert moved.key != first.key


def test_track_ends_after_three_seconds_unseen():
    tracker = Tracker('person')
    [first] = tracker.update([(0, 0, 20, 40)], [0.9], 0)
    [same] = tracker.update([(0, 0, 20, 40)], [0.9], END_AFTER_MS)
    assert same.key == first.key
    [new] = tracker.update([(0, 0, 20, 40)], [0.9], 2 * END_AFTER_MS + 1)
    assert new.key != first.key


def test_trail_keeps_30_seconds_and_at_most_60_points():
    tracker = Tracker('person')
    for i in range(200):
        [track] = tracker.update([(i * 0.1, 0, 20, 40)], [0.9], i * 250)  # 4 per second for 50 s
    assert len(track.points) == TRAIL_POINTS
    assert track.points[-1][0] - track.points[0][0] <= 30_000
    assert track.points[-1] == (199 * 250, pytest.approx(199 * 0.1 + 10, abs=0.06), 20.0)
