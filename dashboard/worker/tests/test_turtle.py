import numpy as np
import pytest

from hatchwatch_worker.detector import Box
from hatchwatch_worker.device import DevicePipeline

W, H = 320, 240
STEP_MS = 500  # the worker's 2 frames/s


def sand(rng: np.random.Generator) -> np.ndarray:
    picture = np.full((H, W, 3), (150, 170, 190), dtype=np.int16)
    picture += rng.integers(-3, 4, size=(H, W, 1), dtype=np.int16)
    return picture.clip(0, 255).astype(np.uint8)


def run(width: int, height: int, speed_px_s: float, seconds: float = 8, people=lambda at: [], start=(40, 120)) -> list[dict]:
    """Warm the background up for 10 s, then move a dark rectangle; returns the payloads after it appears."""
    rng = np.random.default_rng(3)
    pipeline = DevicePipeline(lambda bgr: people(current[0]))
    current = [0]
    for i in range(20):
        current[0] = i * STEP_MS
        pipeline.process(sand(rng), current[0])
    payloads = []
    for i in range(int(seconds * 1000 / STEP_MS)):
        at = 10_000 + i * STEP_MS
        current[0] = at
        picture = sand(rng)
        x = int(start[0] + speed_px_s * i * STEP_MS / 1000)
        picture[start[1]:start[1] + height, x:x + width] = (60, 70, 80)
        payloads.append(pipeline.process(picture, at))
    return payloads


def turtles(payload: dict) -> list[dict]:
    return [o for o in payload['objects'] if o['label'] == 'possible turtle']


def test_wide_slow_blob_becomes_a_possible_turtle_after_3_s():
    payloads = run(48, 24, speed_px_s=8)  # 2.5% of the width per second, 1.5% of the picture
    first = next(i for i, p in enumerate(payloads) if turtles(p))
    assert 3_000 <= first * STEP_MS <= 4_500
    assert all(turtles(p) for p in payloads[first:])
    [turtle] = turtles(payloads[-1])
    assert turtle['track'] == 'T1' and 'score' not in turtle
    [trail] = [t for t in payloads[-1]['trails'] if t['track'] == 'T1']
    assert trail['label'] == 'possible turtle' and len(trail['points']) >= 8


@pytest.mark.parametrize('case,width,height,speed', [
    ('tall', 24, 48, 8),
    ('fast', 48, 24, 40),        # 12.5% of the width per second
    ('tiny', 12, 6, 4),          # 0.09% of the picture
    ('huge', 240, 120, 4),       # 37.5% of the picture
])
def test_rule_rejects(case, width, height, speed):
    payloads = run(width, height, speed_px_s=speed, start=(10, 60) if case == 'huge' else (40, 120))
    assert not any(turtles(p) for p in payloads), case


def test_blob_on_a_person_is_not_a_turtle():
    def person(at):
        x = int(40 + 8 * (at - 10_000) / 1000) if at >= 10_000 else -1
        return [Box(x, 120, 48, 24, 0.9)] if x >= 0 else []
    payloads = run(48, 24, speed_px_s=8, people=person)
    assert not any(turtles(p) for p in payloads)
    assert payloads[-1]['objects'][0]['label'] == 'person'


def test_dark_frames_detect_nothing():
    pipeline = DevicePipeline(lambda bgr: pytest.fail('person detection must be skipped in the dark'))
    payload = pipeline.process(np.full((H, W, 3), 10, dtype=np.uint8), 1_000)
    assert payload == {'at': 1_000, 'dark': True, 'width': W, 'height': H, 'objects': [], 'trails': []}


from hatchwatch_worker.tracker import Track
from hatchwatch_worker.turtle import blob_shape_ok, is_possible_turtle

PIC_W, PIC_H = 320, 240


@pytest.mark.parametrize('box,persons,expected', [
    ((100, 100, 48, 24), [], True),
    ((100, 100, 24, 48), [], False),                       # tall
    ((100, 100, 31, 24), [], False),                       # aspect 1.29
    ((100, 100, 12, 6), [], False),                        # tiny: 0.09%
    ((10, 10, 240, 120), [], False),                       # huge: 37.5%
    ((100, 100, 48, 24), [(110, 100, 48, 24)], False),     # on a person
    ((100, 100, 48, 24), [(200, 200, 20, 40)], True),      # person elsewhere
])
def test_blob_shape_ok(box, persons, expected):
    assert blob_shape_ok(box, PIC_W, PIC_H, persons) is expected


def make_track(speed_px_s: float, seconds: int = 4) -> Track:
    track = Track(1, 'blob', (0, 0, 48, 24), None, 0, 0)
    for i in range(seconds * 2 + 1):
        track.add((speed_px_s * i * 0.5, 100, 48, 24), None, i * 500)
    return track


def test_is_possible_turtle_speed_and_sustain():
    slow, fast = make_track(8), make_track(40)  # 40 px/s = 12.5% of 320
    assert is_possible_turtle(slow, 0, PIC_W)
    assert not is_possible_turtle(fast, 0, PIC_W)
    assert not is_possible_turtle(slow, None, PIC_W)
    assert not is_possible_turtle(slow, 1_500, PIC_W)  # shape rule held only 2.5 s
    assert not is_possible_turtle(make_track(8, seconds=1), 0, PIC_W)  # not enough history
