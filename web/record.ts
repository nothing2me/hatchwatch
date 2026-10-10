import {Simulation} from './simulation';
declare global {interface Window{nestRecord:any}}
let sim:Simulation;
window.nestRecord={async init(config:any){sim?.dispose();sim=new Simulation(document.querySelector('canvas')!,config);await sim.ready;return {calibrations:[sim.calibration(0),sim.calibration(1)],truth:sim.truth(),renderer:sim.renderer.capabilities}},frame(t:number,view:number){return sim.render(t,view)}};
