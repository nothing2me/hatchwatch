import re

from tests.helpers import MODEL_SHA256, MODEL_URL, WORKER


def test_dockerfile_pins_the_model_release_and_hash():
    dockerfile = (WORKER / 'Dockerfile').read_text()
    assert f'ARG MODEL_URL={MODEL_URL}' in dockerfile
    assert f'ARG MODEL_SHA256={MODEL_SHA256}' in dockerfile
    assert 'sha256sum -c -' in dockerfile


def test_worker_never_reaches_into_the_research_app():
    # agent.md: the worker is dashboard code. No simulator, research pipeline, research API, seeds or private paths.
    imports = re.compile(r'^\s*(from|import)\s+(pipeline|web|scripts|config)\b', re.MULTILINE)
    for path in (WORKER / 'nesttrace_worker').glob('*.py'):
        text = path.read_text()
        assert not imports.search(text), path.name
        for word in ('artifacts/', 'private/', 'server.mjs', ':5174', 'truth.json'):
            assert word not in text, f'{path.name} mentions {word}'
