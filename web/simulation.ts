import * as THREE from 'three';
import {ParticleSand,sandFloor,BEACH_LENGTH,BEACH_WIDTH,type SandForcing} from './sand';
import {BeachEnvironment} from './environment';
import {addHousingPoles} from './housing';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export type Scenario='clean'|'multi'|'swarm'|'swarm-night'|'swarm-spread'|'travel'|'rest'|'abandoned'|'unrelated'|'no-eggs'|'weak'|'obstructed'|'low-light';
export type SimConfig={seed:number;scenario:Scenario;model:'A'|'B';eggs?:boolean;layout?:'along'|'seaward';humans?:number};
export const WIDTH=1280,HEIGHT=720,DURATION=40,FPS=8;
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
const markers=[[-10,-6],[0,-6],[10,-6],[-10,6],[0,6],[10,6]];
const surface=(z:number)=>sandFloor(z)+.44;
// Walkers (opt-in via config.humans) are visual only: they never enter forcing(), so the sand is untouched.
type Walker={id:number;group:THREE.Group;hips:THREE.Group[];knees:THREE.Group[];shoulders:THREE.Group[];elbows:THREE.Group[];height:number;speed:number;through:THREE.Vector2;dir:THREE.Vector2;passAt:number;start:number;end:number};
const WALK_AREA=[-22,22,-15,9];
type TurtleActor={id:number;group:THREE.Group;flippers:THREE.Mesh[];model?:THREE.Mesh;modelBase?:Float32Array;lastModelTime?:number;target:THREE.Vector2;startX:number;startAt:number;size:number;speed:number;digStart:number;digEnd:number;coverEnd:number;strength:number};
export class Simulation{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();cameras:THREE.PerspectiveCamera[]=[];overhead:THREE.OrthographicCamera;detailCamera:THREE.PerspectiveCamera;
 actors:TurtleActor[]=[];walkers:Walker[]=[];sand:ParticleSand;environment:BeachEnvironment;ready:Promise<void>;config:SimConfig;random:()=>number;light:THREE.DirectionalLight;ambient:THREE.HemisphereLight;night:boolean;lastTracksTime=-1;nightCanvas?:HTMLCanvasElement;nightContext?:CanvasRenderingContext2D;noiseCanvas?:HTMLCanvasElement;noiseContext?:CanvasRenderingContext2D;
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
  addHousingPoles(this.scene);
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
 // Opt-in seaward layout: dune-mounted cameras behind the nesting area looking out over it toward the water.
 if(config.layout==='seaward'){this.addSandUnderlay();for(const x of [-9,9]){const c=new THREE.PerspectiveCamera(52,WIDTH/HEIGHT,.1,250);c.position.set(x,5.6,14);c.lookAt(x+Math.sign(x)*-12,0,-8);c.updateMatrixWorld();this.cameras.push(c)}}
 else for(const x of [-28,28]){const c=new THREE.PerspectiveCamera(48,WIDTH/HEIGHT,.1,250);c.position.set(x,5.6,0);c.lookAt(-Math.sign(x)*20,2.3,0);c.updateMatrixWorld();this.cameras.push(c)}
 // Every walker random draw happens here, after the turtle specs and sand, so default seeds are unchanged.
 this.buildWalkers(Math.max(0,Math.min(4,Math.floor(config.humans||0))));
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
  const phase=(t-actor.startAt)*7.4+actor.id*0.7;
  for(let i=0;i<position.count;i++){
   const k=i*3,x=base[k],y=base[k+1],z=base[k+2];
   const side=Math.sign(x)||1;
   const front=Math.max(0,Math.min(1,(Math.abs(x)-0.37)/0.30))*Math.max(0,Math.min(1,(z+0.02)/0.27));
   const rear=Math.max(0,Math.min(1,(Math.abs(x)-0.34)/0.32))*Math.max(0,Math.min(1,(-z-0.14)/0.28));
   const stroke=Math.sin(phase+(side>0?Math.PI:0));
   const frontStroke=dig?Math.sin(phase*1.35):stroke;
   const recovery=Math.max(0,-frontStroke);
   const amount=active?1:0;
   position.setXYZ(i,
    x+amount*side*front*frontStroke*(dig?0.07:0.10),
    y+amount*(front*recovery*(dig?0.055:0.15)+rear*Math.max(0,stroke)*0.045),
    z-amount*(front*frontStroke*(dig?0.15:0.25)+rear*stroke*0.075));
  }
  position.needsUpdate=true;actor.model.geometry.computeVertexNormals();actor.lastModelTime=t;
 }
 buildWalkers(count:number){const r=this.random,turtle=this.actors[0];
 for(let id=0;id<count;id++){const height=1.65+r()*.2,speed=1.2+r()*.3;let angle:number,through:THREE.Vector2,passAt:number;
 if(id===0){// Walker 0 passes 0.7-1.2 m beside turtle 0's site, along the shore, during its dig window.
  angle=(r()<.5?1:-1)*Math.PI/2+(r()-.5)*.9;const side=r()<.5?-1:1,offset=side*(.7+r()*.5);through=new THREE.Vector2(turtle.target.x+Math.cos(angle)*offset,turtle.target.y-Math.sin(angle)*offset);
  passAt=Math.max(3,Math.min(37,turtle.digStart+.5+r()*Math.max(0,turtle.digEnd-turtle.digStart-1)))}
 else{angle=r()*Math.PI*2;const x=-10+r()*20,z=-6+r()*12;through=new THREE.Vector2(x,z);passAt=6+r()*28}
 const dir=new THREE.Vector2(Math.sin(angle),Math.cos(angle));let sMin=-Infinity,sMax=Infinity;
 for(const [p,d,lo,hi] of [[through.x,dir.x,WALK_AREA[0],WALK_AREA[1]],[through.y,dir.y,WALK_AREA[2],WALK_AREA[3]]]){if(Math.abs(d)<1e-6)continue;const a=(lo-p)/d,b=(hi-p)/d;sMin=Math.max(sMin,Math.min(a,b));sMax=Math.min(sMax,Math.max(a,b))}
 const skins=[0x8d5524,0xc68642,0xe0ac69,0xf1c27d,0x5c3a21],shirts=[0x2f5d8a,0xb33a3a,0xe8e4d8,0x3c7a4a,0xd9a62e,0x6a4c93],pants=[0x2b2f3a,0x4a5a6b,0x7a6a55,0x1f3a5f];
 const pick=(list:number[])=>list[Math.floor(r()*list.length)];const skin=pick(skins),shirt=pick(shirts),pant=pick(pants),hair=pick([0x1b1410,0x3b2a1a,0x6b4a2a,0x9a8a7a]);
 const mat=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.85});const skinMat=mat(skin),shirtMat=mat(shirt),pantMat=mat(pant),shoeMat=mat(0x222222);
 const part=(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D,x:number,y:number,z=0)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m};
 // Modelled at 1.75 m with feet at y=0 and facing +z, then scaled to the walker's height.
 const group=new THREE.Group(),hips:THREE.Group[]=[],knees:THREE.Group[]=[],shoulders:THREE.Group[]=[],elbows:THREE.Group[]=[];
 for(const side of [-1,1]){const hip=new THREE.Group();hip.position.set(side*.1,.92,0);group.add(hip);part(new THREE.CapsuleGeometry(.08,.29,4,10),pantMat,hip,0,-.225);
  const knee=new THREE.Group();knee.position.y=-.45;hip.add(knee);part(new THREE.CapsuleGeometry(.06,.3,4,10),pantMat,knee,0,-.21);part(new THREE.BoxGeometry(.1,.07,.25),shoeMat,knee,0,-.435,.05);hips.push(hip);knees.push(knee)}
 part(new THREE.BoxGeometry(.32,.16,.2),pantMat,group,0,.95);part(new THREE.BoxGeometry(.36,.48,.22),shirtMat,group,0,1.2);
 const shoulderBar=part(new THREE.CapsuleGeometry(.09,.24,4,10),shirtMat,group,0,1.42);shoulderBar.rotation.z=Math.PI/2;
 part(new THREE.CylinderGeometry(.05,.055,.1,10),skinMat,group,0,1.52);const head=part(new THREE.SphereGeometry(.11,16,12),skinMat,group,0,1.63);head.scale.y=1.12;
 const hairCap=part(new THREE.SphereGeometry(.118,16,8,0,Math.PI*2,0,Math.PI/2),mat(hair),group,0,1.65,-.012);hairCap.scale.y=1.1;
 for(const side of [-1,1]){const shoulder=new THREE.Group();shoulder.position.set(side*.24,1.42,0);group.add(shoulder);part(new THREE.CapsuleGeometry(.05,.2,4,8),shirtMat,shoulder,0,-.15);
  const elbow=new THREE.Group();elbow.position.y=-.3;shoulder.add(elbow);part(new THREE.CapsuleGeometry(.045,.18,4,8),skinMat,elbow,0,-.13);part(new THREE.SphereGeometry(.05,10,8),skinMat,elbow,0,-.29);shoulders.push(shoulder);elbows.push(elbow)}
 group.scale.setScalar(height/1.75);group.rotation.y=angle;group.visible=false;this.scene.add(group);
 this.walkers.push({id,group,hips,knees,shoulders,elbows,height,speed,through,dir,passAt,start:Math.max(2,passAt+sMin/speed),end:Math.min(38,passAt+sMax/speed)})}}
 // Seaward cameras look down into the particle bed, so gaps between grains and dug pits would show the clear
 // colour; a damp-sand underlay at the bed floor closes them. Seaward-only, so default renders are unchanged.
 addSandUnderlay(){const geometry=new THREE.PlaneGeometry(BEACH_LENGTH,BEACH_WIDTH,1,8);geometry.rotateX(-Math.PI/2);const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,sandFloor(p.getZ(i))-.01);geometry.computeVertexNormals();
 const underlay=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x8f7d5c,roughness:1}));this.scene.add(underlay)}
 walkerPosition(w:Walker,t:number){const s=(t-w.passAt)*w.speed;return {x:w.through.x+w.dir.x*s,z:w.through.y+w.dir.y*s,s}}
 updateWalkers(t:number){for(const w of this.walkers){w.group.visible=t>=w.start&&t<=w.end;if(!w.group.visible)continue;const {x,z,s}=this.walkerPosition(w,t),phase=s/(1.4*w.height/1.75)*Math.PI*2,swing=Math.sin(phase);
  w.group.position.set(x,surface(z)-.05+.025*Math.abs(Math.cos(phase)),z);
  w.hips.forEach((hip,i)=>{const leg=(i?-1:1)*swing;hip.rotation.x=.5*leg;w.knees[i].rotation.x=.1+.8*Math.max(0,(i?1:-1)*Math.cos(phase))});
  w.shoulders.forEach((shoulder,i)=>{shoulder.rotation.x=(i?1:-1)*.4*swing;w.elbows[i].rotation.x=-.3-.2*Math.max(0,(i?1:-1)*swing)})}}
 hasDig(){return !['travel','rest'].includes(this.config.scenario)}
 pauseEnd(actor:TurtleActor){return this.config.scenario==='travel'?actor.digStart:actor.coverEnd}
 position(actor:TurtleActor,t:number){const shore=-BEACH_WIDTH/2+.2,a=smooth((t-actor.startAt)/(actor.digStart-actor.startAt));let x=actor.startX+(actor.target.x-actor.startX)*a,z=shore+(actor.target.y-shore)*a;if(t>this.pauseEnd(actor)){const b=smooth((t-this.pauseEnd(actor))/8);x=actor.target.x+(actor.startX+1-actor.target.x)*b;z=actor.target.y+(-BEACH_WIDTH/2-6-actor.target.y)*b}return {x,z}}
 forcing(t:number):SandForcing[]{return this.actors.map(actor=>{const {x,z}=this.position(actor,t);let mode:SandForcing['mode']='none';if(t>=actor.startAt&&t<this.pauseEnd(actor)+8){if(this.hasDig()&&t>=actor.digStart&&t<actor.digEnd)mode='dig';else if(this.hasDig()&&t>=actor.digEnd&&t<actor.coverEnd)mode='cover';else if((t<actor.digStart||t>this.pauseEnd(actor))&&this.config.scenario!=='unrelated')mode='travel'}return {x,z,heading:t>this.pauseEnd(actor)?Math.PI:Math.atan2(actor.target.x-actor.startX,actor.target.y+BEACH_WIDTH/2-.2),mode,model:this.config.model,strength:actor.strength*(this.config.scenario==='weak'?.15:1),time:t-actor.startAt}})}
 render(t:number,view:number,capture=true){
this.sand.advance(t,tt=>this.forcing(tt));const forces=this.forcing(t);
 const tracks=(time:number,items:SandForcing[])=>items.map((force,j)=>({x:force.x,z:force.z,heading:force.heading,digging:force.mode==='dig'||force.mode==='cover',active:time>=this.actors[j].startAt&&this.config.scenario!=='unrelated'})).filter(item=>item.active);
 if(t<this.lastTracksTime)this.lastTracksTime=-1;
 for(let tt=this.lastTracksTime<0?0:Math.floor(this.lastTracksTime*4)/4+.25;tt<t-.001;tt+=.25)this.environment.update(tt,tracks(tt,this.forcing(tt)));
 this.environment.update(t,tracks(t,forces));this.lastTracksTime=t;
 this.environment.setLiveContact(forces);
 for(let j=0;j<this.actors.length;j++){const actor=this.actors[j],f=forces[j];actor.group.visible=this.config.scenario!=='unrelated'&&t>=actor.startAt&&t<this.pauseEnd(actor)+8;
 const crawling=f.mode==='travel',cycle=(t-actor.startAt)*7.4;
 actor.group.position.set(f.x,surface(f.z)-.04+(crawling?0.024*Math.sin(cycle*2):0),f.z);
  // After digging the turtle returns to the sea. Past the shoreline it sinks
  // smoothly below the waterline so it is fully submerged before it despawns.
  const returnProgress=(t-this.pauseEnd(actor))/8,waterEdge=-BEACH_WIDTH/2-.3;
  const sink=returnProgress>0&&f.z<=waterEdge?smooth((waterEdge-f.z)/5)*.85:0;
  actor.group.position.y-=sink;
 actor.group.rotation.set(crawling?0.024*Math.sin(cycle):0,f.heading+(crawling?0.055*Math.sin(cycle):0),crawling?0.04*Math.sin(cycle):0);
 actor.flippers.forEach(flipper=>{const side=Math.sign(flipper.position.x),front=flipper.position.z>0,stroke=Math.sin(cycle+(side>0?Math.PI:0));flipper.rotation.y=side*(front?.4:.24)+stroke*(f.mode!=='none'?(front?.8:.35):0);flipper.rotation.x=front?Math.max(0,-stroke)*.45:Math.max(0,stroke)*.2;flipper.position.y=.1+(f.mode!=='none'?Math.max(0,-stroke)*(front?.09:.035):0)});this.animateModel(actor,t,f.mode);}
 this.updateWalkers(t);
 if(view===3){const first=this.actors[0],f=forces[0];this.detailCamera.position.set(f.x+2.8,1.55,f.z-3.25);this.detailCamera.lookAt(f.x,0.6,f.z+0.15)}
 if(view===3)this.scene.traverse(obj=>{if(obj.userData.calibrationMarker)obj.visible=false});
 this.renderer.render(this.scene,view===2?this.overhead:view===3?this.detailCamera:this.cameras[view]);
 if(view===3)this.scene.traverse(obj=>{if(obj.userData.calibrationMarker)obj.visible=true});
 return capture?(this.night?this.captureNight(t,view):this.renderer.domElement.toDataURL('image/png').split(',')[1]):'';
 }
 captureNight(t:number,view:number){const ctx=this.nightContext!,noise=this.noiseContext!,image=noise.createImageData(320,180);let state=(this.config.seed^Math.imul(Math.round(t*FPS)+1,2654435761)^Math.imul(view+1,2246822519))>>>0;
 for(let i=0;i<image.data.length;i+=4){state=(Math.imul(state,1664525)+1013904223)>>>0;const value=state>>>24;image.data[i]=value;image.data[i+1]=value;image.data[i+2]=value;image.data[i+3]=255}
 noise.putImageData(image,0,0);ctx.drawImage(this.renderer.domElement,0,0);ctx.globalAlpha=.045;ctx.imageSmoothingEnabled=false;ctx.drawImage(this.noiseCanvas!,0,0,WIDTH,HEIGHT);ctx.globalAlpha=1;return this.nightCanvas!.toDataURL('image/png').split(',')[1]}
 calibration(view:number){const c=this.cameras[view];return {camera:view,width:WIDTH,height:HEIGHT,mount_position_m:c.position.toArray(),orientation_quaternion_xyzw:c.quaternion.toArray(),vertical_fov_degrees:c.fov,ground_bounds:[-12,12,-8,8],beach_bounds:[-BEACH_LENGTH/2,BEACH_LENGTH/2,-BEACH_WIDTH/2,BEACH_WIDTH/2],plane_slope:.018,reference_points:markers.map(([x,z])=>{const v=new THREE.Vector3(x,surface(z),z).project(c);return {world:[x,z],pixel:[(v.x+1)*WIDTH/2,(1-v.y)*HEIGHT/2]}}),note:this.config.layout==='seaward'?'Dune-mounted seaward cameras at 5.6m mounting height, 14m inland at x=±9, pitched down toward the water and overlapping the central 24 × 16m region. Planar initial particle surface; particle relief and elevated turtle motion add parallax.':'Opposed down-beach side cameras at 5.6m mounting height with about 4 degree downward pitch, overlapping the central 24 × 16m region. Planar initial particle surface; particle relief and elevated turtle motion add parallax.'}}
 truth(){const eggs=this.hasDig()&&!['abandoned','unrelated','no-eggs'].includes(this.config.scenario)&&this.config.eggs!==false;return {seed:this.config.seed,scenario:this.config.scenario,model:this.config.model,sites:this.hasDig()&&this.config.scenario!=='unrelated'?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digStart,actor.coverEnd],radius:1.2,kind:'digging'})):[],eggs:eggs?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digEnd,actor.coverEnd]})):[],body_footprint_m2:Math.PI*.43*.62*this.actors[0].size*this.actors[0].size,...(this.walkers.length?{people:this.walkers.map(w=>({id:w.id,height_m:+w.height.toFixed(3),path:Array.from({length:81},(_,i)=>i/2).filter(t=>t>=w.start&&t<=w.end).map(t=>{const {x,z}=this.walkerPosition(w,t);return [t,+x.toFixed(3),+z.toFixed(3)]})}))}:{})}}
 dispose(){this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){o.geometry.dispose();const m=o.material;if(Array.isArray(m))m.forEach(x=>x.dispose());else m.dispose()}});this.renderer.dispose()}
}
