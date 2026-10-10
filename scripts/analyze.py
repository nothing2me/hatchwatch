"""Independent subprocesses. Detector gets a minimal staging directory and explicit inputs.

This enforces an auditable data contract, not a hostile-code OS security sandbox.
"""
import argparse, shutil, subprocess, sys, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'pipeline'))
from common import read_json, write_json, sha

def run(run_id, cameras=(0,), settings=None, evaluate=True, mask=None):
    settings=Path(settings or ROOT/'config/settings.json').resolve();public=ROOT/'artifacts/public'/run_id;private=ROOT/'artifacts/private'/run_id;start=time.perf_counter()
    if mask is None:
        public_mask=ROOT/'artifacts/public/camera-masks.json'
        fallback_mask=ROOT/'config/camera-masks.json'
        mask=str(public_mask) if public_mask.exists() else (str(fallback_mask) if fallback_mask.exists() else None)
    for view in cameras:
        signal=public/f'view-{view}';prediction=signal/'detection'
        cmd=[sys.executable,str(ROOT/'pipeline/extract.py'),'--video',str(public/f'camera-{view}.mp4'),'--calibration',str(public/f'calibration-{view}.json'),'--settings',str(settings),'--output',str(signal)]
        if mask: cmd+=['--mask',str(mask)]
        subprocess.run(cmd,check=True)
        with tempfile.TemporaryDirectory(prefix='nesttrace-blind-') as tmp:
            stage=Path(tmp)
            for src,name in [(signal/'signals.npz','signals.npz'),(public/f'calibration-{view}.json','calibration.json'),(settings,'settings.json'),(ROOT/'pipeline/detect.py','detect.py'),(ROOT/'pipeline/common.py','common.py')]:shutil.copy2(src,stage/name)
            subprocess.run([sys.executable,'detect.py','--signals','signals.npz','--calibration','calibration.json','--settings','settings.json','--output','output'],cwd=stage,check=True)
            shutil.copytree(stage/'output',prediction,dirs_exist_ok=True)
            write_json(prediction/'input-manifest.json',{'files':{name:sha(stage/name) for name in ['signals.npz','calibration.json','settings.json']},'process':'Independent Python subprocess in minimal staging directory. Not an OS access-control sandbox.'})
    if evaluate:
        # Do not expose private truth until inference has finished for every requested view.
        for view in cameras:
            prediction=public/f'view-{view}'/'detection'
            subprocess.run([sys.executable,str(ROOT/'pipeline/evaluate.py'),'--predictions',str(prediction/'predictions.json'),'--truth',str(private/'truth.json'),'--registration',str(ROOT/'config/registration.json'),'--output',str(private/f'evaluation-{view}.json')],check=True)
    write_json(public/'analysis.json',{'cameras':list(cameras),'runtime_seconds':time.perf_counter()-start,'settings_sha256':sha(settings),'inference_complete':True})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('run_id');p.add_argument('--both',action='store_true');p.add_argument('--settings');p.add_argument('--no-evaluate',action='store_true');p.add_argument('--no-mask',action='store_true');a=p.parse_args();run(a.run_id,(0,1) if a.both else (0,),a.settings,not a.no_evaluate,None if not a.no_mask else '')
