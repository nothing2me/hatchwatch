import math, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'))
from common import read_json,write_json,writer
from evaluate import evaluate
from detect import detect
from extract import extract

def pred(point,interval=(10,20),radius=.9):
    return {'point':point,'interval':interval,'radius_m':radius,'area_m2':math.pi*radius**2}

def truth(points,eggs=()):
    return {'seed':1,'scenario':'test','model':'A','sites':[{'point':p,'interval':[10,20]} for p in points],'eggs':[{'point':p} for p in eggs]}

def score(preds,t):
    return evaluate({'methods':{'full':preds}},t,read_json(ROOT/'config/registration.json'))['methods']['full']

def test_one_to_one_and_secondary_truth():
    r=score([pred([0,0]),pred([.1,0])],truth([[0,0]]))
    assert (r['tp'],r['fp'],r['duplicate_predictions'],r['nonproductive_inspections'])==(1,1,1,2)

def test_oversized_and_temporally_wrong_regions_rejected():
    r=score([pred([0,0],radius=5),pred([0,0],interval=(21,30))],truth([[0,0]],[[0,0]]))
    assert r['tp']==0 and r['fn']==1

def test_maximum_cardinality_matching():
    r=score([pred([.4,0]),pred([-.7,0])],truth([[0,0],[1,0]]))
    assert r['tp']==2

def test_stationary_change_does_not_become_motion(tmp_path):
    cfg=read_json(ROOT/'config/settings.json');cfg.update(grid_width=40,grid_height=30)
    write_json(tmp_path/'settings.json',cfg);write_json(tmp_path/'calibration.json',{})
    bg=np.zeros((160,30,40),np.uint8);bg[:,10:20,15:25]=100
    np.savez_compressed(tmp_path/'signals.npz',background=bg,motion=np.zeros_like(bg),timestamps=np.arange(160)/8,valid=np.ones((30,40),bool))
    result=detect(tmp_path/'signals.npz',tmp_path/'calibration.json',tmp_path/'settings.json',tmp_path/'out')
    assert result['methods']['frozen']
    assert not result['methods']['motion'] and not result['methods']['full']

def test_detector_rejects_hidden_fields(tmp_path):
    import pytest
    write_json(tmp_path/'settings.json',read_json(ROOT/'config/settings.json'));write_json(tmp_path/'calibration.json',{})
    np.savez(tmp_path/'signals.npz',eggs=np.array([1]))
    with pytest.raises(ValueError,match='Unexpected signal fields'):detect(tmp_path/'signals.npz',tmp_path/'calibration.json',tmp_path/'settings.json',tmp_path/'out')

def test_pure_motion_is_native_resolution_and_background_free(tmp_path):
    import cv2
    width,height=160,90
    base=np.full((height,width,3),120,np.uint8)
    for x,y in [(20,20),(140,20),(140,70),(20,70)]:cv2.rectangle(base,(x-5,y-5),(x+5,y+5),(70,70,70),-1)
    encoder=writer(tmp_path/'source.mp4',width,height,8)
    for i in range(32):
        frame=base.copy()
        if i>=16:cv2.circle(frame,(80+i-16,45),5,(255,255,255),-1)
        encoder.stdin.write(frame.tobytes())
    encoder.stdin.close();assert encoder.wait()==0
    cal={'camera':0,'reference_points':[{'pixel':[x,y],'world':[wx,wz]} for (x,y),(wx,wz) in zip([(20,20),(140,20),(140,70),(20,70)],[(-7,-5),(7,-5),(7,5),(-7,5)])]}
    write_json(tmp_path/'cal.json',cal)
    settings=read_json(ROOT/'config/settings.json');settings.update(grid_width=40,grid_height=30,preprocess=False)
    write_json(tmp_path/'settings.json',settings)
    extract(tmp_path/'source.mp4',tmp_path/'cal.json',tmp_path/'settings.json',tmp_path/'out')
    cap=cv2.VideoCapture(str(tmp_path/'out/pure-motion.mp4'))
    cap.set(cv2.CAP_PROP_POS_FRAMES,24);ok,frame=cap.read();cap.release()
    assert ok and frame.shape[:2]==(height,width)
    assert frame.max()>200 and np.mean(frame>10)<.03
    assert np.max(frame[:15])<10
