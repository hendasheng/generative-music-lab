(function () {
  'use strict';
  const LIMIT = 30;
  // 录制时的按列波形：与解码后 analyse() 的 1000 列**同构**（列 = 位置，不是时间窗口）。
  // 这样 pad 的「起点 / 终点」与波形横轴指向同一件事，播放头才对得上。
  // 早期版本画的是 analyser 的 43ms 滚动窗口——那是时间轴，与位置轴无关，所以对不上。
  const COLUMNS = 1000, COLUMN_MS = 25;
  function newColumns() {
    return { mins: new Float32Array(COLUMNS), maxs: new Float32Array(COLUMNS), have: new Uint8Array(COLUMNS) };
  }
  function accumulateColumns(cols, chunk, index) {
    const i = Math.min(COLUMNS - 1, Math.max(0, index | 0));
    let lo = 0, hi = 0;
    for (const v of chunk) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v; else if (v > hi) hi = v;
    }
    if (!cols.have[i]) { cols.mins[i] = lo; cols.maxs[i] = hi; cols.have[i] = 1; return; }
    if (lo < cols.mins[i]) cols.mins[i] = lo;
    if (hi > cols.maxs[i]) cols.maxs[i] = hi;
  }
  function create({onState,onResult,onError}) {
    let session=null;
    function release(s){clearTimeout(s.limit);clearInterval(s.clock);if(s.stream)s.stream.getTracks().forEach(t=>t.stop());if(s.source)s.source.disconnect();if(s.analyser)s.analyser.disconnect();if(s.context && s.context.state!=='closed'){void s.context.close().catch(function(){});}s.analyser=null;}
    function cancel(){const s=session;if(!s)return;session=null;s.cancelled=true;release(s);if(s.recorder && s.recorder.state==='recording')s.recorder.stop();onState('idle',0);}
    function finish(){const s=session;if(!(s && s.recorder) || s.finishing)return;s.finishing=true;onState('processing',0);if(s.recorder.state!=='inactive')s.recorder.stop();release(s);}
    async function start(){
      if(session)return;
      const s={chunks:[],cancelled:false};session=s;onState('requesting',0);
      try{
        if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder==='undefined')throw new Error('浏览器不支持录音，请使用支持录音的浏览器并通过 localhost 或 HTTPS 打开');
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
        s.columns=newColumns();
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
    function waveform(){const s=session;if(!(s && s.analyser) || !(s.recorder && s.recorder.state==='recording'))return null;s.analyser.getFloatTimeDomainData(s.wave);return s.wave;}
    // 录制中的按列波形（位置轴）。index 由已录秒数换算，与解码后 analyse() 的列一一对应。
    function columns(){
      const s=session;if(!(s && s.recorder) || s.recorder.state!=='recording')return null;
      const chunk=s.wave;
      s.analyser.getFloatTimeDomainData(chunk);
      accumulateColumns(s.columns,chunk,Math.floor((performance.now()-s.started)/COLUMN_MS));
      return s.columns;
    }
    return {start,finish,cancel,waveform,columns,get active(){return session!==null;}};
  }
  window.SampleRecorder={create,LIMIT};
})();
