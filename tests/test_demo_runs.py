import json

import pytest

from scripts import demo_runs


def test_registered_seeds_collects_every_registration(tmp_path):
    (tmp_path / 'a-registration.json').write_text(json.dumps({'seeds': [1, 2]}))
    (tmp_path / 'b-registration.json').write_text(json.dumps({'splits': {'validation': [3], 'test': [4, 5]}}))
    (tmp_path / 'settings.json').write_text(json.dumps({'seeds': [99]}))
    assert demo_runs.registered_seeds(tmp_path) == {1, 2, 3, 4, 5}


def test_demo_seeds_are_not_registered():
    used = demo_runs.registered_seeds(demo_runs.ROOT / 'config')
    assert not ({seed for _, _, seed in demo_runs.DEMO_RUNS} & used)


def test_guard_rejects_registered_seed(tmp_path):
    (tmp_path / 'x-registration.json').write_text(json.dumps({'seeds': [907]}))
    with pytest.raises(SystemExit, match='907'):
        demo_runs.check_seeds(tmp_path)
