/* Independent granular engine. Audio time is the only scheduling/visual clock. */
(() => {
  'use strict';
  const defaults = { position: .35, size: 180, density: 24, pitch: 0, spray: .03125, pan: .8, reverse: 0, reverb: .3, volume: 0 };
  function random(seed) {
    let state = 2166136261;
    for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function plan(params, duration, rng) {
    const rate = 2 ** (params.pitch / 12);
    const length = Math.min(params.size / 1000, duration / rate);
    const reverse = rng() < params.reverse;
    const offset = Math.max(0, Math.min(duration - length * rate, params.position * duration + (rng() * 2 - 1) * params.spray * duration));
    return { offset, length, rate, reverse, pan: (rng() * 2 - 1) * params.pan,
      peak: .38 / Math.sqrt(Math.max(1, params.density * length)) };
  }
  function demo(ctx) {
    const buffer = ctx.createBuffer(2, ctx.sampleRate * 8, ctx.sampleRate);
    for (let i = 0; i < buffer.length; i++) {
      const t = i / ctx.sampleRate;
      const f = [110, 130.8128, 164.8138, 195.9977][Math.min(3, Math.floor(t / 2))];
      const envelope = Math.sin(Math.PI * (t % 2) / 2) ** 2;
      for (let ch = 0; ch < 2; ch++) {
        const tone = Math.sin(2 * Math.PI * f * t) + .28 * Math.sin(2 * Math.PI * f * 2 * t + ch * .3) + .12 * Math.sin(2 * Math.PI * f * 3 * t);
        buffer.getChannelData(ch)[i] = tone * .35 * envelope;
      }
    }
    return buffer;
  }
  // Bounded input compensation: linked channels, no changes to source samples.
  function inputGain(buffer) {
    let peak=0,energy=0,count=0;
    for(let c=0;c<buffer.numberOfChannels;c++)for(const sample of buffer.getChannelData(c)){
      peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;count++;
    }
    const rms=Math.sqrt(energy/Math.max(1,count));
    return rms<.001 || peak===0 ? 1 : Math.max(1,Math.min(4,.16/rms,.85/peak));
  }
  function defaultSpray(duration){return Math.min(.5,.25/Math.max(.001,duration));}
  function impulse(ctx) {
    const ir=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*4.5),ctx.sampleRate);
    const rng=random('room-03');
    for(let c=0;c<2;c++){
      const data=ir.getChannelData(c);let smooth=0;
      for(let i=0;i<data.length;i++){
        const t=i/ctx.sampleRate;
        smooth=.65*smooth+.35*(rng()*2-1);
        data[i]=smooth*Math.exp(-t*1.65)*Math.min(1,t/.012)*Math.min(1,(4.5-t)/.08);
      }
    }
    return ir;
  }
  function octaveEvent(base,duration){
    const rate=base.rate*2,length=Math.min(base.length*1.25,duration/rate);
    return {...base,rate,length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.4,wetOnly:true};
  }
  function dryOctaveEvent(base,duration){
    const rate=base.rate*2,length=Math.min(base.length,duration/rate);
    return {...base,rate,length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.8,octave:12};
  }
  async function create(buffer, params, seed) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try { await ctx.resume(); } catch (error) { await ctx.close(); throw error; }
    const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) reversed.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
    const bus = ctx.createGain(), master = ctx.createGain(), compressor = ctx.createDynamicsCompressor();
    const input=ctx.createGain(),wet=ctx.createGain(),space=ctx.createConvolver(),output=ctx.createGain();
    const shimmerInput=ctx.createGain(),damping=ctx.createBiquadFilter();
    input.gain.value=inputGain(buffer);shimmerInput.gain.value=input.gain.value;
    damping.type='lowpass';damping.frequency.value=4500;damping.Q.value=.707;
    shimmerInput.connect(space);
    space.buffer=impulse(ctx);
    wet.gain.value=Math.max(0,Math.min(1,params.reverb ?? .3))*.8;
    output.gain.value=10**((params.volume ?? 0)/20);
    master.gain.value = 0;
    compressor.threshold.value = -6; compressor.knee.value = 3; compressor.ratio.value = 12;
    compressor.attack.value = .003; compressor.release.value = .15;
    bus.connect(input);input.connect(master);input.connect(space);space.connect(damping).connect(wet).connect(master);
    master.connect(output).connect(compressor).connect(ctx.destination);
    const voices = new Set(), events = [];
    let timer = null, next = 0, closed = false, ending = null, rng, timing, shimmer, harmony;
    function spawn(when) {
      if (voices.size >= 192) return;
      const event = { ...plan(params, buffer.duration, rng), when };
      spawnVoice(harmony()<.15 ? dryOctaveEvent(event,buffer.duration) : event);
      if((params.reverb ?? .3)>0 && shimmer()<.45)spawnVoice(octaveEvent(event,buffer.duration));
    }
    function spawnVoice(event){
      if(voices.size>=192)return;
      const when=event.when;
      const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      source.buffer = event.reverse ? reversed : buffer;
      source.playbackRate.value = event.rate;
      pan.pan.value = event.pan;
      const window = new Float32Array(128);
      for (let i = 0; i < window.length; i++) window[i] = event.peak * .5 * (1 - Math.cos(2 * Math.PI * i / (window.length - 1)));
      gain.gain.value = 0;
      gain.gain.setValueCurveAtTime(window, when, event.length);
      source.connect(gain).connect(pan).connect(event.wetOnly?shimmerInput:bus);
      const voice = { source, gain, pan };
      voices.add(voice); events.push(event);
      source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); voices.delete(voice); };
      const offset = event.reverse ? buffer.duration - event.offset - event.length * event.rate : event.offset;
      source.start(when, Math.max(0, offset));
      source.stop(when + event.length);
    }
    function tick() {
      const now = ctx.currentTime;
      wet.gain.setTargetAtTime(Math.max(0,Math.min(1,params.reverb ?? .3))*.8,now,.03);
      output.gain.setTargetAtTime(10**(Math.max(-24,Math.min(6,params.volume ?? 0))/20),now,.03);
      // Skip missed time after a stalled tab; never burst old grains into the present.
      if (next < now) next = now + .005;
      while (next < now + .12) { spawn(next); next += (1 + (timing()*2-1)*.1) / params.density; }
      while (events.length && events[0].when < now - 2) events.shift();
    }
    function schedule() {
      if (closed || ending || timer !== null) return;
      rng = random(seed); timing=random(seed+':timing'); shimmer=random(seed+':shimmer'); harmony=random(seed+':harmony'); next = ctx.currentTime + .035;
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(10 ** (6 / 20), ctx.currentTime + .04);
      tick(); timer = setInterval(tick, 25);
    }
    function end() {
      if (ending) return ending;
      clearInterval(timer); timer = null;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + .035);
      ending = new Promise(resolve => setTimeout(() => {
        for (const voice of voices) { try { voice.source.stop(); } catch (_) {} voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); }
        voices.clear(); events.length = 0; resolve();
      }, 50));
      return ending;
    }
    async function deactivate() { await end(); if (closed) return; closed = true; bus.disconnect(); input.disconnect(); shimmerInput.disconnect(); damping.disconnect(); space.disconnect(); wet.disconnect(); master.disconnect(); output.disconnect(); compressor.disconnect(); await ctx.close(); }
    return { schedule, end, deactivate, events, get time() { return ctx.currentTime; }, get active() { return voices.size; } };
  }
  // The controls and XY are two views of the same position/spray values.
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function reverseFromSpray(spray) { return Math.pow(clamp(spray*2,0,1),2.5); }
  function fromXY(x,y) { const spray=clamp(y,0,1)*.5; return {position:clamp(x,0,1),spray,reverse:reverseFromSpray(spray)}; }
  function toXY(params) { return {x:clamp(params.position,0,1),y:clamp(params.spray,0,.5)*2}; }
  window.Granular = { defaults, random, plan, demo, create, dryOctaveEvent, octaveEvent, inputGain, defaultSpray, fromXY, toXY, reverseFromSpray };
})();
