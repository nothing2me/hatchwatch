import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const browser=await chromium.launch({headless:true,executablePath:process.env.NESTTRACE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--no-sandbox',...(process.platform==='win32'?['--use-angle=d3d11']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.goto('http://127.0.0.1:5173/');
 await page.locator('#runs').selectOption('A-swarm-dev-601');
 await page.waitForSelector('.pin-item');
 assert.equal(await page.locator('.pin-item').count(),6);
 assert.equal(await page.locator('.pin-number.paired').count()+await page.locator('.pin-number.provisional').count(),6);
 assert.equal((await page.locator('#map').getAttribute('width')),'900');
 await page.locator('#pin-reveal').click();
 await page.waitForSelector('#pin-evaluation .caption');
 assert.match(await page.locator('#pin-evaluation').innerText(),/6\/6 sites matched, 0 extra pin/);
 await mkdir('artifacts/qa',{recursive:true});
 await page.screenshot({path:'artifacts/qa/pin-dashboard.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Pin dashboard QA passed: six mapped pins and explicit evaluator result.');
}finally{await browser.close()}
