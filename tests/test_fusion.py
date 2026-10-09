import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'))
from common import read_json
from fuse import fuse

def candidate(point,interval=(10,20)):
    return {'id':'full-1','point':point,'radius_m':.9,'area_m2':2.5446900494,'interval':interval,'score':.7,'evidence':{'activity':.2,'persistent':.3}}

def test_pair_once_and_preserve_area_budget():
    config=read_json(ROOT/'config/fusion-registration.json')
    result=fuse({'methods':{'full':[candidate([0,0])]}},{'methods':{'full':[candidate([.4,.2])]}},config)['methods']['fusion']
    assert len(result)==1 and result[0]['source_views']==[0,1]
    assert result[0]['point']==[.2,.1]
    assert result[0]['radius_m']==.9

def test_one_camera_keeps_candidate_with_limited_quality():
    config=read_json(ROOT/'config/fusion-registration.json')
    result=fuse({'methods':{'full':[]}},{'methods':{'full':[candidate([2,1])]}},config)['methods']['fusion']
    assert len(result)==1 and result[0]['source_views']==[1]
    assert result[0]['observation_quality']=='single-view'
