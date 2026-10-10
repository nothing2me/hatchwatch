import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>{if(x.startsWith('--'))a.push([x.slice(2),all[i+1]]);return a},[]));
const seed=Number(args.seed||11),scenario=args.scenario||'clean',model=args.model||'A';
const layout=args.layout||'along';if(!['along','seaward'].includes(layout))throw Error(`Invalid --layout ${args.layout} (along|seaward)`);
const humans=args.humans===undefined?0:Number(args.humans);if(!Number.isInteger(humans)||humans<0||humans>4)throw Error(`Invalid --humans ${args.humans} (integer 0-4)`);
const nirPower=args['nir-power']===undefined?undefined:Number(args['nir-power']);if(nirPower!==undefined&&(!Number.isFinite(nirPower)||nirPower<1000||nirPower>7000||!['swarm-nir','nir-travel'].includes(scenario)))throw Error(`Invalid --nir-power ${args['nir-power']} (NIR scenarios only, 1000-7000)`);
const id=args.id||`${model}-${scenario}-${seed}`;if(!/^[\w-]+$/.test(id))throw Error('Invalid run ID');
const publicDir=resolve('artifacts/public',id),privateDir=resolve('artifacts/private',id);await mkdir(publicDir,{recursive:true});await mkdir(privateDir,{recursive:true});
for(const marker of [`${publicDir}/analysis.json`,`${privateDir}/provenance.json`]){try{await unlink(marker)}catch(e){if(e.code!=='ENOENT')throw e}}
const python=process.platform==='win32'?resolve('.venv/Scripts/python.exe'):resolve('.venv/bin/python');
const ffmpegLookup=spawnSync(python,['-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8'});
if(ffmpegLookup.error||ffmpegLookup.status!==0)throw Error(`Could not locate FFmpeg through ${python}: ${ffmpegLookup.error?.message||ffmpegLookup.stderr||`exit ${ffmpegLookup.status}`}`);
const ffmpeg=ffmpegLookup.stdout.trim();
const executablePath=process.env.HATCHWATCH_BROWSER || process.env.NESTTRACE_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--enable-webgl','--no-sandbox',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
let encoders=[];
try{
const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/record.html');await page.waitForFunction(()=>!!window.nestRecord);
const config={seed,scenario,model,...(args.eggs==='false'?{eggs:false}:{}),layout,humans,...(nirPower===undefined?{}:{nirPower})};
const init=await page.evaluate(c=>window.nestRecord.init(c),config);
const gpuRenderer=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});
if(process.platform==='win32'&&!/Direct3D11|D3D11/i.test(gpuRenderer))throw Error(`Hardware Direct3D 11 renderer required; Chrome returned ${gpuRenderer}`);
await writeFile(`${privateDir}/truth.json`,JSON.stringify(init.truth,null,2));
await writeFile(`${privateDir}/config.json`,JSON.stringify(config,null,2));
encoders=[0,1].map(v=>spawn(ffmpeg,['-loglevel','error','-y','-f','image2pipe','-vcodec','png','-r','8','-i','-','-an','-c:v','libx264','-preset','ultrafast','-crf','10','-pix_fmt','yuv420p',`${publicDir}/camera-${v}.mp4`],{stdio:['pipe','ignore','inherit']}));
const done=encoders.map(e=>once(e,'close'));const start=Date.now();
for(let frame=0;frame<320;frame++){
 for(let view=0;view<2;view++){const png=await page.evaluate(({t,view})=>window.nestRecord.frame(t,view),{t:frame/8,view});if(!encoders[view].stdin.write(Buffer.from(png,'base64')))await once(encoders[view].stdin,'drain')}
 if(frame%80===0)console.log(`${id}: ${frame}/320 frames`);
}encoders.forEach(e=>e.stdin.end());for(const [code] of await Promise.all(done))if(code!==0)throw Error('Encoder failed');
for(let view=0;view<2;view++)await writeFile(`${publicDir}/calibration-${view}.json`,JSON.stringify(init.calibrations[view],null,2));
await writeFile(`${publicDir}/timestamps.json`,JSON.stringify(Array.from({length:320},(_,i)=>i/8)));
const hashes={};for(const name of ['camera-0.mp4','camera-1.mp4','calibration-0.json','calibration-1.json','timestamps.json'])hashes[name]=createHash('sha256').update(await readFile(`${publicDir}/${name}`)).digest('hex');
const gitRevision=spawnSync('git',['rev-parse','--verify','HEAD'],{encoding:'utf8'});const revision=gitRevision.status===0?gitRevision.stdout.trim():'uncommitted';
const meta={id,config,revision,source_note:'Working tree source hashes in source-hashes.json',browser:await browser.version(),gpu_renderer:gpuRenderer,node:process.version,dependencies:JSON.parse(await readFile('package.json','utf8')).dependencies,encoder:'libx264 CRF 10 ultrafast yuv420p',fps:8,width:init.calibrations[0].width,height:init.calibrations[0].height,timestep:1/8,recording_seconds:(Date.now()-start)/1000,hashes,determinism:'Seeded fixed-time scene repeatability; encoded bytes may vary across GPU/driver/encoder versions.'};
await writeFile(`${privateDir}/provenance.json`,JSON.stringify(meta,null,2));
const sources={};for(const f of ['web/simulation.ts','web/sand.ts','pipeline/extract.py','pipeline/detect.py','pipeline/evaluate.py','config/settings.json','config/registration.json'])sources[f]=createHash('sha256').update(await readFile(f)).digest('hex');await writeFile(`${privateDir}/source-hashes.json`,JSON.stringify(sources,null,2));
console.log(`Recorded ${id} in ${meta.recording_seconds}s`);
}finally{for(const encoder of encoders){if(encoder.exitCode===null){encoder.stdin.end();encoder.kill()}}await browser.close()}
