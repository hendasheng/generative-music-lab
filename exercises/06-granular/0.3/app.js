(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const controls = document.querySelector('exercise-controls');
  const params = { ...Granular.defaults };
  const pad=$('xyPad'), dot=$('xyDot');
  function syncXY() {
    const point=Granular.toXY(params);
    dot.style.left=(point.x*100)+'%';dot.style.top=(point.y*100)+'%';
    const text='位置 '+Math.round(params.position*100)+'% · 散布 ±'+Math.round(params.spray*100)+'% · 倒放 '+Math.round(params.reverse*100)+'%';
    $('xyDescription').textContent=text;
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
    flowButton.setAttribute('aria-pressed','false');flowButton.textContent='自由流动';
  }
  function toggleFlow() {
    if(flow){stopFlow();return;}
    flow=FreeFlow.create(params,controls.seedValue || seed);
    lastFlowTime=performance.now();
    flowButton.setAttribute('aria-pressed','true');flowButton.textContent='自由流动 · 开';
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
    const div = document.createElement('div'); div.className = 'parameter';
    div.innerHTML = `<label for="p-${key}">${label}<output></output></label><small>${en}</small><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
    $(key==='reverb' || key==='volume'?'outputParameters':'parameters').append(div);
    const input = div.querySelector('input'), output = div.querySelector('output');
    fields[key] = { input, output, format, min, max, div };
    output.textContent = format(params[key]);
    input.addEventListener('pointerdown',()=>{stopFlow();editing=key;});
    for(const name of ['pointerup','pointercancel','lostpointercapture','blur']) input.addEventListener(name,()=>{if(editing===key)editing=null;});
    input.addEventListener('input', () => setParam(key, +input.value));
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
  function analyse() {
    const data = buffer.getChannelData(0); peaks = [];
    for (let x = 0; x < 1000; x++) {
      let min = 0, max = 0;
      for (let i = Math.floor(x*data.length/1000); i < Math.floor((x+1)*data.length/1000); i++) { min=Math.min(min,data[i]); max=Math.max(max,data[i]); }
      peaks.push([min,max]);
    }
    $('duration').textContent = buffer.duration.toFixed(2)+' s';
  }
  async function stop() {
    stopFlow();
    ++generation; starting = false;
    const previous = engine; engine = null;
    controls.setPlaying(false); controls.setBusy(loading);
    $('status').textContent = '已停止 · 再次播放从同一随机序列开始';
    if (previous) await previous.deactivate();
  }
  async function play() {
    if (engine || starting || loading || recorder.active || recordPreparing) return;
    const ticket = ++generation; starting = true; controls.setBusy(true);
    try {
      const created = await Granular.create(buffer, params, seed);
      if (ticket !== generation) { await created.deactivate(); return; }
      engine = created; engine.schedule(); controls.setPlaying(true);
      $('status').textContent = '播放中 · 种子 '+seed;
    } catch (error) { if (ticket === generation) $('status').textContent = '无法启动音频：'+error.message; }
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
      const busy=state!=='idle';
      controls.setBusy(busy || loading);$('demo').disabled=busy;$('file').disabled=busy;
      recordButton.disabled=state==='processing';
      recordButton.setAttribute('aria-pressed',String(state==='recording'));
      recordButton.textContent=state==='requesting'?'取消授权等待':state==='recording'?'停止 · '+seconds.toFixed(1)+' / 30s':state==='processing'?'处理中…':'录制采样 · 30s';
      if(state==='requesting')$('status').textContent='请允许麦克风权限 · 可点击取消';
      if(state==='recording')$('status').textContent='正在录制麦克风 · 最长 30 秒 · 点击停止后载入';
    },
    onResult(blob){return load(new File([blob],'麦克风采样 · '+new Date().toLocaleTimeString(),{type:blob.type}));},
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
  function draw() {
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
    const width=Math.round(rect.width*dpr), height=Math.round(rect.height*dpr);
    if(canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
    paint.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;
    paint.clearRect(0,0,w,h);
    paint.strokeStyle='#393939'; paint.lineWidth=1;
    for(let i=1;i<8;i++){paint.beginPath();paint.moveTo(i*w/8,22);paint.lineTo(i*w/8,h-22);paint.stroke();}
    const live=recorder.waveform();
    if(live){
      paint.strokeStyle='#ed5b2a';paint.lineWidth=1.5;paint.beginPath();
      for(let i=0;i<live.length;i++){
        const x=i/(live.length-1)*w,y=h/2-Math.max(-1,Math.min(1,live[i]))*h*.42;
        if(i===0)paint.moveTo(x,y);else paint.lineTo(x,y);
      }
      paint.stroke();paint.fillStyle='#ed5b2a';paint.font='11px monospace';
      paint.fillText('REC / LIVE INPUT',14,22);
      requestAnimationFrame(draw);return;
    }
    paint.fillStyle='#969a95';
    peaks.forEach(([min,max],i)=>paint.fillRect(i*w/peaks.length,h/2-max*h*.32,Math.max(1,w/peaks.length),Math.max(1,(max-min)*h*.32)));
    paint.fillStyle='#e2e2db12';
    const effective=params;
    const left=Math.max(0,effective.position-effective.spray),right=Math.min(1,effective.position+effective.spray);
    paint.fillRect(left*w,20,(right-left)*w,h-40);
    paint.strokeStyle='#e0e5d9';paint.beginPath();paint.moveTo(effective.position*w,18);paint.lineTo(effective.position*w,h-18);paint.stroke();
    if(engine) for(const e of engine.events){
      const age=engine.time-e.when;
      if(age<0 || age>=e.length) continue;
      const envelope=Math.sin(Math.PI*age/e.length)**2;
      const position=e.reverse?e.offset+(e.length-age)*e.rate:e.offset+age*e.rate;
      const x=position/buffer.duration*w, y=h/2+e.pan*h*.38;
      paint.globalAlpha=envelope;paint.fillStyle=e.reverse?'#f37944':'#e0e5d9';
      const a=e.offset/buffer.duration*w, length=e.length*e.rate/buffer.duration*w;
      paint.fillRect(a,y-1,Math.max(1,length),2);paint.beginPath();paint.arc(x,y,3,0,Math.PI*2);paint.fill();
    }
    paint.globalAlpha=1; requestAnimationFrame(draw);
  }
  analyse(); requestAnimationFrame(draw);
})();
