import logging
import time
from collections.abc import Callable
from typing import Protocol

import cv2
import numpy as np

from .api import InternalApi

log = logging.getLogger('nesttrace_worker')

LOOP_MS = 500
MIN_FRAME_GAP_MS = 500    # at most 2 frames/s per device


class Analyser(Protocol):
    def process(self, bgr: np.ndarray, at_ms: int) -> dict: ...


class Scheduler:
    """One pass every 500 ms: newest frame of each online device whose frame changed, round-robin, at most 2 frames/s per device.
    A pass stops once it has used its 500 ms; the next pass starts with the device after the last one served."""

    def __init__(self, api: InternalApi, make_pipeline: Callable[[], Analyser], clock: Callable[[], float] = time.monotonic):
        self.api = api
        self.make_pipeline = make_pipeline
        self.clock = clock
        self.pipelines: dict[str, Analyser] = {}
        self.done_at: dict[str, int] = {}      # frame time last processed, per device
        self.ran_at: dict[str, float] = {}     # clock (s) of the last run, per device
        self.last_served: str | None = None

    def tick(self) -> list[str]:
        started = self.clock()
        devices = self.api.devices()  # a refused token or unreachable web service propagates: main names it once and backs off
        online = {d.id for d in devices}
        for gone in [key for key in self.pipelines if key not in online]:
            self.pipelines.pop(gone)
            self.done_at.pop(gone, None)
            self.ran_at.pop(gone, None)
        ids = sorted(online)
        if self.last_served in ids:
            pivot = ids.index(self.last_served) + 1
            ids = ids[pivot:] + ids[:pivot]
        frame_at = {d.id: d.frame_at for d in devices}
        served = []
        for device_id in ids:
            if (self.clock() - started) * 1000 >= LOOP_MS:
                break
            if frame_at[device_id] == self.done_at.get(device_id):
                continue
            if (self.clock() - self.ran_at.get(device_id, float('-inf'))) * 1000 < MIN_FRAME_GAP_MS:
                continue
            self.ran_at[device_id] = self.clock()
            try:
                if self.serve(device_id):
                    served.append(device_id)
            except Exception as error:  # noqa: BLE001 - network, cv2 and detector errors alike must not stop the other devices
                log.warning('device %s failed: %s', device_id, type(error).__name__)  # class only: never the token or URL
            self.last_served = device_id  # a failing device must not starve the ones after it
        return served

    def serve(self, device_id: str) -> bool:
        frame = self.api.frame(device_id)
        if frame is None:
            return False
        self.done_at[device_id] = frame.at
        picture = cv2.imdecode(np.frombuffer(frame.jpeg, np.uint8), cv2.IMREAD_COLOR)
        if picture is None:
            return False
        if device_id not in self.pipelines:
            self.pipelines[device_id] = self.make_pipeline()
        self.api.post_detections(device_id, self.pipelines[device_id].process(picture, frame.at))
        return True
