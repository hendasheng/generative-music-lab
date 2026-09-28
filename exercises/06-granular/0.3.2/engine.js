/* Independent granular engine. Audio time is the only scheduling/visual clock. */
(() => {
  'use strict';
  const defaults = { position: .35, size: 180, density: 24, pitch: 0, spray: .03125, pan: .8, reverse: 0, reverb: .65, volume: 6 };
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
  // 内置音源库：demo(ctx, index) 一号一段素材，demoNames 与之一一对应。
  // ★ 0 号是首版就有的「谐波片段」，它的循环体**一个字都不能动** —— 版本之间不允许因为
  //   「加了音源」而改变原有声音（0.1 / 0.2 不升级，仍只会生成 0 号）。新音源全走 else 分支。
  // 每段只用种子随机流 random('demo-N')：同一号在任何机器、任何时刻都是同一段素材。
  const demoNames = ['谐波片段', '钟形泛音', '拨弦余韵', '人声共振'];
  const demoSeconds = [8, 6, 6, 8];
  function demo(ctx, index = 0) {
    const count = demoNames.length;
    const which = ((Math.trunc(index) || 0) % count + count) % count;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(2, rate * demoSeconds[which], rate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const rng = random('demo-' + which);
    if (which === 0) {
      for (let i = 0; i < buffer.length; i++) {
        const t = i / ctx.sampleRate;
        const f = [110, 130.8128, 164.8138, 195.9977][Math.min(3, Math.floor(t / 2))];
        const envelope = Math.sin(Math.PI * (t % 2) / 2) ** 2;
        for (let ch = 0; ch < 2; ch++) {
          const tone = Math.sin(2 * Math.PI * f * t) + .28 * Math.sin(2 * Math.PI * f * 2 * t + ch * .3) + .12 * Math.sin(2 * Math.PI * f * 3 * t);
          buffer.getChannelData(ch)[i] = tone * .35 * envelope;
        }
      }
    } else if (which === 1) {
      // 钟形泛音：非谐分音 + 指数衰减，四次敲击互相叠尾（颗粒化后是金属质感的碎点）。
      const f0 = 523.2511, partial = [[1, 1], [2.76, .5], [5.4, .26], [8.93, .12]], strike = [0, 1.7, 3.3, 4.7];
      for (let i = 0; i < buffer.length; i++) {
        const t = i / rate;
        for (let ch = 0; ch < 2; ch++) {
          let sum = 0;
          for (const when of strike) {
            const dt = t - when;
            if (dt < 0) continue;
            const env = Math.exp(-dt * 1.35) * (1 - Math.exp(-dt * 400));
            for (const [ratio, gain] of partial) sum += gain * env * Math.sin(2 * Math.PI * f0 * ratio * (1 + ch * .0006) * dt);
          }
          (ch ? right : left)[i] = sum * .22;
        }
      }
    } else if (which === 2) {
      // 拨弦余韵：Karplus-Strong（延迟线长度 = 周期，衰减随音高自然变化），五音依次拨响。
      const note = [110, 146.8324, 164.8138, 220, 293.6648], at = [0, 1.2, 2.4, 3.6, 4.8];
      for (let ch = 0; ch < 2; ch++) {
        const data = ch ? right : left;
        for (let k = 0; k < note.length; k++) {
          const period = Math.max(2, Math.round(rate / note[k]));
          const line = new Float32Array(period);
          for (let j = 0; j < period; j++) line[j] = rng() * 2 - 1;
          const start = Math.round(at[k] * rate);
          for (let i = start; i < buffer.length; i++) {
            const j = (i - start) % period;
            const value = (line[j] + line[(j + 1) % period]) * .5 * .9965;
            line[j] = value;
            data[i] += value * .34 * Math.exp(-(i - start) / rate * .3);
          }
        }
      }
    } else {
      // 人声共振：脉冲列过三个共振峰（加性合成），带颤音、逐句换音高、句间淡入淡出。
      const f0 = 138.5913, formant = [[700, 1], [1220, .55], [2600, .3]], H = 14;
      const weight = new Float32Array(H + 1);
      let total = 0;
      for (let h = 1; h <= H; h++) {
        const f = f0 * h; let w = 0;
        for (const [center, gain] of formant) w += gain / (1 + ((f - center) / 380) ** 2);
        weight[h] = w; total += w;
      }
      const melody = [0, 2, 4, 7, 4, 0], phrase = demoSeconds[3] / melody.length;
      for (let i = 0; i < buffer.length; i++) {
        const t = i / rate;
        const step = Math.min(melody.length - 1, Math.floor(t / phrase));
        const f = f0 * 2 ** (melody[step] / 12) * (1 + .006 * Math.sin(2 * Math.PI * 4.6 * t));
        let sum = 0;
        for (let h = 1; h <= H; h++) sum += weight[h] * Math.sin(2 * Math.PI * f * h * t);
        const env = Math.sin(Math.PI * ((t % phrase) / phrase)) ** 2;
        left[i] = sum / total * .42 * env;
        right[i] = sum / total * .42 * env * (1 + .08 * Math.sin(2 * Math.PI * .7 * t));
      }
    }
    if (which !== 0) {
      // 段尾淡出：新音源的自然衰减到素材末尾还没归零，硬切会在最后一个粒子里变成「啪」。
      // 0 号不加（它的 sin² 包络本来就在整秒处归零，且它必须与首版逐字节相同）。
      const fade = Math.min(Math.round(rate * .3), buffer.length);
      for (let i = 0; i < fade; i++) {
        const gain = (i + 1) / fade;
        left[buffer.length - 1 - i] *= gain; right[buffer.length - 1 - i] *= gain;
      }
    }
    return buffer;
  }
  // Bounded input compensation: linked channels, no changes to source samples.
  // 目标一致（RMS .16 / 峰值 .85 / 最多 4 倍），两条路径共用：素材按整段统计，
  // 实时按环形缓冲的当前电平反复标定。
  function gainForLevel(peak, energy, count) {
    const rms = Math.sqrt(energy / Math.max(1, count));
    return rms < .001 || peak === 0 ? 1 : Math.max(1, Math.min(4, .16 / rms, .85 / peak));
  }
  function inputGain(buffer) {
    let peak=0,energy=0,count=0;
    for(let c=0;c<buffer.numberOfChannels;c++)for(const sample of buffer.getChannelData(c)){
      peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;count++;
    }
    return gainForLevel(peak, energy, count);
  }
  // iOS 音频会话类型。默认（auto）有两个坑：输出会跟着静音开关走，且在采集麦克风期间
  // 系统会把整个页面的输出压低（WebKit #236219：非 MediaStreamTrack 音频在录音时被衰减）。
  // 显式声明 playback / play-and-record，并且**离开麦克风必须切回 playback**，
  // 否则之后所有播放都留在被压低的那一档——真机上「声音特别小、尤其录制」多半来自这里。
  function setAudioSession(type) {
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (_) {}
  }  function defaultSpray(duration){return Math.min(.5,.25/Math.max(.001,duration));}
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
  async function create(buffer, params, seed, liveSource = null) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try { await ctx.resume(); } catch (error) { await ctx.close(); throw error; }
    const reversed = liveSource ? null : ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; !liveSource && c < buffer.numberOfChannels; c++) reversed.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
    const bus = ctx.createGain(), master = ctx.createGain(), compressor = ctx.createDynamicsCompressor();
    // 输出电平表：接在压缩器与扬声器之间，AnalyserNode 直通不改声音，只用于测量/显示。
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    const levelBuffer = new Float32Array(analyser.fftSize);
    const input=ctx.createGain(),wet=ctx.createGain(),space=ctx.createConvolver(),output=ctx.createGain();
    const shimmerInput=ctx.createGain(),damping=ctx.createBiquadFilter();
    // 输入补偿：素材路径按整段统计（inputGain）；**实时路径过去写死为 1**，等于不补偿，
    // 而 iOS 采集到的麦克风电平常远低于桌面（WebKit #236219 那条输出压低是另一回事，
    // 这里说的是输入本身偏小）。实时改为按环形缓冲的实际电平持续标定到与素材同一目标
    // （RMS 0.16 / 峰值 0.85 / 最多 4 倍），这样桌面与 iOS 走的是同一套响度目标。
    const LIVE_GAIN_INTERVAL = .25;
    let liveGainNext = 0, liveGainValue = 1;
    input.gain.value = liveSource ? 1 : inputGain(buffer);
    shimmerInput.gain.value = input.gain.value;
    damping.type='lowpass';damping.frequency.value=4500;damping.Q.value=.707;
    const wetLowCut=ctx.createBiquadFilter(),shimmerTone=ctx.createBiquadFilter(),octaveTone=ctx.createBiquadFilter();
    wetLowCut.type='highpass';wetLowCut.frequency.value=180;wetLowCut.Q.value=.707;
    shimmerTone.type='lowpass';shimmerTone.frequency.value=3500;shimmerTone.Q.value=.707;
    octaveTone.type='lowpass';octaveTone.frequency.value=6000;octaveTone.Q.value=.707;
    shimmerInput.connect(shimmerTone).connect(space);
    octaveTone.connect(bus);
    space.buffer=impulse(ctx);
    wet.gain.value=Math.max(0,Math.min(1,params.reverb ?? .3))*.8;
    output.gain.value=10**((params.volume ?? 0)/20);
    master.gain.value = 0;
    compressor.threshold.value = -6; compressor.knee.value = 3; compressor.ratio.value = 12;
    compressor.attack.value = .003; compressor.release.value = .15;
    bus.connect(input);input.connect(master);input.connect(space);space.connect(wetLowCut).connect(damping).connect(wet).connect(master);
    master.connect(output).connect(compressor).connect(analyser).connect(ctx.destination);
    const voices = new Set(), events = [];
    let timer = null, next = 0, closed = false, ending = null, rng, timing, shimmer, harmony;
    function spawn(when) {
      if (voices.size >= 192) return;
      const duration=liveSource ? liveSource.duration : buffer.duration;
      if(liveSource && duration<.12)return;
      const event = { ...plan(params, duration, rng), when, origin:liveSource?.origin ?? 0 };
      spawnVoice(harmony()<.15 ? dryOctaveEvent(event,duration) : event);
      if((params.reverb ?? .3)>0 && shimmer()<.45)spawnVoice(octaveEvent(event,duration));
    }
    function spawnVoice(event){
      if(voices.size>=192)return;
      const when=event.when;
      const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      source.buffer = liveSource ? liveSource.grain(ctx,event) : event.reverse ? reversed : buffer;
      source.playbackRate.value = event.rate;
      pan.pan.value = event.pan;
      const window = new Float32Array(128);
      for (let i = 0; i < window.length; i++) window[i] = event.peak * .5 * (1 - Math.cos(2 * Math.PI * i / (window.length - 1)));
      gain.gain.value = 0;
      gain.gain.setValueCurveAtTime(window, when, event.length);
      source.connect(gain).connect(pan).connect(event.wetOnly?shimmerInput:event.octave===12?octaveTone:bus);
      const voice = { source, gain, pan };
      voices.add(voice); events.push(event);
      source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); voices.delete(voice); };
      const offset = liveSource ? 0 : event.reverse ? buffer.duration - event.offset - event.length * event.rate : event.offset;
      source.start(when, Math.max(0, offset));
      source.stop(when + event.length);
    }
    function tick() {
      const now = ctx.currentTime;
      wet.gain.setTargetAtTime(Math.max(0,Math.min(1,params.reverb ?? .3))*.8,now,.03);
      output.gain.setTargetAtTime(10**(Math.max(-24,Math.min(6,params.volume ?? 0))/20),now,.03);
      // 实时输入：每 LIVE_GAIN_INTERVAL 按环形缓冲的当前电平重新标定输入补偿。
      // 取 256 点做估计（约 5ms@48k）——够稳，且不必遍历整个 8 秒缓冲。
      // ★ 只在变化明显时改，避免把增益本身变成调制噪声。
      if (liveSource && now >= liveGainNext) {
        liveGainNext = now + LIVE_GAIN_INTERVAL;
        const total = liveSource.count ?? 0;
        if (total > 2400) {
          const step = Math.max(1, Math.floor(total / 256));
          let peak = 0, energy = 0, count = 0;
          for (let i = 0; i < total; i += step) {
            const v = liveSource.sample ? liveSource.sample(i) : 0;
            const a = Math.abs(v); if (a > peak) peak = a;
            energy += v * v; count++;
          }
          const next = gainForLevel(peak, energy, count);
          if (Math.abs(next - liveGainValue) > .05 * liveGainValue) {
            liveGainValue = next;
            input.gain.setTargetAtTime(next, now, .05);
            shimmerInput.gain.setTargetAtTime(next, now, .05);
          }
        }
      }
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
    async function deactivate() { await end(); if (closed) return; closed = true; bus.disconnect(); input.disconnect(); shimmerInput.disconnect(); shimmerTone.disconnect(); octaveTone.disconnect(); wetLowCut.disconnect(); damping.disconnect(); space.disconnect(); wet.disconnect(); master.disconnect(); output.disconnect(); compressor.disconnect(); analyser.disconnect(); await ctx.close(); }
    // 输出电平读数（与参考实现同名）：peak/rms 为线性值，不改声音，仅供测量与显示。
    function levels() {
      if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(levelBuffer);
      let peak = 0, sum = 0;
      for (const v of levelBuffer) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
      return { peak, rms: Math.sqrt(sum / levelBuffer.length) };
    }
    return { schedule, end, deactivate, events, levels, get time() { return ctx.currentTime; }, get active() { return voices.size; } };
  }
  // The controls and XY are two views of the same position/spray values.
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function reverseFromSpray(spray) { return Math.pow(clamp(spray*2,0,1),2.5); }
  function fromXY(x,y) { const spray=clamp(y,0,1)*.5; return {position:clamp(x,0,1),spray,reverse:reverseFromSpray(spray)}; }
  function toXY(params) { return {x:clamp(params.position,0,1),y:clamp(params.spray,0,.5)*2}; }
  window.Granular = { defaults, random, plan, demo, demoNames, create, dryOctaveEvent, octaveEvent, inputGain, defaultSpray, fromXY, toXY, reverseFromSpray, setAudioSession };
})();
