const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const intervals = new Map(); let intervalID=0, context;
class Param {
  constructor() { this.value=0; }
  setValueAtTime(v) { assert(Number.isFinite(v)); this.value=v; }
  linearRampToValueAtTime(v) { assert(Number.isFinite(v)); this.value=v; }
  setTargetAtTime(v) { assert(Number.isFinite(v));this.value=v; }
  cancelScheduledValues() {}
  setValueCurveAtTime(curve,t,duration) { assert(t>=0 && duration>0); assert(curve.every(Number.isFinite)); assert.equal(curve[0],0); assert(Math.abs(curve.at(-1))<1e-7); }
}
class Node {
  constructor(ctx) { this.ctx=ctx; this.frequency=new Param();this.Q=new Param();this.gain=new Param(); this.pan=new Param(); this.playbackRate=new Param(); this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();this.connected=false;this.targets=[]; ctx.nodes.push(this); }
  connect(n) { this.connected=true;this.targets.push(n); return n; }
  disconnect() { this.connected=false; }
  start(t,offset) { assert(t>=this.ctx.currentTime); assert(offset>=0 && offset<this.buffer.duration); this.ctx.starts.push({t,offset,rate:this.playbackRate.value}); }
  stop(t) { if(t===undefined) this.onended?.(); else assert(Number.isFinite(t)); }
}
class AudioContext {
  constructor() { context=this;this.currentTime=0;this.sampleRate=44100;this.nodes=[];this.starts=[];this.destination={}; }
  async resume() {}
  async close() { this.closed=true; }
  createBiquadFilter() { return new Node(this); }
  createConvolver() { return new Node(this); }
  createGain() { return new Node(this); }
  createDynamicsCompressor() { return new Node(this); }
  createBufferSource() { return new Node(this); }
  createStereoPanner() { return new Node(this); }
  createBuffer(ch,len,sr) { const data=Array.from({length:ch},()=>new Float32Array(len));return {numberOfChannels:ch,length:len,sampleRate:sr,duration:len/sr,getChannelData:c=>data[c]}; }
}
const sandbox={ window:{}, AudioContext, Float32Array, setInterval: fn=>{intervals.set(++intervalID,fn);return intervalID;}, clearInterval:id=>intervals.delete(id), setTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../'+(process.argv[2] || '0.1')+'/engine.js'),'utf8'),sandbox);
const G=sandbox.window.Granular;
function sequence(seed) { const rng=G.random(seed); return Array.from({length:100},()=>G.plan(G.defaults,8,rng)); }
assert.equal(JSON.stringify(sequence('a')),JSON.stringify(sequence('a')));
assert.notEqual(JSON.stringify(sequence('a')),JSON.stringify(sequence('b')));
for(const duration of [.002,.1,8,30]) for(const pitch of [-24,0,24]) for(const size of [15,1000]) for(const position of [0,.5,1]) for(const reverse of [0,1]) {
  const e=G.plan({...G.defaults,pitch,size,position,reverse,spray:.5},duration,G.random('edge'));
  assert(e.offset>=0 && e.offset+e.length*e.rate<=duration+1e-10);
  assert(e.length>0 && Number.isFinite(e.peak) && e.peak<=.38);
  assert.equal(e.reverse,Boolean(reverse));
}
if (G.effective) {
  const base={...G.defaults};
  assert.equal(JSON.stringify(G.effective(base,{x:.5,y:.5},0)),JSON.stringify(base));
  for(const x of [0,.25,.5,.75,1]) for(const y of [0,.25,.5,.75,1]) for(const t of [0,3.5,7,10.5]) {
    const p=G.effective(base,{x,y},t,G.random('macro'));
    assert(p.position>=0 && p.position<=1 && p.reverse>=0 && p.reverse<=1 && p.density>0);
    const event=G.plan(p,.01,G.random('grain'));
    assert(event.offset+event.length*event.rate<=.01+1e-10);
  }
  assert(G.effective(base,{x:0,y:0}).reverse>.8);
  assert(G.effective(base,{x:0,y:1},3.5).position>base.position);
  assert(G.effective(base,{x:1,y:1}).spray>base.spray);
  assert(G.effective(base,{x:1,y:0}).density>base.density);
  assert.equal(G.gateLevel(.08,0),1);
  assert(G.gateLevel(.08,1)<.1); assert.equal(G.gateLevel(.03,1),1);
  console.log('PASS: neutral identity, 100 XY/time combinations, short-source boundaries, four corner mappings and gate phase.');
}
if(G.fromXY) {
  for(const x of [0,.2,.5,.9,1]) for(const y of [0,.25,.5,.75,1]) {
    const mapped=G.fromXY(x,y), back=G.toXY(mapped);
    assert(Math.abs(back.x-x)<1e-12 && Math.abs(back.y-y)<1e-12);
    const p={...G.defaults,...mapped};
    assert.equal(p.size,G.defaults.size);assert.equal(p.pitch,G.defaults.pitch);
    const a=G.random('xy'), b=G.random('xy');
    for(let i=0;i<50;i++) assert.equal(JSON.stringify(G.plan(p,8,a)),JSON.stringify(G.plan({...G.defaults,position:x,spray:y*.5,reverse:Math.pow(y,2.5)},8,b)));
  }
  assert.equal(G.fromXY(.5,1).spray,.5);assert.equal(G.fromXY(.5,0).spray,0);
  assert.equal(G.fromXY(-1,2).position,0);assert.equal(G.fromXY(2,-1).spray,0);
  console.log('PASS: 25 XY round trips, bounds, axis directions and 1250 direct-parameter grain comparisons.');
}
if(G.octaveEvent){
  for(const duration of [.002,.1,8])for(const pitch of [-24,0,24])for(const position of [0,1]){
    const base=G.plan({...G.defaults,pitch,position},duration,G.random('octave'));
    const high=G.octaveEvent(base,duration);
    const direct=G.dryOctaveEvent(base,duration);assert.equal(direct.rate,base.rate*2);assert(!direct.wetOnly);assert(direct.offset+direct.length*direct.rate<=duration+1e-10);
    assert.equal(high.rate,base.rate*2);assert(high.wetOnly);assert.equal(high.reverse,base.reverse);
    assert(high.offset>=0 && high.offset+high.length*high.rate<=duration+1e-10);
  }
  console.log('PASS: octave layer rate, reverse identity and short-source/end boundaries.');
}
if(G.inputGain){
  const bufferOf=value=>({numberOfChannels:2,getChannelData:()=>new Float32Array(1000).fill(value)});
  assert.equal(G.inputGain(bufferOf(0)),1);
  assert.equal(G.inputGain(bufferOf(.0001)),1);
  assert.equal(G.inputGain(bufferOf(.01)),4);
  assert.equal(G.inputGain(bufferOf(.9)),1);
  const transient=new Float32Array(1000).fill(.01);transient[0]=.8;
  const source={numberOfChannels:1,getChannelData:()=>transient};
  const snapshot=transient.slice();assert(G.inputGain(source)<=.85/.8+1e-7);assert.deepEqual(transient,snapshot);
  for(const seconds of [1,8,30])assert(Math.abs(G.defaultSpray(seconds)*seconds-.25)<1e-12);
  console.log('PASS: silence floor, +12dB gain cap, peak headroom, unchanged source, duration-independent default spread.');
}
(async()=>{
  const buffer=new AudioContext().createBuffer(2,44100,44100);
  const engine=await G.create(buffer,{...G.defaults},'test');
  engine.schedule(); const count=context.starts.length;assert(count>0);
  const initialDry=engine.events.filter(e=>!e.wetOnly).map(e=>({t:e.when}));
  engine.schedule();assert.equal(context.starts.length,count);assert.equal(intervals.size,1);
  assert(context.starts.every(s=>s.t>=.035 && s.t<.12));
  context.currentTime=10; [...intervals.values()][0]();
  assert(context.starts.slice(count).every(s=>s.t>10));
  if(G.inputGain){
    const dry=initialDry;
    const gaps=dry.slice(1).map((e,i)=>e.t-dry[i].t);
    assert(gaps.every(g=>g>=.9/G.defaults.density && g<=1.1/G.defaults.density));
    assert(gaps.some(g=>Math.abs(g-1/G.defaults.density)>1e-8));
    const convolver=context.nodes.find(n=>n.buffer?.duration===4.5);
    assert(convolver);assert(convolver.buffer.getChannelData(0).every(Number.isFinite));
    const hp=context.nodes.find(n=>n.type==='highpass' && n.frequency.value===180);
    const shimmerTone=context.nodes.find(n=>n.type==='lowpass' && n.frequency.value===3500);
    const octaveTone=context.nodes.find(n=>n.type==='lowpass' && n.frequency.value===6000);
    assert(hp && shimmerTone && octaveTone);
    assert(convolver.targets.includes(hp));assert(shimmerTone.targets.includes(convolver));
    assert(!octaveTone.targets.includes(convolver));
    assert(hp.targets.some(n=>n.type==='lowpass' && n.frequency.value===4500));
  }
  await engine.deactivate();assert.equal(intervals.size,0);assert.equal(engine.active,0);assert.equal(engine.events.length,0);assert(context.closed);assert(context.nodes.every(n=>!n.connected));
  await engine.deactivate();
  console.log('PASS: deterministic grains, 144 boundary combinations, finite envelopes/gain, audio scheduling, idempotency, stall recovery and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
