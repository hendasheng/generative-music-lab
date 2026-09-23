/* Independent granular engine. Audio time is the only scheduling/visual clock. */
(() => {
  'use strict';
  const defaults = { position: .35, size: 180, density: 24, pitch: 0, spray: .12, pan: .8, reverse: 0 };
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
    const rng = random('granular-demo');
    for (let i = 0; i < buffer.length; i++) {
      const t = i / ctx.sampleRate;
      const f = [110, 130.8128, 164.8138, 195.9977][Math.min(3, Math.floor(t / 2))];
      const envelope = Math.sin(Math.PI * (t % 2) / 2) ** 2;
      const noise = (rng() * 2 - 1) * .015;
      for (let ch = 0; ch < 2; ch++) {
        const tone = Math.sin(2 * Math.PI * f * t) + .28 * Math.sin(2 * Math.PI * f * 2 * t + ch * .3) + .12 * Math.sin(2 * Math.PI * f * 3 * t);
        buffer.getChannelData(ch)[i] = tone * .35 * envelope + noise * envelope;
      }
    }
    return buffer;
  }
  function strengths(x=.5,y=.5) {
    const raw = [(1-x)*(1-y),x*(1-y),(1-x)*y,x*y];
    return raw.map(v => Math.max(0,(v-.25)/.75));
  }
  function effective(base, morph, time=0, rng=()=>.5) {
    const [reverse,gater,chorus,scatter] = strengths(morph.x,morph.y);
    let pitch=base.pitch;
    // A separate random stream keeps center playback identical to 0.1.
    if(reverse && rng()<reverse*.45) pitch+=12;
    if(scatter && rng()<scatter) pitch += [0,0,7,-7,12,-12][Math.floor(rng()*6)];
    if(chorus) pitch+=(rng()*2-1)*.3*chorus;
    return {...base, pitch,
      size:base.size*(1-.45*reverse)*(1+1.5*chorus),
      density:base.density*(1+gater*.8+scatter*.5)*(1-chorus*.25),
      reverse:base.reverse+(1-base.reverse)*reverse*.85,
      position:Math.max(0,Math.min(1,base.position+Math.sin(time*2*Math.PI/14)*.12*chorus)),
      spray:Math.min(.5,base.spray+scatter*.25)};
  }
  function gateLevel(time, depth) {
    // Fixed 120 BPM sixteenth notes, 5ms softened edges; phase uses audio time.
    const phase=((time%.125)+.125)%.125;
    const open=Math.min(1,phase/.005,Math.max(0,(.0625-phase)/.005));
    return 1-depth*.95*(1-Math.max(0,open));
  }
  async function create(buffer, params, seed, morph={x:.5,y:.5}) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try { await ctx.resume(); } catch (error) { await ctx.close(); throw error; }
    const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) reversed.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
    const bus = ctx.createGain(), gate = ctx.createGain(), master = ctx.createGain(), compressor = ctx.createDynamicsCompressor();
    master.gain.value = 0;
    compressor.threshold.value = -6; compressor.knee.value = 3; compressor.ratio.value = 12;
    compressor.attack.value = .003; compressor.release.value = .15;
    bus.connect(gate).connect(master).connect(compressor).connect(ctx.destination);
    const voices = new Set(), events = [];
    let timer = null, next = 0, nextGate=0, origin=0, closed = false, ending = null, rng, macroRng;
    const gateEvents=[];
    function spawn(when, settings) {
      if (voices.size >= 192) return;
      const event = { ...plan(settings, buffer.duration, rng), when };
      const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      source.buffer = event.reverse ? reversed : buffer;
      source.playbackRate.value = event.rate;
      pan.pan.value = event.pan;
      const window = new Float32Array(128);
      for (let i = 0; i < window.length; i++) window[i] = event.peak * .5 * (1 - Math.cos(2 * Math.PI * i / (window.length - 1)));
      gain.gain.value = 0;
      gain.gain.setValueCurveAtTime(window, when, event.length);
      source.connect(gain).connect(pan).connect(bus);
      const voice = { source, gain, pan };
      voices.add(voice); events.push(event);
      source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); voices.delete(voice); };
      const offset = event.reverse ? buffer.duration - event.offset - event.length * event.rate : event.offset;
      source.start(when, Math.max(0, offset));
      source.stop(when + event.length);
    }
    function tick() {
      const now = ctx.currentTime;
      // Skip missed time after a stalled tab; never burst old grains into the present.
      if (next < now) next = now + .005;
      while (next < now + .12) {
        const settings=effective(params,morph,next-origin,macroRng);
        spawn(next,settings); next += 1/settings.density;
      }
      if(nextGate<now) { nextGate=now; gate.gain.cancelScheduledValues(now); }
      const depth=strengths(morph.x,morph.y)[1];
      while(nextGate<now+.12) {
        const value=gateLevel(nextGate-origin,depth);
        gate.gain.linearRampToValueAtTime(value,nextGate);
        gateEvents.push({when:nextGate,value}); nextGate+=.005;
      }
      while(gateEvents.length>1 && gateEvents[1].when<now) gateEvents.shift();
      while (events.length && events[0].when < now - 3) events.shift();
    }
    function schedule() {
      if (closed || ending || timer !== null) return;
      rng = random(seed); macroRng=random(seed+':morph'); next = ctx.currentTime + .035;
      origin=next; nextGate=ctx.currentTime; gate.gain.setValueAtTime(1,ctx.currentTime);
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
    async function deactivate() { await end(); if (closed) return; closed = true; bus.disconnect(); gate.disconnect(); gateEvents.length=0; master.disconnect(); compressor.disconnect(); await ctx.close(); }
    return { schedule, end, deactivate, events,
      get gateLevel() {
        const now=ctx.currentTime; let previous=gateEvents[0];
        if(!previous) return 1;
        for(const point of gateEvents){if(point.when>now){const mix=Math.max(0,Math.min(1,(now-previous.when)/(point.when-previous.when || 1)));return previous.value+(point.value-previous.value)*mix;}previous=point;}
        return previous.value;
      },
      get settings() { return effective(params,morph,ctx.currentTime-origin); },
      get elapsed() { return ctx.currentTime-origin; },
      get time() { return ctx.currentTime; }, get active() { return voices.size; } };
  }
  window.Granular = { defaults, random, plan, demo, create, strengths, effective, gateLevel };
})();
