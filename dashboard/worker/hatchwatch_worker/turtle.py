import cv2
import numpy as np

from .tracker import Rect, Track, iou

MIN_ASPECT = 1.3          # width / height
MIN_AREA = 0.003          # 0.3% of the picture
MAX_AREA = 0.15           # 15% of the picture
MAX_SPEED = 0.08          # picture widths per second
SUSTAIN_MS = 3_000
SPEED_SPAN_MS = 1_000     # speed is measured over about one second, so box jitter between frames does not count
MAX_PERSON_IOU = 0.1
MOG2_HISTORY = 120        # frames (about 60 s at 2 frames/s)
MOG2_VAR_THRESHOLD = 25
# Fixed learning rate: OpenCV's automatic rate starts at 1/frames-seen, which soaks a slow blob into the background within a few frames.
LEARNING_RATE = 1 / MOG2_HISTORY


class MovingBlobs:
    """Per-device background subtraction (MOG2, shadows ignored) -> bounding boxes of moving areas."""

    def __init__(self):
        self.subtractor = cv2.createBackgroundSubtractorMOG2(history=MOG2_HISTORY, varThreshold=MOG2_VAR_THRESHOLD, detectShadows=True)
        self.open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

    def boxes(self, bgr: np.ndarray) -> list[Rect]:
        mask = self.subtractor.apply(bgr, learningRate=LEARNING_RATE)
        mask = np.where(mask == 255, 255, 0).astype(np.uint8)  # 127 = shadow: ignored
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self.open_kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self.close_kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        return [tuple(float(v) for v in cv2.boundingRect(contour)) for contour in contours]


def blob_shape_ok(box: Rect, width: int, height: int, persons: list[Rect]) -> bool:
    """Wider than tall, 0.3-15% of the picture, and not on a person (IoU < 0.1 with every person box)."""
    x, y, w, h = box
    if h <= 0 or w / h < MIN_ASPECT:
        return False
    area = (w * h) / (width * height)
    if not MIN_AREA <= area <= MAX_AREA:
        return False
    return all(iou(box, person) < MAX_PERSON_IOU for person in persons)


def is_possible_turtle(track: Track, shape_ok_since_ms: int | None, width: int) -> bool:
    """A blob track that kept the shape rule for the last 3 s and, over every 1 s span ending in those 3 s, moved < 8% of the picture width per second."""
    now = track.last_ms
    if shape_ok_since_ms is None or now - shape_ok_since_ms < SUSTAIN_MS:
        return False
    spans = 0
    for t, x, y in track.points:
        if now - t > SUSTAIN_MS:
            continue
        earlier = [p for p in track.points if t - p[0] >= SPEED_SPAN_MS]
        if not earlier:
            continue
        t0, x0, y0 = earlier[-1]
        if np.hypot(x - x0, y - y0) / ((t - t0) / 1000) >= MAX_SPEED * width:
            return False
        spans += 1
    return spans > 0
