"""Registered paired daylight and very-dark six-turtle video stress evaluation."""
import argparse,json,subprocess,sys
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'pipeline'))
sys.path.insert(0,str(ROOT/'scripts'))
from common import read_json,write_json,sha
from batch import summarize

def completed(run_id,plan):
    public=ROOT/'artifacts/public'/run_id;private=ROOT/'artifacts/private'/run_id
    if not all((private/f'evaluation-{view}.json').is_file() for view in (0,1)) or not(public/'analysis.json').is_file():return False
    saved=read_json(private/'source-hashes.json') if (private/'source-hashes.json').is_file() else {}
    if any(saved.get(path)!=plan['source_sha256'][name] for name,path in plan['source_files'].items() if path in saved):return False
    return read_json(public/'analysis.json')['settings_sha256']==plan['source_sha256']['settings']

def evaluate_scenario(scenario,plan,reuse):
    rows={0:[],1:[]};ids=[];resources=[]
    for seed in plan['seeds']:
        run_id=f'A-{scenario}-stress-{seed}';ids.append(run_id)
        if not(reuse and completed(run_id,plan)):
            subprocess.run(['node','scripts/record.mjs','--seed',str(seed),'--scenario',scenario,'--model','A','--id',run_id],cwd=ROOT,check=True)
            subprocess.run([sys.executable,'scripts/analyze.py',run_id,'--both','--settings','config/settings-swarm.json'],cwd=ROOT,check=True)
        public=ROOT/'artifacts/public'/run_id;private=ROOT/'artifacts/private'/run_id
        for view in (0,1):rows[view].append(read_json(private/f'evaluation-{view}.json'))
        prov=read_json(private/'provenance.json');analysis=read_json(public/'analysis.json')
        resources.append({'id':run_id,'recording_seconds':prov['recording_seconds'],'analysis_seconds':analysis['runtime_seconds'],'source_video_bytes':sum((public/f'camera-{view}.mp4').stat().st_size for view in (0,1)),'gpu_renderer':prov['gpu_renderer']})
    methods={f'camera_{view}_{method}':summarize(rows[view],method) for view in (0,1) for method in ('frozen','motion','tracker','full')}
    rng=np.random.default_rng(73);ci={}
    for view in (0,1):
        samples=[summarize([rows[view][i] for i in rng.integers(0,len(ids),len(ids))],'full') for _ in range(2000)]
        ci[f'camera_{view}_full']={}
        for metric in ('recall','mean_localization_error_m'):
            values=[s[metric] for s in samples if s[metric] is not None]
            ci[f'camera_{view}_full'][metric]=[float(x) for x in np.percentile(values,[2.5,97.5])] if values else None
    return {'run_ids':ids,'sites':sum(row['methods']['full']['sites'] for row in rows[0]),'methods':methods,'seed_bootstrap_95ci':ci,'rows':[{'id':run_id,'camera_0':a['methods'],'camera_1':b['methods']} for run_id,a,b in zip(ids,rows[0],rows[1])],'resources':resources}

def main():
    p=argparse.ArgumentParser();p.add_argument('--reuse',action='store_true',help='Reuse completed runs with matching source and settings hashes');args=p.parse_args()
    plan=read_json(ROOT/'config/swarm-registration.json')
    for name,path in plan['source_files'].items():
        if sha(ROOT/path)!=plan['source_sha256'][name]:raise SystemExit(f'{path} changed after stress registration; use fresh seeds.')
    scenarios={scenario:evaluate_scenario(scenario,plan,args.reuse) for scenario in plan['scenarios']}
    report={'protocol':plan['protocol'],'seeds':plan['seeds'],'scenarios':scenarios,'source_sha256':plan['source_sha256'],'note':'Paired seed-controlled daylight and very-dark synthetic videos. Six turtles, two opposed camera recordings per run. Very dark synthetic visible-light noise is not infrared or field validation. Settings fixed before these seeds; confidence intervals resample whole runs.'}
    write_json(ROOT/'artifacts/reports/swarm-v3.json',report)
    print(json.dumps({scenario:{'sites':data['sites'],'camera_0_full':data['methods']['camera_0_full'],'camera_1_full':data['methods']['camera_1_full']} for scenario,data in scenarios.items()},indent=2))

if __name__=='__main__':main()
