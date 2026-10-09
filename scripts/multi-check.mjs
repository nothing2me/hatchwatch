import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:process.env.NESTTRACE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--no-sandbox',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1100,height:700}});
 await page.goto('http://127.0.0.1:5173/record.html');
 await page.waitForFunction(()=>!!window.nestRecord);
 const result=await page.evaluate(async()=>{
  const {Simulation}=await import('/simulation.ts');
  const sim=new Simulation(document.createElement('canvas'),{seed:503,scenario:'multi',model:'A'});
  const truth=sim.truth();
  const moved=()=>{let count=0;for(let i=0;i<sim.sand.count;i++){const o=i*3,p=sim.sand.positions,b=sim.sand.initial;if(Math.hypot(p[o]-b[o],p[o+1]-b[o+1],p[o+2]-b[o+2])>.08)count++}return count};
  sim.sand.advance(8,t=>sim.forcing(t));const travelMoved=moved();
  sim.sand.advance(31,t=>sim.forcing(t));
  const result={grains:sim.sand.count,travel_moved_grains:travelMoved,moved_grains:moved(),sites:truth.sites,eggs:truth.eggs.length};
  sim.dispose();return result;
 });
 assert.equal(result.grains,134400);
 assert.equal(result.sites.length,3);
 assert.equal(result.eggs,3);
 assert(result.travel_moved_grains>100);
 assert(result.moved_grains>500);
 assert(result.sites[0].interval[0]<result.sites[1].interval[0]&&result.sites[1].interval[0]<result.sites[2].interval[0]);
 for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert(Math.hypot(result.sites[i].point[0]-result.sites[j].point[0],result.sites[i].point[1]-result.sites[j].point[1])>3);
 const a=await page.evaluate(()=>{window.nestRecord.init({seed:503,scenario:'multi',model:'A',eggs:true});return window.nestRecord.frame(27,0)});
 const b=await page.evaluate(()=>{window.nestRecord.init({seed:503,scenario:'multi',model:'A',eggs:false});return window.nestRecord.frame(27,0)});
 assert.equal(a,b,'Hidden eggs changed rendered pixels');
 await mkdir('artifacts/qa',{recursive:true});
 await page.locator('canvas').screenshot({path:'artifacts/qa/multi-camera.png'});
 await page.goto('http://127.0.0.1:5173/');
 await page.locator('#runs').selectOption('A-multi-dev-11');
 await page.waitForSelector('#prediction-view');
 assert.equal(await page.locator('[data-method="full"] span').textContent(),'2');
 await page.locator('#prediction-view').selectOption('1');
 assert.equal(await page.locator('[data-method="full"] span').textContent(),'3');
 await page.locator('#reveal').click();
 await page.waitForSelector('#evaluation table');
 assert((await page.locator('#evaluation').textContent()).includes('Camera 02 evaluation'));
 await page.screenshot({path:'artifacts/qa/multi-dashboard.png',fullPage:true});
 await writeFile('artifacts/qa/multi-check.json',JSON.stringify({...result,hidden_egg_invariance:true},null,2));
 console.log(JSON.stringify({grains:result.grains,travel_moved_grains:result.travel_moved_grains,moved_grains:result.moved_grains,sites:result.sites.map(s=>s.point),hidden_egg_invariance:true}));
}finally{await browser.close()}
