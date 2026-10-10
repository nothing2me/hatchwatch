from dataclasses import dataclass, field

import numpy as np

MATCH_IOU = 0.3
END_AFTER_MS = 3_000
TRAIL_MS = 30_000
TRAIL_POINTS = 60

Rect = tuple[float, float, float, float]  # x, y, w, h in picture pixels


def iou(a: Rect, b: Rect) -> float:
    ax1, ay1, bx1, by1 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    w = min(ax1, bx1) - max(a[0], b[0])
    h = min(ay1, by1) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def hungarian(cost: np.ndarray) -> list[tuple[int, int]]:
    """Minimum-cost assignment for a rectangular cost matrix (Kuhn-Munkres with potentials, O(n^3)). Returns (row, col) pairs."""
    rows, cols = cost.shape
    if rows == 0 or cols == 0:
        return []
    transposed = rows > cols
    matrix = cost.T if transposed else cost
    n, m = matrix.shape  # n <= m
    u = np.zeros(n + 1)
    v = np.zeros(m + 1)
    owner = np.zeros(m + 1, dtype=int)  # owner[j] = row (1-based) assigned to column j
    way = np.zeros(m + 1, dtype=int)
    for i in range(1, n + 1):
        owner[0] = i
        j0 = 0
        minv = np.full(m + 1, np.inf)
        used = np.zeros(m + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = owner[j0]
            delta, j1 = np.inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    current = matrix[i0 - 1, j - 1] - u[i0] - v[j]
                    if current < minv[j]:
                        minv[j], way[j] = current, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[owner[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if owner[j0] == 0:
                break
        while True:
            j1 = way[j0]
            owner[j0] = owner[j1]
            j0 = j1
            if j0 == 0:
                break
    pairs = [(owner[j] - 1, j - 1) for j in range(1, m + 1) if owner[j] != 0]
    return sorted((c, r) for r, c in pairs) if transposed else sorted(pairs)


@dataclass
class Track:
    key: int
    label: str
    box: Rect
    score: float | None
    first_ms: int
    last_ms: int
    points: list[tuple[int, float, float]] = field(default_factory=list)
    name: str | None = None  # 'P3' / 'T1'; None until the track is shown

    def add(self, box: Rect, score: float | None, at_ms: int) -> None:
        self.box, self.score, self.last_ms = box, score, at_ms
        self.points.append((at_ms, round(box[0] + box[2] / 2, 1), round(box[1] + box[3] / 2, 1)))
        self.points = [p for p in self.points if at_ms - p[0] <= TRAIL_MS][-TRAIL_POINTS:]


class Tracker:
    """Frame-to-frame matching for one device and one label: IoU >= 0.3, Hungarian on 1 - IoU; a track ends after 3 s unseen."""

    def __init__(self, label: str):
        self.label = label
        self.tracks: list[Track] = []
        self._next_key = 1

    def update(self, boxes: list[Rect], scores: list[float | None], at_ms: int) -> list[Track]:
        """Returns the tracks seen in this frame, in the order of `boxes`."""
        self.tracks = [t for t in self.tracks if at_ms - t.last_ms <= END_AFTER_MS]
        seen: list[Track | None] = [None] * len(boxes)
        if self.tracks and boxes:
            cost = np.array([[1.0 - iou(t.box, b) for b in boxes] for t in self.tracks])
            for row, col in hungarian(cost):
                if 1.0 - cost[row, col] >= MATCH_IOU:
                    self.tracks[row].add(boxes[col], scores[col], at_ms)
                    seen[col] = self.tracks[row]
        for col, box in enumerate(boxes):
            if seen[col] is None:
                track = Track(self._next_key, self.label, box, scores[col], at_ms, at_ms)
                self._next_key += 1
                track.add(box, scores[col], at_ms)
                self.tracks.append(track)
                seen[col] = track
        return [t for t in seen if t is not None]
