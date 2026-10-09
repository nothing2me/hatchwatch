import * as THREE from 'three';
import {ParticleSand,sandFloor,BEACH_LENGTH,BEACH_WIDTH,type SandForcing} from './sand';
export type Scenario='clean'|'multi'|'travel'|'rest'|'abandoned'|'unrelated'|'no-eggs'|'weak'|'obstructed'|'low-light';
export type SimConfig={seed:number;scenario:Scenario;model:'A'|'B';eggs?:boolean};
export const WIDTH=960,HEIGHT=540,DURATION=40,FPS=8;
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
const markers=[[-6,-4],[0,-4],[6,-4],[-6,4],[0,4],[6,4]];
const surface=(z:number)=>sandFloor(z)+.44;
type TurtleActor={id:number;group:THREE.Group;flippers:THREE.Mesh[];target:THREE.Vector2;startX:number;startAt:number;size:number;speed:number;digStart:number;digEnd:number;coverEnd:number;strength:number};
export class Simulation{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();cameras:THREE.PerspectiveCamera[]=[];overhead:THREE.OrthographicCamera;
 actors:TurtleActor[]=[];sand:ParticleSand;config:SimConfig;random:()=>number;light:THREE.DirectionalLight;
 constructor(canvas:HTMLCanvasElement,config:SimConfig){
 this.config=config;this.random=rng(config.seed);
 const multi=config.scenario==='multi';
 const specs=Array.from({length:multi?3:1},(_,id)=>{
 const targetX=multi?-5+id*5+(this.random()-.5)*.8:(this.random()-.5)*6;
 const startX=multi?targetX+(this.random()-.5)*1.4:(this.random()-.5)*7;
 const target=new THREE.Vector2(targetX,-.8+this.random()*3);
 const size=.85+this.random()*.25,speed=.9+this.random()*.2,startAt=3+(multi?id*3.5:0);
 const digStart=startAt+8/speed,digEnd=digStart+(multi?6.5+this.random()*1.5:8+this.random()*3);
 const coverEnd=digEnd+(multi?2.6+this.random()*.5:3.5+this.random());
 return {id,target,startX,startAt,size,speed,digStart,digEnd:config.scenario==='abandoned'?digStart+4:digEnd,coverEnd:config.scenario==='abandoned'?digStart+4:coverEnd,strength:.85+.3*this.random()};
 });
 this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});this.renderer.setSize(WIDTH,HEIGHT,false);this.renderer.setPixelRatio(1);this.renderer.setClearColor(0xc2dbe2);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.scene.fog=new THREE.Fog(0xc2dbe2,50,160);
 this.scene.add(new THREE.HemisphereLight(0xe5f3ff,0xa18b5d,1.7));this.light=new THREE.DirectionalLight(0xfff0d6,2);this.light.position.set(-12,20,-8);this.scene.add(this.light);
 this.sand=new ParticleSand(this.random);this.scene.add(this.sand.mesh);
 const water=new THREE.Mesh(new THREE.PlaneGeometry(350,200),new THREE.MeshStandardMaterial({color:0x438d99,roughness:.38}));water.rotation.x=-Math.PI/2;water.position.set(0,.1,-112);this.scene.add(water);
 for(let i=0;i<6;i++){const foam=new THREE.Mesh(new THREE.PlaneGeometry(160,.035+i*.012),new THREE.MeshBasicMaterial({color:0xe0eeeb,transparent:true,opacity:.50-i*.065}));foam.rotation.x=-Math.PI/2;foam.position.set(0,.105,-12.3-i*.75);this.scene.add(foam)}
 for(const [x,z] of markers){const marker=new THREE.Mesh(new THREE.BoxGeometry(.16,.035,.16),new THREE.MeshStandardMaterial({color:0x354d4c}));marker.position.set(x,surface(z),z);this.scene.add(marker)}
 for(const spec of specs){const group=new THREE.Group(),flippers:THREE.Mesh[]=[];
 const mat=new THREE.MeshStandardMaterial({color:0x586b45,roughness:.9});const shell=new THREE.Mesh(new THREE.SphereGeometry(1,32,16),mat);shell.scale.set(.43,.25,.62);shell.position.y=.25;group.add(shell);
 for(const x of [-.21,0,.21])for(const z of [-.3,0,.3]){const scute=new THREE.Mesh(new THREE.SphereGeometry(1,5,3),new THREE.MeshStandardMaterial({color:x===0?0x758358:0x65794f}));scute.scale.set(.13,.035,.16);scute.position.set(x,.48-Math.abs(x)*.28-Math.abs(z)*.16,z);group.add(scute)}
 const head=new THREE.Mesh(new THREE.SphereGeometry(.17,16,10),new THREE.MeshStandardMaterial({color:0x8a956c}));head.position.set(0,.18,.68);head.scale.z=1.25;group.add(head);
 for(const side of [-1,1]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.024,8,6),new THREE.MeshStandardMaterial({color:0x17211b}));eye.position.set(side*.14,.23,.75);group.add(eye)}
 for(const x of [-1,1])for(const z of [-1,1]){const f=new THREE.Mesh(new THREE.SphereGeometry(1,12,6),new THREE.MeshStandardMaterial({color:0x78845c}));f.scale.set(z>0?.36:.26,.045,z>0?.13:.16);f.position.set(x*.46,.1,z*.36);f.rotation.y=x*z*.4;group.add(f);flippers.push(f)}group.scale.setScalar(spec.size);this.scene.add(group);this.actors.push({...spec,group,flippers});}
 // Shoreline runs along X. Cameras face along its length, perpendicular to inland travel.
 for(const x of [-18,18]){const c=new THREE.PerspectiveCamera(48,WIDTH/HEIGHT,.1,250);c.position.set(x,4.4,0);c.lookAt(-Math.sign(x)*18,2.7,0);c.updateMatrixWorld();this.cameras.push(c)}
 this.overhead=new THREE.OrthographicCamera(-BEACH_LENGTH/2,BEACH_LENGTH/2,BEACH_WIDTH/2,-BEACH_WIDTH/2,.1,150);this.overhead.position.set(0,60,0);this.overhead.up.set(0,0,1);this.overhead.lookAt(0,0,0);
 if(config.scenario==='obstructed'){const screen=new THREE.Mesh(new THREE.BoxGeometry(.35,2.3,3.1),new THREE.MeshStandardMaterial({color:0x64715a}));screen.position.set(-8,1.4,.3);this.scene.add(screen)}
 if(config.scenario==='low-light'){this.light.intensity=.13;(this.scene.children[0] as THREE.HemisphereLight).intensity=.15;this.renderer.setClearColor(0x18232b)}this.render(0,0);
 }
 hasDig(){return !['travel','rest'].includes(this.config.scenario)}
 pauseEnd(actor:TurtleActor){return this.config.scenario==='travel'?actor.digStart:actor.coverEnd}
 position(actor:TurtleActor,t:number){const a=smooth((t-actor.startAt)/(actor.digStart-actor.startAt));let x=actor.startX+(actor.target.x-actor.startX)*a,z=-11.8+(actor.target.y+11.8)*a;if(t>this.pauseEnd(actor)){const b=smooth((t-this.pauseEnd(actor))/8);x=actor.target.x+(actor.startX+1-actor.target.x)*b;z=actor.target.y+(-12.5-actor.target.y)*b}return {x,z}}
 forcing(t:number):SandForcing[]{return this.actors.map(actor=>{const {x,z}=this.position(actor,t);let mode:SandForcing['mode']='none';if(t>=actor.startAt&&t<this.pauseEnd(actor)+8){if(this.hasDig()&&t>=actor.digStart&&t<actor.digEnd)mode='dig';else if(this.hasDig()&&t>=actor.digEnd&&t<actor.coverEnd)mode='cover';else if((t<actor.digStart||t>this.pauseEnd(actor))&&this.config.scenario!=='unrelated')mode='travel'}return {x,z,heading:t>this.pauseEnd(actor)?Math.PI:Math.atan2(actor.target.x-actor.startX,actor.target.y+11.8),mode,model:this.config.model,strength:actor.strength*(this.config.scenario==='weak'?.15:1),time:t-actor.startAt}})}
 render(t:number,view:number,capture=true){
 this.sand.advance(t,tt=>this.forcing(tt));const forces=this.forcing(t);for(let j=0;j<this.actors.length;j++){const actor=this.actors[j],f=forces[j];actor.group.visible=this.config.scenario!=='unrelated'&&t>=actor.startAt&&t<this.pauseEnd(actor)+8;actor.group.position.set(f.x,surface(f.z)-.04,f.z);actor.group.rotation.y=f.heading;
 actor.flippers.forEach((flipper,i)=>{flipper.rotation.y=(i<2?-1:1)*.4+Math.sin((t-actor.startAt)*(f.mode==='dig'||f.mode==='cover'?11:7)+i*2)*(f.mode!=='none'?.65:0)});}
 this.renderer.render(this.scene,view===2?this.overhead:this.cameras[view]);return capture?this.renderer.domElement.toDataURL('image/png').split(',')[1]:'';
 }
 calibration(view:number){const c=this.cameras[view];return {camera:view,width:WIDTH,height:HEIGHT,ground_bounds:[-8,8,-6,6],beach_bounds:[-30,30,-12,12],plane_slope:.018,reference_points:markers.map(([x,z])=>{const v=new THREE.Vector3(x,surface(z),z).project(c);return {world:[x,z],pixel:[(v.x+1)*WIDTH/2,(1-v.y)*HEIGHT/2]}}),note:'Down-beach side camera at 4.4m mounting height with about 5 degree downward pitch. Planar initial particle surface; particle relief and elevated turtle motion add parallax.'}}
 truth(){const eggs=this.hasDig()&&!['abandoned','unrelated','no-eggs'].includes(this.config.scenario)&&this.config.eggs!==false;return {seed:this.config.seed,scenario:this.config.scenario,model:this.config.model,sites:this.hasDig()&&this.config.scenario!=='unrelated'?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digStart,actor.coverEnd],radius:1.2,kind:'digging'})):[],eggs:eggs?this.actors.map(actor=>({turtle_id:actor.id,point:[actor.target.x,actor.target.y-.3],interval:[actor.digEnd,actor.coverEnd]})):[],body_footprint_m2:Math.PI*.43*.62*this.actors[0].size*this.actors[0].size}}
 dispose(){this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){o.geometry.dispose();const m=o.material;if(Array.isArray(m))m.forEach(x=>x.dispose());else m.dispose()}});this.renderer.dispose()}
}
