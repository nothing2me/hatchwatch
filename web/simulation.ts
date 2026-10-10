import * as THREE from 'three';
import {ParticleSand,sandFloor,BEACH_LENGTH,BEACH_WIDTH,type SandForcing} from './sand';
import {BeachEnvironment} from './environment';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export type Scenario='clean'|'multi'|'swarm'|'swarm-night'|'swarm-spread'|'travel'|'rest'|'abandoned'|'unrelated'|'no-eggs'|'weak'|'obstructed'|'low-light';
export type SimConfig={seed:number;scenario:Scenario;model:'A'|'B';eggs?:boolean};
export const WIDTH=1280,HEIGHT=720,DURATION=40,FPS=8;
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
const markers=[[-10,-6],[0,-6],[10,-6],[-10,6],[0,6],[10,6]];
const surface=(z:number)=>sandFloor(z)+.44;
type TurtleActor={id:number;group:THREE.Group;flippers:THREE.Mesh[];model?:THREE.Mesh;modelBase?:Float32Array;lastModelTime?:number;target:THREE.Vector2;startX:number;startAt:number;size:number;speed:number;digStart:number;digEnd:number;coverEnd:number;strength:number};
export class Simulation{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();cameras:THREE.PerspectiveCamera[]=[];overhead:THREE.OrthographicCamera;detailCamera:THREE.PerspectiveCamera;
 actors:TurtleActor[]=[];sand:ParticleSand;environment:BeachEnvironment;ready:Promise<void>;config:SimConfig;random:()=>number;light:THREE.DirectionalLight;ambient:THREE.HemisphereLight;night:boolean;lastTracksTime=-1;nightCanvas?:HTMLCanvasElement;nightContext?:CanvasRenderingContext2D;noiseCanvas?:HTMLCanvasElement;noiseContext?:CanvasRenderingContext2D;
 constructor(canvas:HTMLCanvasElement,config:SimConfig){
 this.config=config;this.random=rng(config.seed);this.night=config.scenario==='swarm-night'||config.scenario==='low-light';
 const spread=config.scenario==='swarm-spread',swarm=config.scenario==='swarm'||config.scenario==='swarm-night'||spread,multi=config.scenario==='multi'||swarm;
 // Spread layout: every turtle gets its own dune-to-water lane (shuffled per seed) so the end cameras never
 // see two turtles stacked, plus a seeded along-shore position at least 3.5 m from every other site.
 const spreadSites:number[][]=[];
 if(spread){const lanes=[-5,-3,-1,1,3,5];for(let i=lanes.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[lanes[i],lanes[j]]=[lanes[j],lanes[i]]}
  for(const z of lanes){let x=0;for(let attempt=0;attempt<200;attempt++){x=-10.5+this.random()*21;if(spreadSites.every(([sx,sz])=>Math.hypot(sx-x,sz-z)>=3.5))break}spreadSites.push([x,z])}}
 const specs=Array.from({length:swarm?6:multi?3:1},(_,id)=>{
 const targetX=spread?spreadSites[id][0]+(this.random()-.5)*.6:swarm?-10+id*4+(this.random()-.5)*.6:multi?-5+id*5+(this.random()-.5)*.8:(this.random()-.5)*6;
 const startX=multi?targetX+(this.random()-.5)*1.4:(this.random()-.5)*7;
 const target=new THREE.Vector2(targetX,spread?spreadSites[id][1]+(this.random()-.5)*.6:-.8+this.random()*3);
 const size=.85+this.random()*.25,speed=.9+this.random()*.2,startAt=3+(spread?id*.4:swarm?id*1.5:multi?id*3.5:0);
 const digStart=startAt+(swarm?9:8)/speed,digEnd=digStart+(swarm?6+this.random()*1.5:multi?6.5+this.random()*1.5:8+this.random()*3);
 const coverEnd=digEnd+(swarm?2.5+this.random()*.5:multi?2.6+this.random()*.5:3.5+this.random());
 return {id,target,startX,startAt,size,speed,digStart,digEnd:config.scenario==='abandoned'?digStart+4:digEnd,coverEnd:config.scenario==='abandoned'?digStart+4:coverEnd,strength:.85+.3*this.random()};
 });
 this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});this.renderer.setSize(WIDTH,HEIGHT,false);this.renderer.setPixelRatio(1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.AgXToneMapping;this.renderer.toneMappingExposure=1.15;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.scene.fog=new THREE.FogExp2(0xc4d6d5,.0038);
 if(this.night){this.nightCanvas=document.createElement('canvas');this.nightCanvas.width=WIDTH;this.nightCanvas.height=HEIGHT;this.nightContext=this.nightCanvas.getContext('2d')!;this.noiseCanvas=document.createElement('canvas');this.noiseCanvas.width=320;this.noiseCanvas.height=180;this.noiseContext=this.noiseCanvas.getContext('2d')!}
 this.ambient=new THREE.HemisphereLight(0xe5f3ff,0x897c66,1.2);this.scene.add(this.ambient);this.light=new THREE.DirectionalLight(0xffefd2,2.7);this.light.position.set(-25,35,-24);this.light.castShadow=true;this.light.shadow.mapSize.set(2048,2048);this.light.shadow.camera.left=-48;this.light.shadow.camera.right=48;this.light.shadow.camera.top=28;this.light.shadow.camera.bottom=-28;this.light.shadow.camera.near=1;this.light.shadow.camera.far=120;this.light.shadow.bias=-.00008;this.scene.add(this.light);
 this.environment=new BeachEnvironment(this.scene,this.renderer);this.environment.setNight(this.night);
 this.ready=Promise.all([this.environment.ready,this.loadTurtleModel()]).then(()=>{});
 this.sand=new ParticleSand(this.random);this.scene.add(this.sand.mesh);
 for(const [x,z] of markers){const marker=new THREE.Mesh(new THREE.BoxGeometry(.16,.035,.16),new THREE.MeshStandardMaterial({color:0x354d4c}));marker.position.set(x,surface(z),z);marker.userData.calibrationMarker=true;this.scene.add(marker)}
 for(const spec of specs){const group=new THREE.Group(),flippers:THREE.Mesh[]=[];
 const mat=new THREE.MeshStandardMaterial({color:0x586b45,roughness:.9});const shell=new THREE.Mesh(new THREE.SphereGeometry(1,32,16),mat);shell.scale.set(.43,.25,.62);shell.position.y=.25;group.add(shell);
 for(const x of [-.21,0,.21])for(const z of [-.3,0,.3]){const scute=new THREE.Mesh(new THREE.SphereGeometry(1,5,3),new THREE.MeshStandardMaterial({color:x===0?0x758358:0x65794f}));scute.scale.set(.13,.035,.16);scute.position.set(x,.48-Math.abs(x)*.28-Math.abs(z)*.16,z);group.add(scute)}
 const head=new THREE.Mesh(new THREE.SphereGeometry(.17,16,10),new THREE.MeshStandardMaterial({color:0x8a956c}));head.position.set(0,.18,.68);head.scale.z=1.25;group.add(head);
 for(const side of [-1,1]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.024,8,6),new THREE.MeshStandardMaterial({color:0x17211b}));eye.position.set(side*.14,.23,.75);group.add(eye)}
 for(const x of [-1,1])for(const z of [-1,1]){const f=new THREE.Mesh(new THREE.SphereGeometry(1,12,6),new THREE.MeshStandardMaterial({color:0x78845c}));f.scale.set(z>0?.36:.26,.045,z>0?.13:.16);f.position.set(x*.46,.1,z*.36);f.rotation.y=x*z*.4;group.add(f);flippers.push(f)}group.traverse(obj=>{if(obj instanceof THREE.Mesh)obj.castShadow=true});group.scale.setScalar(spec.size);this.scene.add(group);this.actors.push({...spec,group,flippers});}
 // Shoreline runs along X. Cameras face along its length, perpendicular to inland travel.
 for(const x of [-28,28]){const c=new THREE.PerspectiveCamera(48,WIDTH/HEIGHT,.1,250);c.position.set(x,5.6,0);c.lookAt(-Math.sign(x)*20,2.3,0);c.updateMatrixWorld();this.cameras.push(c)}
 this.overhead=new THREE.OrthographicCamera(-BEACH_LENGTH/2,BEACH_LENGTH/2,BEACH_WIDTH/2,-BEACH_WIDTH/2,.1,150);this.overhead.position.set(0,60,0);this.overhead.up.set(0,0,1);this.overhead.lookAt(0,0,0);
 this.detailCamera=new THREE.PerspectiveCamera(42,WIDTH/HEIGHT,.1,250);
 if(config.scenario==='obstructed'){const screen=new THREE.Mesh(new THREE.BoxGeometry(.35,2.3,3.1),new THREE.MeshStandardMaterial({color:0x64715a}));screen.position.set(-8,1.4,.3);this.scene.add(screen)}
 if(this.night){this.light.color.set(0xb4cef5);this.light.position.set(94,23,-18);this.light.intensity=.38;this.ambient.color.set(0x647fa9);this.ambient.groundColor.set(0x293344);this.ambient.intensity=.29;this.scene.fog=new THREE.FogExp2(0x091323,.006)}this.render(0,0);
 }
 async loadTurtleModel(){
  if(import.meta.env.PROD)return;
  try{
   const gltf=await new GLTFLoader().loadAsync('/models/turtle.gltf');
   for(const actor of this.actors){
    const model=gltf.scene.clone(true);
    model.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry=obj.geometry.clone();obj.castShadow=true;obj.receiveShadow=true;actor.model=obj;actor.modelBase=new Float32Array((obj.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array)}});
    if(!actor.model)continue;
    const bounds=new THREE.Box3().setFromObject(model);
    model.position.y=-bounds.min.y+0.02;
    actor.group.add(model);
    actor.group.children.forEach(child=>{if(child!==model)child.visible=false});
   }
  }catch(error){console.warn('Local turtle model unavailable; using procedural turtle.',error)}
 }
 animateModel(actor:TurtleActor,t:number,mode:SandForcing['mode']){
  if(!actor.model||!actor.modelBase||actor.lastModelTime===t)return;
  const position=actor.model.geometry.getAttribute('position') as THREE.BufferAttribute;
  const base=actor.modelBase,active=mode!=='none',dig=mode==='dig'||mode==='cover';
  const phase=(t-actor.startAt)*(dig?10:6)+actor.id*0.7;
  for(let i=0;i<position.count;i++){
   const k=i*3,x=base[k],y=base[k+1],z=base[k+2];
   const front=Math.max(0,Math.min(1,(Math.abs(x)-0.29)/0.42))*Math.max(0,Math.min(1,(z+0.12)/0.35));
   const rear=Math.max(0,Math.min(1,(Math.abs(x)-0.25)/0.35))*Math.max(0,Math.min(1,(-z-0.1)/0.3));
   const wave=Math.sin(phase+Math.sign(x)*0.75),amount=active?(dig?0.11:0.075):0;
   position.setXYZ(i,x+Math.sign(x)*front*wave*amount*0.4,y+front*Math.max(0,wave)*amount*0.55+rear*Math.max(0,-wave)*amount*0.25,z+front*wave*amount+rear*wave*amount*0.35);
  }
  position.needsUpdate=true;actor.model.geometry.computeVertexNormals();actor.lastModelTime=t;
 }
 hasDig(){return !['travel','rest'].includes(this.config.scenario)}
 pauseEnd(actor:TurtleActor){return this.config.scenario==='travel'?actor.digStart:actor.coverEnd}
 position(actor:TurtleActor,t:number){const shore=-BEACH_WIDTH/2+.2,a=smooth((t-actor.startAt)/(actor.digStart-actor.startAt));let x=actor.startX+(actor.target.x-actor.startX)*a,z=shore+(actor.target.y-shore)*a;if(t>this.pauseEnd(actor)){const b=smooth((t-this.pauseEnd(actor))/8);x=actor.target.x+(actor.startX+1-actor.target.x)*b;z=actor.target.y+(-BEACH_WIDTH/2-.5-actor.target.y)*b}return {x,z}}
 forcing(t:number):SandForcing[]{return this.actors.map(actor=>{const {x,z}=this.position(actor,t);let mode:SandForcing['mode']='none';if(t>=actor.startAt&&t<this.pauseEnd(actor)+8){if(this.hasDig()&&t>=actor.digStart&&t<actor.digEnd)mode='dig';else if(this.hasDig()&&t>=actor.digEnd&&t<actor.coverEnd)mode='cover';else if((t<actor.digStart||t>this.pauseEnd(actor))&&this.config.scenario!=='unrelated')mode='travel'}return {x,z,heading:t>this.pauseEnd(actor)?Math.PI:Math.atan2(actor.target.x-actor.startX,actor.target.y+BEACH_WIDTH/2-.2),mode,model:this.config.model,strength:actor.strength*(this.config.scenario==='weak'?.15:1),time:t-actor.startAt}})}
 render(t:number,view:number,capture=true){
 this.sand.advance(t,tt=>this.forcing(tt));const forces=this.forcing(t);
 const tracks=(time:number,items:SandForcing[])=>items.map((force,j)=>({x:force.x,z:force.z,heading:force.heading,digging:force.mode==='dig'||force.mode==='cover',active:time>=this.actors[j].startAt&&this.config.scenario!=='unrelated'})).filter(item=>item.active);
 if(t<this.lastTracksTime)this.lastTracksTime=-1;
 for(let tt=this.lastTracksTime<0?0:Math.floor(this.lastTracksTime*4)/4+.25;tt<t-.001;tt+=.25)this.environment.update(tt,tracks(tt,this.forcing(tt)));
 this.environment.update(t,tracks(t,forces));this.lastTracksTime=t;
 for(let j=0;j<this.actors.length;j++){const actor=this.actors[j],f=forces[j];actor.group.visible=this.config.scenario!=='unrelated'&&t>=actor.startAt&&t<this.pauseEnd(actor)+8;actor.group.position.set(f.x,surface(f.z)-.04,f.z);actor.group.rotation.y=f.heading;
 actor.flippers.forEach((flipper,i)=>{flipper.rotation.y=(i<2?-1:1)*.4+Math.sin((t-actor.startAt)*(f.mode==='dig'||f.mode==='cover'?11:7)+i*2)*(f.mode!=='none'?.65:0)});this.animateModel(actor,t,f.mode);}
 if(view===3){const first=this.actors[0],f=forces[0];this.detailCamera.position.set(f.x+2.8,1.55,f.z-3.25);this.detailCamera.lookAt(f.x,0.6,f.z+0.15)}
 if(view===3)this.scene.traverse(obj=>{if(obj.userData.calibrationMarker)obj.visible=false});
 this.renderer.render(this.scene,view===2?this.overhead:view===3?this.detailCamera:this.cameras[view]);
 if(view===3)this.scene.traverse(obj=>{if(obj.userData.calibrationMarker)obj.visible=true});
 return capture?(this.night?this.captureNight(t,view):this.renderer.domElement.toDataURL('image/png').split(',')[1]):'';
 }
 captureNight(t:number,view:number){const ctx=this.nightContext!,noise=this.noiseContext!,image=noise.createImageData(320,180);let state=(this.config.seed^Math.imul(Math.round(t*FPS)+1,2654435761)^Math.imul(view+1,2246822519))>>>0;
 for(let i=0;i<image.data.length;i+=4){state=(Math.imul(state,1664525)+1013904223)>>>0;const value=state>>>24;image.data[i]=value;image.data[i+1]=value;image.data[i+2]=value;image.data[i+3]=255}
 noise.putImageData(image,0,0);ctx.drawImage(this.renderer.domElement,0,0);ctx.globalAlpha=.045;ctx.imageSmoothingEnabled=false;ctx.drawImage(this.noiseCanvas!,0,0,WIDTH,HEIGHT);ctx.globalAlpha=1;return this.nightCanvas!.toDataURL('image/png').split(',')[1]}
 calibration(view:number){const c=this.cameras[view];return {camera:view,width:WIDTH,height:HEIGHT,mount_position_m:c.position.toArray(),orientation_quaternion_xyzw:c.quaternion.toArray(),vertical_fov_degrees:c.fov,ground_bounds:[-12,12,-8,8],beach_bounds:[-BEACH_LENGTH/2,BEACH_LENGTH/2,-BEACH_WIDTH/2,BEACH_WIDTH/2],plane_slope:.018,reference_points:markers.map(([x,z])=>{const v=new THREE.Vector3(x,surface(z),z).project(c);return {world:[x,z],pixel:[(v.x+1)*WIDTH/2,(1-v.y)*HEIGHT/2]}}),note:'Opposed down-beach side cameras at 5.6m mounting height with about 4 degree downward pitch, overlapping the central 24 × 16m region. Planar initial particle surface; particle relief and elevated turtle motion add parallax.'}}
 truth(){const eggs=this.hasDig()&&!['abandoned','unrelated','no-eggs'].includes(this.config.scenario)&&this.config.eggs!==false;return {seed:this.config.seed,scenario:this.config.scenario,model:this.config.model,sites:this.hasDig()&&this.config.scenario!=='unrelated'?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digStart,actor.coverEnd],radius:1.2,kind:'digging'})):[],eggs:eggs?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digEnd,actor.coverEnd]})):[],body_footprint_m2:Math.PI*.43*.62*this.actors[0].size*this.actors[0].size}}
 dispose(){this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){o.geometry.dispose();const m=o.material;if(Array.isArray(m))m.forEach(x=>x.dispose());else m.dispose()}});this.renderer.dispose()}
}
