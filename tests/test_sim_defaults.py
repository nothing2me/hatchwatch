"""Default simulator renders stay byte-identical (opt-in layout/humans must not leak into defaults).

Skipped unless NESTTRACE_SIM_CHECK=1 and root Vite answers on 127.0.0.1:5173, because it needs a real
WebGL browser. Runs scripts/sim-frame-hash.mjs --check and scripts/sim-markers-check.mjs.
"""
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _vite_answers():
    try:
        with urllib.request.urlopen('http://127.0.0.1:5173/record.html', timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    os.environ.get('NESTTRACE_SIM_CHECK') != '1' or not _vite_answers(),
    reason='set NESTTRACE_SIM_CHECK=1 and serve web/ with root Vite on 5173',
)


def _node(*args):
    return subprocess.run([shutil.which('node') or 'node', *args], cwd=ROOT, capture_output=True, text=True, timeout=300)


def test_default_frames_match_fixture():
    result = _node('scripts/sim-frame-hash.mjs', '--check', 'tests/fixtures/sim-default-frame-hashes.json')
    assert result.returncode == 0, result.stdout + result.stderr


def test_seaward_markers_and_water_in_frame():
    result = _node('scripts/sim-markers-check.mjs')
    assert result.returncode == 0, result.stdout + result.stderr
