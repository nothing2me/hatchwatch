import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import pytest

from nesttrace_worker.api import DeviceRef, InternalApi
from nesttrace_worker.config import load_config
from nesttrace_worker.scheduler import Scheduler

TOKEN = 'test-worker-token'
JPEG = cv2.imencode('.jpg', np.full((240, 320, 3), 128, np.uint8))[1].tobytes()


class FakeWeb:
    """A stand-in for the web app's internal routes, on a real local socket."""

    def __init__(self):
        self.devices: dict[str, int] = {}
        self.requests: list[tuple[str, str, str | None]] = []
        self.posted: dict[str, list[dict]] = {}
        self.failing_posts: set[str] = set()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status: int, body: bytes = b'', headers: dict | None = None):
                self.send_response(status)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _authorized(self) -> bool:
                fake.requests.append((self.command, self.path, self.headers.get('Authorization')))
                if self.headers.get('Authorization') != f'Bearer {TOKEN}':
                    self._send(401)
                    return False
                return True

            def do_GET(self):
                if not self._authorized():
                    return
                if self.path == '/api/internal/devices':
                    body = json.dumps({'devices': [{'id': key, 'frameAt': at} for key, at in fake.devices.items()]}).encode()
                    return self._send(200, body, {'Content-Type': 'application/json'})
                device = self.path.removeprefix('/api/internal/frame/')
                if device in fake.devices:
                    return self._send(200, JPEG, {'Content-Type': 'image/jpeg', 'X-Frame-At': str(fake.devices[device])})
                self._send(404)

            def do_POST(self):
                if not self._authorized():
                    return
                device = self.path.removeprefix('/api/internal/detections/')
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if device in fake.failing_posts:
                    return self._send(500)
                fake.posted.setdefault(device, []).append(body)
                self._send(200 if device in fake.devices else 404, b'{}', {'Content-Type': 'application/json'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def web():
    fake = FakeWeb()
    yield fake
    fake.close()


@pytest.fixture
def make_api(web):
    apis = []

    def make(token: str = TOKEN) -> InternalApi:
        apis.append(InternalApi(web.url, token))
        return apis[-1]

    yield make
    for api in apis:
        api.close()


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class CountingPipeline:
    def __init__(self, log: list):
        self.log = log

    def process(self, bgr, at_ms):
        self.log.append(at_ms)
        return {'at': at_ms, 'dark': False, 'width': bgr.shape[1], 'height': bgr.shape[0], 'objects': [], 'trails': []}


def test_client_sends_the_bearer_token_and_reads_frames(web, make_api):
    web.devices = {'d1': 1_000}
    api = make_api()
    assert api.devices() == [DeviceRef('d1', 1_000)]
    frame = api.frame('d1')
    assert frame.at == 1_000 and frame.jpeg == JPEG
    assert api.frame('missing') is None
    assert api.post_detections('d1', {'at': 1_000}) is True
    assert api.post_detections('gone', {'at': 1_000}) is False
    assert {auth for _, _, auth in web.requests} == {f'Bearer {TOKEN}'}


def test_wrong_token_raises(web, make_api):
    import httpx
    with pytest.raises(httpx.HTTPStatusError):
        make_api('wrong').devices()


def test_config_refuses_a_missing_token():
    with pytest.raises(SystemExit):
        load_config({'WORKER_TOKEN': '  '})
    config = load_config({'WORKER_TOKEN': 'abc', 'WEB_URL': 'http://web:3000/'})
    assert config.web_url == 'http://web:3000' and config.model_path == '/app/models/yolox_nano.onnx'


def test_loop_skips_unchanged_frames_and_caps_two_per_second(web, make_api):
    web.devices = {'d1': 1_000}
    clock = FakeClock()
    runs: list[int] = []
    scheduler = Scheduler(make_api(), lambda: CountingPipeline(runs), clock)
    assert scheduler.tick() == ['d1']
    clock.now = 0.5
    assert scheduler.tick() == []                 # same frame time: nothing to do
    web.devices['d1'] = 1_100
    clock.now = 0.7
    assert scheduler.tick() == ['d1']             # new frame, 0.7 s after the last run
    web.devices['d1'] = 1_200
    clock.now = 0.9
    assert scheduler.tick() == []                 # new frame, but only 0.2 s later: over 2 frames/s
    clock.now = 1.2
    assert scheduler.tick() == ['d1']
    assert runs == [1_000, 1_100, 1_200]
    assert [p['at'] for p in web.posted['d1']] == runs


def test_round_robin_when_a_pass_runs_out_of_time(web, make_api):
    web.devices = {'a': 1, 'b': 1, 'c': 1}
    clock = FakeClock()

    class SlowPipeline(CountingPipeline):
        def process(self, bgr, at_ms):
            clock.now += 0.3  # each frame takes 300 ms, so a 500 ms pass serves two devices
            return super().process(bgr, at_ms)

    runs: list[int] = []
    scheduler = Scheduler(make_api(), lambda: SlowPipeline(runs), clock)
    assert scheduler.tick() == ['a', 'b']
    for key in web.devices:
        web.devices[key] = 2
    clock.now += 1.0
    assert scheduler.tick() == ['c', 'a']         # starts after the last device served
    assert scheduler.tick() == ['b']


def test_devices_that_go_offline_lose_their_state(web, make_api):
    web.devices = {'d1': 1}
    clock = FakeClock()
    scheduler = Scheduler(make_api(), lambda: CountingPipeline([]), clock)
    scheduler.tick()
    assert 'd1' in scheduler.pipelines
    web.devices = {}
    scheduler.tick()
    assert scheduler.pipelines == {}


def test_a_failing_device_does_not_starve_the_others(web, make_api):
    web.devices = {'a': 1, 'b': 1, 'c': 1}
    web.failing_posts = {'a'}
    clock = FakeClock()
    scheduler = Scheduler(make_api(), lambda: CountingPipeline([]), clock)
    assert scheduler.tick() == ['b', 'c']         # a's POST returns 500; b and c are still served
    for key in web.devices:
        web.devices[key] = 2
    clock.now += 1.0
    assert scheduler.tick() == ['b', 'c']         # a is tried first again, still failing, without blocking the rest
    assert len(web.posted['b']) == 2 and 'a' not in web.posted


def test_a_failing_device_list_skips_the_pass(web, make_api):
    scheduler = Scheduler(make_api('wrong'), lambda: CountingPipeline([]), FakeClock())
    assert scheduler.tick() == []


def test_the_pipeline_is_built_once_per_device(web, make_api):
    web.devices = {'d1': 1}
    clock = FakeClock()
    built = []
    scheduler = Scheduler(make_api(), lambda: built.append(1) or CountingPipeline([]), clock)
    for at in (1, 2, 3):
        web.devices['d1'] = at
        clock.now += 1.0
        assert scheduler.tick() == ['d1']
    assert len(built) == 1
