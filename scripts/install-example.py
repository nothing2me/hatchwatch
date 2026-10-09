"""Install the bundled development example into the local UI artifact directories."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[1]
for kind in ('public','private'):
    source=ROOT/'examples/A-clean-11'/kind
    if not source.is_dir():raise SystemExit(f'Missing bundled example: {source}')
    shutil.copytree(source,ROOT/'artifacts'/kind/'A-clean-11',dirs_exist_ok=True)
print('Installed A-clean-11. Start the Vite and API servers, then select A-clean-11 in the UI.')
