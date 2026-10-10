"""Only this stage reads RGB video. Outputs observed difference signals, not RGB."""
import argparse, time
from collections import deque
from pathlib import Path
import cv2
import numpy as np
from common import read_json, write_json, sha, writer, ground_homography

def load_mask(mask_file, camera_index):
    """Operator-drawn per-camera watch polygon (source-frame pixels).

    Everything outside the polygon is excluded from the motion-signal grid
    (skies, surf, water, dune edges) while the raw video is untouched. Masks
    are public operator configuration, never simulator truth.
    """
    masks=read_json(mask_file)
    for entry in masks.get('cameras', []):
        if int(entry.get('camera'))==int(camera_index):
            polygon=[[float(x),float(y)] for x,y in entry['polygon']]
            if len(polygon)<3:
                raise ValueError('Camera mask needs at least 3 polygon points')
            return polygon, sha(mask_file)
    return None, None

def mask_image(polygon, height, width):
    img=np.zeros((height,width),np.uint8)
    cv2.fillConvexPoly(img,np.array(polygon,dtype=np.int32).reshape(-1,1,2),255)
    return img

def extract(video, calibration, settings, output, mask_file=None):
    start=time.perf_counter(); output=Path(output);output.mkdir(parents=True,exist_ok=True)
    cfg=read_json(settings); cal=read_json(calibration); cap=cv2.VideoCapture(str(video))
    if not cap.isOpened(): raise ValueError(f'Cannot decode {video}')
    fps=cap.get(cv2.CAP_PROP_FPS); total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); w=cfg['grid_width'];h=cfg['grid_height']
    if fps<=0 or total<16: raise ValueError('Video needs a clean two-second baseline and valid FPS')
    base_frames=[]
    for _ in range(round(fps*2)):
        ok,f=cap.read()
        if not ok:raise ValueError('Truncated baseline')
        base_frames.append(cv2.cvtColor(f,cv2.COLOR_BGR2GRAY))
    baseline=np.median(base_frames,axis=0).astype(np.uint8);cap.set(cv2.CAP_PROP_POS_FRAMES,0)
    # Fixed reference neighborhoods are declared calibration markers, not simulator masks.
    stable=np.zeros_like(baseline)
    for p in cal['reference_points']:
        x,y=np.rint(p['pixel']).astype(int);cv2.circle(stable,(x,y),12,255,-1)
    features=cv2.goodFeaturesToTrack(baseline,100,.01,4,mask=stable)
    H,cal_error=ground_homography(cal,w,h)
    valid=cv2.warpPerspective(np.ones_like(baseline)*255,H,(w,h))>250
    mask_polygon=None;mask_sha256=None
    if mask_file:
        mask_polygon,mask_sha256=load_mask(mask_file,cal['camera'])
        if mask_polygon is not None:
            native_mask=mask_image(mask_polygon,*baseline.shape)
            valid=cv2.warpPerspective(native_mask,H,(w,h))>128
    background=[];motion=[];times=[];history=deque(maxlen=max(1,round(cfg['delay_seconds']*fps))+1)
    out=writer(output/'extraction.mp4',w*3,h,fps)
    pure=writer(output/'pure-motion.mp4',baseline.shape[1],baseline.shape[0],fps)
    failures=0;gains=[]; suppression=[]
    i=0
    while True:
        ok,frame=cap.read()
        if not ok:break
        raw=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY);gray=raw.copy()
        if cfg['preprocess']:
            if features is not None and len(features)>=4:
                pts,status,_=cv2.calcOpticalFlowPyrLK(baseline,gray,features,None)
                good=status.ravel()==1 if status is not None else np.zeros(len(features),bool)
                if np.sum(good)>=4:
                    M,inliers=cv2.estimateAffinePartial2D(pts[good],features[good],method=cv2.RANSAC,ransacReprojThreshold=2)
                    if M is not None and np.linalg.norm(M[:,2])<15:
                        gray=cv2.warpAffine(gray,M,(gray.shape[1],gray.shape[0]))
                    else:failures+=1
                else:failures+=1
            a=gray[stable>0].astype(float);b=baseline[stable>0].astype(float)
            aq=np.percentile(a,[20,80]);bq=np.percentile(b,[20,80]);gain=float(np.clip((bq[1]-bq[0])/max(1,aq[1]-aq[0]),.7,1.4));offset=float(np.median(b-gain*a));gray=np.clip(gray*gain+offset,0,255).astype(np.uint8);gains.append(gain)
        suppression.append(float(np.mean(cv2.absdiff(raw,baseline)))-float(np.mean(cv2.absdiff(gray,baseline))))
        history.append(gray);recent=cv2.absdiff(gray,history[0]);bg=cv2.absdiff(gray,baseline)
        bg=cv2.medianBlur(bg,3);recent=cv2.medianBlur(recent,3)
        camera_motion=recent.copy()
        bg=cv2.warpPerspective(bg,H,(w,h));recent=cv2.warpPerspective(recent,H,(w,h));bg[~valid]=0;recent[~valid]=0
        background.append(bg);motion.append(recent);times.append(i/fps)
        # This export contains delayed-frame motion alone: neutral black elsewhere,
        # no RGB scene, frozen surface difference, glow or display color map.
        pure_mask=(camera_motion>cfg['motion_threshold']).astype(np.uint8)*255
        pure_mask=cv2.morphologyEx(pure_mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        pure.stdin.write(cv2.cvtColor(pure_mask,cv2.COLOR_GRAY2BGR).tobytes())
        signed=cv2.warpPerspective(np.clip(127.5+.5*(gray.astype(float)-baseline),0,255).astype(np.uint8),H,(w,h))
        display=np.hstack([cv2.cvtColor(signed,cv2.COLOR_GRAY2BGR),cv2.applyColorMap(bg*1,cv2.COLORMAP_INFERNO),cv2.applyColorMap(recent*1,cv2.COLORMAP_INFERNO)])
        out.stdin.write(display.tobytes());i+=1
    cap.release();out.stdin.close();pure.stdin.close()
    if out.wait()!=0 or pure.wait()!=0:raise RuntimeError('Extraction clip encoding failed')
    np.savez_compressed(output/'signals.npz',background=np.asarray(background),motion=np.asarray(motion),timestamps=np.asarray(times),valid=valid)
    activity=(np.asarray(motion)>cfg['motion_threshold']).mean(axis=0).astype(np.float32)
    activity=cv2.GaussianBlur(activity,(0,0),2)
    opacity=np.clip(activity*1400,0,190).astype(np.uint8)
    overlay=np.zeros((h,w,4),np.uint8)
    overlay[:,:,:3]=[103,151,27] if cal['camera']==0 else [50,143,230]  # BGRA: teal / orange
    overlay[:,:,3]=opacity
    overlay[~valid,3]=0
    cv2.imwrite(str(output/'motion-map.png'),overlay)
    meta={'source_sha256':sha(video),'calibration_sha256':sha(calibration),'settings_sha256':sha(settings),'frames':i,'fps':fps,'runtime_seconds':time.perf_counter()-start,'registration_failures':failures,'mean_gain':float(np.mean(gains)) if gains else 1,'mean_absolute_difference_suppressed':float(np.mean(suppression)),'calibration_fit_rmse_m':cal_error,'pure_motion_sha256':sha(output/'pure-motion.mp4'),'pure_motion_resolution':[int(baseline.shape[1]),int(baseline.shape[0])],'motion_map_sha256':sha(output/'motion-map.png'),'mask_polygon':mask_polygon,'mask_sha256':mask_sha256,'valid_area_fraction':float(np.mean(valid)),'note':'Calibration residual is a fit residual, not an independent accuracy bound. Motion map uses planar visible-marker calibration; elevated bodies shift in ground projection. Pure motion is a native-resolution delayed-difference display and contains no RGB background or persistent change.'}
    write_json(output/'metadata.json',meta);return meta

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--video',required=True);p.add_argument('--calibration',required=True);p.add_argument('--settings',required=True);p.add_argument('--output',required=True);p.add_argument('--mask');a=p.parse_args();print(extract(a.video,a.calibration,a.settings,a.output,a.mask))
