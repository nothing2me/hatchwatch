"""Run a separately registered, untuned multi-turtle stress set."""
import json, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'pipeline'))
sys.path.insert(0,str(ROOT/'scripts'))
from common import read_json,write_json,sha
from batch import summarize

def main():
    plan=read_json(ROOT/'config/stress-registration.json')
    for name,path in plan['source_files'].items():
        if sha(ROOT/path)!=plan['source_sha256'][name]:
            raise SystemExit(f'{path} changed after stress registration; create new seeds before evaluating.')
    rows={0:[],1:[]};ids=[]
    for seed in plan['seeds']:
        run_id=f'A-multi-stress-{seed}';ids.append(run_id)
        subprocess.run(['node','scripts/record.mjs','--seed',str(seed),'--scenario','multi','--model','A','--id',run_id],cwd=ROOT,check=True)
        subprocess.run([sys.executable,'scripts/analyze.py',run_id,'--both'],cwd=ROOT,check=True)
        for view in (0,1):rows[view].append(read_json(ROOT/'artifacts/private'/run_id/f'evaluation-{view}.json'))
    methods={f'camera_{view}_{method}':summarize(rows[view],method) for view in (0,1) for method in ('frozen','motion','tracker','full')}
    report={'protocol':plan['protocol'],'run_ids':ids,'site_count':sum(len(read_json(ROOT/'artifacts/private'/run_id/'truth.json')['sites']) for run_id in ids),'methods':methods,'rows':[{ 'id':run_id,'camera_0':a['methods'],'camera_1':b['methods']} for run_id,a,b in zip(ids,rows[0],rows[1])],'source_sha256':plan['source_sha256'],'note':'Three digging turtles at staggered times and separate seeded locations in each run. Same frozen detector settings; no threshold tuning on stress seeds. Synthetic only.'}
    write_json(ROOT/'artifacts/reports/stress-v2.json',report)
    print(json.dumps({'runs':len(ids),'sites':report['site_count'],'methods':methods},indent=2))

if __name__=='__main__':main()
