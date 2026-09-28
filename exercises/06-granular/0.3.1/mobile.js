(() => {
  'use strict';
  const $=id=>document.getElementById(id),controls=document.querySelector('exercise-controls');
  const play=$('mainPlay');
  const playIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
  const pauseIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
  function sync(){play.disabled=controls.busy;play.innerHTML=controls.playing?pauseIcon:playIcon;play.setAttribute('aria-label',controls.playing?'停止':'播放');}
  // Adapt the shared control without changing the shared file or previous versions.
  for(const key of ['setPlaying','setBusy']){const original=controls[key].bind(controls);controls[key]=value=>{original(value);sync();};}
  const style=document.createElement('style');style.textContent='.toggle{display:none!important}.controls{grid-template-columns:72px!important}input,button.secondary{grid-column:1!important}';controls.shadowRoot.append(style);
  play.addEventListener('click',()=>{if(!controls.busy)controls.emit(controls.playing?'stop':'play');});sync();
  const settings=$('settings'),menu=$('menuToggle');
  menu.addEventListener('click',()=>{settings.showModal();menu.setAttribute('aria-expanded','true');});
  $('closeSettings').addEventListener('click',()=>settings.close());
  settings.addEventListener('close',()=>{menu.setAttribute('aria-expanded','false');menu.focus();});
  settings.addEventListener('click',e=>{const b=settings.getBoundingClientRect();if(e.target===settings && (e.clientX<b.left || e.clientX>b.right || e.clientY<b.top || e.clientY>b.bottom))settings.close();});
  // 窗内图标在**摄像头未打开时常驻**（用户必须看得到入口在哪，此状态下不存在「隐藏」）；
  // **打开之后**才有点窗口显示 / 再点隐藏的切换，运行中也能收起来看画面。
  // 底线：任何状态都能一键关闭摄像头——运行中收起后，再点一下窗口就回来。
  // 隐藏用 display:none（不是透明），否则看不见却仍能被读屏与 Tab 聚焦。
  const cameraWindow=document.querySelector('.camera-window');
  let cameraState='idle', controlsShown=true;
  const applyControls=()=>{
    // 未打开时强制常驻，忽略 controlsShown
    const collapsed = cameraState!=='idle' && !controlsShown;
    cameraWindow.classList.toggle('controls-hidden',collapsed);
    cameraWindow.classList.toggle('flip-hidden',cameraState!=='active');
  };
  const toggleControls=()=>{
    if(cameraState==='idle')return;   // 未打开：图标常驻，点窗口不隐藏
    controlsShown=!controlsShown;
    applyControls();
  };
  cameraWindow.addEventListener('click',e=>{
    // 点两个图标本身时不要收起（否则一次点击既执行操作又折叠面板）
    if(e.target.closest('#cameraToggle') || e.target.closest('#cameraFlip'))return;
    toggleControls();
  });
  // 键盘等价：窗口可聚焦，回车/空格切换（未打开时同样不生效）
  cameraWindow.tabIndex=0;
  cameraWindow.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleControls();}
  });
  const camera=CameraPreview.create($('cameraVideo'),(state,message)=>{
    cameraState=state;
    $('cameraStatus').textContent=message;$('cameraFlip').disabled=state!=='active';
    $('cameraToggle').setAttribute('aria-pressed',String(state==='active'));
    $('cameraToggle').setAttribute('aria-label',state==='requesting'?'取消摄像头请求':state==='active'?'关闭摄像头':'开启摄像头');
    // 从闲置开始采集时重置为展开：刚点完相机不该立刻看不到关闭键。
    if(state==='requesting')controlsShown=true;
    applyControls();
  });
  $('cameraToggle').addEventListener('click',()=>camera.toggle());$('cameraFlip').addEventListener('click',()=>camera.flip());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)camera.stop('已暂停摄像头 · 点击重新开启');});
  window.addEventListener('pagehide',()=>camera.stop());
  applyControls();
})();
