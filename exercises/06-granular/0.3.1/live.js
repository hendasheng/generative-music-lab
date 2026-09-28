(() => {
  'use strict';
  const workletURL=new URL('live-worklet.js',document.currentScript.src).href;
  function ring(sampleRate,seconds=8){
    const data=new Float32Array(Math.ceil(sampleRate*seconds));
    let head=0,count=0,total=0,frozen=false;
    return {
      sampleRate,
      get duration(){return count/sampleRate;},
      get origin(){return (total-count)/sampleRate;},
      get frozen(){return frozen;},
      freeze(value){frozen=Boolean(value);},
      push(chunk){if(frozen)return;for(const value of chunk){data[head]=Number.isFinite(value)?value:0;head=(head+1)%data.length;count=Math.min(count+1,data.length);total++;}},
      sample(i){return i<0 || i>=count?0:data[(head-count+i+data.length)%data.length];},
      grain(ctx,event){
        const start=Math.max(0,Math.min(count-1,Math.floor(event.offset*sampleRate)));
        const length=Math.max(1,Math.min(count-start,Math.ceil(event.length*event.rate*sampleRate)));
        const buffer=ctx.createBuffer(1,length,sampleRate),out=buffer.getChannelData(0);
        for(let i=0;i<length;i++)out[i]=this.sample(start+(event.reverse?length-1-i:i));
        return buffer;
      },
      peaks(bins=600){return Array.from({length:bins},(_,x)=>{
        let lo=0,hi=0;const end=Math.floor((x+1)*count/bins);
        for(let i=Math.floor(x*count/bins);i<end;i++){const v=this.sample(i);lo=Math.min(lo,v);hi=Math.max(hi,v);}
        return [lo,hi];
      });}
    };
  }
  function create(onEnded=()=>{}){
    let epoch=0,current=null;
    function dispose(session){if(!session)return;session.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});session.source?.disconnect();session.node?.disconnect();if(session.node)session.node.port.onmessage=null;void session.ctx.close();}
    function stop(){++epoch;const old=current;current=null;dispose(old);}
    async function start(){
      stop();const ticket=epoch;
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('实时输入需要 HTTPS 或 localhost 与麦克风支持');
      const session={ctx:new AudioContext({latencyHint:'interactive'})};current=session;
      try{
        await session.ctx.resume();
        if(ticket!==epoch)return null;
        const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
        if(ticket!==epoch){stream.getTracks().forEach(t=>t.stop());return null;}
        session.stream=stream;
        if(!session.ctx.audioWorklet)throw new Error('此浏览器不支持实时音频处理 AudioWorklet');
        await session.ctx.audioWorklet.addModule(workletURL);
        if(ticket!==epoch)return null;
        const history=ring(session.ctx.sampleRate);
        session.node=new AudioWorkletNode(session.ctx,'grain-capture');
        session.node.port.onmessage=e=>{if(ticket===epoch)history.push(e.data);};
        session.source=session.ctx.createMediaStreamSource(stream);
        session.source.connect(session.node).connect(session.ctx.destination);
        stream.getTracks().forEach(t=>{t.onended=()=>{if(ticket===epoch){stop();onEnded();}};});
        return history;
      }catch(error){if(ticket!==epoch)return null;stop();throw error;}
    }
    return {start,stop};
  }
  window.LiveInput={ring,create};
})();
