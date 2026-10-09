import * as THREE from 'three';
export const BEACH_LENGTH=60, BEACH_WIDTH=24;
export const sandFloor=(z:number)=>.018*(z+12);
const STEP=1/32, SPACING=.26, CELL=.55;
export type SandForcing={x:number;z:number;heading:number;mode:'travel'|'dig'|'cover'|'none';model:'A'|'B';strength:number;time:number};
/** Two-layer granular bed: every grain has position, velocity and radius.
 * Untouched grains sleep. Local forces, gravity, neighbor contact and friction
 * are solved at 32 Hz. A coarse-grain approximation, not grain-scale sand. */
export class ParticleSand {
 mesh:THREE.InstancedMesh;count:number;positions:Float32Array;velocities:Float32Array;radii:Float32Array;initial:Float32Array;
 active=new Set<number>();hash=new Map<string,Set<number>>();keys:string[]=[];quiet:Uint16Array;step=0;matrix=new THREE.Matrix4();changed=new Set<number>();
 constructor(random:()=>number){
 const nx=Math.floor(BEACH_LENGTH/SPACING),nz=Math.floor(BEACH_WIDTH/SPACING);this.count=nx*nz*2;
 this.positions=new Float32Array(this.count*3);this.velocities=new Float32Array(this.count*3);this.radii=new Float32Array(this.count);this.quiet=new Uint16Array(this.count);
 this.mesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({roughness:1,flatShading:true}),this.count);this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
 const color=new THREE.Color();let i=0;
 for(let layer=0;layer<2;layer++)for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++,i++){
 const x=-BEACH_LENGTH/2+(ix+.5)*SPACING+layer*SPACING*.5+(random()-.5)*.075,z=-BEACH_WIDTH/2+(iz+.5)*SPACING+layer*SPACING*.5+(random()-.5)*.075;
 const r=.119+random()*.012,y=sandFloor(z)+.13+layer*.215;
 this.positions.set([x,y,z],i*3);this.radii[i]=r;const tone=.72+random()*.20;color.setRGB(tone,tone*.84,tone*.57);this.mesh.setColorAt(i,color);this.updateMatrix(i);this.insert(i);
 }this.initial=this.positions.slice();this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.mesh.instanceMatrix.needsUpdate=true;
 }
 key(x:number,z:number){return `${Math.floor(x/CELL)},${Math.floor(z/CELL)}`}
 insert(i:number){const k=this.key(this.positions[i*3],this.positions[i*3+2]);this.keys[i]=k;let bucket=this.hash.get(k);if(!bucket){bucket=new Set();this.hash.set(k,bucket)}bucket.add(i)}
 updateMatrix(i:number){const o=i*3,r=this.radii[i];this.matrix.makeScale(r,r*.88,r);this.matrix.setPosition(this.positions[o],this.positions[o+1],this.positions[o+2]);this.mesh.setMatrixAt(i,this.matrix)}
 neighbors(x:number,z:number,r:number){const result:number[]=[];for(let gx=Math.floor((x-r)/CELL);gx<=Math.floor((x+r)/CELL);gx++)for(let gz=Math.floor((z-r)/CELL);gz<=Math.floor((z+r)/CELL);gz++){const bucket=this.hash.get(`${gx},${gz}`);if(bucket)for(const i of bucket)result.push(i)}return result}
 reset(){this.positions.set(this.initial);this.velocities.fill(0);this.active.clear();this.hash.clear();this.quiet.fill(0);this.step=0;for(let i=0;i<this.count;i++){this.insert(i);this.updateMatrix(i)}this.mesh.instanceMatrix.needsUpdate=true}
 wake(i:number){this.active.add(i);this.quiet[i]=0}
 force(f:SandForcing){
 if(f.mode==='none')return;
 const moving=f.mode==='travel',cover=f.mode==='cover',radius=moving?.65:1.2;
 const sin=Math.sin(f.heading),cos=Math.cos(f.heading);
 for(const i of this.neighbors(f.x,f.z,radius)){
 const o=i*3,dx=this.positions[o]-f.x,dz=this.positions[o+2]-f.z;const localX=dx*cos-dz*sin,localZ=dx*sin+dz*cos;
 const phase=f.time*(moving?7:11)+Math.sign(localX)*1.6;
 const pulse=Math.max(0,Math.sin(phase));
 // A flipper strike is a short impulse. The grains then follow ballistic arcs
 // under gravity, colliding with neighboring grains and settling by friction.
 const strike=Math.sin(phase)>.88&&Math.sin(phase-STEP*(moving?7:11))<=.88;
 let strength=0,fx=0,fz=0,lift=0;
 if(moving){if(Math.abs(localX)>.23&&Math.abs(localX)<.65&&Math.abs(localZ)<.5){strength=pulse*.55;fx=Math.sign(localX)*cos;fz=-Math.sign(localX)*sin;lift=.15}}
 else if(f.model==='A'){
 const d=Math.hypot(localX,localZ+.3);if(d<(cover?1.15:.64)&&d>.06){strength=(cover?pulse:strike?1:0)*(cover?2.2:1.0)*(cover?1:(1-d*.4));fx=(cover?-1:1)*dx/d;fz=(cover?-1:1)*(dz-.12)/d;lift=cover?.15:1}
 }else{
 // B rakes alternating tangential strips rather than radial excavation jets.
 const strip=Math.abs(localX-Math.sin(f.time*2.1)*.42);if(strip<.32&&Math.abs(localZ+.3)<(cover?1:.65)){strength=(cover?pulse:strike?1:0)*(cover?1.5:1);const side=Math.sin(f.time*2.1)>0?1:-1;fx=cover?-dx:side*cos+.45*sin;fz=cover?-dz:-side*sin+.45*cos;lift=cover?.05:1}
 }
 if(strength>0){this.wake(i);const launched=!moving&&!cover,scale=strength*f.strength*(launched?1:STEP);
 this.velocities[o]+=fx*scale*(launched?2.4:1);
 this.velocities[o+1]+=lift*scale*(launched?3.1:3);
 this.velocities[o+2]+=fz*scale*(launched?2.4:1)}
 }
 }
 advance(t:number,forcing:(t:number)=>SandForcing){
 const target=Math.floor((t+1e-7)/STEP);if(target<this.step)this.reset();
 while(this.step<target){this.step++;this.force(forcing(this.step*STEP));this.integrate()}
 for(const i of this.changed)this.updateMatrix(i);if(this.changed.size)this.mesh.instanceMatrix.needsUpdate=true;this.changed.clear();
 }
 integrate(){
 const ids=Array.from(this.active).sort((a,b)=>a-b),p=this.positions,v=this.velocities;
 for(const i of ids){const o=i*3;v[o+1]-=9.81*STEP;v[o]*=.985;v[o+2]*=.985;p[o]+=v[o]*STEP;p[o+1]+=v[o+1]*STEP;p[o+2]+=v[o+2]*STEP;
 const floor=sandFloor(p[o+2])+this.radii[i]*.88;if(p[o+1]<floor){p[o+1]=floor;v[o+1]=Math.max(0,-v[o+1]*.05);v[o]*=.80;v[o+2]*=.80}
 p[o]=Math.max(-BEACH_LENGTH/2+.1,Math.min(BEACH_LENGTH/2-.1,p[o]));p[o+2]=Math.max(-BEACH_WIDTH/2+.1,Math.min(BEACH_WIDTH/2-.1,p[o+2]));
 const key=this.key(p[o],p[o+2]);if(key!==this.keys[i]){this.hash.get(this.keys[i])?.delete(i);this.insert(i)}this.changed.add(i);
 }
 for(let iteration=0;iteration<2;iteration++)for(const i of ids){const o=i*3;for(const j of this.neighbors(p[o],p[o+2],.3)){if(i===j)continue;const q=j*3,dx=p[o]-p[q],dy=p[o+1]-p[q+1],dz=p[o+2]-p[q+2],dist=Math.hypot(dx,dy,dz),minimum=(this.radii[i]+this.radii[j])*.94;if(dist>=minimum||dist<1e-6)continue;
 const penetration=minimum-dist,nx=dx/dist,ny=dy/dist,nz=dz/dist;const both=this.active.has(j),share=both?.5:1;
 p[o]+=nx*penetration*share;p[o+1]+=ny*penetration*share;p[o+2]+=nz*penetration*share;
 const relative=(v[o]-v[q])*nx+(v[o+1]-v[q+1])*ny+(v[o+2]-v[q+2])*nz;
 if(relative<0){const impulse=-relative*.95*share;v[o]+=nx*impulse;v[o+1]+=ny*impulse;v[o+2]+=nz*impulse;if(both){v[q]-=nx*impulse;v[q+1]-=ny*impulse;v[q+2]-=nz*impulse}}
 if(both){p[q]-=nx*penetration*.5;p[q+1]-=ny*penetration*.5;p[q+2]-=nz*penetration*.5;this.changed.add(j)}else if(penetration>.045||relative<-.65)this.wake(j);
 v[o]*=.96;v[o+2]*=.96;
 }}
 for(const i of ids){const o=i*3;if(Math.hypot(v[o],v[o+1],v[o+2])<.09)this.quiet[i]++;else this.quiet[i]=0;if(this.quiet[i]>24){this.active.delete(i);v[o]=v[o+1]=v[o+2]=0}}
 }
}
