import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:process.env.HATCHWATCH_BROWSER||process.env.NESTTRACE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--no-sandbox',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1320,height:760}});
 await page.goto('http://127.0.0.1:5173/record.html');
 await page.waitForFunction(()=>!!window.nestRecord);
 const info=await page.evaluate(async()=>{
  const {Simulation}=await import('/simulation.ts');
  const sim=new Simulation(document.querySelector('canvas'),{seed:601,scenario:'swarm',model:'A'});
  const truth=sim.truth(),calibrations=[sim.calibration(0),sim.calibration(1)];
  sim.render(27,0,false);
  let moved=0;
  for(let i=0;i<sim.sand.count;i++){const o=i*3,p=sim.sand.positions,b=sim.sand.initial;if(Math.hypot(p[o]-b[o],p[o+1]-b[o+1],p[o+2]-b[o+2])>.08)moved++}
  const gl=document.querySelector('canvas').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {grains:sim.sand.count,moved_grains:moved,sites:truth.sites,calibrations,gpu_renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
 });
 assert.equal(info.grains,134400);
 assert.equal(info.sites.length,6);
 assert(info.moved_grains>3000);
 assert(/Direct3D11|D3D11/i.test(info.gpu_renderer));
 for(let i=1;i<info.sites.length;i++){assert(info.sites[i-1].interval[0]<info.sites[i].interval[0]);assert(info.sites[i].point[0]-info.sites[i-1].point[0]>3)}
 for(const cal of info.calibrations){assert.deepEqual(cal.ground_bounds,[-12,12,-8,8]);assert(cal.reference_points.every(p=>p.pixel[0]>=0&&p.pixel[0]<cal.width&&p.pixel[1]>=0&&p.pixel[1]<cal.height))}
 await mkdir('artifacts/qa',{recursive:true});await page.locator('canvas').screenshot({path:'artifacts/qa/swarm-camera.png'});
 await writeFile('artifacts/qa/swarm-check.json',JSON.stringify(info,null,2));
 console.log(JSON.stringify({grains:info.grains,moved_grains:info.moved_grains,sites:info.sites.map(s=>s.point),gpu_renderer:info.gpu_renderer}));
}finally{await browser.close()}
