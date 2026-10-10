import numpy as np
import pytest
import cv2

from hatchwatch_worker.detector import PersonDetector
from hatchwatch_worker.device import DevicePipeline
from tests.helpers import FIXTURES


def test_person_keeps_one_track_and_a_trail(model_path):
    picture = cv2.imread(str(FIXTURES / 'person-beach-320.jpg'))
    pipeline = DevicePipeline(PersonDetector(model_path).detect)
    for i in range(5):
        payload = pipeline.process(picture, 1_000 + i * 500)
    [person] = payload['objects']
    assert person['track'] == 'P1' and person['label'] == 'person' and person['score'] >= 0.80
    [trail] = payload['trails']
    assert trail['track'] == 'P1' and [p[0] for p in trail['points']] == [1_000, 1_500, 2_000, 2_500, 3_000]


def test_objects_and_trails_are_capped_at_50_highest_score_first():
    from hatchwatch_worker.detector import Box

    boxes = [Box(10 + (i % 10) * 30, 10 + (i // 10) * 30, 20, 20, 0.5 + i / 1000) for i in range(70)]
    pipeline = DevicePipeline(lambda bgr: boxes)
    picture = np.full((400, 400, 3), 128, dtype=np.uint8)
    payload = pipeline.process(picture, 1_000)
    assert len(payload['objects']) == 50 and len(payload['trails']) == 50
    scores = [o['score'] for o in payload['objects']]
    assert scores == sorted(scores, reverse=True) and scores[0] == pytest.approx(0.569)


def test_a_picture_size_change_rebuilds_the_pipeline_so_no_old_pixels_remain():
    from hatchwatch_worker.detector import Box

    pipeline = DevicePipeline(lambda bgr: [Box(100, 100, 40, 40, 0.9)])
    big = np.full((400, 400, 3), 128, dtype=np.uint8)
    small = np.full((200, 200, 3), 128, dtype=np.uint8)
    pipeline.process(big, 1_000)
    payload = pipeline.process(big, 1_500)
    assert [p[0] for p in payload['trails'][0]['points']] == [1_000, 1_500]
    payload = pipeline.process(small, 2_000)
    assert payload['width'] == 200 and [p[0] for p in payload['trails'][0]['points']] == [2_000]


def test_track_numbers_wrap_back_to_one_after_999999():
    from hatchwatch_worker.detector import Box

    pipeline = DevicePipeline(lambda bgr: [Box(10, 10, 40, 40, 0.9)])
    pipeline.person_count = 999_999
    payload = pipeline.process(np.full((200, 200, 3), 128, dtype=np.uint8), 1_000)
    assert payload['objects'][0]['track'] == 'P1'
    pipeline.turtle_count = 999_999
    track = type('T', (), {'name': None})()
    pipeline._name_turtle(track)
    assert track.name == 'T1'
