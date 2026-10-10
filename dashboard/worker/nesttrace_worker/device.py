import numpy as np

from .detector import Box, is_dark
from .tracker import Rect, Track, Tracker
from .turtle import MovingBlobs, blob_shape_ok, is_possible_turtle

MAX_OBJECTS = 50
MAX_TRAILS = 50
PERSON = 'person'
POSSIBLE_TURTLE = 'possible turtle'


class DevicePipeline:
    """Everything one device needs between frames: its background model and its two trackers."""

    def __init__(self, detect_people):
        self.detect_people = detect_people  # callable(bgr) -> list[Box]
        self.blobs = MovingBlobs()
        self.people = Tracker(PERSON)
        self.candidates = Tracker('blob')
        self.rule_since: dict[int, int] = {}
        self.person_count = 0
        self.turtle_count = 0

    def _name_person(self, track: Track) -> None:
        if track.name is None:
            self.person_count += 1
            track.name = f'P{self.person_count}'

    def _name_turtle(self, track: Track) -> None:
        if track.name is None:
            self.turtle_count += 1
            track.name = f'T{self.turtle_count}'

    def process(self, bgr: np.ndarray, at_ms: int) -> dict:
        height, width = bgr.shape[:2]
        objects = []
        dark = is_dark(bgr)
        if not dark:
            found: list[Box] = self.detect_people(bgr)
            person_boxes: list[Rect] = [(b.x, b.y, b.w, b.h) for b in found]
            tracked = self.people.update(person_boxes, [b.score for b in found], at_ms)
            for track in sorted(tracked, key=lambda t: -(t.score or 0.0)):
                self._name_person(track)
                objects.append({'track': track.name, 'label': PERSON, 'score': track.score, 'box': list(track.box)})
            blob_boxes = self.blobs.boxes(bgr)
            for track in self.candidates.update(blob_boxes, [None] * len(blob_boxes), at_ms):
                if blob_shape_ok(track.box, width, height, person_boxes):
                    self.rule_since.setdefault(track.key, at_ms)
                else:
                    self.rule_since.pop(track.key, None)
                if is_possible_turtle(track, self.rule_since.get(track.key), width):
                    self._name_turtle(track)
                    objects.append({'track': track.name, 'label': POSSIBLE_TURTLE, 'box': list(track.box)})
            alive = {t.key for t in self.candidates.tracks}
            self.rule_since = {key: since for key, since in self.rule_since.items() if key in alive}
        objects = objects[:MAX_OBJECTS]
        trails = [
            {'track': t.name, 'label': t.label if t.label == PERSON else POSSIBLE_TURTLE, 'points': [list(p) for p in t.points]}
            for t in [*self.people.tracks, *self.candidates.tracks]
            if t.name is not None and at_ms - t.last_ms <= 3_000
        ][:MAX_TRAILS]
        return {'at': at_ms, 'dark': dark, 'width': width, 'height': height, 'objects': objects, 'trails': trails}
