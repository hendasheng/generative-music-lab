(() => {
  'use strict';
  const M=GridMusic, $=id=>document.getElementById(id), controls=$('transportControls');
  const state={bpm:120,root:9,scale:'minor',seed:'grid-05',tracks:[{cells:M.blank(),muted:false},{cells:M.blank(),muted:false}]};
  let mode='draw', engine=null, generation=0, pending=false;
  let patternStreams=[];
  const panels=[],cells=[],rowLabels=[];
  const setStatus=text=>{$('status').textContent=text;};
  for(const [i,name] of M.ROOTS.entries()) $('root').add(new Option(name,i));
  $('root').value=state.root;
  for(const name of Object.keys(M.SCALES)) $('scale').add(new Option(name.toUpperCase(),name));
  function updateCell(track,index) {
    const strength=state.tracks[track].cells[index], button=cells[track][index];
    button.style.setProperty('--level',strength);
    button.setAttribute('aria-label',`第 ${Math.floor(index/12)+1} 步，${M.noteName(M.midi(index%12,state.root,state.scale))}，强度 ${Math.round(strength*100)}%，概率 ${Math.round(M.probability(strength)*100)}%`);
  }
  function refresh(track) { cells[track].forEach((_,index)=>updateCell(track,index)); }
  function updateNotes() {
    panels.forEach((panel,track)=>{
      panel.querySelector('.notes').replaceChildren(...Array.from({length:12},(_,col)=>{
        const span=document.createElement('span'); span.textContent=M.noteName(M.midi(col,state.root,state.scale));return span;
      }));refresh(track);
    });
  }
  function clearPlayhead() {
    for(const panel of panels) panel.querySelectorAll('.playhead,.fired').forEach(el=>el.classList.remove('playhead','fired'));
  }
  function onStep({step,fired}) {
    clearPlayhead();
    state.tracks.forEach((_,track)=>{
      rowLabels[track][step].classList.add('playhead');
      for(let col=0;col<12;col++) cells[track][step*12+col].classList.add('playhead');
      fired[track].forEach(col=>cells[track][step*12+col].classList.add('fired'));
    });
    setStatus(`播放中 · ${String(step+1).padStart(2,'0')} / 16`);
  }
  state.tracks.forEach((track,trackIndex)=>{
    const panel=document.createElement('article'); panel.className='track';
    panel.innerHTML=`<div class="track-head"><h2>${trackIndex===0?'01 · SINE PLUCK':'02 · TRIANGLE PLUCK'}</h2><button class="mute" aria-pressed="false">静音</button><button class="random">随机</button><button class="clear">清空</button></div><div class="notes"></div><div class="grid" aria-label="轨道 ${trackIndex+1} 网格"></div>`;
    $('tracks').append(panel);panels.push(panel);cells[trackIndex]=[];rowLabels[trackIndex]=[];
    const grid=panel.querySelector('.grid');
    for(let row=0;row<16;row++) {
      const label=document.createElement('span');label.className='step';label.textContent=String(row+1).padStart(2,'0');grid.append(label);rowLabels[trackIndex].push(label);
      for(let col=0;col<12;col++) {
        const button=document.createElement('button');button.type='button';button.className='cell'+(row%4===0?' beat':'');button.dataset.row=row;button.dataset.col=col;
        grid.append(button);cells[trackIndex].push(button);
        // Keyboard activation operates at the center, pointer painting below includes bleed.
        button.addEventListener('click',event=>{if(event.detail!==0)return;if(mode==='erase')M.erase(track.cells,row,col);else M.brush(track.cells,col+.5,row+.5);refresh(trackIndex);});
      }
    }
    let pointer=null,last=null;
    function drawAt(event) {
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.cell');
      if(!target || !grid.contains(target)) { last=null;return; }
      const rect=target.getBoundingClientRect();
      const x=Number(target.dataset.col)+(event.clientX-rect.left)/rect.width,y=Number(target.dataset.row)+(event.clientY-rect.top)/rect.height;
      if(mode==='erase')M.erase(track.cells,Math.floor(y),Math.floor(x));
      else {
        const count=last?Math.max(1,Math.ceil(Math.hypot(x-last.x,y-last.y)*5)):1;
        for(let i=1;i<=count;i++)M.brush(track.cells,last?last.x+(x-last.x)*i/count:x,last?last.y+(y-last.y)*i/count:y);
      }
      last={x,y};refresh(trackIndex);
    }
    grid.addEventListener('pointerdown',event=>{if(event.button!==0 || pointer!==null)return;pointer=event.pointerId;last=null;grid.setPointerCapture(pointer);drawAt(event);});
    grid.addEventListener('pointermove',event=>{if(event.pointerId===pointer)drawAt(event);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])grid.addEventListener(type,()=>{pointer=null;last=null;});
    panel.querySelector('.mute').addEventListener('click',event=>{track.muted=!track.muted;event.currentTarget.setAttribute('aria-pressed',track.muted);panel.classList.toggle('muted',track.muted);});
    panel.querySelector('.random').addEventListener('click',()=>{M.randomize(track.cells,patternStreams[trackIndex]);refresh(trackIndex);});
    panel.querySelector('.clear').addEventListener('click',()=>{track.cells.fill(0);refresh(trackIndex);});
  });
  function applyPattern(seed) {
    state.seed=seed;patternStreams=state.tracks.map((_,index)=>M.rng(seed+':pattern:'+index));
    state.tracks.forEach((track,index)=>{M.randomize(track.cells,patternStreams[index]);refresh(index);});
    $('seedLabel').textContent='SEED · '+seed;
  }
  async function stop() {
    const token=++generation,old=engine;engine=null;pending=false;
    controls.setPlaying(false);controls.setBusy(true);clearPlayhead();setStatus('正在停止…');
    try { if(old)await old.deactivate(); }
    finally {if(token===generation){controls.setBusy(false);setStatus('已停止');}}
  }
  async function play() {
    if(engine || pending)return;
    const token=++generation;pending=true;controls.setBusy(true);setStatus('正在启动…');
    let created;
    try {
      created=await GridAudio.activate({state,onStep,onError:error=>{void stop().then(()=>setStatus('音频错误：'+error.message));}});
      if(token!==generation){await created.deactivate();return;}
      engine=created;engine.schedule();controls.setPlaying(true);
    } catch(error) {
      if(created)await created.deactivate();
      if(token===generation){engine=null;controls.setPlaying(false);setStatus('无法播放：'+error.message);}
    } finally {if(token===generation){pending=false;controls.setBusy(false);}}
  }
  async function regenerate(fresh) {
    await stop();
    const seed=fresh?'grid-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36):controls.seedValue || state.seed;
    if(fresh)controls.clearSeed();
    applyPattern(seed);await play();
  }
  controls.addEventListener('exercise-play',()=>void play());
  controls.addEventListener('exercise-stop',()=>void stop());
  controls.addEventListener('exercise-regenerate',()=>void regenerate(true));
  controls.addEventListener('exercise-seed-apply',()=>void regenerate(false));
  $('bpm').addEventListener('change',event=>{const value=Number(event.target.value);state.bpm=Number.isFinite(value)?Math.max(40,Math.min(240,Math.round(value))):120;event.target.value=state.bpm;});
  $('root').addEventListener('change',event=>{state.root=Number(event.target.value);updateNotes();});
  $('scale').addEventListener('change',event=>{state.scale=event.target.value;updateNotes();});
  for(const name of ['draw','erase'])$(name).addEventListener('click',()=>{mode=name;$('draw').setAttribute('aria-pressed',name==='draw');$('erase').setAttribute('aria-pressed',name==='erase');});
  document.addEventListener('keydown',event=>{
    if(event.code!=='Space' || event.repeat || event.composedPath().some(el=>['INPUT','SELECT','BUTTON','EXERCISE-CONTROLS'].includes(el.tagName)))return;
    event.preventDefault();if(engine || pending)void stop();else void play();
  });
  // Hidden tabs stop rather than allowing timer throttling to bunch musical events.
  document.addEventListener('visibilitychange',()=>{if(document.hidden && (engine||pending))void stop();});
  window.addEventListener('pagehide',()=>void stop());
  updateNotes();applyPattern(state.seed);
  window.exercise={activate:options=>GridAudio.activate({state,onStep,...options})};
})();
