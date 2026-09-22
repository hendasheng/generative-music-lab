/* Pure music rules: independent from DOM, audio devices and wall-clock time. */
(function (scope) {
  'use strict';
  const STEPS = 16, PITCHES = 12;
  const ROOTS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const SCALES = {minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],dorian:[0,2,3,5,7,9,10],penta:[0,3,5,7,10],phrygian:[0,1,3,5,7,8,10]};
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
  const duration = bpm => 60 / bpm / 4;
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
  function events(track, step, root, scale, random) {
    const result=[];
    // Consume the same two draws per cell, even when muted or empty.
    // Muting one track therefore cannot change the future of either track.
    for (let col=0;col<PITCHES;col++) {
      const chance=random(), velocity=random(), strength=track.cells[step*PITCHES+col];
      if (!track.muted && strength>0 && chance<probability(strength)) result.push({col,midi:midi(col,root,scale),velocity:strength*(.72+.26*velocity)});
    }
    return result;
  }
  const api={STEPS,PITCHES,ROOTS,SCALES,rng,blank,midi,noteName,duration,probability,stamp,brush,erase,randomize,events};
  if (typeof module !== 'undefined') module.exports=api;
  else scope.GridMusic=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
