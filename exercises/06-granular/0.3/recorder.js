(() => {
  'use strict';
  const LIMIT=30;
  function create({onState,onResult,onError}) {
    let session=null;
    function release(s){clearTimeout(s.limit);clearInterval(s.clock);s.stream?.getTracks().forEach(t=>t.stop());s.source?.disconnect();s.analyser?.disconnect();if(s.context && s.context.state!=='closed'){void s.context.close().catch(()=>{});}s.analyser=null;}
    function cancel(){const s=session;if(!s)return;session=null;s.cancelled=true;release(s);if(s.recorder?.state==='recording')s.recorder.stop();onState('idle',0);}
    function finish(){const s=session;if(!s?.recorder || s.finishing)return;s.finishing=true;onState('processing',0);if(s.recorder.state!=='inactive')s.recorder.stop();release(s);}
    async function start(){
      if(session)return;
      const s={chunks:[],cancelled:false};session=s;onState('requesting',0);
      try{
        if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined')throw new Error('浏览器不支持录音，请使用支持录音的浏览器并通过 localhost 或 HTTPS 打开');
        s.context=new AudioContext({latencyHint:'interactive'});
        const resumed=s.context.resume().catch(()=>{});
        s.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
        if(s.cancelled){release(s);return;}
        await resumed;
        if(s.cancelled){release(s);return;}
        s.analyser=s.context.createAnalyser();s.analyser.fftSize=2048;
        s.source=s.context.createMediaStreamSource(s.stream);s.source.connect(s.analyser);
        // Analysis only: never connect the microphone to speakers.
        s.wave=new Float32Array(s.analyser.fftSize);
        const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
        s.recorder=new MediaRecorder(s.stream,mime?{mimeType:mime}:undefined);
        s.recorder.ondataavailable=e=>{if(e.data.size)s.chunks.push(e.data);};
        s.recorder.onerror=()=>{if(session===s){cancel();onError(new Error('录音设备异常，原音源已保留'));}};
        s.recorder.onstop=async()=>{
          release(s);if(s.cancelled || session!==s)return;
          session=null;onState('idle',0);
          const blob=new Blob(s.chunks,{type:s.recorder.mimeType});
          if(!blob.size || performance.now()-s.started<250){onError(new Error('录音太短，请至少录制 0.25 秒'));return;}
          await onResult(blob);
        };
        s.recorder.start(250);s.started=performance.now();onState('recording',0);
        s.limit=setTimeout(finish,LIMIT*1000);
        s.clock=setInterval(()=>onState('recording',Math.min(LIMIT,(performance.now()-s.started)/1000)),100);
        s.stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(session===s)finish();}));
      }catch(error){release(s);if(session===s){session=null;onState('idle',0);onError(error);}}
    }
    function waveform(){const s=session;if(!s?.analyser || s.recorder?.state!=='recording')return null;s.analyser.getFloatTimeDomainData(s.wave);return s.wave;}
    return {start,finish,cancel,waveform,get active(){return session!==null;}};
  }
  window.SampleRecorder={create,LIMIT};
})();
