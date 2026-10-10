"""Exploratory preprocessing on a development night video, outside registered stress runs.

Writes new source videos, then feeds each through the unchanged extractor and detector.
Private truth is read only after predictions have been saved.
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import read_json, write_json, writer


def brighten(frame, variant, clahe):
    if variant == 'gain4':
        return cv2.convertScaleAbs(frame, alpha=4, beta=0)
    if variant == 'blur-gain4':
        return cv2.convertScaleAbs(cv2.GaussianBlur(frame, (7, 7), 0), alpha=4, beta=0)
    if variant == 'clahe':
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    raise ValueError(variant)


def temporal_median(previous, current, following):
    low = np.minimum(previous, current)
    high = np.maximum(previous, current)
    return np.maximum(low, np.minimum(high, following))


def run(run_id, view, variants):
    public = ROOT / 'artifacts/public' / run_id
    private = ROOT / 'artifacts/private' / run_id
    if not (public / f'camera-{view}.mp4').is_file() or not (private / 'truth.json').is_file():
        raise SystemExit('Use a completed development night recording with private truth.')
    out = ROOT / 'artifacts/probes' / run_id / f'view-{view}'
    out.mkdir(parents=True, exist_ok=True)
    source = public / f'camera-{view}.mp4'
    calibration = public / f'calibration-{view}.json'
    settings = ROOT / 'config/settings-swarm.json'
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    summary_path = out / 'summary.json'
    results = read_json(summary_path).get('variants', {}) if summary_path.is_file() else {}
    for prior in ('gain4', 'blur-gain4', 'clahe', 'temporal-gain4'):
        folder = out / prior
        if prior in results or not (folder / 'evaluation.json').is_file():
            continue
        metrics = read_json(folder / 'evaluation.json')['methods']['full']
        metadata = read_json(folder / 'signals/metadata.json')
        results[prior] = {'tp': metrics['tp'], 'fp': metrics['fp'], 'fn': metrics['fn'], 'mean_center_error_m': sum(metrics['localization_errors_m']) / len(metrics['localization_errors_m']) if metrics['tp'] else None, 'registration_failures': metadata['registration_failures'], 'video_bytes': (folder / 'enhanced.mp4').stat().st_size}
    for variant in variants:
        folder = out / variant
        folder.mkdir(parents=True, exist_ok=True)
        cap = cv2.VideoCapture(str(source))
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        proc = writer(folder / 'enhanced.mp4', width, height, fps)
        count = 0
        if variant == 'temporal-gain4':
            ok, current = cap.read()
            if not ok:
                raise RuntimeError('No frames in source video')
            previous = current
            while True:
                has_next, following = cap.read()
                if not has_next:
                    following = current
                cleaned = temporal_median(previous, current, following)
                proc.stdin.write(cv2.convertScaleAbs(cleaned, alpha=4, beta=0).tobytes())
                count += 1
                if not has_next:
                    break
                previous, current = current, following
        else:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                proc.stdin.write(brighten(frame, variant, clahe).tobytes())
                count += 1
        cap.release()
        proc.stdin.close()
        if proc.wait() != 0 or count < 16:
            raise RuntimeError(f'Could not encode {variant}')
        signals = folder / 'signals'
        subprocess.run([sys.executable, str(ROOT / 'pipeline/extract.py'), '--video', str(folder / 'enhanced.mp4'), '--calibration', str(calibration), '--settings', str(settings), '--output', str(signals)], check=True)
        with tempfile.TemporaryDirectory(prefix='hatchwatch-night-probe-') as temp:
            stage = Path(temp)
            for file, name in [(signals / 'signals.npz', 'signals.npz'), (calibration, 'calibration.json'), (settings, 'settings.json'), (ROOT / 'pipeline/detect.py', 'detect.py'), (ROOT / 'pipeline/common.py', 'common.py')]:
                shutil.copy2(file, stage / name)
            subprocess.run([sys.executable, 'detect.py', '--signals', 'signals.npz', '--calibration', 'calibration.json', '--settings', 'settings.json', '--output', 'output'], cwd=stage, check=True)
            shutil.copytree(stage / 'output', folder / 'detection', dirs_exist_ok=True)
        subprocess.run([sys.executable, str(ROOT / 'pipeline/evaluate.py'), '--predictions', str(folder / 'detection/predictions.json'), '--truth', str(private / 'truth.json'), '--registration', str(ROOT / 'config/registration.json'), '--output', str(folder / 'evaluation.json')], check=True)
        metrics = read_json(folder / 'evaluation.json')['methods']['full']
        metadata = read_json(signals / 'metadata.json')
        results[variant] = {'tp': metrics['tp'], 'fp': metrics['fp'], 'fn': metrics['fn'], 'mean_center_error_m': sum(metrics['localization_errors_m']) / len(metrics['localization_errors_m']) if metrics['tp'] else None, 'registration_failures': metadata['registration_failures'], 'video_bytes': (folder / 'enhanced.mp4').stat().st_size}
        print(variant, results[variant], flush=True)
    write_json(summary_path, {'development_run': run_id, 'camera': view, 'note': 'Exploratory preprocessing on one development seed only. Not part of registered stress results.', 'variants': results})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='A-swarm-night-dev-601')
    parser.add_argument('--view', type=int, choices=[0, 1], default=1)
    parser.add_argument('--variants', nargs='*', choices=['gain4', 'blur-gain4', 'clahe', 'temporal-gain4'], default=['gain4', 'blur-gain4', 'clahe', 'temporal-gain4'])
    args = parser.parse_args()
    run(args.run, args.view, args.variants)
