import logging
import time

import httpx

from .api import InternalApi
from .config import load_config
from .detector import PersonDetector
from .device import DevicePipeline
from .scheduler import LOOP_MS, Scheduler

ERROR_BACKOFF_S = 2.0

log = logging.getLogger('hatchwatch_worker')


def run() -> None:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s worker %(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)  # its INFO lines list every request
    config = load_config()
    detector = PersonDetector(config.model_path)
    api = InternalApi(config.web_url, config.token)
    scheduler = Scheduler(api, lambda: DevicePipeline(detector.detect))
    log.info('live detection on; web at %s', config.web_url)
    while True:
        started = time.monotonic()
        try:
            scheduler.tick()
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            log.warning('web answered %s%s; retrying in %.0f s', status, ' (worker token refused)' if status == 401 else '', ERROR_BACKOFF_S)
            time.sleep(ERROR_BACKOFF_S)
            continue
        except httpx.HTTPError as error:
            # Never logs the token or frame data: only the error class and status.
            log.warning('web not reachable (%s); retrying in %.0f s', type(error).__name__, ERROR_BACKOFF_S)
            time.sleep(ERROR_BACKOFF_S)
            continue
        except Exception as error:  # noqa: BLE001 - the loop must survive anything; class name only
            log.warning('pass failed (%s); retrying in %.0f s', type(error).__name__, ERROR_BACKOFF_S)
            time.sleep(ERROR_BACKOFF_S)
            continue
        time.sleep(max(0.0, LOOP_MS / 1000 - (time.monotonic() - started)))


if __name__ == '__main__':
    run()
