(() => {
'use strict';
const M=GridMusic,$=id=>document.getElementById(id),controls=$('transportControls');
const shapes=['circle','diamond','square','triangle','cross'];
const colors=['#5487ff','#ff765e','#e6ed59','#b78aff','#45d9bb'];
const highlights=['#acc5ff','#ffc1a3','#f9ffaf','#dfc5ff','#a0f6df'];
const shadows=['#294b9c','#9d443e','#777d2c','#664294','#247e74'];
const state={harmonicEvolution:true,bpm:120,root:9,scale:'minor',seed:'grid-05',tracks:GridAudio.SOUNDS.map(s=>({cells:M.blank(),chances:new Float32Array(M.STEPS*M.PITCHES).fill(1),muted:false,sound:s.id}))};
let mode='draw',active=0,chance=.75,strength=.8,visibleCycle=0,engine=null,generation=0,pending=false,patternStreams=[];
const cells=[],labels=[];const setStatus=text=>{$('status').textContent=text;};
for(const [i,name] of M.ROOTS.entries())$('root').add(new Option(name,i));$('root').value=9;
for(const name of Object.keys(M.SCALES))$('scale').add(new Option(name==='penta'?'PENTA MINOR':name==='penta_major'?'PENTA MAJOR':name.toUpperCase(),name));
function refresh(cycle=visibleCycle){visibleCycle=cycle;cells.forEach(cell=>cell.replaceChildren());for(let step=0;step<M.STEPS;step++)for(let pitch=0;pitch<M.PITCHES;pitch++){
const cell=cells[step*M.PITCHES+pitch];
state.tracks.forEach((track,t)=>{const index=step*M.PITCHES+pitch;if(!track.cells[index])return;const mark=document.createElement('span');mark.className='mark '+shapes[t];mark.style.setProperty('--voice',colors[t]);mark.style.setProperty('--voice-light',highlights[t]);mark.style.opacity=track.muted?.15:.45+.55*track.chances[index];mark.style.setProperty('--size',(7+track.cells[index]*19)+'px');mark.dataset.baseSize=String(7+track.cells[index]*19);mark.dataset.track=t;mark.dataset.source=pitch;mark.title=track.sound.toUpperCase()+' · 力度 '+Math.round(track.cells[index]*100)+'% · 概率 '+Math.round(track.chances[index]*100)+'%';const target=M.harmonyColumn(pitch,track.sound,step,cycle,state.scale); cells[step*M.PITCHES+target].append(mark);});
cell.setAttribute('aria-label',`第 ${step+1} 步 ${M.noteName(M.midi(pitch,state.root,state.scale))}，编辑 ${state.tracks[active].sound}`);
}composeField();}
// Across-cell composition: each accompaniment belongs to a nearby real note.
// These visual echoes never write musical cells or consume performance randomness.
function composeField(){
 const occupied=new Set();cells.forEach((cell,i)=>{if(cell.querySelector('.mark'))occupied.add(i);});
 const field=new Map();
 state.tracks.forEach((track,t)=>{if(track.muted)return;for(let step=0;step<M.STEPS;step++)for(let pitch=0;pitch<M.PITCHES;pitch++){
  const index=step*M.PITCHES+pitch,energy=track.cells[index];if(!energy)continue;
  const target=M.harmonyColumn(pitch,track.sound,step,visibleCycle,state.scale);
  const offsets=[[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,-1],[2,0],[0,2],[0,-2]];
  const count=3+Math.round(energy*3);
  offsets.slice(0,count).forEach(([dx,dy],k)=>{const x=step+dx,y=target+dy;if(x<0||x>=M.STEPS||y<0||y>=M.PITCHES)return;const key=x*M.PITCHES+y;if(occupied.has(key))return;
   const weight=energy/(1+Math.abs(dx)+Math.abs(dy));if(field.has(key)&&field.get(key).weight>=weight)return;
   field.set(key,{t,weight,k,chance:track.chances[index]});
  });
 }});
 for(const [index,item] of field){const echo=document.createElement('span');echo.className='field-echo '+shapes[item.t];echo.style.setProperty('--voice',item.k%3===0?highlights[item.t]:colors[item.t]);echo.style.setProperty('--echo-size',(3+item.weight*13)+'px');echo.style.opacity=.3+item.weight*.65;echo.setAttribute('aria-hidden','true');cells[index].append(echo);}
}
function updateNotes(){labels.forEach((label,pitch)=>label.textContent=M.noteName(M.midi(pitch,state.root,state.scale)));refresh();}
function clearPlayhead(){document.querySelectorAll('.fired').forEach(el=>{el.classList.remove('fired');if(el.dataset.baseSize)el.style.setProperty('--size',el.dataset.baseSize+'px');});}
function onStep({step,fired,hits,cycle=0}){measureBoard();visibleCycle=cycle;clearPlayhead();fired.forEach((notes,t)=>notes.forEach(pitch=>cells[step*M.PITCHES+pitch].querySelector(`[data-track="${t}"]`)?.classList.add('fired')));if(hits)hits.forEach((notes,t)=>notes.forEach(note=>{const mark=cells[step*M.PITCHES+note.col].querySelector(`[data-track="${t}"][data-source="${note.sourceCol}"]`);if(mark){mark.classList.add('fired');mark.style.setProperty('--size',(5+note.velocity*11)+'px');emitVisual(step,note,t);}}));setStatus(`播放中 · 第 ${Math.floor(step/6)+1}/8 小节 · ${String(step+1).padStart(2,'0')} / ${M.STEPS}`);}
GridAudio.SOUNDS.forEach((sound,t)=>{const button=document.createElement('button');button.className='voice';button.style.setProperty('--voice',colors[t]);button.style.setProperty('--voice-dark',shadows[t]);button.innerHTML=`<span class="mark ${shapes[t]}"></span><span>${sound.label}</span>`;button.setAttribute('aria-pressed',t===active);button.addEventListener('click',()=>{active=t;document.querySelectorAll('.voice').forEach((b,i)=>b.setAttribute('aria-pressed',i===t));$('mute').setAttribute('aria-pressed',state.tracks[t].muted);refresh();});$('voices').append(button);});
const board=$('board');
board.style.setProperty('--steps',M.STEPS);
const cursor=document.createElement('div');cursor.className='roll-cursor';cursor.hidden=true;cursor.setAttribute('aria-hidden','true');board.append(cursor);
let cursorGeometry=null,cursorAnimation=null,cursorBpm=null,lastCursorPosition=-1,geometry=null;
window.addEventListener('resize',()=>{cursorGeometry=null;geometry=null;cursorAnimation?.cancel();cursorAnimation=null;});
function measureBoard(){if(geometry)return;geometry=cells.map(cell=>({x:cell.offsetLeft,y:cell.offsetTop,w:cell.offsetWidth,h:cell.offsetHeight}));}
function onPosition(position){
 if(!cursorGeometry){measureBoard();const first=geometry[0],last=geometry[(M.STEPS-1)*M.PITCHES];cursorGeometry={start:first.x,width:last.x+last.w-first.x};}
 const duration=M.duration(state.bpm)*M.STEPS*1000,at=position/M.STEPS*duration;
 cursor.hidden=false;
 if(!cursorAnimation||cursorBpm!==state.bpm){cursorAnimation?.cancel();cursorAnimation=cursor.animate([{transform:'translate3d('+cursorGeometry.start+'px,0,0)'},{transform:'translate3d('+(cursorGeometry.start+cursorGeometry.width)+'px,0,0)'}],{duration,iterations:Infinity,easing:'linear'});cursorAnimation.currentTime=at;cursorBpm=state.bpm;}
 else {const actual=Number(cursorAnimation.currentTime||0)%duration;const difference=Math.abs(actual-at);if(position<lastCursorPosition||Math.min(difference,duration-difference)>100)cursorAnimation.currentTime=at;}
 lastCursorPosition=position;
}const emissions=document.createElement('div');emissions.className='emissions';emissions.style.position='absolute';emissions.style.inset='0';emissions.setAttribute('aria-hidden','true');board.append(emissions);
function emitVisual(step,note,track){
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const energy=note.velocity,count=3+Math.round(energy*5);
 const offsets=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[2,0],[-2,0]];
 for(let k=0;k<count;k++){
  const [dx,dy]=offsets[k],x=step+dx,y=note.col+dy;if(x<0||x>=M.STEPS||y<0||y>=M.PITCHES)continue;
  const cell=cells[x*M.PITCHES+y];if(cell.querySelector('.mark'))continue;measureBoard();const rect=geometry[x*M.PITCHES+y];
  while(emissions.childElementCount>=160)emissions.firstElementChild.remove();
  const item=document.createElement('span');item.className='field-pulse '+(k%3===0?'field-block':shapes[track]);
  const size=k%3===0?Math.min(rect.w-6,12+energy*18):3+energy*6;
  item.style.left=rect.x+rect.w/2+'px';item.style.top=rect.y+rect.h/2+'px';
  item.style.setProperty('--voice',k%3===0?shadows[track]:highlights[track]);item.style.setProperty('--particle-size',size+'px');item.style.setProperty('--life',Math.max(550,M.duration(state.bpm)*1000*7)+'ms');
  item.addEventListener('animationend',()=>item.remove(),{once:true});emissions.append(item);
 }
}const corner=document.createElement('span');board.append(corner);for(let step=0;step<M.STEPS;step++){const label=document.createElement('span');label.className='step';label.textContent=step%6===0?String(step/6+1).padStart(2,'0'):'';board.append(label);}
function edit(step,pitch){const track=state.tracks[active],index=step*M.PITCHES+pitch;track.cells[index]=mode==='erase'?0:strength;track.chances[index]=chance;refresh();}
for(let pitch=M.PITCHES-1;pitch>=0;pitch--){const label=document.createElement('span');label.className='pitch';labels[pitch]=label;board.append(label);for(let step=0;step<M.STEPS;step++){const b=document.createElement('button');b.type='button';b.className='cell'+(step%12===0?' section-start':step%6===0?' beat':'');b.dataset.step=step;b.dataset.pitch=pitch;cells[step*M.PITCHES+pitch]=b;board.append(b);b.addEventListener('click',e=>{if(e.detail===0)edit(step,pitch);});}}
let pointer=null,last='';function paint(e){const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('.cell');if(!cell||!board.contains(cell))return;const key=cell.dataset.step+':'+cell.dataset.pitch;if(key===last)return;last=key;edit(+cell.dataset.step,+cell.dataset.pitch);}
board.addEventListener('pointerdown',e=>{if(e.button!==0)return;pointer=e.pointerId;last='';board.setPointerCapture(pointer);paint(e);});board.addEventListener('pointermove',e=>{if(e.pointerId===pointer)paint(e);});for(const type of ['pointerup','pointercancel','lostpointercapture'])board.addEventListener(type,()=>{pointer=null;last='';});
function applyPattern(seed){state.seed=seed;patternStreams=state.tracks.map((_,i)=>M.rng(seed+':pattern:'+i));state.tracks.forEach((track,t)=>{track.cells.fill(0);track.chances.fill(1);const random=patternStreams[t];for(let step=0;step<M.STEPS;step++){if(random()>(t===4?.55:.27))continue;const pitch=Math.floor(random()*(t===3?4:M.PITCHES)),index=step*M.PITCHES+pitch;track.cells[index]=.8;track.chances[index]=step%4===0?1:.5;}});refresh();$('seedLabel').textContent='SEED · '+seed;}
  async function stop() {
    const token=++generation,old=engine;engine=null;pending=false;
    controls.setPlaying(false);controls.setBusy(true);emissions.replaceChildren();cursor.hidden=true;cursorAnimation?.cancel();cursorAnimation=null;lastCursorPosition=-1;clearPlayhead();setStatus('正在停止…');
    try { if(old)await old.deactivate(); }
    finally {if(token===generation){controls.setBusy(false);setStatus('已停止');}}
  }
  async function play() {
    if(engine || pending)return;
    const token=++generation;pending=true;controls.setBusy(true);setStatus('正在启动…');
    let created;
    try {
      created=await GridAudio.activate({state,onStep,onPosition,onError:error=>{void stop().then(()=>setStatus('音频错误：'+error.message));}});
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
$('bpm').addEventListener('change',e=>{state.bpm=Math.max(40,Math.min(240,Number(e.target.value)||120));e.target.value=state.bpm;});
$('root').addEventListener('change',e=>{state.root=+e.target.value;updateNotes();});$('scale').addEventListener('change',e=>{state.scale=e.target.value;updateNotes();});
for(const name of ['draw','erase'])$(name).addEventListener('click',()=>{mode=name;for(const id of ['draw','erase'])$(id).setAttribute('aria-pressed',id===name);});
$('strength').addEventListener('change',e=>strength=+e.target.value);
$('chance').addEventListener('change',e=>chance=+e.target.value);
$('mute').addEventListener('click',e=>{const track=state.tracks[active];track.muted=!track.muted;e.currentTarget.setAttribute('aria-pressed',track.muted);refresh();});
$('clear').addEventListener('click',()=>{state.tracks[active].cells.fill(0);refresh();});
document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||e.composedPath().some(el=>['INPUT','SELECT','BUTTON','EXERCISE-CONTROLS'].includes(el.tagName)))return;e.preventDefault();if(engine||pending)void stop();else void play();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(engine||pending))void stop();});window.addEventListener('pagehide',()=>void stop());
updateNotes();applyPattern(state.seed);window.exercise={activate:options=>GridAudio.activate({state,onStep,onPosition,...options})};
})();