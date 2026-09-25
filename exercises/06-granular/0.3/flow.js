(() => {
  'use strict';
  // Each lane has its own random stream, distance and travel duration.
  // Pitch is deliberately absent. Values remain in their existing UI ranges.
  const lanes={
    position:[0,1,.28,6,13], spray:[0,.5,.11,9,18],
    size:[15,1000,220,7,15], density:[2,60,15,5,11],
    pan:[0,1,.30,11,21]
  };
  function create(params,seed) {
    const states={};
    const anchorSize=params.size,anchorDensity=params.density;
    const reverseOffset=params.reverse-Granular.reverseFromSpray(params.spray);
    let elapsed=0;
    for(const key of Object.keys(lanes)) states[key]={rng:Granular.random(seed+':flow:'+key),time:0,from:params[key],to:params[key],duration:0};
    function reset(key) {
      const s=states[key];if(!s)return;
      const [min,max,distance,slow,fast]=lanes[key];
      s.from=params[key];s.time=0;s.duration=slow+s.rng()*(fast-slow);
      let target=s.from+(s.rng()<.5?-1:1)*distance*(.4+.6*s.rng());
      if(target<min)target=min+(min-target);
      if(target>max)target=max-(target-max);
      if(key==='density'){
        // A gentle inverse relationship, with independent variation and timing.
        const sizeTarget=states.size.to;
        target=anchorDensity*Math.pow(anchorSize/Math.max(15,sizeTarget),.45)*(.8+.4*s.rng());
      }
      s.to=Math.max(min,Math.min(max,target));
    }
    for(const key of Object.keys(lanes))reset(key);
    function step(seconds,held=new Set()) {
      elapsed+=Math.max(0,seconds);
      for(const key of Object.keys(lanes)) {
        const s=states[key];
        if(held.has(key)){s.held=true;continue;}
        if(s.held){reset(key);s.held=false;}
        let remaining=Math.max(0,seconds);
        while(remaining>0){
          const dt=Math.min(remaining,s.duration-s.time);s.time+=dt;remaining-=dt;
          const t=Math.min(1,s.time/s.duration),ease=t*t*t*(t*(t*6-15)+10);
          params[key]=s.from+(s.to-s.from)*ease;
          if(s.time>=s.duration)reset(key);
        }
      }
      // Ease a manual reverse override into the XY curve without an onset jump.
      const t=Math.min(1,elapsed/4),ease=t*t*t*(t*(t*6-15)+10);
      params.reverse=Math.max(0,Math.min(1,Granular.reverseFromSpray(params.spray)+reverseOffset*(1-ease)));
    }
    return {step,reset};
  }
  window.FreeFlow={create,lanes};
})();
