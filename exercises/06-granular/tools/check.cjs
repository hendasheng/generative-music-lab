const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const intervals = new Map(); let intervalID=0, context;
class Param {
  constructor() { this.value=0; }
  setValueAtTime(v) { assert(Number.isFinite(v)); this.value=v; }
  linearRampToValueAtTime(v) { assert(Number.isFinite(v)); this.value=v; }
  cancelScheduledValues() {}
  setValueCurveAtTime(curve,t,duration) { assert(t>=0 && duration>0); assert(curve.every(Number.isFinite)); assert.equal(curve[0],0); assert(Math.abs(curve.at(-1))<1e-7); }
}
class Node {
  constructor(ctx) { this.ctx=ctx; this.gain=new Param(); this.pan=new Param(); this.playbackRate=new Param(); this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();this.connected=false; ctx.nodes.push(this); }
  connect(n) { this.connected=true; return n; }
  disconnect() { this.connected=false; }
  start(t,offset) { assert(t>=this.ctx.currentTime); assert(offset>=0 && offset<this.buffer.duration); this.ctx.starts.push({t,offset,rate:this.playbackRate.value}); }
  stop(t) { if(t===undefined) this.onended?.(); else assert(Number.isFinite(t)); }
}
class AudioContext {
  constructor() { context=this;this.currentTime=0;this.sampleRate=44100;this.nodes=[];this.starts=[];this.destination={}; }
  async resume() {}
  async close() { this.closed=true; }
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
(async()=>{
  const buffer=new AudioContext().createBuffer(2,44100,44100);
  const engine=await G.create(buffer,{...G.defaults},'test');
  engine.schedule(); const count=context.starts.length;assert(count>0);
  engine.schedule();assert.equal(context.starts.length,count);assert.equal(intervals.size,1);
  assert(context.starts.every(s=>s.t>=.035 && s.t<.12));
  context.currentTime=10; [...intervals.values()][0]();
  assert(context.starts.slice(count).every(s=>s.t>10));
  await engine.deactivate();assert.equal(intervals.size,0);assert.equal(engine.active,0);assert.equal(engine.events.length,0);assert(context.closed);assert(context.nodes.every(n=>!n.connected));
  await engine.deactivate();
  console.log('PASS: deterministic grains, 144 boundary combinations, finite envelopes/gain, audio scheduling, idempotency, stall recovery and cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
