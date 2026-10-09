"""Registered batches. Development first; freeze settings before reserved validation."""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'pipeline'));sys.path.insert(0,str(ROOT/'scripts'))
from common import read_json, write_json, sha
from analyze import run

def summarize(rows, method):
    values=[r['methods'][method] for r in rows];tp=sum(v['tp'] for v in values);fp=sum(v['fp'] for v in values);fn=sum(v['fn'] for v in values);errors=[e for v in values for e in v['localization_errors_m']]
    return {'runs':len(values),'tp':tp,'fp':fp,'fn':fn,'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'false_alerts_per_run':fp/len(values) if values else None,'mean_localization_error_m':float(np.mean(errors)) if errors else None,'mean_inspection_area_m2':float(np.mean([v['inspection_area_m2'] for v in values])) if values else None,'nonproductive_inspections':sum(v['nonproductive_inspections'] for v in values),'eggs_covered':sum(v['eggs_covered'] for v in values),'eggs':sum(v['eggs'] for v in values),'duplicate_predictions':sum(v['duplicate_predictions'] for v in values)}

def report(ids, name):
    rows=[read_json(ROOT/'artifacts/private'/i/'evaluation-0.json') for i in ids];result={m:summarize(rows,m) for m in ['frozen','motion','tracker','full']};rng=np.random.default_rng(42)
    for method in result:
        samples=[summarize([rows[j] for j in rng.integers(0,len(rows),len(rows))],method) for _ in range(1000)]
        for metric in ['recall','precision','mean_localization_error_m']:
            vals=[s[metric] for s in samples if s[metric] is not None];result[method][metric+'_95ci']=np.percentile(vals,[2.5,97.5]).tolist() if vals else None
    gate=read_json(ROOT/'config/registration.json')['gate_a'];full=result['full'];passed=len(rows)==gate['runs'] and full['recall'] is not None and full['recall']>=gate['required_recall'] and full['false_alerts_per_run']<=gate['maximum_false_alerts_per_run']
    write_json(ROOT/f'artifacts/reports/{name}.json',{'batch':name,'run_ids':ids,'settings_sha256':sha(ROOT/'config/settings.json'),'methods':result,'gate_a_passed':passed if name=='validation' else None,'rows':rows})
    print(json.dumps({'batch':name,'methods':result,'gate_a_passed':passed if name=='validation' else None},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--split',choices=['development','validation','test','demonstrations'],default='development');p.add_argument('--model',choices=['A','B'],default='A');p.add_argument('--both',action='store_true');p.add_argument('--reuse',action='store_true');a=p.parse_args()
    manifest=read_json(ROOT/'config/registration.json');frozen=ROOT/'config/frozen.json'
    if a.split!='development':
        if not frozen.exists():raise SystemExit('Freeze development settings first: python scripts/freeze.py')
        locked=read_json(frozen)
        for key,path in [('settings','config/settings.json'),('registration','config/registration.json'),('simulator','web/simulation.ts'),('sand','web/sand.ts'),('detector','pipeline/detect.py'),('extractor','pipeline/extract.py')]:
            if locked[key+'_sha256']!=sha(ROOT/path):raise SystemExit(f'{key} changed after freezing; register fresh reserved seeds before evaluation.')
    scenarios=['travel','rest','abandoned','obstructed','weak','unrelated','no-eggs'] if a.split=='demonstrations' else ['clean']
    seeds=[401+i for i in range(len(scenarios))] if a.split=='demonstrations' else manifest[a.split+'_seeds'];ids=[]
    for i,seed in enumerate(seeds):
        scenario=scenarios[i] if a.split=='demonstrations' else 'clean';id=f'{a.model}-{scenario}-{seed}';ids.append(id)
        if not(a.reuse and (ROOT/'artifacts/private'/id/'provenance.json').exists()):subprocess.run(['node','scripts/record.mjs','--seed',str(seed),'--scenario',scenario,'--model',a.model],cwd=ROOT,check=True)
        run(id,(0,1) if a.both else (0,))
    report(ids,a.split if a.model=='A' else f'{a.split}-model-B')
