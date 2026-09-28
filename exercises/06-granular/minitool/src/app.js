(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // ★ 主色调（橙色族）只有一个来源：style.css 的 :root 里的 --accent 族（见那边的注释）。
  // 画布（Canvas 2D）读不了 CSS 变量，所以在这里启动时读一次；改颜色只改 CSS，不用动这里。
  // 括号里的十六进制只是「变量读不到时」的兜底，正常永远不会用到。
  const rootStyle=getComputedStyle(document.documentElement);
  const themeColor=(name,fallback)=>{const v=rootStyle.getPropertyValue(name).trim();return v||fallback;};
  const ACCENT=themeColor('--accent','#ed5b2a');              // 录音波形柱 / 'REC / LIVE INPUT' 文字
  const ACCENT_REVERSE=themeColor('--accent-reverse',ACCENT); // 倒放粒子
  const ACCENT_SOFT=themeColor('--accent-soft',ACCENT);       // 录制中的播放头
  const controls = document.querySelector('exercise-controls');
  const params = Object.assign({}, Granular.defaults);
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
  // 拖尾：控制点后面拖一条**连续的、由头部向尾部逐渐变细变淡的带子**。
  // · pad 是 DOM，圆点做不出连续带子，所以给 pad 加一块 canvas；canvas 插在 #xyDot
  //   之前，控制点仍然画在带子上面。
  // · 采样点取 `Granular.toXY(params)`（圆点钳制后的实际位置），不是原始手指坐标：
  //   手指滑出 pad 时圆点贴边，带子必须跟着贴边，不能跑到 pad 外面。
  // · 每次指针移动即时重画（不依赖 rAF：无头里 rAF 被节流到 ~500ms，靠帧更新就量不到）；
  //   rAF 负责手指停住/松手后的衰减 —— 样本按时间过期，带子自然缩回控制点。
  // ★ 画法：**沿路径算出左右边界，填成一个多边形**（一次 fill），不是分段描边。
  //   第一版分段描边（每段自己的线宽与透明度 + lineCap:round）会在每段端头露出一颗颗
  //   胶囊，用户一眼就看出「一个一个圆点」—— 描边的端帽和段间透明度差就是那些点。
  //   填充多边形没有端帽、没有接缝；变细靠边界的宽度剖面，变淡靠一条沿带子的线性渐变。
  const TRAIL_MS=650, TRAIL_MAX=400;
  const trailCanvas=document.createElement('canvas');
  trailCanvas.className='xy-trail';trailCanvas.setAttribute('aria-hidden','true');
  const trailCtx=trailCanvas.getContext('2d');
  pad.insertBefore(trailCanvas,dot);
  const trail=[];let trailPainted=false;
  // 渐变要按颜色给透明度，而 --accent 用户可以写 hex 也可以写 rgb()：这里统一转成 rgba。
  function withAlpha(color,alpha){
    const s=String(color).trim();
    let r=237,g=91,b=42;
    const hex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if(hex){let h=hex[1];if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      r=parseInt(h.slice(0,2),16);g=parseInt(h.slice(2,4),16);b=parseInt(h.slice(4,6),16);}
    else{const m=/^rgba?\(([^)]+)\)$/.exec(s);
      if(m){const p=m[1].split(/[\s,/]+/).map(Number);if(p.length>=3){r=p[0];g=p[1];b=p[2];}}}
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }
  function paintTrail(now=performance.now()){
    while(trail.length && now-trail[0].t>TRAIL_MS) trail.shift();
    if(trail.length>TRAIL_MAX) trail.splice(0,trail.length-TRAIL_MAX);
    const padRect=pad.getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio||1,2);
    const W=Math.max(1,Math.round(padRect.width*dpr)), H=Math.max(1,Math.round(padRect.height*dpr));
    if(trailCanvas.width!==W||trailCanvas.height!==H){trailCanvas.width=W;trailCanvas.height=H;}
    if(!trail.length){
      if(trailPainted){trailCtx.setTransform(1,0,0,1,0,0);trailCtx.clearRect(0,0,W,H);trailPainted=false;}
      return;
    }
    trailCtx.setTransform(dpr,0,0,dpr,0,0);
    trailCtx.clearRect(0,0,padRect.width,padRect.height);
    trailPainted=true;
    const n=trail.length;
    const pts=trail.map(s=>({x:s.x*padRect.width,y:s.y*padRect.height}));
    const dotW0=dot.getBoundingClientRect().width||13;
    if(n<2){                                  // 只有一个样本：画一个圆头就够（按住不动时与控制点重合）
      trailCtx.fillStyle=withAlpha(ACCENT,.5);
      trailCtx.beginPath();trailCtx.arc(pts[0].x,pts[0].y,dotW0/2,0,Math.PI*2);trailCtx.fill();
      return;
    }
    // 采样点稀疏时折线有硬拐角，先做两遍 3 点平滑；头（最新样本）固定不动，带子必须贴着控制点
    for(let pass=0;pass<2;pass++){
      for(let i=1;i<n-1;i++){
        pts[i].x=(pts[i-1].x+pts[i].x*2+pts[i+1].x)/4;
        pts[i].y=(pts[i-1].y+pts[i].y*2+pts[i+1].y)/4;
      }
    }
    // ★ 采样点之间用 Catmull-Rom 插值成密集路径（每 ~3px 一个点）再算边界：
    //   直接连折线一定有硬折角，加几遍平滑也去不掉"一段一段直"的观感。
    const dense=resamplePath(pts,3);
    const m=dense.length;
    // ★ 头部宽度跟着**控制点当前直径**走（按住时它已经放大到 1.5 / 2.5 倍）：
    //   固定头宽会变成"大圆头 + 细尾巴"的蝌蚪。尾部收到 0，指数 0.9 让靠头的部分保持厚一点。
    const dotW=dotW0;
    const halfW=i=>Math.max(.35,(dotW/2)*Math.pow(i/(m-1),.9));
    const left=[],right=[];
    for(let i=0;i<m;i++){
      const a=dense[Math.max(0,i-1)],b=dense[Math.min(m-1,i+1)],p=dense[i];
      let dx=b.x-a.x,dy=b.y-a.y;const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
      const w=halfW(i);
      left.push({x:p.x-dy*w,y:p.y+dx*w});
      right.push({x:p.x+dy*w,y:p.y-dx*w});
    }
    const grad=trailCtx.createLinearGradient(dense[m-1].x,dense[m-1].y,dense[0].x,dense[0].y);
    grad.addColorStop(0,withAlpha(ACCENT,.5));     // 头：实
    grad.addColorStop(.45,withAlpha(ACCENT,.18));
    grad.addColorStop(1,withAlpha(ACCENT,0));      // 尾：化开
    trailCtx.fillStyle=grad;
    trailCtx.beginPath();
    left.forEach((p,i)=>i?trailCtx.lineTo(p.x,p.y):trailCtx.moveTo(p.x,p.y));
    for(let i=right.length-1;i>=0;i--)trailCtx.lineTo(right[i].x,right[i].y);
    trailCtx.closePath();trailCtx.fill();
  }
  // Catmull-Rom：穿过所有采样点的光滑插值（不是逼近），用来把稀疏样本变成密集路径。
  function resamplePath(pts,step){
    if(pts.length<3)return pts.slice();
    const at=i=>pts[Math.max(0,Math.min(pts.length-1,i))];
    const out=[pts[0]];
    for(let i=0;i<pts.length-1;i++){
      const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2);
      const seg=Math.hypot(p2.x-p1.x,p2.y-p1.y);
      const n=Math.max(2,Math.min(32,Math.round(seg/step)));
      for(let s=1;s<=n;s++){
        const t=s/n,t2=t*t,t3=t2*t;
        out.push({
          x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        });
      }
    }
    return out;
  }
  function moveXY(e) {
    const r=pad.getBoundingClientRect();
    if(r.width && r.height) setXY((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);
    // 每个 move 都采样（折线要连续，不能再按 24ms 抽稀成点）；数量由 TRAIL_MAX 兜底。
    const p=Granular.toXY(params),now=performance.now();
    trail.push({x:p.x,y:p.y,t:now});
    paintTrail(now);
  }
  function releaseXY(e) {
    if(e && e.pointerId!==undefined && e.pointerId!==pointer) return;
    const previous=pointer; pointer=null;
    pad.classList.remove('pressing');   // 松开就把控制点缩回原大小
    pad.classList.remove('pressing-touch');
    try {if(previous!==null && pad.hasPointerCapture(previous)) pad.releasePointerCapture(previous);} catch (_) {}
  }
  pad.addEventListener('pointerdown',e=>{
    if(e.button!==0 || e.isPrimary===false) return;
    // A new primary press is authoritative, even if the previous release was lost.
    releaseXY(); pointer=e.pointerId; e.preventDefault();
    trail.length=0;                     // 新的一次拖动从空白开始，不接上一段的尾巴
    // 按住 pad 时控制点放大（CSS：.xy-pad.pressing #xyDot / …pressing-touch 再放大一档）。
    // 类挂在这里、由 releaseXY() 统一摘掉 —— 它已经接在 pointerup/pointercancel/
    // lostpointercapture/blur/切后台这些出口上，不会出现「松手了还放大着」。
    // 手指要更大一档：手指肚会盖住小圆点，跟鼠标同一个尺寸在真机上根本看不见。
    pad.classList.add('pressing');
    pad.classList.toggle('pressing-touch', e.pointerType === 'touch');
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
  // 点击 pad 不该长出焦点描边（用户要求），但**键盘操作时必须保留**（pad 支持方向键与空格，
  // 没有焦点环就没法用键盘）。只靠 `:focus-visible` 不够：Safari 会把手指点出来的焦点也判成
  // :focus-visible。所以记一个「最近一次交互是不是指针」，由它决定要不要挂 .pointer-focus，
  // CSS 那条规则（`.xy-pad.pointer-focus:focus{outline:none}`）只在挂上时把环关掉。
  // ★ 直接在 pointerdown / keydown 上切类，**不要挂在 focus 事件上**：无头里实测
  //   `document.activeElement` 已经是 pad 了，但 pad 的 focus 事件一次都没触发（计数 0），
  //   挂在 focus 上的写法在那种环境下完全不生效。类挂着而 pad 没焦点是无害的（CSS 用 :focus 限定）。
  pad.classList.add('pointer-focus');
  window.addEventListener('pointerdown',()=>pad.classList.add('pointer-focus'),true);
  window.addEventListener('keydown',()=>pad.classList.remove('pointer-focus'),true);
  let flow=null,flowTimer=null,lastFlowTime=0,waveHeld=false;
  const flowButton=$('freeFlow');
  // 内置音源号：0 = 谐波片段（首版那一段）。导入文件 / 录音载入的素材不改变它，
  // 所以「随机」永远从内置音源库里挑，不会因为刚录完一段就没得换。
  const sourceButton=$('randomSource');
  let sourceIndex=0;
  // 随机键的**触发状态是状态、不是一次闪光**（用户反馈「只是亮了一下，就又成未触发状态了」）：
  //   --sourceRandom   当前这一段内置素材是「随机键」选的（启动时的 0 号不算）
  //   --materialBuiltin 当前素材是内置音源（导入文件 / 麦克风录音之后就不是了）
  // 两者同时为真 = 图标常亮，直到素材被别的路径换掉（菜单里的「内置音源」重新载入、
  // 导入文件、录完自动载入）才熄灭。这样它和自由流动一样是「一盏灯」，不是一个动作反馈。
  let sourceRandom=false, materialBuiltin=true;
  // 随机键的触发状态：**既是「这段素材是随机选的」，也要在响** ——
  // 从播放切到暂停（stop）时这盏灯要灭（用户要求）。所以判定里带上 engine/starting，
  // 并且 stop() / play() 都要调它（引擎状态变了，灯就得跟着变）。
  function syncSourceMark(){
    const playing=!!engine||starting;
    sourceButton.setAttribute('aria-pressed',String(materialBuiltin&&sourceRandom&&playing));
  }
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
    // 用户要求：点「自由流动」就直接出声（原来只让参数游走，声音要另按播放）。
    // 放在 toggleFlow 里而不是按钮的 click 里：pad 上按空格也走这条路，两个入口必须一致。
    // 关掉流动**不**停声（只是停止游走），所以只有开启这一侧调用。
    void play();
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
      // 双击恢复默认值（Max/MSP、Ableton Live 的惯例：双击旋钮回默认）。
      // 默认值取 Granular.defaults[key] —— 四个常驻旋钮的默认值都是 step 的整数倍
      // （粒子长度 180 / 密度 24 / 立体声散布 0.8 / 音高 0），写回 input 不会吸附跑偏。
      // 走 setParam()：它会停掉自由流动、钳制范围、刷新读数与 --dial-angle、同步 XY 点，
      // 与拖拽走同一条路（不另写一份）。
      input.addEventListener('dblclick',e=>{
        e.preventDefault();
        const fallback=Granular.defaults[key];
        if(!Number.isFinite(fallback))return;
        input.value=fallback;
        setParam(key,+input.value);
      });
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
  // 初始态：还没播、素材也不是随机选的 → 灯灭。（初始调用必须放在 engine/starting 声明之后：
  // syncSourceMark 读这两个 let，放在声明前调用会撞 TDZ。）
  syncSourceMark();
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
  // 本版（0.3.2）去掉实时输入：不再加载 live.js / live-worklet.js，也没有 LIVE 按钮。
  // 引擎的第四个参数 liveSource 恒为 null，走的就是素材路径（引擎本身不变，仍与 0.3 同源）。
  async function stop() {
    analyse();
    if (typeof Granular.setAudioSession === 'function') Granular.setAudioSession('playback');
    stopFlow();
    ++generation; starting = false;
    const previous = engine; engine = null;
    controls.setPlaying(false); controls.setBusy(loading);
    syncSourceMark();                     // 播放→暂停：随机键的灯跟着灭（用户要求）
    $('status').textContent = '已停止 · 再次播放从同一随机序列开始';
    if (previous) await previous.deactivate();
  }
  async function play() {
    if (engine || starting || loading || recorder.active || recordPreparing) return;
    if (typeof Granular.setAudioSession === 'function') Granular.setAudioSession('playback');
    const ticket = ++generation; starting = true; controls.setBusy(true);
    try {
      const created = await Granular.create(buffer, params, seed);
      if (ticket !== generation) { await created.deactivate(); return; }
      engine = created; engine.schedule(); controls.setPlaying(true);
      syncSourceMark();                   // 又开始响了：若素材仍是随机选的，灯重新亮
      $('status').textContent = '播放中 · 种子 '+seed;
    } catch (error) { if (ticket === generation) { await stop(); $('status').textContent='无法启动音频：'+error.message; } }
    finally { if (ticket === generation) { starting=false; controls.setBusy(false); } }
  }
  controls.addEventListener('exercise-play', () => { seed=controls.seedValue || seed; play(); });
  controls.addEventListener('exercise-stop', stop);
  controls.addEventListener('exercise-seed-apply', async () => { seed=controls.seedValue || 'grain-01'; await stop(); play(); });
  controls.addEventListener('exercise-regenerate', async () => {
    seed=crypto.getRandomValues(new Uint32Array(1))[0].toString(36); controls.clearSeed(); await stop(); play();
  });
  async function load(file, source = sourceIndex) {
    recorder.cancel();
    const ticket = ++loadGeneration; loading=true; await stop();
    $('status').textContent = '正在读取音源…';
    try {
      if (file && file.size > 40*1024*1024) throw new Error('请选择小于 40 MB 的音频');
      const decoded = file ? await decoder.decodeAudioData(await file.arrayBuffer()) : Granular.demo(decoder, source);
      if (ticket !== loadGeneration) return;
      const length = Math.min(decoded.length, Math.floor(decoded.sampleRate*30));
      const selected = decoder.createBuffer(Math.min(2,decoded.numberOfChannels),length,decoded.sampleRate);
      for (let c=0;c<selected.numberOfChannels;c++) selected.copyToChannel(decoded.getChannelData(c).subarray(0,length),c);
      buffer=selected; params.spray=Granular.defaultSpray(buffer.duration); displayParameters();syncXY();analyse();
      if (file) { materialBuiltin=false; $('sampleName').textContent=file.name; }
      else { sourceIndex=source; materialBuiltin=true; $('sampleName').textContent='内置音源 · '+Granular.demoNames[source]; }
      sourceButton.setAttribute('aria-label','随机内置音源（当前：'+$('sampleName').textContent+'）');
      syncSourceMark();
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
      if (typeof Granular.setAudioSession === 'function') Granular.setAudioSession(state==='recording' || state==='requesting' ? 'play-and-record' : 'playback');
      const busy=state!=='idle';
      controls.setBusy(busy || loading);$('demo').disabled=busy;sourceButton.disabled=busy;
      recordButton.disabled=state==='processing';
      recordButton.setAttribute('aria-pressed',String(state==='recording'));
      $('recordLabel').textContent=state==='requesting'?'取消授权等待':state==='recording'?'停止 · '+seconds.toFixed(1)+' / 30s':state==='processing'?'处理中…':'录制采样 · 30s';
      recordButton.setAttribute('aria-label',$('recordLabel').textContent);
      $('recordTime').textContent=state==='recording'?seconds.toFixed(1)+' / 30s':'';
      $('positionSurface').disabled=busy;
      $('record').disabled=state==='processing';
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
  // 本版移除了「导入音频」：容器里的文件选择器只能选图片和视频（无论 accept 怎么写），
  // 音频文件选不到，所以素材只剩内置音源（#demo）与麦克风录制（record）两条路。
  $('demo').addEventListener('click', () => load(null));
  // 随机内置音源（顶栏左侧，自由流动右边）：换一段**不同**的内置素材，避免连点两次听到同一段。
  // 用户要求：点随机就出声。换素材必然要 stop→重建引擎，所以换完统一 play()；
  // `!loading` 表示这次载入还没被下一次点击顶掉（被顶掉时由新那次负责起播，避免两次都抢着 play）。
  // 两段视觉：
  //   aria-busy（≥400ms）—— 这次点击正在换，按下去同一帧就亮，纯过渡；
  //   aria-pressed —— 换完之后**一直亮着**，表示「现在这段是随机选的」，直到素材被别的路径换掉。
  // 用 aria-pressed 而不是只靠 aria-busy：用户要的是状态，不是闪一下。
  // ★ 最小时长 400ms 是必须的：实测「换素材 + 重建引擎」只要 ~75ms，不留时长等于没有反馈。
  const SOURCE_LIT_MS=400;
  sourceButton.addEventListener('click', async () => {
    let next = sourceIndex;
    while (Granular.demoNames.length > 1 && next === sourceIndex) next = Math.floor(Math.random() * Granular.demoNames.length);
    const litAt=performance.now();
    sourceButton.setAttribute('aria-busy','true');
    try {
      sourceRandom=true;                 // 这次换的是「随机选的」素材（load 成功后会 syncSourceMark）
      await load(null, next);
      if (!loading) await play();
    } finally {
      const rest=SOURCE_LIT_MS-(performance.now()-litAt);
      if(rest>0) await new Promise(r=>setTimeout(r,rest));
      sourceButton.removeAttribute('aria-busy');
      syncSourceMark();
    }
  });
  document.addEventListener('visibilitychange', () => { if(document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  // Future shared-player entry. Caller owns schedule/end/deactivate of this engine.
  window.exercise = { activate: () => Granular.create(buffer, params, controls.seedValue || seed) };
  // 竖线数量：按固定像素间距取线（约每 6px 一根），手机 390 宽约 60 根、桌面宽屏封顶 96 根。
  // 目的是"看得清是一根根竖线"，而不是 1000 根叠在一起糊成一块实心波形。
  function lineCountFor(w){return Math.max(24,Math.min(96,Math.round(w/6)));}
  function draw() {
    paintTrail();   // 拖尾的衰减与清理（拖动时已在 moveXY 里即时画过，这里是松手后的收尾）
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
        // 与静态波形同一套竖线：按固定像素间距取线，每根线聚合它覆盖的那几列（未录到的列不画）。
        const lineCount=lineCountFor(w), group=cols.have.length/lineCount, slot=w/lineCount;
        paint.fillStyle=ACCENT;paint.globalAlpha=.9;
        for(let i=0;i<lineCount;i++){
          let lo=0,hi=0,any=false;
          for(let k=Math.floor(i*group);k<Math.floor((i+1)*group) && k<cols.have.length;k++){
            if(!cols.have[k])continue;
            any=true;if(cols.mins[k]<lo)lo=cols.mins[k];if(cols.maxs[k]>hi)hi=cols.maxs[k];
          }
          if(!any)continue;
          const H=Math.max(-1,Math.min(1,hi*scale)), L=Math.max(-1,Math.min(1,lo*scale));
          paint.fillRect(Math.round(i*slot+(slot-1)/2),h/2-H*h*.42,1,Math.max(1,(H-L)*h*.42));
        }
        paint.globalAlpha=1;
        // 播放头与采样波形用同一个换算：同一个位置量 → 同一处像素
        paint.globalAlpha=.67;paint.strokeStyle=ACCENT_SOFT;paint.lineWidth=1;paint.beginPath();
        paint.moveTo(params.position*w,2);paint.lineTo(params.position*w,h-2);paint.stroke();paint.globalAlpha=1;
        paint.fillStyle=ACCENT;paint.font='11px monospace';
        paint.fillText('REC / LIVE INPUT',14,h-6);
        requestAnimationFrame(draw);return;
      }
    }
    waveDrawTime=null;   // 回到采样波形时重置平滑状态，避免把录音期的高增益带过来
    const viewDuration=buffer.duration;
    // 采样波形同样归一化：录进来的声音小一点时，按 ±1 直画几乎看不出波动。
    let peakAbs=0;
    for(const [min,max] of peaks){const a=Math.max(Math.abs(min),Math.abs(max));if(a>peakAbs)peakAbs=a;}
    drawScale=Math.min(DRAW_MAX_SCALE,1/Math.max(WAVE_FLOOR,peakAbs));
    // 竖线而不是实心块：按**固定像素间距**取线（约每 6px 一根，24–96 根），
    // 每根线聚合它覆盖的那几列 peaks 的 min/max —— 少画线但仍是真实包络。
    // 别改成"每 g 列取一列"：那样只取单列的极值，弱音处线条会整体变矮、还会丢峰值。
    const lineCount=lineCountFor(w), group=peaks.length/lineCount, slot=w/lineCount;
    paint.fillStyle='#d8dcd2';paint.globalAlpha=.85;
    for(let i=0;i<lineCount;i++){
      const from=Math.floor(i*group), to=Math.max(from+1,Math.floor((i+1)*group));
      let lo=0,hi=0;
      for(let k=from;k<to && k<peaks.length;k++){const [mn,mx]=peaks[k];if(mn<lo)lo=mn;if(mx>hi)hi=mx;}
      const H=Math.max(-1,Math.min(1,hi*drawScale)), L=Math.max(-1,Math.min(1,lo*drawScale));
      paint.fillRect(Math.round(i*slot+(slot-1)/2),h/2-H*h*.42,1,Math.max(1,(H-L)*h*.42));
    }
    paint.globalAlpha=1;
    // 取样位置竖线
    paint.strokeStyle='#e0e5d9aa';paint.lineWidth=1;paint.beginPath();paint.moveTo(params.position*w,2);paint.lineTo(params.position*w,h-2);paint.stroke();
    if(engine) for(const e of engine.events){
      const age=engine.time-e.when;
      if(age<0 || age>=e.length) continue;
      const envelope=Math.sin(Math.PI*age/e.length)**2;
      const offset=e.offset;
      const position=e.reverse?offset+(e.length-age)*e.rate:offset+age*e.rate;
      const x=position/viewDuration*w, y=h/2+e.pan*h*.42;
      paint.globalAlpha=envelope;paint.fillStyle=e.reverse?ACCENT_REVERSE:'#e0e5d9';
      const a=offset/viewDuration*w, length=e.length*e.rate/viewDuration*w;
      // 粒子读数条 1px、端点 r=2：2px 线与 r=3 的端点在手机上会糊成一片。
      paint.fillRect(a,y-.5,Math.max(1,length),1);paint.beginPath();paint.arc(x,y,2,0,Math.PI*2);paint.fill();
    }
    paint.globalAlpha=1; requestAnimationFrame(draw);
  }
  analyse(); requestAnimationFrame(draw);
})();