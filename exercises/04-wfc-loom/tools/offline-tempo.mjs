#!/usr/bin/env node
// 04 0.5 的 **BPM 演出参数**离线探针：引擎跑在「假 DOM + 虚拟时钟 + 假 Transport」上（不开浏览器、不放声音）。
// 量的都是**调度时序**，三条不变量：
//   ① 每一步的间隔与音的时值都等于 60/BPM/2 —— 改 BPM 后现算，不留任何写死的旧值；
//   ② 第 k 步的绝对时刻 = 起点 + k × 间隔（累加不漂移）；
//   ③ 同一颗种子在不同 BPM 下**音符逐位相同**（模型在拍域，BPM 只缩放绝对速度）。
// ★ 它证明不了两件事，都留给真机探针：声音真的响了、以及 Tone 把"秒数 → 96 tick"换算成
//   "改 bpm 时网格自己跟着走"（桩里的 repeat 间隔是页面传进来的秒数，不经过 Tone 的 tick 换算）。
//
// 用法（仓库根目录）：node exercises/04-wfc-loom/tools/offline-tempo.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadExercise, pump, LOOKAHEAD } from './harness.mjs';

const EXPORT = `;globalThis.__probe = {
  playCurrent, applyBpm, cellSeconds,
  bpm: () => bpm, setBpmInput: v => { bpmInput.value = String(v); },
  setPendingSeed: v => { pendingSeed = v; },
  DEFAULT_BPM, BPM_MIN, BPM_MAX,
};`;

const harness = loadExercise({ file: path.resolve('exercises/04-wfc-loom/0.5/index.html'), exportCode: EXPORT });
const P = harness.api;
const { transport, triggers, context } = harness;

// 走**真实路径**（playCurrent）：建引擎 → 记为当前 engine → schedule → Transport.start。
// 直接 createEngine 会绕开 `engine` 这个页面变量，量不到 `applyBpm` 的接线（第一版就是这么漏掉的）。
const start = async (bpm, seed) => {
  P.setBpmInput(bpm);
  P.applyBpm();
  P.setPendingSeed(seed);
  transport.cancel();
  transport.seconds = 0;
  triggers.length = 0;
  await P.playCurrent();
  assert.ok(transport._queue.size, `${bpm} BPM：playCurrent 之后应该已经排好 repeat`);
};

const run = async (bpm, steps) => {
  await start(bpm, 12345);
  for (let i = 0; i < steps && transport._queue.size; i += 1) pump(harness);
  // ★ 断言用**全精度**时间：这里量的是浮点累加漂移，先 toFixed 会把 1e-10 的误差抹成看起来的失败。
  return {
    bpm: P.bpm(),
    cell: P.cellSeconds(),
    transportBpm: transport.bpm.value,
    notes: triggers.map(t => ({ note: t.note, time: t.time, dur: t.duration })),
  };
};

const STEPS = 120;
const BPS = [112, 56, 224];
const runs = [];
for (const bpm of BPS) runs.push(await run(bpm, STEPS));

console.log('=== 04 0.5 BPM 演出参数（离线，纯调度时序）===\n');
console.log(`默认 ${P.DEFAULT_BPM} · 范围 ${P.BPM_MIN}–${P.BPM_MAX} · 每格恒为一个八分音符\n`);
console.log('BPM    1 格(s)     实时间隔(s)   音的时值(s)   Transport.bpm   音数');
for (const r of runs) {
  const gaps = r.notes.slice(1).map((n, i) => n.time - r.notes[i].time);
  const times = r.notes.map(n => n.time);
  // ① 间隔与"每格秒数"必须是同一个整数倍（休止格不出声，所以间隔是格长的整数倍）
  for (const gap of gaps) assert.ok(Math.abs(gap / r.cell - Math.round(gap / r.cell)) < 1e-9, `${r.bpm} BPM 出现了非整格的间隔：${gap}`);
  // ② 每一步都恰好落在"起点 + k × 格长"上（k 为整数），累加不漂移
  const start = times[0];
  times.forEach((t, i) => {
    const k = (t - start) / r.cell;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `${r.bpm} BPM 第 ${i + 1} 个音漂了：${t}（k=${k}）`);
  });
  // ① 音的时值 = 一个八分音符
  for (const n of r.notes) assert.ok(Math.abs(n.dur - r.cell) < 1e-9, `${r.bpm} BPM 的时值不是一格：${n.dur}`);
  console.log(`${String(r.bpm).padStart(3)}   ${r.cell.toFixed(6)}   ${(gaps[0] || 0).toFixed(6).padStart(10)}   ${r.notes[0].dur.toFixed(6).padStart(10)}   ${String(r.transportBpm).padStart(13)}   ${String(r.notes.length).padStart(4)}`);
}
// Transport 的 BPM 必须与"格长"同源
for (const r of runs) assert.equal(r.transportBpm, r.bpm, 'Transport.bpm 与页面 bpm 必须一致');

// ③ 同一种子在不同 BPM 下音符逐位相同（把时间与时长剥掉，只比音高序列）
const sequences = runs.map(r => r.notes.map(n => n.note).join(' '));
assert.ok(sequences.every(s => s === sequences[0]), '不同 BPM 下的音符序列必须逐位相同');

// ④ 播放中改 BPM：Transport 的速度立刻跟着变，之后触发的音用**新**格长（已排好的那一步保持旧间隔 ——
//    那一段是 Tone 的 tick 换算，桩里量不到，由真机探针量）。
await start(112, 12345);
for (let i = 0; i < 12; i += 1) pump(harness);
const before = P.cellSeconds();
P.setBpmInput(56);
P.applyBpm();
const after = P.cellSeconds();
assert.equal(transport.bpm.value, 56, '播放中改 BPM 必须落到 Transport.bpm');
assert.ok(Math.abs(after / before - 2) < 1e-12, '格长应当与 BPM 成反比');
triggers.length = 0;
for (let i = 0; i < 24 && transport._queue.size; i += 1) pump(harness);
assert.ok(triggers.length > 0, '改 BPM 之后必须继续出声（不是停了）');
const liveDurations = new Set(triggers.map(t => +t.duration.toFixed(9)));
assert.deepEqual([...liveDurations], [+after.toFixed(9)], '改 BPM 之后触发的音必须用新格长');
assert.equal(P.bpm(), 56);
P.setBpmInput(9999);
P.applyBpm();
assert.equal(P.bpm(), 56, '越界输入必须回退到上一个合法值（不把 NaN / 越界值带进调度）');
P.setBpmInput(112);
P.applyBpm();

console.log(`\n同一颗种子在 ${BPS.join(' / ')} BPM 下音符逐位相同（各 ${sequences[0].split(' ').length} 个音）PASS`);
console.log(`播放中 112 → 56：Transport.bpm 立刻跟随、新触发的 ${triggers.length} 个音时值全部 = ${after.toFixed(6)}s；越界输入回退 PASS`);
console.log(`（间隔按格长的整数倍检查，第 k 步落在起点 + k × 格长 —— 累加无漂移。真机另验"改 BPM 后网格自己变快变慢"。）`);
