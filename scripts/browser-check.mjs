import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.NESTTRACE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl']});
try{const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:5173');await page.waitForSelector('#scene');await page.locator('#time').fill('18');await page.locator('#time').dispatchEvent('input');await page.locator('#view').selectOption('1');await page.locator('#view').selectOption('0');await mkdir('artifacts/qa',{recursive:true});await page.screenshot({path:'artifacts/qa/desktop.png',fullPage:true});
await page.locator('#runs').selectOption('A-clean-11');await page.waitForSelector('#candidates');assert.equal(await page.locator('.source-grid video').count(),2);await page.locator('#sync-source').click();await page.locator('#reveal').click();await page.waitForSelector('#evaluation table');assert.equal(await page.locator('#evaluation tbody tr').count(),4);await page.locator('[data-method="motion"]').click();assert((await page.locator('#heatmap').getAttribute('src')).endsWith('/motion-heatmap.png'));await page.screenshot({path:'artifacts/qa/evidence.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/qa/mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
await page.setViewportSize({width:1440,height:1100});
for(const id of ['A-swarm-dev-601','A-swarm-night-dev-601']){
 if(!await page.locator(`#runs option[value="${id}"]`).count())continue;
 await page.locator('#runs').selectOption(id);
 await page.waitForFunction(id=>document.querySelector('#saved-video')?.getAttribute('src')?.includes(id),id);
 assert.match(await page.locator('#map').locator('xpath=..').locator('.panel-head').innerText(),/84 × 32 m beach/);
 assert.equal(await page.locator('.motion-grid video').count(),2);
 await page.locator('#prediction-view').selectOption('1');
 assert(await page.locator('#candidates').isVisible());
 await page.locator('#reveal').click();
 await page.waitForSelector('#evaluation table');
 assert.match(await page.locator('#evaluation').innerText(),/Camera 02 evaluation/);
}
await page.locator('#scenario').selectOption('swarm-night');await page.locator('#reset').click();assert.equal(await page.locator('.badge').innerText(),'SYNTHETIC · VERY DARK');
await page.goto('http://127.0.0.1:5173/record.html');await page.waitForFunction(()=>!!window.nestRecord);
const comparison=await page.evaluate(()=>{const config={seed:11,scenario:'clean',model:'A',eggs:true};const a=window.nestRecord.init(config);const times=[0,3,10,18,23,30,39];const frames=times.map(t=>window.nestRecord.frame(t,0));const b=window.nestRecord.init({...config,eggs:false});return {identical:times.every((t,i)=>window.nestRecord.frame(t,0)===frames[i]),eggsA:a.truth.eggs.length,eggsB:b.truth.eggs.length}});assert(comparison.identical);assert.equal(comparison.eggsA,1);assert.equal(comparison.eggsB,0);
const thrown=await page.evaluate(async()=>{const {Simulation}=await import('/simulation.ts');const {sandFloor}=await import('/sand.ts');const sim=new Simulation(document.createElement('canvas'),{seed:11,scenario:'clean',model:'A'});let maximum=0,airborne=0;for(let frame=0;frame<=48;frame++){const t=13+frame/8;sim.sand.advance(t,tt=>sim.forcing(tt));const p=sim.sand.positions;for(let i=0;i<sim.sand.count;i++){const z=p[i*3+2],height=p[i*3+1]-sandFloor(z);maximum=Math.max(maximum,height);if(height>.55)airborne++}}sim.dispose();return {maximum_height_above_floor_m:maximum,airborne_samples:airborne}});console.log('Ballistic sand check:',JSON.stringify(thrown));assert(thrown.maximum_height_above_floor_m>.55);assert(thrown.airborne_samples>0);assert.deepEqual(errors,[]);await writeFile('artifacts/qa/browser-check.json',JSON.stringify({errors,hidden_egg_invariance:comparison,ballistic_sand:thrown,mobile_overflow:false},null,2));console.log('Browser checks passed, including hidden-egg render invariance and airborne sand.');
}finally{await browser.close()}
