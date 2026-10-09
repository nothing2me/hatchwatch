"""Development-only per-pixel noise-normalized extraction from dark source video.

The detector receives only difference arrays, calibration and fixed settings.
This probe explores whether baseline-measured sensor variance can suppress the
flicker that global brightness amplification promotes into false motion.
"""
import argparse
import sys
from collections import deque
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import ground_homography, read_json, write_json
from detect import detect
from evaluate import evaluate


def signals(video, calibration, settings, threshold_sigma):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if fps <= 0 or count < 16:
        raise ValueError('Incomplete dark source video')
    gray = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gray.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    cap.release()
    frames = np.asarray(gray, dtype=np.uint8)
    baseline = np.median(frames[:round(2 * fps)], axis=0).astype(np.float32)
    noise = np.std(frames[:round(2 * fps)].astype(np.float32), axis=0)
    # The floor guards against zero-MAD quantization artifacts in dark pixels.
    noise = np.maximum(noise, 1.5)
    cal = read_json(calibration)
    cfg = read_json(settings)
    width, height = cfg['grid_width'], cfg['grid_height']
    H, _ = ground_homography(cal, width, height)
    valid = cv2.warpPerspective(np.full(frames.shape[1:], 255, np.uint8), H, (width, height)) > 250
    history = deque(maxlen=max(1, round(cfg['delay_seconds'] * fps)) + 1)
    background = []
    motion = []
    for frame in frames:
        current = frame.astype(np.float32)
        history.append(current)
        persistent = (np.abs(current - baseline) > threshold_sigma * noise).astype(np.uint8) * 255
        recent = (np.abs(current - history[0]) > threshold_sigma * noise * 2**0.5).astype(np.uint8) * 255
        persistent = cv2.warpPerspective(persistent, H, (width, height))
        recent = cv2.warpPerspective(recent, H, (width, height))
        persistent[~valid] = 0
        recent[~valid] = 0
        background.append(persistent)
        motion.append(recent)
    return {'background': np.asarray(background), 'motion': np.asarray(motion), 'timestamps': np.arange(len(frames), dtype=np.float64) / fps, 'valid': valid}, {'baseline_noise_mean': float(noise.mean()), 'threshold_sigma': threshold_sigma, 'frames': len(frames)}


def run(run_id):
    if '-dev-' not in run_id:
        raise SystemExit('Adaptive low-light probing is limited to development recordings.')
    public = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    registration = read_json(ROOT / 'config/registration.json')
    settings = ROOT / 'config/settings-swarm.json'
    output = ROOT / 'artifacts/probes' / run_id / 'adaptive-noise'
    rows = []
    for sigma in (2.0, 2.5, 3.0, 3.5, 4.0):
        row = {'sigma': sigma, 'views': {}}
        for view in (0, 1):
            folder = output / str(sigma) / f'view-{view}'
            folder.mkdir(parents=True, exist_ok=True)
            calibration = public / f'calibration-{view}.json'
            data, metadata = signals(public / f'camera-{view}.mp4', calibration, settings, sigma)
            np.savez_compressed(folder / 'signals.npz', **data)
            prediction = detect(folder / 'signals.npz', calibration, settings, folder / 'detection')
            score = evaluate(prediction, truth, registration)['methods']['full']
            row['views'][str(view)] = {'tp': score['tp'], 'fp': score['fp'], 'fn': score['fn'], **metadata}
        rows.append(row)
        print(row, flush=True)
    write_json(output / 'summary.json', {'development_run': run_id, 'rows': rows, 'note': 'Exploratory baseline-normalized extraction; not registered nighttime accuracy.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='A-swarm-night-dev-601')
    args = parser.parse_args()
    run(args.run)
