import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from extract import load_mask  # noqa: E402

EXAMPLE = ROOT / 'schemas' / 'examples' / 'camera-masks.v1.example.json'


def test_runner_reads_the_dashboard_written_mask_file():
    # pipeline/extract.py is frozen; the dashboard's file must stay readable by it unchanged.
    for slot in (0, 1):
        polygon, digest = load_mask(str(EXAMPLE), slot)
        assert polygon is not None and len(polygon) >= 3 and digest
        assert all(0 <= x <= 1280 and 0 <= y <= 720 for x, y in polygon)
    assert load_mask(str(EXAMPLE), 2) == (None, None)


def test_example_and_repository_default_match_the_contract():
    import json
    schema = json.loads((ROOT / 'schemas' / 'camera-masks.v1.json').read_text())
    for path in (EXAMPLE, ROOT / 'config' / 'camera-masks.json'):
        doc = json.loads(path.read_text())
        try:
            import jsonschema
        except ImportError:
            assert doc['schema'] in schema['properties']['schema']['enum'] and doc['version'] == 1
            assert all(isinstance(entry['camera'], int) and len(entry['polygon']) >= 3 for entry in doc['cameras'])
            assert all(len(entry['polygon']) >= 3 and entry['updated_at'] for entry in doc.get('by_code', {}).values())
        else:
            jsonschema.validate(doc, schema)
