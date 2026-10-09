"""Evaluator alone reads private truth after prediction files exist."""
import argparse, math
from common import read_json, write_json

def evaluate(predictions, truth, registration):
    rules=registration['matching'];sites=truth['sites'];results={}
    for method,preds in predictions['methods'].items():
        edges=[]
        for i,p in enumerate(preds):
            for j,s in enumerate(sites):
                d=math.dist(p['point'],s['point']);overlap=min(p['interval'][1],s['interval'][1])-max(p['interval'][0],s['interval'][0])
                if p['area_m2']<=registration['maximum_inspection_area_m2'] and d<=min(p['radius_m'],rules['maximum_center_error_m']) and overlap>=rules['minimum_temporal_overlap_seconds']:edges.append((d,i,j))
        # Exact maximum-cardinality matching, then minimum distance (small candidate sets).
        best=[]
        def search(k,chosen,pi,sj):
            nonlocal best
            if k==len(edges):
                if len(chosen)>len(best) or len(chosen)==len(best) and sum(x[0] for x in chosen)<sum(x[0] for x in best):best=chosen[:]
                return
            d,i,j=edges[k];search(k+1,chosen,pi,sj)
            if i not in pi and j not in sj:search(k+1,chosen+[(d,i,j)],pi|{i},sj|{j})
        search(0,[],set(),set());tp=len(best);egg_covered=sum(any(math.dist(p['point'],e['point'])<=p['radius_m'] for p in preds) for e in truth['eggs'])
        productive=sum(any(math.dist(p['point'],e['point'])<=p['radius_m'] for e in truth['eggs']) for p in preds)
        duplicates=sum(any(math.dist(p['point'],s['point'])<=p['radius_m'] for s in sites) for p in preds)-tp
        results[method]={'tp':tp,'fp':len(preds)-tp,'fn':len(sites)-tp,'sites':len(sites),'predictions':len(preds),'precision':tp/len(preds) if preds else None,'recall':tp/len(sites) if sites else None,'localization_errors_m':[d for d,_,_ in best],'inspection_area_m2':sum(p['area_m2'] for p in preds),'location_coverage':sum(any(math.dist(p['point'],s['point'])<=p['radius_m'] for p in preds) for s in sites),'eggs_covered':egg_covered,'eggs':len(truth['eggs']),'nonproductive_inspections':len(preds)-productive,'duplicate_predictions':max(0,duplicates)}
    return {'seed':truth['seed'],'scenario':truth['scenario'],'model':truth['model'],'methods':results}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--predictions',required=True);p.add_argument('--truth',required=True);p.add_argument('--registration',required=True);p.add_argument('--output',required=True);a=p.parse_args();write_json(a.output,evaluate(read_json(a.predictions),read_json(a.truth),read_json(a.registration)))
