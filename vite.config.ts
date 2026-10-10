import { defineConfig } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export default defineConfig({
  root:'web',
  plugins:[{
    name:'local-dev-turtle',
    configureServer(server){
      server.middlewares.use((req,res,next)=>{
        const name=req.url?.match(/^\/models\/(turtle\.(?:gltf|bin|png|jpg|jpeg))$/)?.[1];
        if(!name)return next();
        const path=resolve('web/local-models',name);
        if(!existsSync(path))return next();
        res.setHeader('Content-Type',name.endsWith('.gltf')?'model/gltf+json':name.endsWith('.bin')?'application/octet-stream':name.endsWith('.png')?'image/png':'image/jpeg');
        createReadStream(path).pipe(res);
      });
    }
  }],
  server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false},
  build:{outDir:'../dist',emptyOutDir:true}
});
