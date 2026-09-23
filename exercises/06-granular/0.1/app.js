(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const controls = document.querySelector('exercise-controls');
  const params = { ...Granular.defaults };
  const specs = [
    ['position','取样位置','POSITION',0,1,.001,v => Math.round(v*100)+'%'],
    ['size','粒子长度','GRAIN SIZE',15,1000,1,v => Math.round(v)+' ms'],
    ['density','密度','DENSITY',2,60,1,v => v+' /s'],
    ['pitch','音高','PITCH',-24,24,1,v => (v>0?'+':'')+v+' st'],
    ['spray','位置散布','SPRAY',0,.5,.001,v => '±'+Math.round(v*100)+'%'],
    ['pan','立体声散布','STEREO SPREAD',0,1,.01,v => Math.round(v*100)+'%'],
    ['reverse','倒放概率','REVERSE',0,1,.01,v => Math.round(v*100)+'%']
  ];
  const fields = {};
  for (const [key,label,en,min,max,step,format] of specs) {
    const div = document.createElement('div'); div.className = 'parameter';
    div.innerHTML = `<label for="p-${key}">${label}<output></output></label><small>${en}</small><input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
    $('parameters').append(div);
    const input = div.querySelector('input'), output = div.querySelector('output');
    fields[key] = { input, output, format }; output.textContent = format(params[key]);
    input.addEventListener('input', () => setParam(key, +input.value));
  }
  function setParam(key,value) {
    params[key] = value; fields[key].input.value = value;
    fields[key].output.textContent = fields[key].format(value);
    if (key === 'position') $('positionSurface').value = value;
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
  window.exercise = { activate: () => Granular.create(buffer, params, controls.seedValue || seed) };
  function draw() {
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
    const width=Math.round(rect.width*dpr), height=Math.round(rect.height*dpr);
    if(canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
    paint.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;
    paint.clearRect(0,0,w,h);
    paint.strokeStyle='#273222'; paint.lineWidth=1;
    for(let i=1;i<8;i++){paint.beginPath();paint.moveTo(i*w/8,22);paint.lineTo(i*w/8,h-22);paint.stroke();}
    paint.fillStyle='#9fb58b';
    peaks.forEach(([min,max],i)=>paint.fillRect(i*w/peaks.length,h/2-max*h*.32,Math.max(1,w/peaks.length),Math.max(1,(max-min)*h*.32)));
    paint.fillStyle='#c8ef9810';
    const left=Math.max(0,params.position-params.spray),right=Math.min(1,params.position+params.spray);
    paint.fillRect(left*w,20,(right-left)*w,h-40);
    paint.strokeStyle='#d4ef9e';paint.beginPath();paint.moveTo(params.position*w,18);paint.lineTo(params.position*w,h-18);paint.stroke();
    if(engine) for(const e of engine.events){
      const age=engine.time-e.when;
      if(age<0 || age>=e.length) continue;
      const envelope=Math.sin(Math.PI*age/e.length)**2;
      const position=e.reverse?e.offset+(e.length-age)*e.rate:e.offset+age*e.rate;
      const x=position/buffer.duration*w, y=h/2+e.pan*h*.38;
      paint.globalAlpha=envelope;paint.fillStyle=e.reverse?'#e9b28e':'#d4ef9e';
      const a=e.offset/buffer.duration*w, length=e.length*e.rate/buffer.duration*w;
      paint.fillRect(a,y-1,Math.max(1,length),2);paint.beginPath();paint.arc(x,y,3,0,Math.PI*2);paint.fill();
    }
    paint.globalAlpha=1; requestAnimationFrame(draw);
  }
  analyse(); requestAnimationFrame(draw);
})();
