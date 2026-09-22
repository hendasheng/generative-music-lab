/* One audio timeline drives both scheduling and visible row changes. */
(function(scope) {
  'use strict';
  const M=scope.GridMusic;
  const SOUNDS=[
    {id:'reverie',label:'REVERIE',hint:'Drifting pad, long random tails'},
    {id:'kalimba',label:'KALIMBA',hint:'Muted wooden pluck'},
    {id:'rhodes',label:'RHODES',hint:'Electric piano, shimmering'},
    {id:'acid',label:'ACID',hint:'Squelching 303 bass'},
    {id:'machine',label:'MACHINE',hint:'Synthesised drums'}
  ];
  const PROFILES={
    reverie:{cut:[900,4800],send:[.25,.48],wet:.24,chorus:.24},
    kalimba:{cut:[2200,5400],send:[.16,.29],wet:.16,chorus:.1},
    rhodes:{cut:[2200,6800],send:[.2,.36],wet:.19,chorus:.3},
    acid:{cut:[6500,10000],send:[.035,.09],wet:.18,chorus:0},
    machine:{cut:[2600,8500],send:[.08,.18],wet:.13,chorus:.06}
  };
  const soundOf=(state,index)=>PROFILES[state.tracks[index].sound]?state.tracks[index].sound:(index===0?'reverie':'machine');
  const MASTER_VOLUME_DB=6, FADE_SECONDS=.07;
  async function activate({state,onStep=()=>{},onError=()=>{},AudioContextClass=scope.AudioContext || scope.webkitAudioContext}) {
    if (!AudioContextClass) throw new Error('此浏览器不支持 Web Audio');
    const ctx=new AudioContextClass({latencyHint:'interactive'});
    let disposed=false, timer=null, frame=null, running=false, nextTime=0, nextStep=0;
    let visual=[], streams=[], timbreStreams=[];
    const voices=new Set();
    try { await ctx.resume(); } catch(error) { await ctx.close(); throw error; }
    const master=ctx.createGain(), limiter=ctx.createDynamicsCompressor();
    const mix=ctx.createBiquadFilter(), compressor=ctx.createDynamicsCompressor();
    mix.type='highpass'; mix.frequency.value=38;
    compressor.threshold.value=-18; compressor.knee.value=12; compressor.ratio.value=3;
    compressor.attack.value=.015; compressor.release.value=.24;
    master.gain.value=0;
    limiter.threshold.value=-1; limiter.knee.value=0; limiter.ratio.value=20;
    limiter.attack.value=.003; limiter.release.value=.1;
    mix.connect(compressor); compressor.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
    const fixed=[mix,compressor,master,limiter], modulators=[];
    const range=(random,min,max)=>min+(max-min)*random();
    const noiseRandom=M.rng(state.seed+':noise'), roomRandom=M.rng(state.seed+':room');
    const noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
    const noiseData=noise.getChannelData(0);
    for(let i=0;i<noiseData.length;i++)noiseData[i]=noiseRandom()*2-1;
    // Stereo room is generated once. It never consumes the note-probability RNG.
    const room=ctx.createConvolver(), roomHP=ctx.createBiquadFilter(),roomLP=ctx.createBiquadFilter();
    const impulse=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*4.8),ctx.sampleRate);
    for(let channel=0;channel<2;channel++) {
      const data=impulse.getChannelData(channel);let smooth=0;
      for(let i=0;i<data.length;i++) {
        smooth=.65*smooth+.35*(roomRandom()*2-1);
        const t=i/ctx.sampleRate;
        data[i]=t<.023?0:smooth*Math.exp(-t*1.5)*Math.min(1,(t-.023)*60);
      }
    }
    room.buffer=impulse;roomHP.type='highpass';roomHP.frequency.value=260;
    roomLP.type='lowpass';roomLP.frequency.value=5400;
    room.connect(roomHP);roomHP.connect(roomLP);roomLP.connect(mix);
    fixed.push(room,roomHP,roomLP);
    const chains=state.tracks.map((_,index)=>{
      const input=ctx.createBiquadFilter(),send=ctx.createGain(),echo=ctx.createDelay(2);
      const feedback=ctx.createGain(),echoLP=ctx.createBiquadFilter(),wet=ctx.createGain();
      const echoPan=ctx.createStereoPanner(),chorus=ctx.createDelay(.05),chorusGain=ctx.createGain();
      const lfo=ctx.createOscillator(),depth=ctx.createGain();
      input.type='lowpass';input.frequency.value=index===0?3600:6500;input.Q.value=.65;
      send.gain.value=index===0?.38:.13;feedback.gain.value=.32;
      echoLP.type='lowpass';echoLP.frequency.value=index===0?2800:4200;
      wet.gain.value=index===0?.24:.13;echoPan.pan.value=index===0?-.35:.35;
      chorus.delayTime.value=.014;chorusGain.gain.value=index===0?.24:.06;
      lfo.frequency.value=index===0?.31:.43;depth.gain.value=.003;
      lfo.connect(depth);depth.connect(chorus.delayTime);lfo.start();modulators.push(lfo);
      input.connect(mix);input.connect(send);send.connect(room);
      input.connect(chorus);chorus.connect(chorusGain);chorusGain.connect(mix);
      input.connect(echo);echo.connect(echoLP);echoLP.connect(feedback);feedback.connect(echo);
      echoLP.connect(wet);wet.connect(echoPan);echoPan.connect(mix);echoPan.connect(send);
      const division=index===0?3:2;
      echo.delayTime.value=M.duration(state.bpm)*division;
      fixed.push(input,send,echo,feedback,echoLP,wet,echoPan,chorus,chorusGain,lfo,depth);
      return {input,send,echo,feedback,wet,chorusGain,division,lastBpm:state.bpm,sound:null};
    });
    function evolve(time,step) {
      chains.forEach((chain,index)=>{
        const sound=soundOf(state,index),profile=PROFILES[sound];
        if(chain.sound!==sound) {
          chain.sound=sound;
          chain.chorusGain.gain.setTargetAtTime(profile.chorus,time,.04);
          chain.wet.gain.setTargetAtTime(profile.wet,time,.04);
        }
        if(step===0 || chain.previousSound!==sound) {
          chain.previousSound=sound;
          const random=timbreStreams[index];
          chain.input.frequency.linearRampToValueAtTime(range(random,...profile.cut),time+1.2);
          chain.feedback.gain.linearRampToValueAtTime(range(random,.22,.43),time+.4);
          chain.send.gain.linearRampToValueAtTime(range(random,...profile.send),time+.7);
        }
        // Crossfade the echo while retiming; do not pitch-bend its existing tail.
        if(chain.lastBpm!==state.bpm) {
          chain.wet.gain.cancelScheduledValues(time);
          chain.wet.gain.setValueAtTime(profile.wet,time);
          chain.wet.gain.linearRampToValueAtTime(0,time+.025);
          chain.echo.delayTime.setValueAtTime(M.duration(state.bpm)*chain.division,time+.03);
          chain.wet.gain.linearRampToValueAtTime(profile.wet,time+.09);
          chain.lastBpm=state.bpm;
        }
      });
    }
    function voice(note,time,track) {
      const random=timbreStreams[track],sound=soundOf(state,track);
      const frequency=440*2**((note.midi-69)/12);
      const envelope=ctx.createGain(),filter=ctx.createBiquadFilter(),pan=ctx.createStereoPanner();
      const nodes=[envelope,filter,pan],sources=[];
      const group={sources,nodes,envelope};
      // Bound overlapping tails. Retire the oldest with a short fade.
      if(voices.size>=40) {
        const oldest=voices.values().next().value;
        oldest.envelope.gain.cancelScheduledValues(time);
        oldest.envelope.gain.setTargetAtTime(.00001,time,.012);
        oldest.sources.forEach(source=>{try{source.stop(time+.06);}catch{}});
        voices.delete(oldest);
      }
      voices.add(group);
      filter.type='lowpass';filter.Q.value=.7;
      pan.pan.value=range(random,track===0?-.6:-.3,track===0?.6:.3);
      envelope.connect(filter);filter.connect(pan);pan.connect(chains[track].input);
      function oscillator(type,hz,level=1,detune=0) {
        const source=ctx.createOscillator(),gain=ctx.createGain();source.type=type;
        source.frequency.setValueAtTime(hz,time);source.detune.value=detune;gain.gain.value=level;
        source.connect(gain);gain.connect(envelope);sources.push(source);nodes.push(source,gain);return source;
      }
      function noiseSource() {
        const source=ctx.createBufferSource();source.buffer=noise;source.loop=true;
        source.connect(envelope);sources.push(source);nodes.push(source);
      }
      let attack,length,peak;
      if(sound==='reverie') {
        // A soft, unstable chord voice: detuned pair, occasional FM/overtone.
        attack=random()<.28?range(random,.07,.23):range(random,.012,.035);
        length=range(random,.7,2.9);peak=note.velocity*.027;
        const type=random()<.6?'triangle':'sine', detune=range(random,3,11);
        const carrier=oscillator(type,frequency,.65,-detune);
        oscillator('sine',frequency,.55,detune);
        if(random()<.35) {
          const mod=ctx.createOscillator(),amount=ctx.createGain();
          mod.frequency.value=frequency*(random()<.6?2:3);
          amount.gain.setValueAtTime(frequency*range(random,.12,.6),time);
          amount.gain.exponentialRampToValueAtTime(.1,time+.35);
          mod.connect(amount);amount.connect(carrier.frequency);sources.push(mod);nodes.push(mod,amount);
        }
        if(random()<.2)oscillator('sine',frequency*2,.17,range(random,-6,6));
        filter.frequency.setValueAtTime(range(random,1800,6200),time);
        filter.frequency.exponentialRampToValueAtTime(range(random,650,1600),time+length);
        envelope.gain.setValueAtTime(0,time);
        envelope.gain.linearRampToValueAtTime(peak,time+attack);
        envelope.gain.exponentialRampToValueAtTime(peak*.38,time+attack+.16);
        envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      } else if(sound==='kalimba') {
        // Modal wooden tine: a short inharmonic overtone dies before its body.
        length=range(random,.48,1.15);peak=note.velocity*.05;
        oscillator('sine',frequency,.9,range(random,-4,4));
        oscillator('sine',frequency*2.76,.28);
        const tineGain=nodes[nodes.length-1];
        tineGain.gain.setValueAtTime(.28,time);
        tineGain.gain.exponentialRampToValueAtTime(.001,time+.075);
        oscillator('sine',frequency*5.4,.055);
        filter.frequency.setValueAtTime(range(random,2100,4200),time);
        filter.frequency.exponentialRampToValueAtTime(850,time+.2);
        envelope.gain.setValueAtTime(0,time);
        envelope.gain.linearRampToValueAtTime(peak,time+.003);
        envelope.gain.exponentialRampToValueAtTime(peak*.22,time+.11);
        envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      } else if(sound==='rhodes') {
        length=range(random,1.1,2.35);peak=note.velocity*.033;
        const carrier=oscillator('sine',frequency,1,range(random,-5,5));
        oscillator('sine',frequency*2,.12);
        const mod=ctx.createOscillator(),amount=ctx.createGain();
        mod.frequency.value=frequency*(random()<.75?2:3);
        amount.gain.setValueAtTime(frequency*range(random,1.1,3.8),time);
        amount.gain.exponentialRampToValueAtTime(frequency*.04,time+.32);
        mod.connect(amount);amount.connect(carrier.frequency);sources.push(mod);nodes.push(mod,amount);
        // Tremolo stays within a positive gain range.
        const tremolo=ctx.createOscillator(),depth=ctx.createGain(),amp=ctx.createGain();
        tremolo.frequency.value=range(random,3.8,6.2);depth.gain.value=.16;amp.gain.value=.82;
        tremolo.connect(depth);depth.connect(amp.gain);envelope.disconnect();envelope.connect(amp);amp.connect(filter);
        sources.push(tremolo);nodes.push(tremolo,depth,amp);
        filter.frequency.value=range(random,3200,6500);
        envelope.gain.setValueAtTime(0,time);
        envelope.gain.linearRampToValueAtTime(peak,time+.006);
        envelope.gain.exponentialRampToValueAtTime(peak*.3,time+.28);
        envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      } else if(sound==='acid') {
        length=range(random,.16,.42);peak=note.velocity*.031;
        oscillator(random()<.7?'sawtooth':'square',frequency/4,.65,range(random,-3,3));
        const accent=note.velocity>.65;
        filter.Q.value=accent?11:7;
        filter.frequency.setValueAtTime(accent?5200:range(random,1600,3400),time);
        filter.frequency.exponentialRampToValueAtTime(range(random,110,240),time+length*.8);
        // A second pole pair makes the resonant bass less brittle.
        const lowpass=ctx.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=4300;lowpass.Q.value=.5;
        filter.disconnect();filter.connect(lowpass);lowpass.connect(pan);nodes.push(lowpass);
        pan.pan.value=0;
        envelope.gain.setValueAtTime(0,time);
        envelope.gain.linearRampToValueAtTime(peak,time+.003);
        envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      } else {
        // Pitch class chooses drum family, so the drawn scale also shapes rhythm.
        const kind=note.midi%12;
        attack=.003;length=range(random,.12,.38);peak=note.velocity*.085;
        filter.frequency.value=6500;
        if(kind<6) {
          const base=kind<3?range(random,46,64):frequency/2;
          const body=oscillator('sine',base);
          body.frequency.setValueAtTime(base*(kind<3?3:1.8),time);
          body.frequency.exponentialRampToValueAtTime(base,time+range(random,.035,.085));
          length=kind<3?range(random,.28,.5):range(random,.13,.3);
          filter.frequency.value=1500;
        } else if(kind<11) {
          noiseSource();filter.type='bandpass';filter.frequency.value=range(random,1200,3200);
          filter.Q.value=.7;peak=note.velocity*.095;
          if(kind<9)oscillator('triangle',frequency/2,.4);
          else length=range(random,.07,.14);
        } else {
          noiseSource();filter.type='highpass';filter.frequency.value=range(random,5500,8500);
          length=random()<.2?range(random,.3,.55):range(random,.045,.11);peak=note.velocity*.033;
          oscillator('square',frequency*1.43,.07);
        }
        envelope.gain.setValueAtTime(0,time);
        envelope.gain.linearRampToValueAtTime(peak,time+attack);
        envelope.gain.exponentialRampToValueAtTime(.00001,time+length);
      }
      let remaining=sources.length;
      const clean=()=>{if(--remaining===0){voices.delete(group);nodes.forEach(node=>node.disconnect());}};
      for(const source of sources){source.onended=clean;source.start(time);source.stop(time+length+.025);}
    }
    function tick() {
      if (!running || disposed) return;
      try {
        // A throttled background timer must never replay a backlog as a burst.
        if (nextTime < ctx.currentTime) nextTime=ctx.currentTime+.02;
        while (nextTime < ctx.currentTime+.12) {
          evolve(nextTime,nextStep);
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
      for(const group of voices) for(const source of group.sources) { try { source.stop(ctx.currentTime+FADE_SECONDS); } catch {} }
    }
    function schedule() {
      if(disposed) throw new Error('音频引擎已关闭');
      if(running) return end; // Idempotent: never install a second scheduler.
      nextStep=0; nextTime=ctx.currentTime+.09; visual=[];
      streams=state.tracks.map((_,index)=>M.rng(state.seed+':performance:'+index));
      timbreStreams=state.tracks.map((_,index)=>M.rng(state.seed+':timbre:'+index));
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0,ctx.currentTime);
      master.gain.linearRampToValueAtTime(10**(MASTER_VOLUME_DB/20),ctx.currentTime+.04);
      running=true; tick(); paint(); return end;
    }
    async function deactivate() {
      if(disposed) return;
      end(); disposed=true;
      await new Promise(resolve=>setTimeout(resolve,FADE_SECONDS*1000+20));
      try { await ctx.close(); } finally {
        modulators.forEach(source=>{try{source.stop();}catch{}});
        for(const group of voices)group.nodes.forEach(node=>node.disconnect());
        voices.clear();fixed.forEach(node=>node.disconnect());room.buffer=null;
      }
    }
    return {schedule,end,deactivate};
  }
  scope.GridAudio={activate,SOUNDS};
})(globalThis);
