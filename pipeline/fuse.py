"""Blind fusion of independent, calibrated camera predictions. No truth inputs."""
import argparse, math, time
from pathlib import Path
from common import read_json,write_json,sha

def fuse(first,second,settings):
    a=first['methods']['full'];b=second['methods']['full'];pairs=[]
    for i,x in enumerate(a):
        for j,y in enumerate(b):
            distance=math.dist(x['point'],y['point'])
            overlap=min(x['interval'][1],y['interval'][1])-max(x['interval'][0],y['interval'][0])
            if distance<=settings['pair_max_distance_m'] and overlap>=settings['pair_min_temporal_overlap_seconds']:
                pairs.append((distance,i,j))
    used_a=set();used_b=set();output=[]
    for distance,i,j in sorted(pairs):
        if i in used_a or j in used_b:continue
        used_a.add(i);used_b.add(j);x=a[i];y=b[j]
        point=[(u+v)/2 for u,v in zip(x['point'],y['point'])]
        output.append({'id':f'fusion-{len(output)+1}','point':point,'radius_m':x['radius_m'],'area_m2':x['area_m2'],'interval':[min(x['interval'][0],y['interval'][0]),max(x['interval'][1],y['interval'][1])],'score':(x['score']+y['score'])/2,'label':'Digging activity detected; nesting unresolved.','evidence':{'camera_0':x['evidence'],'camera_1':y['evidence'],'camera_disagreement_m':distance},'observation_quality':'usable','uncertainty_note':'Equal-weight paired estimate; camera disagreement and elevated-body parallax remain.','supporting_clips':['view-0/extraction.mp4','view-1/extraction.mp4'],'source_views':[0,1]})
    for view,preds,used in [(0,a,used_a),(1,b,used_b)]:
        for i,p in enumerate(preds):
            if i in used:continue
            q=dict(p);q['id']=f'fusion-{len(output)+1}';q['observation_quality']='single-view';q['uncertainty_note']='Only one camera supplied this candidate; no cross-view localization check.';q['source_views']=[view];q['supporting_clips']=[f'view-{view}/extraction.mp4'];output.append(q)
    return {'schema_version':1,'methods':{'fusion':output},'status':'Digging activity detected; nesting unresolved.' if output else 'No candidate detected.','input_contract':'Camera prediction JSON only; no RGB, simulator state, seed, scenario, or truth.','fusion_registration_sha256':None}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--camera-0',required=True);p.add_argument('--camera-1',required=True);p.add_argument('--registration',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    result=fuse(read_json(args.camera_0),read_json(args.camera_1),read_json(args.registration))
    result['fusion_registration_sha256']=sha(args.registration)
    result['camera_prediction_sha256']=[sha(args.camera_0),sha(args.camera_1)]
    write_json(args.output,result)
