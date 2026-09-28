(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const controls = document.querySelector('exercise-controls');
  const params = { ...Granular.defaults };
  const pad=$('xyPad'), dot=$('xyDot');
  function syncXY() {
    const point=Granular.toXY(params);
    dot.style.left=(point.x*100)+'%';dot.style.top=(point.y*100)+'%';
    // 屏上不再显示这行读数（版面只留内容），但仍写进 aria-label，读屏与无视觉操作者仍有反馈。
    const text='位置 '+Math.round(params.position*100)+'% · 散布 ±'+Math.round(params.spray*100)+'% · 倒放 '+Math.round(params.reverse*100)+'%';
    pad.setAttribute('aria-label','取样控制：'+text+'。左右选择位置，上下调整散布与倒放，空格切换自由流动');
    $('positionSurface').value=params.position;
  }
  function setXY(x,y) {
    stopFlow();
    const mapped=Granular.fromXY(x,y);
    // Horizontal gestures preserve a manually chosen reverse probability.
    if(Math.abs(mapped.spray-params.spray)<1e-8) delete mapped.reverse;
    Object.assign(params,mapped);
    syncXY(); displayParameters();
  }
  let pointer=null;
  function moveXY(e) {
    const r=pad.getBoundingClientRect();
    if(r.width && r.height) setXY((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);
  }
  function releaseXY(e) {
    if(e && e.pointerId!==undefined && e.pointerId!==pointer) return;
    const previous=pointer; pointer=null;
    try {if(previous!==null && pad.hasPointerCapture(previous)) pad.releasePointerCapture(previous);} catch (_) {}
  }
  pad.addEventListener('pointerdown',e=>{
    if(e.button!==0 || e.isPrimary===false) return;
    // A new primary press is authoritative, even if the previous release was lost.
    releaseXY(); pointer=e.pointerId; e.preventDefault();
    pad.focus({preventScroll:true});
    try {pad.setPointerCapture(pointer);} catch (_) { /* window listeners remain active */ }
    moveXY(e);
  });
  window.addEventListener('pointermove',e=>{
    if(e.pointerId!==pointer) return;
    if(e.pointerType==='mouse' && !(e.buttons&1)) {releaseXY(e);return;}
    e.preventDefault(); moveXY(e);
  },{passive:false});
  for(const name of ['pointerup','pointercancel']) window.addEventListener(name,releaseXY);
  pad.addEventListener('lostpointercapture',releaseXY);
  window.addEventListener('blur',()=>{releaseXY();editing=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseXY();editing=null;}});
  pad.addEventListener('dragstart',e=>e.preventDefault());
  // Native text drags near the thin sliders show a no-drop cursor and block all
  // dragging until they end; the page has no drop targets, so block drags outright.
  document.addEventListener('dragstart',e=>e.preventDefault());
  pad.addEventListener('keydown',e=>{
    const d=e.shiftKey?.1:.025,point=Granular.toXY(params);
    if(e.key===' '){e.preventDefault();toggleFlow();}
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();setXY(point.x+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0),point.y+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0));
    }
  });
  let flow=null,flowTimer=null,lastFlowTime=0,waveHeld=false;
  const flowButton=$('freeFlow');
  function stopFlow() {
    clearInterval(flowTimer);flowTimer=null;flow=null;
    flowButton.setAttribute('aria-pressed','false');flowButton.setAttribute('aria-label','开启自由流动');
  }
  function toggleFlow() {
    if(flow){stopFlow();return;}
    flow=FreeFlow.create(params,controls.seedValue || seed);
    lastFlowTime=performance.now();
    flowButton.setAttribute('aria-pressed','true');flowButton.setAttribute('aria-label','关闭自由流动');
    flowTimer=setInterval(()=>{
      const now=performance.now(),dt=Math.min(.1,(now-lastFlowTime)/1000);lastFlowTime=now;
      const held=new Set(editing?[editing]:[]);
      if(pointer!==null){held.add('position');held.add('spray');}
      if(waveHeld)held.add('position');
      flow.step(dt,held);displayParameters();syncXY();
    },25);
  }
  flowButton.addEventListener('click',toggleFlow);
  window.addEventListener('blur',()=>{waveHeld=false;});
  window.addEventListener('pointerup',()=>{waveHeld=false;});
  window.addEventListener('pointercancel',()=>{waveHeld=false;});
  const specs = [
    ['position','取样位置','POSITION',0,1,.001,v => Math.round(v*100)+'%'],
    ['spray','位置散布','SPRAY',0,.5,.001,v => '±'+Math.round(v*100)+'%'],
    ['reverse','倒放概率','REVERSE',0,1,.01,v => Math.round(v*100)+'%'],
    ['size','粒子长度','GRAIN SIZE',15,1000,1,v => Math.round(v)+' ms'],
    ['density','密度','DENSITY',2,60,1,v => Number(v.toFixed(1))+' /s'],
    ['pan','立体声散布','STEREO SPREAD',0,1,.01,v => Math.round(v*100)+'%'],
    ['pitch','音高','PITCH',-24,24,1,v => (v>0?'+':'')+Number(v.toFixed(2))+' st'],
    ['reverb','混响','REVERB',0,1,.01,v=>Math.round(v*100)+'%'],
    ['volume','输出音量','OUTPUT',-24,6,1,v=>(v>0?'+':'')+Math.round(v)+' dB']
  ];
  const fields = {};
  let editing=null;
  for (const [key,label,en,min,max,step,format] of specs) {
    const core=['size','density','pan','pitch'].includes(key);
    const div = document.createElement('div'); div.className = core?'parameter core-parameter':'parameter';
    div.innerHTML = `<label for="p-${key}">${label}<output></output></label><small>${en}</small><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
    if(core)div.innerHTML=`<div class="dial-face" aria-hidden="true"><span class="dial-pointer"></span></div><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}"><label for="p-${key}">${label}</label><output></output>`;
    $(core?'coreParameters':key==='reverb' || key==='volume'?'outputParameters':'parameters').append(div);
    const input = div.querySelector('input'), output = div.querySelector('output');
    fields[key] = { input, output, format, min, max, div };
    output.textContent = format(params[key]);
    input.addEventListener('pointerdown',()=>{stopFlow();editing=key;});
    for(const name of ['pointerup','pointercancel','lostpointercapture','blur']) input.addEventListener(name,()=>{if(editing===key)editing=null;});
    input.addEventListener('input', () => setParam(key, +input.value));
    if(core){
      let drag=null;
      input.addEventListener('pointerdown',e=>{
        if(e.button!==0 || e.isPrimary===false)return;
        e.preventDefault();input.focus({preventScroll:true});stopFlow();editing=key;
        drag={id:e.pointerId,y:e.clientY,x:e.clientX,value:params[key]};
        try{input.setPointerCapture(e.pointerId);}catch(_){}
      });
      window.addEventListener('pointermove',e=>{
        if(!drag || drag.id!==e.pointerId)return;
        if(e.pointerType==='mouse' && !(e.buttons&1)){drag=null;editing=null;return;}
        e.preventDefault();const precision=e.shiftKey?.2:1;
        const value=drag.value+((drag.y-e.clientY)/220+(e.clientX-drag.x)/420)*(max-min)*precision;
        input.value=Math.max(min,Math.min(max,min+Math.round((value-min)/step)*step));
        setParam(key,+input.value);
      },{passive:false});
      const release=e=>{if(drag && (e.pointerId===undefined || drag.id===e.pointerId)){drag=null;if(editing===key)editing=null;}};
      for(const name of ['pointerup','pointercancel'])window.addEventListener(name,release);
      input.addEventListener('lostpointercapture',release);window.addEventListener('blur',release);
      document.addEventListener('visibilitychange',()=>{if(document.hidden)release({});});
    }
  }
  function setParam(key,value) {
    stopFlow();
    params[key]=Math.max(fields[key].min,Math.min(fields[key].max,value));
    displayParameters(); syncXY();
  }
  function displayParameters() {
    for(const [key,field] of Object.entries(fields)) {
      const value=field.format(params[key]);
      if(editing!==key) field.input.value=params[key];
      field.input.setAttribute('aria-valuetext',value);
      field.div.style.setProperty('--dial-angle',(-135+270*(params[key]-field.min)/(field.max-field.min))+'deg');
      if(field.output.textContent!==value) field.output.textContent=value;
    }
  }
  syncXY(); displayParameters();
  $('positionSurface').addEventListener('pointerdown',()=>{stopFlow();waveHeld=true;});
  $('positionSurface').addEventListener('input', e => setParam('position', +e.target.value));
  const decoder = new OfflineAudioContext(2, 1, 44100);
  let buffer = Granular.demo(decoder), engine = null, generation = 0, loadGeneration = 0;
  let starting = false, loading = false, seed = 'grain-01', peaks = [];
  const canvas = $('wave'), paint = canvas.getContext('2d');
  // 波形显示增益：只影响画面，不改音频。麦克风原始电平常只有 ±0.2~0.4，
  // 按 ±1 直画又小又平；WAVE_FLOOR 兜底避免安静时把底噪放大成满屏，
  // 下限 .02 决定了最多放大 ×50；上限 32 让它停在「素材峰值 ≥0.031（−30 dBFS）都能铺满」，
  const WAVE_FLOOR = .02, DRAW_MAX_SCALE = 32;
  let waveDisplayPeak = WAVE_FLOOR, waveDrawTime = null;
  let drawScale = 1;   // 本帧采样波形用的显示增益（便于测量；只影响画面）
  // analyser 时域缓冲的采样率：录音链路用 AudioContext 的默认采样率（44.1k/48k）。
  // 仅用于把「缓冲点数」换算成「秒」，决定实时波形的横向步长。
  const REC_SR = 48000;
  function analyse() {
    const data = buffer.getChannelData(0); peaks = [];
    for (let x = 0; x < 1000; x++) {
      let min = 0, max = 0;
      for (let i = Math.floor(x*data.length/1000); i < Math.floor((x+1)*data.length/1000); i++) { min=Math.min(min,data[i]); max=Math.max(max,data[i]); }
      peaks.push([min,max]);
    }
    $('duration').textContent = buffer.duration.toFixed(2)+' s';
  }
  // 实时输入：与 0.3 同一套（live.js 的 8 秒环形缓冲 + AudioWorklet 采集），本版只做
  // 「开/关」一个按钮；顶部播放键居中，这里占原来播放键的位置。
  let liveSource=null,livePending=false,liveEpoch=0,lastLivePaint=0;
  const liveCapture=LiveInput.create(()=>{void stop();$('status').textContent='麦克风已断开 · 实时输入停止';});
  function liveUI(busy=false){
    const button=$('liveInput');
    button.setAttribute('aria-pressed',String(Boolean(liveSource)));
    // 按钮只有文字（无图标），状态靠文案与 aria-label 表达；呼吸动画由 aria-pressed 驱动。
    button.querySelector('.live-text').textContent=livePending?'等待':'LIVE';
    button.setAttribute('aria-label',livePending?'取消实时输入等待':liveSource?'关闭实时输入':'实时输入');
    // busy 由调用方传入（0.3 是直接读 recorder.active）。本版 liveUI 定义在 recorder 之前，
    // 表达式里写 recorder.active 会落进 TDZ；默认 false 即可——录音开始/结束时 onState 会带 busy 再调一次。
    $('liveInput').disabled=busy;
    $('record').disabled=Boolean(liveSource)||livePending;
    // 实时素材只有「最近 8 秒」，轴向语义随之改变；回到素材模式时恢复。
    document.querySelector('.axis-label.left').textContent=liveSource?'较早':'起点';
    document.querySelector('.axis-label.right').textContent=liveSource?'刚刚':'终点';
  }
  $('liveInput').addEventListener('click',async()=>{
    if(liveSource || livePending){await stop();return;}
    cancelRecording();++loadGeneration;loading=false;await stop();
    const ticket=++liveEpoch;livePending=true;liveUI();
    Granular.setAudioSession?.('play-and-record');
    $('status').textContent='请允许麦克风 · 建议戴耳机 · 可再次点击取消';
    try{
      const captured=await liveCapture.start();
      if(ticket!==liveEpoch || !captured)return;
      liveSource=captured;livePending=false;
      // 实时输入的素材来自麦克风，与「上一次导入的文件」无关；进入实时即回到内置音源，
      // 避免采样名/波形读数还停在某个导入文件上。
      await adoptDemoSource();
      liveUI();
      await play();
    }catch(error){if(ticket===liveEpoch){await stop();$('status').textContent='实时输入失败：'+error.message;}}
  });
  // 把音源切回内置素材。这里不调用 load()——load 会先 stop()，那会把刚拿到的 liveSource 清掉。
  function adoptDemoSource(status){
    const demo=Granular.demo(decoder);
    buffer=demo;
    params.spray=Granular.defaultSpray(buffer.duration);
    $('sampleName').textContent='内置音源 · 谐波片段';
    displayParameters();syncXY();analyse();
    $('status').textContent=status;
  }
  async function stop() {
    ++liveEpoch;liveCapture.stop();liveSource=null;livePending=false;liveUI();analyse();
    Granular.setAudioSession?.('playback');
    stopFlow();
    ++generation; starting = false;
    const previous = engine; engine = null;
    controls.setPlaying(false); controls.setBusy(loading);
    $('status').textContent = '已停止 · 再次播放从同一随机序列开始';
    if (previous) await previous.deactivate();
  }
  async function play() {
    if (engine || starting || loading || livePending || recorder.active || recordPreparing) return;
    // 会话类型必须跟着「当前是否在用麦克风」走：实时输入开着时 play() 也会被调用，
    // 硬写 playback 会把刚声明的 play-and-record 顶掉，采集期又回到被压低的那一档。
    Granular.setAudioSession?.(liveSource || livePending ? 'play-and-record' : 'playback');
    const ticket = ++generation; starting = true; controls.setBusy(true);
    try {
      const created = await Granular.create(buffer, params, seed, liveSource);
      if (ticket !== generation) { await created.deactivate(); return; }
      engine = created; engine.schedule(); controls.setPlaying(true);
      $('status').textContent = liveSource?'实时输入中 · 最近 8 秒 · 请使用耳机':'播放中 · 种子 '+seed;
    } catch (error) { if (ticket === generation) { await stop(); $('status').textContent='无法启动音频：'+error.message; } }
    finally { if (ticket === generation) { starting=false; controls.setBusy(false); } }
  }
  controls.addEventListener('exercise-play', () => { seed=controls.seedValue || seed; play(); });
  controls.addEventListener('exercise-stop', stop);
  controls.addEventListener('exercise-seed-apply', async () => { seed=controls.seedValue || 'grain-01'; await stop(); play(); });
  controls.addEventListener('exercise-regenerate', async () => {
    seed=crypto.getRandomValues(new Uint32Array(1))[0].toString(36); controls.clearSeed(); await stop(); play();
  });
  async function load(file) {
    recorder.cancel();
    const ticket = ++loadGeneration; loading=true; await stop();
    $('status').textContent = '正在读取音源…';
    try {
      if (file && file.size > 40*1024*1024) throw new Error('请选择小于 40 MB 的音频');
      const decoded = file ? await decoder.decodeAudioData(await file.arrayBuffer()) : Granular.demo(decoder);
      if (ticket !== loadGeneration) return;
      const length = Math.min(decoded.length, Math.floor(decoded.sampleRate*30));
      const selected = decoder.createBuffer(Math.min(2,decoded.numberOfChannels),length,decoded.sampleRate);
      for (let c=0;c<selected.numberOfChannels;c++) selected.copyToChannel(decoded.getChannelData(c).subarray(0,length),c);
      buffer=selected; params.spray=Granular.defaultSpray(buffer.duration); displayParameters();syncXY();analyse();
      $('sampleName').textContent=file ? file.name : '内置音源 · 谐波片段';
      $('status').textContent=(decoded.duration>30?'已取前 30 秒':'音源已就绪')+' · 点击播放';
    } catch (error) { if (ticket===loadGeneration) $('status').textContent='导入失败，原音源已保留：'+error.message; }
    finally { if (ticket===loadGeneration) { loading=false; controls.setBusy(false); } }
  }
  let recordPreparing=false,recordEpoch=0;
  const recordButton=$('record');
  const recorder=SampleRecorder.create({
    onState(state,seconds){
      // 录音期间 play-and-record，一离开就切回 playback：漏了这一步，iOS 会把
      // 录音之后的播放一直留在被压低的那一档（见 engine.js 的 setAudioSession）。
      Granular.setAudioSession?.((state==='recording' || state==='requesting' || liveSource || livePending) ? 'play-and-record' : 'playback');
      const busy=state!=='idle';
      controls.setBusy(busy || loading);$('demo').disabled=busy;$('file').disabled=busy;
      recordButton.disabled=state==='processing';
      recordButton.setAttribute('aria-pressed',String(state==='recording'));
      $('recordLabel').textContent=state==='requesting'?'取消授权等待':state==='recording'?'停止 · '+seconds.toFixed(1)+' / 30s':state==='processing'?'处理中…':'录制采样 · 30s';
      recordButton.setAttribute('aria-label',$('recordLabel').textContent);
      $('recordTime').textContent=state==='recording'?seconds.toFixed(1)+' / 30s':'';
      $('positionSurface').disabled=busy;
      liveUI(busy);
      if(state==='requesting')$('status').textContent='请允许麦克风权限 · 可点击取消';
      if(state==='recording'){$('status').textContent='正在录制麦克风 · 最长 30 秒 · 点击停止后载入';}
    },
    onResult(blob){
      // 录完自动载入并播放（用户要求）：载入完成后再 play，避免与 load 内部的 stop 抢。
      return load(new File([blob],'麦克风采样 · '+new Date().toLocaleTimeString(),{type:blob.type}))
        .then(()=>play())
        .catch(()=>{});
    },
    onError(error){
      const messages={NotAllowedError:'麦克风权限未获允许',NotFoundError:'未找到麦克风',NotReadableError:'麦克风被占用或无法读取'};
      $('status').textContent=(messages[error.name] || error.message)+' · 原音源已保留';
    }
  });
  recordButton.addEventListener('click',async()=>{
    if(recordPreparing)return;
    if(recorder.active){
      if(recordButton.getAttribute('aria-pressed')==='true')recorder.finish();
      else{recorder.cancel();$('status').textContent='已取消录音 · 原音源已保留';}
      return;
    }
    const epoch=++recordEpoch;recordPreparing=true;recordButton.disabled=true;
    ++loadGeneration;loading=false;
    try{await stop();if(epoch===recordEpoch && !document.hidden){recordPreparing=false;recordButton.disabled=false;void recorder.start();}}
    finally{recordPreparing=false;recordButton.disabled=false;}
  });
  function cancelRecording(){++recordEpoch;recorder.cancel();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelRecording();});
  window.addEventListener('pagehide',cancelRecording);
  $('file').addEventListener('change', e => { const file=e.target.files[0]; if(file) load(file); e.target.value=''; });
  $('demo').addEventListener('click', () => load(null));
  document.addEventListener('visibilitychange', () => { if(document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  // Future shared-player entry. Caller owns schedule/end/deactivate of this engine.
  window.exercise = { activate: () => Granular.create(buffer, params, controls.seedValue || seed) };
  // ── iOS 音量 A/B 诊断（刻意保留，不要当调试残留删掉）────────────────────────
  // 目的：定位音量下降发生在「麦克风输入层」还是「Granular DSP 层」。
  //   A = 麦克风 → 直通 destination（不经引擎）
  //   B = 内建素材 → Granular 引擎 → destination
  // 两条路径都经过**同一个 output 增益公式** `10^(volume/20)`，把音量设成相同值再比，
  // 差异就只来自 DSP。真机 Safari 控制台用法：
  //   await __iosAB.start()        // A：开麦直通（★ 请戴耳机，否则会啸叫）
  //   __iosAB.read()               // { path:'raw', gainDb, peakDb, rmsDb }
  //   await __iosAB.engine()       // B：起引擎
  //   __iosAB.read()               // { path:'engine', gainDb, peakDb, rmsDb }
  //   __iosAB.gain(-6)             // 改变音量（两条路径同一公式），量「要补多少 dB」
  //   await __iosAB.stop()
  let abCtx = null, abStream = null, abAnalyser = null, abGain = null, abEngine = null;
  const abDb = x => (x <= 0 ? -99 : +(20 * Math.log10(x)).toFixed(1));
  const abOutputGain = db => 10 ** (Math.max(-24, Math.min(6, db)) / 20);
  const abMeasure = node => {
    const buf = new Float32Array(node.fftSize);
    if (node.getFloatTimeDomainData) node.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / buf.length).toFixed(4) };
  };
  window.__iosAB = {
    async start() {
      await this.stop();
      abCtx = new AudioContext({ latencyHint: 'interactive' });
      await abCtx.resume();
      Granular.setAudioSession?.('play-and-record');
      abStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      abGain = abCtx.createGain(); abGain.gain.value = abOutputGain(params.volume);
      abAnalyser = abCtx.createAnalyser(); abAnalyser.fftSize = 2048;
      abCtx.createMediaStreamSource(abStream).connect(abGain).connect(abAnalyser).connect(abCtx.destination);
      return { path: 'raw', gainDb: params.volume, hint: '戴耳机，否则麦克风会收到扬声器产生啸叫' };
    },
    async engine() {
      if (!abCtx) throw new Error('先 await __iosAB.start()');
      if (abEngine) await abEngine.deactivate();
      const demo = Granular.demo(abCtx);
      abEngine = await Granular.create(demo, params, seed);   // 用同一个 params 引用，gain() 直接生效
      abEngine.schedule();
      return { path: 'engine', gainDb: params.volume };
    },
    read() {
      if (abEngine) { const l = abEngine.levels(); return { path: 'engine', gainDb: params.volume, peakDb: abDb(l.peak), rmsDb: abDb(l.rms) }; }
      if (abAnalyser) { const m = abMeasure(abAnalyser); return { path: 'raw', gainDb: params.volume, peakDb: abDb(m.peak), rmsDb: abDb(m.rms) }; }
      return null;
    },
    gain(db) {
      const next = Math.max(-24, Math.min(6, db));
      params.volume = next; displayParameters();
      if (abGain) abGain.gain.setTargetAtTime(abOutputGain(next), abCtx.currentTime, .03);   // 与引擎同步的平滑
      return next;
    },
    async stop() {
      if (abEngine) { await abEngine.deactivate(); abEngine = null; }
      abStream?.getTracks().forEach(t => t.stop());
      abAnalyser?.disconnect(); abGain?.disconnect();
      if (abCtx && abCtx.state !== 'closed') await abCtx.close();
      abStream = null; abAnalyser = null; abGain = null; abCtx = null;
      Granular.setAudioSession?.('playback');
      return 'stopped';
    },
  };

  function draw() {
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
    const width=Math.round(rect.width*dpr), height=Math.round(rect.height*dpr);
    if(canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
    paint.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;
    paint.clearRect(0,0,w,h);
    // 浮在摄像头窗口底部，无背景：只画粒子与取样位置，不画网格与底纹。
    // 波形按窗口内峰值归一化（参考实现的 WAVE_AUTO_GAIN）：麦克风原始电平常只有
    // ±0.2~0.4，按 ±1 直画会又小又平、小声时几乎看不见。WAVE_FLOOR 兜底，
    // 免得安静时把底噪放大成满屏。
    const scaleFor = raw => {
      const dt = waveDrawTime === null ? 16 : Math.max(0, Math.min(100, performance.now() - waveDrawTime));
      waveDrawTime = performance.now();
      // 只平滑显示增益，不改录音数据：遇强音较快收幅，安静后缓慢恢复。
      const smoothing = 1 - Math.exp(-dt / (raw > waveDisplayPeak ? 400 : 1600));
      waveDisplayPeak += (raw - waveDisplayPeak) * smoothing;
      return 1 / Math.max(WAVE_FLOOR, waveDisplayPeak);
    };
    const live=recorder.waveform();
    if(live){
      // ★ 录制中的波形必须与**采样波形同构**：按位置分列、随录制从左向右累积。
      //   画 analyser 的 43ms 滚动窗口是「时间轴」，而 pad 的 起点/终点 指的是
      //   采样位置 0–100%：两者语义不同，播放头就永远对不上。
      const cols=recorder.columns();
      if(cols){
        let peakAbs=0;
        for(let i=0;i<cols.have.length;i++){ if(!cols.have[i])continue;
          const a=Math.max(Math.abs(cols.mins[i]),Math.abs(cols.maxs[i])); if(a>peakAbs)peakAbs=a; }
        const scale=scaleFor(peakAbs);
        const colW=w/cols.have.length;
        paint.fillStyle='#ed5b2a';paint.globalAlpha=.9;
        for(let i=0;i<cols.have.length;i++){
          if(!cols.have[i])continue;                       // 尚未录到的列不画
          const hi=Math.max(-1,Math.min(1,cols.maxs[i]*scale)), lo=Math.max(-1,Math.min(1,cols.mins[i]*scale));
          paint.fillRect(i*colW,h/2-hi*h*.42,colW,Math.max(1,(hi-lo)*h*.42));
        }
        paint.globalAlpha=1;
        // 播放头与采样波形用同一个换算：同一个位置量 → 同一处像素
        paint.strokeStyle='#ffd9c6aa';paint.lineWidth=1;paint.beginPath();
        paint.moveTo(params.position*w,2);paint.lineTo(params.position*w,h-2);paint.stroke();
        paint.fillStyle='#ed5b2a';paint.font='11px monospace';
        paint.fillText('REC / LIVE INPUT',14,h-6);
        requestAnimationFrame(draw);return;
      }
    }
    waveDrawTime=null;   // 回到采样波形时重置平滑状态，避免把录音期的高增益带过来
    // 实时输入：与 pad 的「较早 / 刚刚」同轴——liveSource.peaks() 就是 8 秒环形窗的概貌
    // （每 80ms 重算一次，不逐帧重算）。
    if(liveSource && performance.now()-lastLivePaint>80){
      peaks=liveSource.peaks();lastLivePaint=performance.now();
      $('duration').textContent=liveSource.duration.toFixed(2)+' / 8 s';
    }
    const viewDuration=liveSource ? Math.max(.001,liveSource.duration) : buffer.duration;
    // 采样波形同样归一化：录进来的声音小一点时，按 ±1 直画几乎看不出波动。
    let peakAbs=0;
    for(const [min,max] of peaks){const a=Math.max(Math.abs(min),Math.abs(max));if(a>peakAbs)peakAbs=a;}
    drawScale=Math.min(DRAW_MAX_SCALE,1/Math.max(WAVE_FLOOR,peakAbs));
    const colW=Math.max(1,w/peaks.length);
    paint.fillStyle='#d8dcd2';paint.globalAlpha=.85;
    peaks.forEach(([min,max],i)=>{
      const hi=Math.max(-1,Math.min(1,max*drawScale)), lo=Math.max(-1,Math.min(1,min*drawScale));
      const top=h/2-hi*h*.42, barH=Math.max(1,(hi-lo)*h*.42);
      paint.fillRect(i*colW,top,colW,barH);
    });
    paint.globalAlpha=1;
    // 取样位置竖线
    paint.strokeStyle='#e0e5d9aa';paint.lineWidth=1;paint.beginPath();paint.moveTo(params.position*w,2);paint.lineTo(params.position*w,h-2);paint.stroke();
    if(engine) for(const e of engine.events){
      const age=engine.time-e.when;
      if(age<0 || age>=e.length) continue;
      const envelope=Math.sin(Math.PI*age/e.length)**2;
      // 实时素材是滚动窗口：事件记的是它当时的窗口坐标，用 origin 差换算回当前窗口。
      const offset=e.offset+(liveSource ? e.origin-liveSource.origin : 0);
      const position=e.reverse?offset+(e.length-age)*e.rate:offset+age*e.rate;
      const x=position/viewDuration*w, y=h/2+e.pan*h*.42;
      paint.globalAlpha=envelope;paint.fillStyle=e.reverse?'#f37944':'#e0e5d9';
      const a=offset/viewDuration*w, length=e.length*e.rate/viewDuration*w;
      // 粒子读数条 1px、端点 r=2：2px 线与 r=3 的端点在手机上会糊成一片。
      paint.fillRect(a,y-.5,Math.max(1,length),1);paint.beginPath();paint.arc(x,y,2,0,Math.PI*2);paint.fill();
    }
    paint.globalAlpha=1; requestAnimationFrame(draw);
  }
  analyse(); requestAnimationFrame(draw);
})();
