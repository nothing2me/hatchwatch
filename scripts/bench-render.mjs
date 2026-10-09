import {chromium} from 'playwright';
const modes=[[],['--use-angle=d3d11'],['--use-angle=swiftshader']];
for(const args of modes){
 let browser;
 try{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--no-sandbox',...args]});const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/record.html');await page.waitForFunction(()=>!!window.nestRecord);
 const result=await page.evaluate(()=>{const start=performance.now();window.nestRecord.init({seed:11,scenario:'clean',model:'A'});const init=performance.now();window.nestRecord.frame(12,0);const frame=performance.now();const gl=document.querySelector('canvas').getContext('webgl2');const extension=gl.getExtension('WEBGL_debug_renderer_info');return {init_ms:init-start,frame_ms:frame-init,renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}});console.log(args[0]||'default',JSON.stringify(result));}
 catch(e){console.log(args[0]||'default',String(e))}finally{await browser?.close()}
}
