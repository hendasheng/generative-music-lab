const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const version=process.argv[2] || '0.1';
assert(['0.1','0.2'].includes(version));
const M = require('../'+version+'/sequencer.js');
assert.deepEqual(Array.from({length:12},(_,i)=>M.midi(i,9,'minor')), [57,59,60,62,64,65,67,69,71,72,74,76]);
for(const scale of Object.keys(M.SCALES))for(let root=0;root<12;root++) {
  const pitches=Array.from({length:12},(_,i)=>M.midi(i,root,scale));
  assert(pitches.every((x,i)=>i===0 || x>pitches[i-1]));
}
assert.equal(M.duration(120)*16,2);
assert.equal(M.duration(60)*16,4);
const a=M.blank(),b=M.blank();
M.randomize(a,M.rng('pattern'));M.randomize(b,M.rng('pattern'));
assert.deepEqual(a,b);assert(a.some(x=>x===1));assert(a.every(x=>x>=0&&x<=1));
const edge=M.blank();M.stamp(edge,0,0);assert.equal(edge.filter(x=>x>0).length,3);
M.brush(edge,11.99,15.99);assert.equal(edge[191],1);M.erase(edge,15,11);assert.equal(edge[191],0);
M.brush(edge,-1,0);assert(edge.every(x=>x>=0&&x<=1));
const half={cells:new Float32Array(192).fill(.5),muted:false}, random=M.rng('probability');
let count=0;
for(let i=0;i<10000;i++) {
  const notes=M.events(half,i%16,9,'minor',random);count+=notes.length;
  assert(notes.every(n=>n.velocity>=.36 && n.velocity<=.49));
}
assert(Math.abs(count/120000-.675)<.006);
const full={cells:new Float32Array(192).fill(1),muted:false};
assert.equal(M.events(full,0,9,'minor',M.rng('full')).length,12);
assert.equal(M.events({cells:M.blank()},0,9,'minor',M.rng('zero')).length,0);
const r1=M.rng('mute'),r2=M.rng('mute');
M.events({...full,muted:true},0,9,'minor',r1);M.events(full,0,9,'minor',r2);
assert.deepEqual(M.events(full,1,9,'minor',r1),M.events(full,1,9,'minor',r2));

// Run the actual audio scheduler against a virtual audio clock.
let now=0, uid=0, ctx, starts=[],stops=[],draws=[];
const timers=new Map(),frames=new Map(), endings=new Map();
let nodeCount=0, disconnected=0;const parameters=[];
function setTimer(fn,ms){const id=++uid;timers.set(id,{fn,at:now+ms/1000});return id;}
function advance(to){
  while(true){const entry=[...timers].filter(([,t])=>t.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();}
  now=to;
  for(const [source,time] of endings)if(time<=now){endings.delete(source);source.onended?.();}
  const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());
}
function param(){const p={value:0,setValueAtTime(v,t){assert(Number.isFinite(v));assert(Number.isFinite(t));this.value=v;parameters.push(v);},linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);},exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);},setTargetAtTime(v,t){this.setValueAtTime(v,t);},cancelScheduledValues(){}};return p;}
function node(){nodeCount++;let closed=false;return {connect(){},disconnect(){if(!closed){closed=true;disconnected++;}},gain:param(),frequency:param(),detune:param(),Q:param(),pan:param(),delayTime:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()};}
function source(){return {...node(),start(time){if(time!==undefined)starts.push(time);},stop(time){stops.push(time);endings.set(this,time??now);}};}
class FakeContext {
  constructor(){ctx=this;this.destination={};this.closed=false;this.sampleRate=8000;}
  get currentTime(){return now;}
  async resume(){}
  async close(){this.closed=true;}
  createGain(){return node();} createDynamicsCompressor(){return node();}
  createOscillator(){return source();}
  createBufferSource(){return source();}
  createBiquadFilter(){return node();}createDelay(){return node();}createStereoPanner(){return node();}createConvolver(){return node();}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData(index){return data[index];}};}
}
const sandbox={GridMusic:M,AudioContext:FakeContext,setTimeout:setTimer,clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=++uid;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+version+'/audio.js'),'utf8'),sandbox);
(async()=>{
  const state={bpm:120,root:9,scale:'minor',seed:'test',tracks:[full,{cells:version==='0.2'?new Float32Array(192).fill(1):M.blank(),muted:false}]};
  if(version==='0.2'){
    assert.deepEqual(Array.from(sandbox.GridAudio.SOUNDS,s=>s.id),['reverie','kalimba','rhodes','acid','machine']);
    if(process.argv[3])state.tracks.forEach(track=>track.sound=process.argv[3]);
  }
  const engine=await sandbox.GridAudio.activate({state,onStep:event=>draws.push({at:now,...event})});
  engine.schedule();engine.schedule();assert.equal(timers.size,1);
  advance(2.12);
  const times=[...new Set(starts)];assert(times.length>=17);
  times.slice(1).forEach((time,i)=>assert(Math.abs(time-times[i]-.125)<1e-9));
  assert(draws.every(event=>event.time<=event.at));assert(starts.length>0);
  engine.end();const stoppedCount=starts.length;advance(3);assert.equal(starts.length,stoppedCount);assert.equal(frames.size,0);assert.equal(timers.size,0);
  engine.schedule();assert.equal(timers.size,1);state.bpm=60;advance(3.65);
  const changed=[...new Set(starts)].filter(time=>time>3.2);
  changed.slice(1).forEach((time,i)=>assert(Math.abs(time-changed[i]-.25)<1e-9));
  if(version==='0.2') {
    for(const sound of sandbox.GridAudio.SOUNDS){
      state.tracks[0].sound=sound.id;state.tracks[1].sound=sound.id;
      const before=starts.length;advance(now+.3);assert(starts.length>before,'Sound switch must continue scheduling');
    }
  }
  const closing=engine.deactivate();advance(now+.4);await closing;assert(ctx.closed);assert.equal(timers.size,0);assert.equal(frames.size,0);
  assert.equal(disconnected,nodeCount,'Every audio node must be disconnected after shutdown');
  console.log(version+' '+(process.argv[3]||'default')+' PASS: scales, boundaries, seed replay, probability ('+(count/120000).toFixed(4)+'), mute independence, actual scheduler, tempo changes, visual timing, restart and cleanup; '+starts.length+' voice starts.');
})().catch(error=>{console.error(error);process.exitCode=1;});
