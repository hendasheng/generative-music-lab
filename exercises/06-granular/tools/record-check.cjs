const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let now=0,pending,latest;const timers=new Map();let id=0;
class Recorder{
 static isTypeSupported(){return true;}
 constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';latest=this;}
 start(){this.state='recording';}
 stop(){assert.notEqual(this.state,'inactive');this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['audio'])});this.onstop();});}
}
const contexts=[];
class AudioContext{
 constructor(){this.state='running';this.nodes=[];contexts.push(this);}
 async resume(){}
 async close(){this.state='closed';}
 createAnalyser(){const n={fftSize:2048,disconnected:false,disconnect(){this.disconnected=true;},getFloatTimeDomainData(a){a.fill(.25);}};this.nodes.push(n);return n;}
 createMediaStreamSource(){const n={disconnected:false,connect(target){assert(target.getFloatTimeDomainData);},disconnect(){this.disconnected=true;}};this.nodes.push(n);return n;}
}
const ctx={AudioContext,Float32Array,window:{},navigator:{mediaDevices:{getUserMedia:()=>new Promise((resolve,reject)=>{pending={resolve,reject};})}},MediaRecorder:Recorder,Blob,performance:{now:()=>now},setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:i=>timers.delete(i),setInterval:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearInterval:i=>timers.delete(i)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../0.3/recorder.js'),'utf8'),ctx);
function stream(){const track={stopped:false,stop(){this.stopped=true;},addEventListener(){}};return {track,getTracks:()=>[track]};}
(async()=>{
 const results=[],errors=[],states=[];const rec=ctx.window.SampleRecorder.create({onState:(...x)=>states.push(x),onResult:b=>results.push(b),onError:e=>errors.push(e)});
 let s=stream(),p=rec.start();pending.resolve(s);await p;assert(rec.active);assert.equal(rec.waveform().length,2048);assert.equal(rec.waveform()[0],.25);now=1000;rec.finish();await Promise.resolve();assert.equal(results.length,1);assert(s.track.stopped);assert.equal(timers.size,0);
 s=stream();p=rec.start();rec.cancel();pending.resolve(s);await p;assert(s.track.stopped);assert(!rec.active);assert.equal(results.length,1);
 p=rec.start();pending.reject(new Error('denied'));await p;assert.equal(errors.length,1);assert(!rec.active);
 s=stream();p=rec.start();pending.resolve(s);await p;now+=30000;[...timers.values()].find(t=>t.ms===30000).f();await Promise.resolve();assert.equal(results.length,2);assert(s.track.stopped);assert.equal(timers.size,0);
 s=stream();p=rec.start();pending.resolve(s);await p;rec.cancel();await Promise.resolve();assert.equal(results.length,2);assert.equal(timers.size,0);assert(s.track.stopped);
 s=stream();p=rec.start();pending.resolve(s);await p;now+=100;rec.finish();await Promise.resolve();assert.equal(errors.length,2);assert.equal(results.length,2);
 assert.equal(rec.waveform(),null);assert(contexts.every(c=>c.state==='closed' && c.nodes.every(n=>n.disconnected)));
 console.log('PASS: live waveform and analyser/context cleanup; manual stop, 30s timeout, pending-permission cancellation, permission rejection, active cancellation, short recording rejection, track/timer cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
