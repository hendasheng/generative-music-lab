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
  // 引擎在 compressor 与 destination 之间插了 AnalyserNode（输出电平表，直通不改声音）。
  // 桩要跟着被测代码走：给它 fftSize 与 getFloatTimeDomainData，levels() 才能读数。
  createAnalyser() { const a = new Node(this); a.fftSize = 2048; a.getFloatTimeDomainData = buf => buf.fill(0); return a; }
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
// 内置音源库：demo(ctx, index) 一号一段素材。三份引擎（0.3 / 0.3.1 / 0.3.2）的这段代码逐字节相同。
if(G.demoNames){
  const ctx=new AudioContext();
  // 首版公式逐字复刻：0 号音源是音源库的第 0 号，任何时候都不允许因为「加了音源」而变声。
  const original=(()=>{
    const buffer=ctx.createBuffer(2,ctx.sampleRate*8,ctx.sampleRate);
    for(let i=0;i<buffer.length;i++){
      const t=i/ctx.sampleRate;
      const f=[110,130.8128,164.8138,195.9977][Math.min(3,Math.floor(t/2))];
      const envelope=Math.sin(Math.PI*(t%2)/2)**2;
      for(let ch=0;ch<2;ch++){
        const tone=Math.sin(2*Math.PI*f*t)+.28*Math.sin(2*Math.PI*f*2*t+ch*.3)+.12*Math.sin(2*Math.PI*f*3*t);
        buffer.getChannelData(ch)[i]=tone*.35*envelope;
      }
    }
    return buffer;
  })();
  const stats=buffer=>{const d=buffer.getChannelData(0);let peak=0,energy=0;
    for(const v of d){assert(Number.isFinite(v),'音源里有非有限值');peak=Math.max(peak,Math.abs(v));energy+=v*v;}
    return {peak,rms:Math.sqrt(energy/d.length)};};
  const tail=buffer=>{const d=buffer.getChannelData(0);return Math.abs(d[d.length-1]);};
  assert(G.demoNames.length>=3,'内置音源至少要有 3 段');
  assert.equal(new Set(G.demoNames).size,G.demoNames.length,'内置音源名字重复');
  const first=G.demo(ctx,0);
  assert.deepEqual(first.getChannelData(0),original.getChannelData(0),'0 号内置音源与首版不一致（不允许改原有声音）');
  assert.deepEqual(first.getChannelData(1),original.getChannelData(1),'0 号内置音源右声道与首版不一致');
  assert.equal(G.demo(ctx).duration,first.duration,'不传索引时必须等于 0 号');
  assert.deepEqual(G.demo(ctx).getChannelData(0),first.getChannelData(0),'不传索引时必须等于 0 号');
  const prints=new Set();
  for(let i=0;i<G.demoNames.length;i++){
    const buffer=G.demo(ctx,i), s=stats(buffer), name=G.demoNames[i];
    assert(buffer.numberOfChannels===2,'音源 '+i+' 不是双声道');
    assert(buffer.duration>=4 && buffer.duration<=10,'音源 '+name+' 时长异常：'+buffer.duration);
    assert(s.peak>.02 && s.peak<=1,'音源 '+name+' 峰值越界：'+s.peak.toFixed(4));
    assert(s.rms>.005,'音源 '+name+' 几乎是静音：RMS '+s.rms.toFixed(5));
    if(i!==0) assert(tail(buffer)<.05,'音源 '+name+' 末尾是硬切（末样本 '+tail(buffer).toFixed(4)+'）');
    prints.add(i+':'+buffer.duration.toFixed(3)+':'+s.peak.toFixed(5)+':'+s.rms.toFixed(5));
    // 只用种子随机流：同一号任何时候都得到同一段素材（不受调用顺序影响）
    assert.deepEqual(G.demo(ctx,i).getChannelData(0),buffer.getChannelData(0),'音源 '+name+' 不可复现');
    if(i!==0) assert.notDeepEqual(buffer.getChannelData(0),first.getChannelData(0),'音源 '+name+' 与 0 号相同');
  }
  assert.equal(prints.size,G.demoNames.length,'有音源的统计量完全相同');
  const n=G.demoNames.length;
  assert.deepEqual(G.demo(ctx,n).getChannelData(0),first.getChannelData(0),'索引应取模回绕到 0 号');
  assert.deepEqual(G.demo(ctx,-1).getChannelData(0),G.demo(ctx,n-1).getChannelData(0),'负数索引应取模回绕');
  assert.deepEqual(G.demo(ctx,1.9).getChannelData(0),G.demo(ctx,1).getChannelData(0),'小数索引应取整');
  console.log('PASS: 内置音源库 '+n+' 段（'+G.demoNames.join(' / ')+'）都非静音、互不相同、可复现、末尾不硬切；0 号与首版逐字节相同，索引取模回绕。');
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

  // 实时输入的输入补偿：素材路径按整段统计，实时路径按环形缓冲当前电平反复标定
  // （曾经写死为 1，等于不补偿；iOS 采集电平远低于桌面时就是「声音特别小」）。
  // 只对本版引擎生效：0.3 的引擎没有实时输入（用 setAudioSession 是否存在来判断）。
  if (typeof G.setAudioSession === 'function') {
    const live = new AudioContext();
    const demo = live.createBuffer(2, 44100, 44100);
    // 造一个「小声的麦克风」：峰值 0.02（约 −34 dBFS）。目标 RMS .16 → 应放大到上限 4 倍。
    const quiet = { count: 9600, sampleRate: 48000, duration: .2, origin: 0, frozen: false,
      sample: i => 0.02 * Math.sin(i / 7), grain: (c) => c.createBuffer(1, 256, 48000),
      peaks: () => Array.from({ length: 16 }, () => [-0.02, 0.02]) };
    const eng = await G.create(demo, { ...G.defaults }, 'live-gain', quiet);
    const liveCtx = context;                       // create 自建的上下文
    const inputGainNode = liveCtx.nodes.find(n => n.gain && Math.abs(n.gain.value - 1) < 1e-9 && n.connected);
    assert(inputGainNode, '找不到输入增益节点');
    eng.schedule();
    // 推进虚拟时钟跨越 LIVE_GAIN_INTERVAL，触发重新标定
    for (let i = 0; i < 20; i++) { liveCtx.currentTime += .25; [...intervals.values()][0](); }
    const g = liveCtx.nodes.filter(n => n.gain).map(n => n.gain.value);
    assert(g.some(v => v > 3.9 && v <= 4 + 1e-9), '小声麦克风没有被补偿到 4 倍上限，实测增益=' + JSON.stringify(g.slice(0, 6)));
    await eng.deactivate();
    console.log('PASS: 实时输入的输入补偿按环形缓冲电平标定（安静麦克风被抬到 4 倍上限）。');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
