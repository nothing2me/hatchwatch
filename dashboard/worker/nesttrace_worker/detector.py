from dataclasses import dataclass

import cv2
import numpy as np

INPUT_SIZE = 416
STRIDES = (8, 16, 32)
ANCHORS = sum((INPUT_SIZE // stride) ** 2 for stride in STRIDES)  # 3549
CLASSES = 80
PERSON_CLASS = 0
PAD_VALUE = 114
PERSON_MIN_SCORE = 0.40
NMS_IOU = 0.45
MIN_BOX_FRACTION = 0.01
DARK_MEAN = 25.0


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float
    score: float


def is_dark(bgr: np.ndarray) -> bool:
    """Mean brightness below 25/255: too dark to detect anything."""
    return float(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).mean()) < DARK_MEAN


def letterbox(bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """YOLOX demo pre-processing: scale to fit 416x416 keeping aspect, pad bottom/right with 114, BGR, no normalisation."""
    height, width = bgr.shape[:2]
    ratio = min(INPUT_SIZE / height, INPUT_SIZE / width)
    padded = np.full((INPUT_SIZE, INPUT_SIZE, 3), PAD_VALUE, dtype=np.uint8)
    new_w, new_h = int(width * ratio), int(height * ratio)
    padded[:new_h, :new_w] = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    return padded, ratio


def to_blob(padded: np.ndarray) -> np.ndarray:
    """HWC uint8 BGR -> NCHW float32, values 0-255."""
    return np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32)


def _grid() -> tuple[np.ndarray, np.ndarray]:
    cells, strides = [], []
    for stride in STRIDES:
        n = INPUT_SIZE // stride
        ys, xs = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
        cells.append(np.stack((xs, ys), axis=2).reshape(-1, 2))
        strides.append(np.full((n * n, 1), stride))
    return np.concatenate(cells).astype(np.float32), np.concatenate(strides).astype(np.float32)


GRID, GRID_STRIDES = _grid()


def decode(raw: np.ndarray, ratio: float, width: int, height: int) -> list[Box]:
    """raw: (1, 3549, 85) model output -> person boxes in picture pixels (score >= 0.40, NMS 0.45, >= 1% of the picture)."""
    if raw.shape != (1, ANCHORS, 5 + CLASSES):
        raise ValueError(f'unexpected YOLOX output shape {raw.shape}')
    out = raw[0]
    centres = (out[:, :2] + GRID) * GRID_STRIDES
    sizes = np.exp(out[:, 2:4]) * GRID_STRIDES
    scores = out[:, 4] * out[:, 5 + PERSON_CLASS]
    keep = scores >= PERSON_MIN_SCORE
    if not keep.any():
        return []
    xywh = np.concatenate((centres - sizes / 2, sizes), axis=1)[keep] / ratio
    kept_scores = scores[keep]
    # Clip to the picture before the size check, so a box hanging off the edge is measured by what is visible.
    x0 = np.clip(xywh[:, 0], 0, width)
    y0 = np.clip(xywh[:, 1], 0, height)
    x1 = np.clip(xywh[:, 0] + xywh[:, 2], 0, width)
    y1 = np.clip(xywh[:, 1] + xywh[:, 3], 0, height)
    boxes = np.stack((x0, y0, x1 - x0, y1 - y0), axis=1)
    picked = cv2.dnn.NMSBoxes(boxes.tolist(), kept_scores.tolist(), PERSON_MIN_SCORE, NMS_IOU)
    min_area = MIN_BOX_FRACTION * width * height
    result = []
    for index in np.array(picked, dtype=int).reshape(-1):
        x, y, w, h = (float(v) for v in boxes[index])
        if w * h >= min_area:
            result.append(Box(round(x, 1), round(y, 1), round(w, 1), round(h, 1), round(float(kept_scores[index]), 2)))
    return sorted(result, key=lambda box: -box.score)


class PersonDetector:
    def __init__(self, model_path: str):
        self.net = cv2.dnn.readNetFromONNX(model_path)

    def detect(self, bgr: np.ndarray) -> list[Box]:
        padded, ratio = letterbox(bgr)
        self.net.setInput(to_blob(padded))
        raw = self.net.forward()
        return decode(raw, ratio, bgr.shape[1], bgr.shape[0])
