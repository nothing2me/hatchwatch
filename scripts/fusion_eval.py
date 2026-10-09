"""Evaluate pre-registered fusion only after both blind camera predictions exist."""
import json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'));sys.path.insert(0,str(ROOT/'scripts'))
from common import read_json,write_json,sha
from batch import summarize
from evaluate import evaluate

def run(split):
    registration=read_json(ROOT/'config/registration.json');fusion_registration=read_json(ROOT/'config/fusion-registration.json')
    if split=='validation':ids=[f'A-clean-{seed}' for seed in registration['validation_seeds']]
    elif split=='demonstrations':ids=[f'A-{scenario}-{401+i}' for i,scenario in enumerate(['travel','rest','abandoned','obstructed','weak','unrelated','no-eggs'])]
    else:raise SystemExit('Supported splits: validation (Gate B) and demonstrations (exploratory).')
    paired=[];view0=[];view1=[]
    for id in ids:
        public=ROOT/'artifacts/public'/id;private=ROOT/'artifacts/private'/id
        first=public/'view-0/detection/predictions.json';second=public/'view-1/detection/predictions.json'
        if not first.is_file() or not second.is_file():raise SystemExit(f'Missing completed blind predictions for {id}')
        result=public/'fusion/predictions.json';result.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run([sys.executable,str(ROOT/'pipeline/fuse.py'),'--camera-0',str(first),'--camera-1',str(second),'--registration',str(ROOT/'config/fusion-registration.json'),'--output',str(result)],check=True)
        truth=read_json(private/'truth.json');paired.append(evaluate(read_json(result),truth,registration))
        view0.append(read_json(private/'evaluation-0.json'));view1.append(read_json(private/'evaluation-1.json'))
    fused=summarize(paired,'fusion');single={f'camera_{view}_{method}':summarize(rows,method) for view,rows in [(0,view0),(1,view1)] for method in ['frozen','motion','tracker','full']}
    def rank(v):return (v['recall'] or 0,-v['false_alerts_per_run'],-(v['mean_localization_error_m'] if v['mean_localization_error_m'] is not None else float('inf')))
    winner=max(single,key=lambda k:rank(single[k]));best=single[winner]
    better=(fused['recall'] or 0)>(best['recall'] or 0) or ((fused['recall'] or 0)==(best['recall'] or 0) and fused['mean_localization_error_m'] is not None and best['mean_localization_error_m'] is not None and fused['mean_localization_error_m']<best['mean_localization_error_m'])
    passed=better and fused['false_alerts_per_run']<=best['false_alerts_per_run'] and fused['mean_inspection_area_m2']<=best['mean_inspection_area_m2']+1e-9
    report={'split':split,'ids':ids,'fusion_registration_sha256':sha(ROOT/'config/fusion-registration.json'),'fusion':fused,'single_camera_methods':single,'strongest_single':winner,'gate_b_passed':passed if split=='validation' else None,'rows':[{ 'id':id,'fusion':pair['methods']['fusion'],'camera_0_full':left['methods']['full'],'camera_1_full':right['methods']['full']} for id,pair,left,right in zip(ids,paired,view0,view1)],'note':'No fusion thresholds tuned on these results. Demonstrations are one seed per condition and exploratory, not Gate B.'}
    write_json(ROOT/f'artifacts/reports/fusion-{split}.json',report)
    print(json.dumps({'fusion':fused,'strongest_single':winner,'strongest_single_metrics':best,'gate_b_passed':report['gate_b_passed']},indent=2))

if __name__=='__main__':run(sys.argv[1] if len(sys.argv)>1 else 'validation')
