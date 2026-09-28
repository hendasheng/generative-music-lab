(() => {
  'use strict';
  function create(video,onState){
    let stream=null,epoch=0,pending=false,facing='environment';
    const release=s=>s?.getTracks().forEach(t=>t.stop());
    function stop(message='摄像头已关闭'){
      ++epoch;pending=false;const old=stream;stream=null;video.pause();video.srcObject=null;release(old);onState('idle',message);
    }
    async function start(next=facing,exact=false){
      stop('');const ticket=epoch;pending=true;onState('requesting','正在请求摄像头 · 可再次点击取消');
      let acquired=null;
      try{
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('请通过 HTTPS 或 localhost 打开摄像头');
        acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:exact?{exact:next}:{ideal:next},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}});
        if(ticket!==epoch){release(acquired);return;}
        stream=acquired;video.srcObject=stream;await video.play();
        if(ticket!==epoch){release(acquired);return;}
        const actual=stream.getVideoTracks()[0].getSettings().facingMode;
        facing=actual || next;video.classList.toggle('mirrored',facing==='user');pending=false;
        stream.getVideoTracks()[0].addEventListener('ended',()=>{if(ticket===epoch)stop('摄像头已中断 · 点击重新开启');});
        onState('active','');
      }catch(error){
        release(acquired);if(ticket!==epoch)return;
        stop('');
        const messages={NotAllowedError:'未获摄像头权限 · 可点击重试',NotFoundError:'未找到摄像头',NotReadableError:'摄像头被占用或无法启动',OverconstrainedError:'未找到另一侧镜头 · 可重新开启原镜头'};
        onState('error',messages[error.name] || error.message);
      }
    }
    return {start,stop,toggle(){if(stream || pending)stop();else void start();},flip(){if(stream && !pending)return start(facing==='user'?'environment':'user',true);},get active(){return !!stream;}};
  }
  window.CameraPreview={create};
})();
