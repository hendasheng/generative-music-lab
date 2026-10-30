/* Pure music rules: independent from DOM, audio devices and wall-clock time. */
(function (scope) {
  'use strict';
  const STEPS = 48, PITCHES = 27;
  const ROOTS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const SCALES = {minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],dorian:[0,2,3,5,7,9,10],penta:[0,3,5,7,10],penta_major:[0,2,4,7,9],phrygian:[0,1,3,5,7,8,10]};
  function rng(seed) {
    let state = 2166136261;
    for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let x = Math.imul(state ^ state >>> 15, 1 | state);
      x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }
  const blank = () => new Float32Array(STEPS * PITCHES);
  const midi = (column, root, scale) => 48 + root + Math.floor(column / SCALES[scale].length) * 12 + SCALES[scale][column % SCALES[scale].length];
  const noteName = note => ROOTS[note % 12] + (Math.floor(note / 12) - 1);
  const duration = bpm => 60 / bpm / 2;
  const probability = value => value <= 0 ? 0 : value >= 1 ? 1 : .35 + .65 * value;
  function write(cells, row, col, value) {
    if (row >= 0 && row < STEPS && col >= 0 && col < PITCHES) {
      const index = row * PITCHES + col;
      cells[index] = Math.max(cells[index], Math.min(1, value));
    }
  }
  function stamp(cells, row, col) {
    write(cells, row, col, 1);
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) write(cells, row+dr, col+dc, .45);
  }
  function brush(cells, x, y) {
    if (x < 0 || y < 0 || x >= PITCHES || y >= STEPS) return;
    const col = Math.floor(x), row = Math.floor(y), dx = x-col-.5, dy = y-row-.5;
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    write(cells,row,col,1);
    write(cells,row,col+sx,Math.abs(dx)*1.8);
    write(cells,row+sy,col,Math.abs(dy)*1.8);
    write(cells,row+sy,col+sx,Math.abs(dx*dy)*3.6);
  }
  function erase(cells, row, col) {
    if (row < 0 || row >= STEPS || col < 0 || col >= PITCHES) return;
    row = Math.min(row,STEPS-2); col = Math.min(col,PITCHES-2);
    for (const [dr,dc] of [[0,0],[1,0],[0,1],[1,1]]) cells[(row+dr)*PITCHES+col+dc] = 0;
  }
  function randomize(cells, random) {
    cells.fill(0);
    for (let row=0;row<STEPS;row++) if (random() < .42) {
      stamp(cells,row,Math.floor(random()*PITCHES));
      if (random() < .25) stamp(cells,row,Math.floor(random()*PITCHES));
    }
  }
  // SQNCR City: degree candidates (turn / turnMajor), triadic bass,
  // and nearest chord-tone correction on strong beats. Zero-based degrees.
  function chordDegree(cycle, scale) {
    const minor=[[0],[5,3],[6,4],[2,5],[3,5],[5,3],[6,4],[4,6]];
    const major=[[0],[3],[4],[2,4],[5,3],[3],[1,3],[4]];
    const steps=SCALES[scale], count=steps.length;
    const degreeMidi=d=>steps[d%count]+12*Math.floor(d/count);
    const plan=((scale==='major'||scale==='penta_major')?major:minor);
    let previous=null;
    const degrees=plan.map(options=>{
      const triads=options.filter(d=>{
        const third=degreeMidi(d+2)-degreeMidi(d),fifth=degreeMidi(d+4)-degreeMidi(d);
        return (third===3||third===4)&&fifth===7;
      });
      const pool=triads.length?triads:options;
      const d=pool.find(x=>x!==previous)??pool[0];previous=d;return d;
    });
    return degrees[cycle%degrees.length];
  }
  function harmonyColumn(col, sound, step, cycle, scale) {
    if(sound==='machine')return col;
    const count=SCALES[scale].length, degree=chordDegree(Math.floor(step/6),scale);
    // Bass / pad follow chord tones; lead preserves the drawn line off strong beats.
    if(sound==='acid'||sound==='reverie') {
      const ranks=[];for(let d=-count*2;d<count*4;d++)if([0,2,4].includes(((d-degree)%count+count)%count))ranks.push(d);
      const home=ranks.reduce((a,b)=>Math.abs(b-0)<Math.abs(a-0)?b:a,ranks[0]);
      const base=ranks.indexOf(home),offset=Math.round(col/3);
      const d=ranks[Math.min(ranks.length-1,base+offset)];
      return Math.max(0,Math.min(PITCHES-1,d));
    }
    if(step%6!==0)return col;
    const chord=[0,2,4].map(d=>(degree+d)%count);
    for(let distance=0;distance<PITCHES;distance++)for(const candidate of distance?[col-distance,col+distance]:[col])
      if(candidate>=0&&candidate<PITCHES&&chord.includes(candidate%count))return candidate;
    return col;
  }
  function events(track, step, root, scale, random, cycle) {
    const result=[];
    // Consume the same two draws per cell, even when muted or empty.
    // Muting one track therefore cannot change the future of either track.
    for (let col=0;col<PITCHES;col++) {
      const chance=random(), velocity=random(), strength=track.cells[step*PITCHES+col];
      if (!track.muted && strength>0 && chance<(track.chances ? track.chances[step*PITCHES+col] : probability(strength))) { const performed=cycle===undefined?col:harmonyColumn(col,track.sound,step,cycle,scale); result.push({col:performed,sourceCol:col,midi:midi(performed,root,scale),velocity:strength*(.72+.26*velocity)}); };
    }
    return result;
  }
  const api={STEPS,PITCHES,ROOTS,SCALES,rng,blank,midi,noteName,duration,probability,stamp,brush,erase,randomize,events,chordDegree,harmonyColumn};
  if (typeof module !== 'undefined') module.exports=api;
  else scope.GridMusic=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
