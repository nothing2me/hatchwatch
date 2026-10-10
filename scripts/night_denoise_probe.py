"""Development-only night denoising probe for the current dark footage.

Compares four signal constructions through the SAME fixed detector and
settings (config/settings-swarm.json), so any difference is attributable to
the signal, not to threshold tuning:

  fixed     - current extractor behaviour: static first-2 s median baseline
              and delayed-frame difference (control).
  floor     - per-pixel noise floor from the baseline window is subtracted
              (soft threshold): |diff| - k*sigma, clipped at 0.
  temporal  - floor, plus a 3-frame temporal median along time.
  running   - floor + 3-frame temporal median + running-average background
              (mean of the last `window_seconds`) instead of a static baseline.

The pipeline stages are NOT modified; this probe reproduces their fixed path
in scripts and evaluates on a development '-'dev-' recording only. Results are
explicitly development measurements, not registered accuracy.
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


def frames_of(video):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS)
    grays = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        grays.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    cap.release()
    if fps <= 0 or len(grays) < 16:
        raise ValueError('Incomplete dark source video')
    return np.asarray(grays, dtype=np.uint8), fps


def signal_extraction(frames, calibration, settings, variant, sigma):
    cfg = read_json(settings)
    cal = read_json(calibration)
    grid_w, grid_h = cfg['grid_width'], cfg['grid_height']
    fps = cfg['fps']
    delay = max(1, round(cfg['delay_seconds'] * fps)) + 1
    window = max(1, round(cfg['window_seconds'] * fps))

    baseline = np.median(frames[: round(2 * fps)], axis=0).astype(np.float32)
    static_noise = np.maximum(np.std(frames[: round(2 * fps)].astype(np.float32), axis=0), 1.5)

    H, _ = ground_homography(cal, grid_w, grid_h)
    valid = cv2.warpPerspective(np.full(frames.shape[1:], 255, np.uint8), H, (grid_w, grid_h)) > 250

    history = deque(maxlen=delay)          # delayed-frame comparison (same as extract.py)
    running = deque(maxlen=window)         # running background window
    run_sum = np.zeros(frames.shape[1:], np.float32)

    background = []
    motion = []
    for frame in frames:
        current = frame.astype(np.float32)
        history.append(current)
        recent_diff = np.abs(current - history[0])
        if variant == 'running':
            if len(running) == window:
                run_sum -= running[0]
            running.append(current)
            run_sum += current
            bg = run_sum / len(running)
            persistent_diff = np.abs(current - bg)
        else:
            persistent_diff = np.abs(current - baseline)

        if variant == 'fixed':
            bg_mask = persistent_diff
            recent_mask = recent_diff
        else:
            bg_mask = np.clip(persistent_diff - sigma * static_noise, 0, None)
            recent_mask = np.clip(recent_diff - sigma * static_noise * 2 ** 0.5, 0, None)

        if variant in ('temporal', 'running'):
            bg_mask = np.maximum(bg_mask, 0).astype(np.float32)
            recent_mask = np.maximum(recent_mask, 0).astype(np.float32)
            # 3-frame temporal median over the last three values (stack kept implicitly by re-computing
            # the last three frames is too heavy; use a compact IIR: median(prev, cur, |cur-prev|) shape.
            # Simplest effective: median blur plus a second difference with the one-before-delay frame.
            prev2 = history[-2] if len(history) >= 2 else history[0]
            recent_mask = np.minimum(recent_mask, np.abs(current - prev2) - sigma * static_noise * 2)

        bg_mask = cv2.medianBlur(np.clip(bg_mask, 0, 255).astype(np.uint8), 3)
        recent_mask = cv2.medianBlur(np.clip(recent_mask, 0, 255).astype(np.uint8), 3)
        bg_w = cv2.warpPerspective(bg_mask, H, (grid_w, grid_h))
        re_w = cv2.warpPerspective(recent_mask, H, (grid_w, grid_h))
        bg_w[~valid] = 0
        re_w[~valid] = 0
        background.append(bg_w)
        motion.append(re_w)

    return {
        'background': np.asarray(background, np.uint8),
        'motion': np.asarray(motion, np.uint8),
        'timestamps': np.arange(len(frames), dtype=np.float64) / fps,
        'valid': valid,
    }


def run(run_id):
    if '-dev-' not in run_id:
        raise SystemExit('Night denoise probing is limited to development recordings.')
    public = ROOT / 'artifacts/public' / run_id
    truth = read_json(ROOT / 'artifacts/private' / run_id / 'truth.json')
    registration = read_json(ROOT / 'config/registration.json')
    settings = ROOT / 'config/settings-swarm.json'
    output = ROOT / 'artifacts/probes' / run_id / 'night-denoise'

    frames_by_view = {}
    for view in (0, 1):
        frames, fps = frames_of(public / f'camera-{view}.mp4')
        frames_by_view[view] = frames
        print(f'view {view}: {len(frames)} frames @ {fps:.3f} fps', flush=True)

    rows = []
    variants = ['fixed'] + [f'{name}@{sigma}' for name in ('floor', 'temporal', 'running') for sigma in (2.0, 2.5, 3.0, 3.5)]
    for label in variants:
        variant = label.split('@')[0]
        sigma = float(label.split('@')[1]) if '@' in label else None
        row = {'variant': variant, 'sigma': sigma, 'views': {}}
        for view in (0, 1):
            folder = output / label / f'view-{view}'
            folder.mkdir(parents=True, exist_ok=True)
            calibration = public / f'calibration-{view}.json'
            data = signal_extraction(frames_by_view[view], calibration, settings, variant, sigma)
            np.savez_compressed(folder / 'signals.npz', **data)
            prediction = detect(folder / 'signals.npz', calibration, settings, folder / 'detection')
            score = evaluate(prediction, truth, registration)['methods']['full']
            row['views'][str(view)] = {'tp': score['tp'], 'fp': score['fp'], 'fn': score['fn'], 'center_error_m': score['localization_errors_m']}
        rows.append(row)
        print(f'{label}: {row["views"]}', flush=True)
    write_json(output / 'summary.json', {'development_run': run_id, 'rows': rows, 'note': 'Development night-denoise comparison; not registered accuracy.'})
    print(f'Wrote {output}/summary.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='A-swarm-night-dev-601')
    run(parser.parse_args().run)