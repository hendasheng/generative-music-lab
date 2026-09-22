/* One audio timeline drives both scheduling and visible row changes. */
(function(scope) {
  'use strict';
  const M=scope.GridMusic;
  const MASTER_VOLUME_DB=6, FADE_SECONDS=.07;
  async function activate({state,onStep=()=>{},onError=()=>{},AudioContextClass=scope.AudioContext || scope.webkitAudioContext}) {
    if (!AudioContextClass) throw new Error('此浏览器不支持 Web Audio');
    const ctx=new AudioContextClass({latencyHint:'interactive'});
    let disposed=false, timer=null, frame=null, running=false, nextTime=0, nextStep=0;
    let visual=[], streams=[];
    const voices=new Set();
    try { await ctx.resume(); } catch(error) { await ctx.close(); throw error; }
    const master=ctx.createGain(), limiter=ctx.createDynamicsCompressor();
    master.gain.value=0;
    limiter.threshold.value=-1; limiter.knee.value=0; limiter.ratio.value=20;
    limiter.attack.value=.003; limiter.release.value=.1;
    master.connect(limiter); limiter.connect(ctx.destination);
    function voice(note,time,track) {
      const oscillator=ctx.createOscillator(), envelope=ctx.createGain();
      oscillator.type=track===0?'sine':'triangle';
      oscillator.frequency.setValueAtTime(440*2**((note.midi-69)/12),time);
      const length=track===0?.42:.22;
      // Small branch gains leave room for 24 simultaneous notes.
      const level=note.velocity*(track===0?.035:.018);
      envelope.gain.setValueAtTime(0,time);
      envelope.gain.linearRampToValueAtTime(level,time+.008);
      envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      oscillator.connect(envelope); envelope.connect(master);
      voices.add(oscillator);
      oscillator.onended=()=>{voices.delete(oscillator);oscillator.disconnect();envelope.disconnect();};
      oscillator.start(time); oscillator.stop(time+length+.02);
    }
    function tick() {
      if (!running || disposed) return;
      try {
        // A throttled background timer must never replay a backlog as a burst.
        if (nextTime < ctx.currentTime) nextTime=ctx.currentTime+.02;
        while (nextTime < ctx.currentTime+.12) {
          const fired=state.tracks.map((track,index)=>{
            const notes=M.events(track,nextStep,state.root,state.scale,streams[index]);
            for(const note of notes) voice(note,nextTime,index);
            return notes.map(note=>note.col);
          });
          visual.push({time:nextTime,step:nextStep,fired});
          nextTime+=M.duration(state.bpm); nextStep=(nextStep+1)%M.STEPS;
        }
        timer=setTimeout(tick,25);
      } catch(error) { end(); onError(error); }
    }
    function paint() {
      if(!running) return;
      let latest;
      while(visual.length && visual[0].time<=ctx.currentTime) latest=visual.shift();
      if(latest) onStep(latest);
      frame=requestAnimationFrame(paint);
    }
    function end() {
      running=false; clearTimeout(timer); cancelAnimationFrame(frame); timer=frame=null; visual=[];
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value,ctx.currentTime);
      master.gain.linearRampToValueAtTime(0,ctx.currentTime+FADE_SECONDS);
      for(const oscillator of voices) { try { oscillator.stop(ctx.currentTime+FADE_SECONDS); } catch {} }
    }
    function schedule() {
      if(disposed) throw new Error('音频引擎已关闭');
      if(running) return end; // Idempotent: never install a second scheduler.
      nextStep=0; nextTime=ctx.currentTime+.09; visual=[];
      streams=state.tracks.map((_,index)=>M.rng(state.seed+':performance:'+index));
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0,ctx.currentTime);
      master.gain.linearRampToValueAtTime(10**(MASTER_VOLUME_DB/20),ctx.currentTime+.04);
      running=true; tick(); paint(); return end;
    }
    async function deactivate() {
      if(disposed) return;
      end(); disposed=true;
      await new Promise(resolve=>setTimeout(resolve,FADE_SECONDS*1000+20));
      try { await ctx.close(); } finally { master.disconnect(); limiter.disconnect(); }
    }
    return {schedule,end,deactivate};
  }
  scope.GridAudio={activate};
})(globalThis);
