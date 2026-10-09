import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const python=process.platform==='win32'?resolve('.venv/Scripts/python.exe'):resolve('.venv/bin/python');
for(const [cmd,args] of [[process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],[python,['-m','pytest','tests','-q']]]){const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
