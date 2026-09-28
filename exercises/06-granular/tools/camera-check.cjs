const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let pending,request;const states=[];
const video={srcObject:null,mirrored:false,pause(){},async play(){},classList:{toggle(name,value){video.mirrored=value;}}};
const context={window:{},navigator:{mediaDevices:{getUserMedia:options=>{request=options;return new Promise((resolve,reject)=>pending={resolve,reject});}}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../0.3.1/camera.js'),'utf8'),context);
function stream(facing){const track={stopped:false,stop(){this.stopped=true;},getSettings:()=>({facingMode:facing}),addEventListener(name,fn){this.ended=fn;}};return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};}
(async()=>{
 const camera=context.window.CameraPreview.create(video,(...args)=>states.push(args));
 let p=camera.start(),s=stream('environment');assert.equal(request.audio,false);pending.resolve(s);await p;assert(camera.active);assert(!video.mirrored);
 const flipped=camera.flip();assert(s.track.stopped);assert.equal(request.video.facingMode.exact,'user');s=stream('user');pending.resolve(s);await flipped;assert(video.mirrored);assert(camera.active);
 camera.stop();assert(s.track.stopped);assert.equal(video.srcObject,null);
 p=camera.start();camera.stop();s=stream('environment');pending.resolve(s);await p;assert(s.track.stopped);assert(!camera.active);
 p=camera.start();pending.reject(Object.assign(new Error(),{name:'NotAllowedError'}));await p;assert.equal(states.at(-1)[0],'error');assert(!camera.active);
 p=camera.start();s=stream('environment');pending.resolve(s);await p;s.track.ended();assert(!camera.active);assert(s.track.stopped);
 // A cancelled request must not detach a newer preview when it finally resolves.
 p=camera.start();const old=pending;const fresh=camera.start();s=stream('user');pending.resolve(s);await fresh;const late=stream('environment');old.resolve(late);await p;assert(late.track.stopped);assert.equal(video.srcObject,s);camera.stop();assert(s.track.stopped);
 console.log('PASS: preview, exact front/back switch, audio:false, mirroring, permission rejection, cancellation, late request isolation, track-ended cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
