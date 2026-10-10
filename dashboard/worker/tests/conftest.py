import os
from pathlib import Path

import pytest

from tests.helpers import WORKER


@pytest.fixture(scope='session')
def model_path() -> str:
    path = Path(os.environ.get('MODEL_PATH', WORKER / 'models' / 'yolox_nano.onnx'))
    if not path.is_file():
        pytest.fail(f'{path} is missing: download the model first (dashboard/README.md, "Live detection")')
    return str(path)
