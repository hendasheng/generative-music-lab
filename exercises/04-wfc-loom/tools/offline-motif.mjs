import assert from 'node:assert/strict';
import path from 'node:path';
import { loadExercise } from './harness.mjs';
const { api } = loadExercise({ file:path.resolve('exercises/04-wfc-loom/0.5/index.html'),
  exportCode:';globalThis.__probe = { createStream, NOTES, MOTIF_CAPACITY, MOTIF_LENGTH };' });
const midi = new Map(api.NOTES.map(n => [n.id,n.midi]));
const total = { recalls:0, exact:0, variation:0, intact:0, matched:0, mutated:0, rests:0, stored:0 };
for (let seed=1; seed<=30; seed++) {
  const stream = api.createStream(seed * 7919);
  const replay = api.createStream(seed * 7919);
  const baseline = api.createStream(seed * 7919, { motif:false });
  const zero = api.createStream(seed * 7919, { motifRecallProbability:0 });
  const output = [], expectedPool = [], buffer = [];
  let run=0, restRun=0, previous=null, group=[];
  for (let tick=0; tick<3000; tick++) {
    const frozen=stream.window.filter(c=>c.value).map(c=>[c,c.value.id]);
    const step=stream.stepOnce();
    assert.deepEqual(step,replay.stepOnce(),'seed replay');
    assert.equal(baseline.stepOnce().note,zero.stepOnce().note,'zero recall must preserve original RNG stream');
    for (const [cell,id] of frozen) assert.equal(cell.value.id,id,'recall cannot rewrite determined cells');
    output.push(step.note);
    assert.equal(step.audibleSnapshot[0].value,step.note || 'rest');
    if (step.note === null) { restRun++; run=0; buffer.length=0; }
    else {
      assert.ok(midi.has(step.note));
      if (previous !== null) assert.ok(Math.abs(midi.get(previous)-midi.get(step.note))<=5);
      run = previous===step.note ? run+1 : 1;
      restRun=0; buffer.push(step.note);
      if (buffer.length===4) {
        expectedPool.push({notes:buffer.slice(),endTick:tick});
        if (expectedPool.length>6) expectedPool.shift();
        buffer.length=0;
      }
    }
    assert.ok(run<=2 && restRun<=4);
    previous=step.note;
    assert.deepEqual(JSON.parse(JSON.stringify(stream.motifMemory())),expectedPool,'pool must contain only actual four-note output chunks, FIFO');
    assert.ok(stream.motifMemory().length<=api.MOTIF_CAPACITY);
    if(step.recall) {
      const r=step.recall;
      assert.ok(r.sourceEnd<tick,'never remember future output');
      assert.deepEqual(output.slice(r.sourceEnd-3,r.sourceEnd+1),Array.from(r.source));
      assert.equal(r.target,r.source[r.position]);
      assert.equal(r.mutate,r.position===r.mutationIndex);
      if(r.position===0) {
        assert.equal(group.length,0,'no overlap');
        // 引用可能提前绑定，开始播放时原条目已被 FIFO 淘汰；来源按真实历史验证。
      }
      assert.equal(r.position,group.length);
      group.push(step.note);
      if(r.position===3) {
        if(group.every((n,i)=>n===r.source[i])) total.intact++;
        group=[];
      }
    } else assert.equal(group.length,0);
  }
  assert.ok(stream.motifReport.exact>0 && stream.motifReport.variation>0);
  assert.equal(stream.report.relaxations,0);
  for(const key of ['recalls','exact','variation','matched','mutated','rests','stored']) total[key]+=stream.motifReport[key];
}
assert.ok(total.intact>0 && total.mutated>0,'actual output must contain complete recalls and mutations');
console.log('30 seeds × 3000 steps: hard rules, memory provenance/capacity, replay, disabled baseline, frozen cells, nonoverlap PASS');
console.log(JSON.stringify(total));
