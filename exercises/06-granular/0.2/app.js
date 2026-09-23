(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const controls = document.querySelector('exercise-controls');
  const params = { ...Granular.defaults };
  const morph = {x:.5,y:.5};
  const pad=$('morphPad'), dot=$('morphDot');
  function setMorph(x,y) {
    morph.x=Math.max(0,Math.min(1,x)); morph.y=Math.max(0,Math.min(1,y));
    dot.style.left=(morph.x*100)+'%';dot.style.top=(morph.y*100)+'%';
    const names=['Reverse','Gater','Chorus','Scatter'];
    const levels=Granular.strengths(morph.x,morph.y);
    $('morphDescription').textContent=levels.some(v=>v>.005)?levels.map((v,i)=>v>.005?names[i]+' '+Math.round(v*100)+'%':null).filter(Boolean).join(' · '):'中央 · 基础声音';
    pad.setAttribute('aria-label','XY 音色控制：'+$('morphDescription').textContent+'。方向键移动，Home 回中央');
  }
  let pointer=null;
  function moveMorph(e) {
    const r=pad.getBoundingClientRect();
    if(r.width && r.height) setMorph((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);
  }
  function releaseMorph(e) {
    if(e && e.pointerId!==undefined && e.pointerId!==pointer) return;
    const previous=pointer; pointer=null;
    try {if(previous!==null && pad.hasPointerCapture(previous)) pad.releasePointerCapture(previous);} catch (_) {}
  }
  pad.addEventListener('pointerdown',e=>{
    if(e.button!==0 || e.isPrimary===false) return;
    // A new primary press is authoritative, even if the previous release was lost.
    releaseMorph(); pointer=e.pointerId; e.preventDefault();
    pad.focus({preventScroll:true});
    try {pad.setPointerCapture(pointer);} catch (_) { /* window listeners remain active */ }
    moveMorph(e);
  });
  window.addEventListener('pointermove',e=>{
    if(e.pointerId!==pointer) return;
    if(e.pointerType==='mouse' && !(e.buttons&1)) {releaseMorph(e);return;}
    e.preventDefault(); moveMorph(e);
  },{passive:false});
  for(const name of ['pointerup','pointercancel']) window.addEventListener(name,releaseMorph);
  pad.addEventListener('lostpointercapture',releaseMorph);
  window.addEventListener('blur',()=>{releaseMorph();editing=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseMorph();editing=null;}});
  pad.addEventListener('dragstart',e=>e.preventDefault());
  // Native text drags near the thin sliders show a no-drop cursor and block all
  // dragging until they end; the page has no drop targets, so block drags outright.
  document.addEventListener('dragstart',e=>e.preventDefault());
  pad.addEventListener('keydown',e=>{const d=e.shiftKey?.1:.025;if(e.key==='Home'){e.preventDefault();setMorph(.5,.5);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setMorph(morph.x+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0),morph.y+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0));}});
  $('centerMorph').addEventListener('click',()=>setMorph(.5,.5));
  setMorph(.5,.5);
  const specs = [
    ['position','取样位置','POSITION',0,1,.001,v => Math.round(v*100)+'%'],
    ['size','粒子长度','GRAIN SIZE',15,1000,1,v => Math.round(v)+' ms'],
    ['density','密度','DENSITY',2,60,1,v => Number(v.toFixed(1))+' /s'],
    ['pitch','音高','PITCH',-24,24,1,v => (v>0?'+':'')+Number(v.toFixed(2))+' st'],
    ['spray','位置散布','SPRAY',0,.5,.001,v => '±'+Math.round(v*100)+'%'],
    ['pan','立体声散布','STEREO SPREAD',0,1,.01,v => Math.round(v*100)+'%'],
    ['reverse','倒放概率','REVERSE',0,1,.01,v => Math.round(v*100)+'%']
  ];
  const fields = {};
  const displayLimits={size:[8.25,2500],density:[1.5,108],pitch:[-36.3,48.3]};
  let editing=null;
  function pitchRange(base) {
    const [reverse,,chorus,scatter]=Granular.strengths(morph.x,morph.y);
    return [base-(scatter>0?12:0)-.3*chorus,base+(reverse>0?12:0)+(scatter>0?12:0)+.3*chorus];
  }
  function sliderValue(key,base,time) {
    if(key==='pitch') {const [lo,hi]=pitchRange(base);return (lo+hi)/2;}
    return Granular.effective({...params,[key]:base},morph,time)[key];
  }
  function editEffective(key,target) {
    const field=fields[key],time=engine?engine.elapsed:0;
    // Invert the monotone macro mapping so moving the displayed thumb does not
    // apply the same modulation twice or overwrite unrelated base parameters.
    let low=field.min,high=field.max;
    if(target<=sliderValue(key,low,time)) high=low;
    else if(target>=sliderValue(key,high,time)) low=high;
    else for(let i=0;i<40;i++) {const mid=(low+high)/2;if(sliderValue(key,mid,time)<target) low=mid;else high=mid;}
    setParam(key,(low+high)/2);
  }
  for (const [key,label,en,min,max,step,format] of specs) {
    const div = document.createElement('div'); div.className = 'parameter';
    div.innerHTML = `<label for="p-${key}">${label}<output></output></label><small>${en}<span class="base-value"></span></small><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
    $('parameters').append(div);
    const input = div.querySelector('input'), output = div.querySelector('output');
    fields[key] = { input, output, format, min, max, base: div.querySelector('.base-value'), div };
    const limits=displayLimits[key] || [min,max];input.min=limits[0];input.max=limits[1];input.step='any'; output.textContent = format(params[key]);
    input.addEventListener('pointerdown',()=>{editing=key;});
    for(const name of ['pointerup','pointercancel','lostpointercapture','blur']) input.addEventListener(name,()=>{if(editing===key)editing=null;});
    input.addEventListener('input', () => editEffective(key, +input.value));
  }
  function setParam(key,value) {
    params[key] = value;
    displayParameters(engine?engine.settings:Granular.effective(params,morph));
    if (key === 'position') $('positionSurface').value = value;
  }
  function displayParameters(settings) {
    const [reverse,,chorus,scatter]=Granular.strengths(morph.x,morph.y);
    for(const [key,field] of Object.entries(fields)) {
      let value=field.format(settings[key]);
      let thumb=settings[key];
      let changed=Math.abs(settings[key]-params[key])>1e-6;
      if(key==='pitch') {
        // Pitch is sampled separately for each grain: show its possible range,
        // not an invented average or an extra draw from the audio random stream.
        const [low,high]=pitchRange(params.pitch);
        thumb=(low+high)/2;
        changed=high-low>1e-6;
        value=changed?field.format(low)+' ~ '+field.format(high):field.format(params.pitch);
      }
      if(editing!==key) field.input.value=thumb;
      field.input.setAttribute('aria-valuetext',value+(key==='pitch' && changed?'，滑块位于范围中心':''));
      if(field.output.textContent!==value) field.output.textContent=value;
      field.base.textContent='基础 '+field.format(params[key]);
      field.div.classList.toggle('modulated',changed);
      field.output.title=key==='pitch' && changed?'逐颗粒子的随机音高范围；滑块表示范围中心':'XY 调制后的当前值';
    }
  }
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
    ++generation; starting = false;
    const previous = engine; engine = null;
    controls.setPlaying(false); controls.setBusy(loading);
    $('status').textContent = '已停止 · 再次播放从同一随机序列开始';
    if (previous) await previous.deactivate();
  }
  async function play() {
    if (engine || starting || loading) return;
    const ticket = ++generation; starting = true; controls.setBusy(true);
    try {
      const created = await Granular.create(buffer, params, seed, morph);
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
    const ticket = ++loadGeneration; loading=true; await stop();
    $('status').textContent = '正在读取音源…';
    try {
      if (file && file.size > 40*1024*1024) throw new Error('请选择小于 40 MB 的音频');
      const decoded = file ? await decoder.decodeAudioData(await file.arrayBuffer()) : Granular.demo(decoder);
      if (ticket !== loadGeneration) return;
      const length = Math.min(decoded.length, Math.floor(decoded.sampleRate*30));
      const selected = decoder.createBuffer(Math.min(2,decoded.numberOfChannels),length,decoded.sampleRate);
      for (let c=0;c<selected.numberOfChannels;c++) selected.copyToChannel(decoded.getChannelData(c).subarray(0,length),c);
      buffer=selected; analyse();
      $('sampleName').textContent=file ? file.name : '内置音源 · 谐波片段';
      $('status').textContent=(decoded.duration>30?'已取前 30 秒':'音源已就绪')+' · 点击播放';
    } catch (error) { if (ticket===loadGeneration) $('status').textContent='导入失败，原音源已保留：'+error.message; }
    finally { if (ticket===loadGeneration) { loading=false; controls.setBusy(false); } }
  }
  $('file').addEventListener('change', e => { const file=e.target.files[0]; if(file) load(file); e.target.value=''; });
  $('demo').addEventListener('click', () => load(null));
  document.addEventListener('visibilitychange', () => { if(document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  // Future shared-player entry. Caller owns schedule/end/deactivate of this engine.
  window.exercise = { activate: () => Granular.create(buffer, params, controls.seedValue || seed, morph) };
  function draw() {
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
    const width=Math.round(rect.width*dpr), height=Math.round(rect.height*dpr);
    if(canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
    paint.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;
    paint.clearRect(0,0,w,h);
    paint.strokeStyle='#393939'; paint.lineWidth=1;
    for(let i=1;i<8;i++){paint.beginPath();paint.moveTo(i*w/8,22);paint.lineTo(i*w/8,h-22);paint.stroke();}
    paint.fillStyle='#969a95';
    peaks.forEach(([min,max],i)=>paint.fillRect(i*w/peaks.length,h/2-max*h*.32,Math.max(1,w/peaks.length),Math.max(1,(max-min)*h*.32)));
    paint.fillStyle='#e2e2db12';
    const effective=engine?engine.settings:Granular.effective(params,morph);
    displayParameters(effective);
    const left=Math.max(0,effective.position-effective.spray),right=Math.min(1,effective.position+effective.spray);
    paint.fillRect(left*w,20,(right-left)*w,h-40);
    paint.strokeStyle='#e0e5d9';paint.beginPath();paint.moveTo(effective.position*w,18);paint.lineTo(effective.position*w,h-18);paint.stroke();
    if(engine) for(const e of engine.events){
      const age=engine.time-e.when;
      if(age<0 || age>=e.length) continue;
      const envelope=Math.sin(Math.PI*age/e.length)**2;
      const position=e.reverse?e.offset+(e.length-age)*e.rate:e.offset+age*e.rate;
      const x=position/buffer.duration*w, y=h/2+e.pan*h*.38;
      paint.globalAlpha=envelope*engine.gateLevel;paint.fillStyle=e.reverse?'#f37944':'#e0e5d9';
      const a=e.offset/buffer.duration*w, length=e.length*e.rate/buffer.duration*w;
      paint.fillRect(a,y-1,Math.max(1,length),2);paint.beginPath();paint.arc(x,y,3,0,Math.PI*2);paint.fill();
    }
    paint.globalAlpha=1; requestAnimationFrame(draw);
  }
  analyse(); requestAnimationFrame(draw);
})();
