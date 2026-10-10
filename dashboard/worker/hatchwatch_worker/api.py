import logging
from dataclasses import dataclass

import httpx

TIMEOUT_S = 3.0
log = logging.getLogger('hatchwatch_worker')


@dataclass(frozen=True)
class DeviceRef:
    id: str
    frame_at: int


@dataclass(frozen=True)
class Frame:
    jpeg: bytes
    at: int


class InternalApi:
    """The web app's internal routes (/api/internal/*), reachable only inside Compose, with the worker token."""

    def __init__(self, base_url: str, token: str, transport: httpx.BaseTransport | None = None):
        self.client = httpx.Client(base_url=base_url, headers={'Authorization': f'Bearer {token}'}, timeout=TIMEOUT_S, transport=transport)

    def devices(self) -> list[DeviceRef]:
        response = self.client.get('/api/internal/devices')
        response.raise_for_status()
        return [DeviceRef(str(d['id']), int(d['frameAt'])) for d in response.json()['devices']]

    def frame(self, device_id: str) -> Frame | None:
        response = self.client.get(f'/api/internal/frame/{device_id}')
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return Frame(response.content, int(response.headers['X-Frame-At']))

    def post_detections(self, device_id: str, payload: dict) -> bool:
        response = self.client.post(f'/api/internal/detections/{device_id}', json=payload)
        if response.status_code in (404, 409):
            return False  # device gone, or a newer result is already stored
        if response.status_code in (400, 413):
            log.warning('detections for %s refused with %s; skipped', device_id, response.status_code)  # status only
            return False  # one bad payload must not back the whole loop off
        response.raise_for_status()
        return True

    def close(self) -> None:
        self.client.close()
