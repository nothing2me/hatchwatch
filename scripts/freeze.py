import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'))
from common import sha,write_json
target=ROOT/'config/frozen.json'
if target.exists():raise SystemExit('Already frozen. Do not overwrite after inspecting validation.')
write_json(target,{'settings_sha256':sha(ROOT/'config/settings.json'),'registration_sha256':sha(ROOT/'config/registration.json'),'simulator_sha256':sha(ROOT/'web/simulation.ts'),'sand_sha256':sha(ROOT/'web/sand.ts'),'detector_sha256':sha(ROOT/'pipeline/detect.py'),'extractor_sha256':sha(ROOT/'pipeline/extract.py'),'challenge_authorship':'Same contributor; not independent.'})
print('Registered settings and source frozen.')
