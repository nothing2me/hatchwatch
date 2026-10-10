import re

from tests.helpers import MODEL_SHA256, MODEL_URL, WORKER


def test_dockerfile_pins_the_model_release_and_hash():
    dockerfile = (WORKER / 'Dockerfile').read_text()
    assert f'ARG MODEL_URL={MODEL_URL}' in dockerfile
    assert f'ARG MODEL_SHA256={MODEL_SHA256}' in dockerfile
    assert 'sha256sum -c -' in dockerfile
    assert '|| true' not in dockerfile
    # the download and the hash check are one && chain, so a mismatch fails the build
    start = dockerfile.index('RUN mkdir -p /app/models')
    chain = dockerfile[start:dockerfile.index('\nCOPY . .')]
    assert chain.index('urlretrieve') < chain.index('sha256sum -c -')
    assert chain.count('&&') >= 2 and ' ;' not in chain and ';\n' not in chain


def test_worker_never_reaches_into_the_research_app():
    # agent.md: the worker is dashboard code. No simulator, research pipeline, research API, seeds or private paths.
    imports = re.compile(r'^\s*(from|import)\s+(pipeline|web|scripts|config)\b', re.MULTILINE)
    for path in (WORKER / 'hatchwatch_worker').glob('*.py'):
        text = path.read_text()
        assert not imports.search(text), path.name
        for word in ('artifacts/', 'private/', 'server.mjs', ':5174', 'truth.json'):
            assert word not in text, f'{path.name} mentions {word}'
