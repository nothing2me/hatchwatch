import hashlib

import cv2
import numpy as np
import pytest

from nesttrace_worker.detector import ANCHORS, Box, PersonDetector, decode, is_dark, letterbox, to_blob

from tests.helpers import FIXTURE_SHA256, FIXTURES, MODEL_SHA256


def raw_with(*cells: tuple[int, float, float, float, float, float, float]) -> np.ndarray:
    """A (1, 3549, 85) output: zeros except the given anchors (index, dx, dy, log_w, log_h, objectness, person)."""
    raw = np.zeros((1, ANCHORS, 85), dtype=np.float32)
    raw[0, :, 2:4] = -10.0
    for index, dx, dy, lw, lh, obj, person in cells:
        raw[0, index, :6] = (dx, dy, lw, lh, obj, person)
    return raw


def test_letterbox_pads_bottom_right_with_114_and_keeps_bgr():
    picture = np.zeros((240, 320, 3), dtype=np.uint8)
    picture[:, :, 0] = 200  # blue channel
    padded, ratio = letterbox(picture)
    assert padded.shape == (416, 416, 3)
    assert ratio == pytest.approx(1.3)
    assert padded[0, 0].tolist() == [200, 0, 0]
    assert padded[311, 415].tolist() == [200, 0, 0]
    assert padded[312, 0].tolist() == [114, 114, 114]
    blob = to_blob(padded)
    assert blob.shape == (1, 3, 416, 416) and blob.dtype == np.float32
    assert blob.max() == 200.0  # no normalisation


def test_decode_uses_grid_and_strides():
    # Stride-8 grid is 52x52 (anchors 0..2703), stride 16 is 26x26 (2704..3379), stride 32 is 13x13 (3380..3548).
    index = 2704 + 10 * 26 + 5  # stride 16, cell x=5, y=10
    raw = raw_with((index, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.9))
    boxes = decode(raw, ratio=1.0, width=416, height=416)
    assert boxes == [Box(56.0, 104.0, 64.0, 128.0, 0.81)]


def test_decode_maps_back_through_the_ratio_and_clips():
    index = 3380 + 0 * 13 + 0  # stride 32, top-left cell; box hangs off the picture
    raw = raw_with((index, 0.0, 0.0, np.log(4.0), np.log(4.0), 1.0, 0.8))
    [box] = decode(raw, ratio=1.3, width=320, height=240)
    assert (box.x, box.y) == (0.0, 0.0)
    assert box.w == pytest.approx(64 / 1.3, abs=0.1) and box.h == pytest.approx(64 / 1.3, abs=0.1)


def test_decode_thresholds_nms_and_min_size():
    base = 2704 + 10 * 26 + 5
    raw = raw_with(
        (base, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.9),       # 0.81 kept
        (base + 1, 0.0, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.8),   # 0.72, IoU 0.78 with the first (> 0.45): suppressed
        (base + 10, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.6, 0.6),  # 0.36 < 0.40: dropped
        (100, 0.5, 0.5, np.log(1.5), np.log(1.5), 1.0, 1.0),        # 12x12 px = 0.08% of 416x416: too small
    )
    assert [box.score for box in decode(raw, 1.0, 416, 416)] == [0.81]


def test_decode_refuses_another_output_shape():
    with pytest.raises(ValueError):
        decode(np.zeros((1, 3549, 6), dtype=np.float32), 1.0, 416, 416)


def test_dark_frames():
    assert is_dark(np.full((240, 320, 3), 24, dtype=np.uint8))
    assert not is_dark(np.full((240, 320, 3), 25, dtype=np.uint8))


def test_model_file_is_the_pinned_release(model_path):
    with open(model_path, 'rb') as handle:
        assert hashlib.sha256(handle.read()).hexdigest() == MODEL_SHA256


def test_person_found_in_the_fixture(model_path):
    data = (FIXTURES / 'person-beach-320.jpg').read_bytes()
    assert hashlib.sha256(data).hexdigest() == FIXTURE_SHA256
    picture = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    net = cv2.dnn.readNetFromONNX(model_path)
    padded, _ = letterbox(picture)
    net.setInput(to_blob(padded))
    assert net.forward().shape == (1, 3549, 85)
    [person] = PersonDetector(model_path).detect(picture)
    assert person.score >= 0.80
    assert person.x == pytest.approx(194, abs=6) and person.y == pytest.approx(104, abs=6)
    assert person.w == pytest.approx(31, abs=6) and person.h == pytest.approx(86, abs=6)
