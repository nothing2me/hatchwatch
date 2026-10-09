"""Blind detector. Explicit inputs: differences, timestamps, calibration and settings only.

No imports from simulator/evaluator. No seed, scenario, RGB, or truth arguments.
"""
import argparse, time
from pathlib import Path
import cv2
import numpy as np
from common import read_json, write_json, sha

LABEL='Digging activity detected; nesting unresolved.'
UNCERTAIN='Localized activity; insufficient evidence to classify.'

def smooth_map(a, radius=7):
    return cv2.GaussianBlur(a.astype(np.float32),(0,0),radius)

def candidates(score, threshold, cfg, timestamps, activity, evidence, method):
    h,w=score.shape;work=score.copy();found=[]
    for _ in range(cfg['max_candidates']):
        _,peak,_,loc=cv2.minMaxLoc(work);x,y=loc
        if peak<threshold:break
        point=[x/(w-1)*16-8,y/(h-1)*12-6]
        curve=activity[:,max(0,y-5):y+6,max(0,x-5):x+6].mean(axis=(1,2));active=np.flatnonzero(curve>.025)
        interval=[float(timestamps[active[0]]),float(timestamps[active[-1]])] if len(active) else [float(timestamps[0]),float(timestamps[-1])]
        summary={k:round(float(v[y,x]),4) for k,v in evidence.items()}
        found.append({'id':f'{method}-{len(found)+1}','point':point,'radius_m':cfg['radius_m'],'area_m2':float(np.pi*cfg['radius_m']**2),'interval':interval,'score':float(peak),'label':LABEL if method=='full' and summary['persistent']>.04 else UNCERTAIN,'evidence':summary,'observation_quality':'limited' if summary['persistent']<.04 else 'usable','uncertainty_note':'Fixed registered inspection radius; elevated-motion parallax and surface visibility remain uncalibrated.','supporting_clip':'extraction.mp4'})
        cv2.circle(work,loc,round(cfg['min_separation_m']*w/16),0,-1)
    return found

def detect(signals,calibration,settings,output):
    begin=time.perf_counter();cfg=read_json(settings);read_json(calibration)
    with np.load(signals,allow_pickle=False) as z:
        if set(z.files)!={'background','motion','timestamps','valid'}:raise ValueError('Unexpected signal fields')
        bg=z['background']; motion=z['motion'];ts=z['timestamps'];valid=z['valid']
    fps=1/np.median(np.diff(ts));a=(motion>cfg['motion_threshold']).astype(np.float32);b=(bg>cfg['pixel_threshold']).astype(np.float32)
    # Recent activity is counted from delayed differences only. Persistent change is sampled once after activity.
    recent=a.mean(axis=0);persistent=b[-max(1,round(fps*4)):].mean(axis=0)
    activity=smooth_map(recent,4);persist=smooth_map(persistent,3)
    # Dwell: number of time windows containing localized activity, distinct from stationary surface change.
    win=max(1,round(fps*cfg['window_seconds'])); windows=[a[i:i+win].mean(axis=0) for i in range(0,len(a),win)]
    dwell=smooth_map(np.mean([v>.025 for v in windows],axis=0),4)
    # Simple nearest-centroid tracking of motion blobs, in public calibrated ground coordinates.
    tracks=[];active_tracks=[]
    for i in range(0,len(a),max(1,round(fps/2))):
        mask=cv2.morphologyEx(a[i].astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8));n,labels,stats,centroids=cv2.connectedComponentsWithStats(mask)
        blobs=[c for c,s in zip(centroids[1:],stats[1:]) if s[4]>=4]; used=set()
        for c in blobs:
            options=[(np.linalg.norm(c-tr['points'][-1]),j,tr) for j,tr in enumerate(active_tracks) if j not in used and i-tr['last']<=fps*2]
            if options and min(o[0] for o in options)<15:
                _,j,tr=min(options,key=lambda o:o[0]);used.add(j);tr['points'].append(c);tr['frames'].append(i);tr['last']=i
            else:
                tr={'points':[c],'frames':[i],'last':i};tracks.append(tr);active_tracks.append(tr);used.add(len(active_tracks)-1)
    tracking=np.zeros_like(recent);continuity=np.zeros_like(recent)
    for tr in tracks:
        points=np.asarray(tr['points']);duration=(tr['frames'][-1]-tr['frames'][0])/fps
        if duration<3:continue
        traveled=np.linalg.norm(points[-1]-points[0])
        for p in points:
            near=np.linalg.norm(points-p,axis=1)<8;local_dwell=np.sum(near)*.5
            if local_dwell>=2:
                x,y=np.rint(p).astype(int);tracking[y,x]=max(tracking[y,x],local_dwell/10);continuity[y,x]=max(continuity[y,x],min(1,traveled/15))
    tracker=smooth_map(tracking,5)*20;continuous=smooth_map(continuity,5)*20
    # Evidence fusion within a camera; no egg classification.
    motion_score=activity*5;frozen_score=persist.copy()
    count,regions,stats,_=cv2.connectedComponentsWithStats((persistent>.5).astype(np.uint8))
    persistent_regions=np.zeros_like(persistent,np.uint8)
    for component in range(1,count):
        if stats[component,cv2.CC_STAT_AREA]>=4:persistent_regions[regions==component]=1
    frozen_score[smooth_map(persistent_regions,3)<.03]=0
    full=np.sqrt(np.maximum(activity*4*dwell,0))*.65+np.sqrt(np.maximum(activity*4*persist,0))*.30+np.minimum(continuous,1)*.05
    scores={'frozen':frozen_score,'motion':motion_score,'tracker':tracker,'full':full}
    evidence={'activity':activity,'persistent':persist,'dwell':dwell,'travel_continuity':continuous}
    methods={}
    thresholds={'frozen':cfg['frozen_threshold'],'motion':cfg['motion_score_threshold'],'tracker':cfg['tracker_threshold'],'full':cfg['full_threshold']}
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    for method,score in scores.items():
        score[~valid]=0;methods[method]=candidates(score,thresholds[method],cfg,ts,a,evidence,method)
        cv2.imwrite(str(out/f'{method}-heatmap.png'),cv2.applyColorMap(np.clip(score*255,0,255).astype(np.uint8),cv2.COLORMAP_INFERNO))
    result={'schema_version':1,'input_sha256':sha(signals),'settings_sha256':sha(settings),'calibration_sha256':sha(calibration),'runtime_seconds':time.perf_counter()-begin,'methods':methods,'status':LABEL if methods['full'] else 'No candidate detected.','input_contract':'Difference arrays and timestamps only; no RGB, seed, scenario, simulator state, or truth.'}
    write_json(out/'predictions.json',result);return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--signals',required=True);p.add_argument('--calibration',required=True);p.add_argument('--settings',required=True);p.add_argument('--output',required=True);a=p.parse_args();detect(a.signals,a.calibration,a.settings,a.output)
