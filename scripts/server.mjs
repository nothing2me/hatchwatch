import {createServer} from 'node:http';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve('artifacts/public');const privateRoot=resolve('artifacts/private');const python=process.platform==='win32'?resolve('.venv/Scripts/python.exe'):resolve('.venv/bin/python');let counter=0;const jobs=new Map();let busy=false;
const valid=id=>/^[A-Za-z0-9_-]+$/.test(id);const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));const origins=new Set(['http://127.0.0.1:5173','http://localhost:5173']);
function command(exe,args,onOutput){return new Promise((ok,bad)=>{const p=spawn(exe,args,{cwd:resolve('.'),stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>onOutput(b.toString().trim()));p.stderr.on('data',b=>console.error(b.toString()));p.on('error',bad);p.on('close',code=>code===0?ok():bad(Error(`Command exited ${code}`)))})}
createServer(async(req,res)=>{try{
 const origin=req.headers.origin;if(origin&&!origins.has(origin)){res.writeHead(403);return res.end('Origin rejected')}
 if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('X-Content-Type-Options','nosniff');if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
 const url=new URL(req.url,'http://127.0.0.1:5174');const path=decodeURIComponent(url.pathname);const send=(data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 if(path==='/api/runs'){let ids=[];try{ids=await readdir(root)}catch{}return send(ids.filter(i=>existsSync(resolve(root,i,'analysis.json'))&&existsSync(resolve(root,i,'view-0/detection/predictions.json'))).sort())}
 if(path.startsWith('/api/run/')){const id=path.slice(9);if(!valid(id))return send({error:'Invalid ID'},400);const analysis=await readJSON(resolve(root,id,'analysis.json'));const first=await readJSON(resolve(root,id,'view-0/detection/predictions.json'));const second=analysis.cameras.includes(1)?await readJSON(resolve(root,id,'view-1/detection/predictions.json')):null;return send({analysis,predictions:first,predictions_by_camera:{0:first,...(second?{1:second}:{})}})}
 if(path.startsWith('/api/truth/')){const id=path.slice(11),view=Number(url.searchParams.get('view')||0);if(!valid(id)||![0,1].includes(view))return send({error:'Invalid ID or camera'},400);if(!existsSync(resolve(root,id,'analysis.json')))return send({error:'Inference has not completed'},409);return send({truth:await readJSON(resolve(privateRoot,id,'truth.json')),evaluation:await readJSON(resolve(privateRoot,id,`evaluation-${view}.json`))})}
 if(path.startsWith('/api/job/'))return send(jobs.get(path.slice(9))||{state:'missing',message:'Job not found'},jobs.has(path.slice(9))?200:404);
 if(path==='/api/record'&&req.method==='POST'){
 if(!origins.has(origin))return send({error:'Browser origin required'},403);if(busy)return send({error:'A recording is already running.'},409);
 let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)return send({error:'Request too large'},413)}const c=JSON.parse(body);
 if(!Number.isInteger(c.seed)||c.seed<1||c.seed>999999||!['A','B'].includes(c.model)||!['clean','multi','travel','rest','abandoned','unrelated','no-eggs','weak','obstructed','low-light'].includes(c.scenario))return send({error:'Invalid simulation configuration'},400);
 const id=`${c.model}-${c.scenario}-${c.seed}-${Date.now()}`,job=String(++counter);const status={state:'running',run:id,message:'Recording two synchronized camera videos…'};jobs.set(job,status);busy=true;send({job},202);
 void(async()=>{try{await command('node',['scripts/record.mjs','--seed',String(c.seed),'--scenario',c.scenario,'--model',c.model,'--id',id],message=>status.message=message);status.message='Decoding both videos and extracting difference signals…';await command(python,['scripts/analyze.py',id,'--both'],message=>{if(message)status.message='Running blind detection and evaluation…'});status.state='done';status.message=`Completed ${id}. Predictions are ready.`}catch(e){status.state='failed';status.message=String(e)}finally{busy=false}})();return;
 }
 if(path.startsWith('/artifacts/')){
 const relative=path.slice(11),file=resolve(root,relative);if(!file.startsWith(root+sep))return send({error:'Forbidden'},403);const s=await stat(file);if(!s.isFile())return send({error:'Not found'},404);
 const types={'.json':'application/json','.mp4':'video/mp4','.png':'image/png','.npz':'application/octet-stream'};const type=types[extname(file)];if(!type)return send({error:'Unsupported'},403);res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');let start=0,end=s.size-1;
 if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m)return send({error:'Invalid range'},416);start=Number(m[1]);end=m[2]?Number(m[2]):end;if(start>end||end>=s.size)return send({error:'Invalid range'},416);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${s.size}`,'Content-Length':end-start+1})}else res.writeHead(200,{'Content-Length':s.size});createReadStream(file,{start,end}).pipe(res);return;
 }
 send({error:'Not found'},404)
 }catch(e){if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e)}))}else res.end()}
}).listen(5174,'127.0.0.1',()=>console.log('NestTrace API: http://127.0.0.1:5174'));
