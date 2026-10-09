"""Run frozen detector settings against real re-encoded video variants; count full analysis cost."""
import argparse, subprocess, sys, time, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'));sys.path.insert(0,str(ROOT/'scripts'))
import imageio_ffmpeg
from common import read_json,write_json,sha
from analyze import run

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('run_id');a=p.parse_args();source=ROOT/'artifacts/public'/a.run_id;private=ROOT/'artifacts/private'/a.run_id
    variants=[('half-fps',['-vf','fps=4'],1),('half-resolution',['-vf','scale=240:160'],.5),('compressed',['-b:v','100k','-maxrate','100k','-bufsize','200k'],1),('no-preprocess',[],1),('short-delay',[],1),('long-delay',[],1)]
    rows=[]
    for name,args,scale in variants:
        id=f'{a.run_id}-{name}';dest=ROOT/'artifacts/public'/id;priv=ROOT/'artifacts/private'/id;dest.mkdir(parents=True,exist_ok=True);priv.mkdir(parents=True,exist_ok=True)
        cal=read_json(source/'calibration-0.json');cal['width']=int(cal['width']*scale);cal['height']=int(cal['height']*scale)
        for pt in cal['reference_points']:pt['pixel']=[v*scale for v in pt['pixel']]
        write_json(dest/'calibration-0.json',cal);shutil.copy2(private/'truth.json',priv/'truth.json')
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-loglevel','error','-y','-i',str(source/'camera-0.mp4'),*args,'-c:v','libx264','-preset','fast',*([] if name=='compressed' else ['-crf','10']),str(dest/'camera-0.mp4')],check=True)
        cfg=read_json(ROOT/'config/settings.json')
        if name=='no-preprocess':cfg['preprocess']=False
        if name=='short-delay':cfg['delay_seconds']=.25
        if name=='long-delay':cfg['delay_seconds']=1.0
        path=priv/'settings.json';write_json(path,cfg);run(id,settings=path)
        rows.append({'variant':name,'video_bytes':(dest/'camera-0.mp4').stat().st_size,'analysis':read_json(dest/'analysis.json'),'extraction':read_json(dest/'view-0/metadata.json'),'evaluation':read_json(priv/'evaluation-0.json')})
    write_json(ROOT/'artifacts/reports/efficiency.json',{'source_run':a.run_id,'rows':rows,'scope':'One development recording, exploratory paired comparison. Decode, preprocessing, extraction, diagnostic encoding and detection are included. No energy estimate or peak-memory claim.'})
