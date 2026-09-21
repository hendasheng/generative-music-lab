#!/usr/bin/env node
// 04 0.5 的离线探针：量**滚动窗口**、**register drift**、**density drift** 三个机制。
//
// 用法（在仓库根目录）：
//   node exercises/04-wfc-loom/tools/offline-stream.mjs
//   node exercises/04-wfc-loom/tools/offline-stream.mjs --ticks 400 --seeds 30
//
// 量什么（每条机制单独开/关，看它自己改变了什么）：
//   ① 硬规则在**无限音流**上仍然成立：相邻两个音的音程 ≤ max interval、不被休止打断的同音连续 ≤ max repeat、无调外音。
//      （休止是"时间上的空位"，不参与音高约束 —— 所以它会打断音程链与连击，这正是判定口径。）
//   ② register drift：中心开/关 → 音高是否跟着中心走（平均 |音−中心|、corr、中心低/高两半的平均音高）。
//   ③ density drift：疏密开/关 → 窗口音数是否跟着目标走（|窗口音数 − density×16|、corr、低/高两半的窗口音数），
//      以及"窗口级配额"有没有把空洞控制住（最长休止段、实际发声比例）。
//   ④ 决定性：同一颗种子两次跑出的音流逐位相同。
// ★ 假环境在 ./harness.mjs；它只证明模型，证明不了"真的响了 / 画面对不对齐"（那要真机）。
import path from 'node:path';
import { loadExercise } from './harness.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const file = path.resolve(ROOT, getArg('--file', 'exercises/04-wfc-loom/0.5/index.html'));
const seedCount = Number(getArg('--seeds', '30'));
const ticks = Number(getArg('--ticks', '400'));
const seeds = Array.from({ length: seedCount }, (_, i) => (i + 1) * 7919);

const EXPORT = `
;globalThis.__probe = {
  createStream, WINDOW, MAX_INTERVAL, MAX_REPEAT, NOTES, hashSeed,
  REGISTER_MIN, REGISTER_MAX, REGISTER_START, REGISTER_WIDTH,
  DENSITY_MIN, DENSITY_MAX, DENSITY_START, SCALE_STEPS, KEY_MODE, ROOT_MIDI,
};`;

const { api, consoleLines } = loadExercise({ file, exportCode: EXPORT });
const {
  createStream, WINDOW, MAX_INTERVAL, MAX_REPEAT, NOTES, hashSeed,
  REGISTER_MIN, REGISTER_MAX, REGISTER_START, REGISTER_WIDTH,
  DENSITY_MIN, DENSITY_MAX, DENSITY_START, SCALE_STEPS, KEY_MODE, ROOT_MIDI,
} = api;
const MIDI = new Map(NOTES.map(note => [note.id, note.midi]));
const SCALE_PCS = new Set(SCALE_STEPS[KEY_MODE].map(step => (ROOT_MIDI + step) % 12));

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const pearson = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
};
const corrText = value => (Number.isFinite(value) ? value.toFixed(2) : '—（不变化）');
// 按某个量把**这些 tick** 分成低/高两半（用来直接看"这个 drift 有没有带动音乐"）
// ★ 传进来的是 tick 序号本身，返回的也是 tick 序号 —— 不要用"在子集里的位置"去索引整条序列。
const halvesByKey = (ticksList, keyOf) => {
  const sorted = [...ticksList].sort((a, b) => keyOf(a) - keyOf(b));
  const cutoff = Math.floor(sorted.length / 2);
  return { low: sorted.slice(0, cutoff), high: sorted.slice(sorted.length - cutoff) };
};

// 与页面**完全一致**的驱动方式：页面每拍调一次 stepOnce()（顺便发那个音），探针就在循环里逐步调它
const runStream = (seed, count, options) => {
  const stream = createStream(seed, options);
  const notes = [];       // 音名 id 或 null（休止）
  const centers = [];
  const densities = [];
  const windowNotes = [];
  const unresolved = [];
  let stalls = 0;
  for (let i = 0; i < count; i += 1) {
    const step = stream.stepOnce();
    if (!step) { stalls += 1; continue; }
    notes.push(step.note);
    centers.push(step.center);
    densities.push(step.density);
    windowNotes.push(step.windowNotes);
    unresolved.push(step.unresolved);
  }
  return { notes, centers, densities, windowNotes, unresolved, report: stream.report, stalls };
};

// 全部指标都从**播放出来的音流**上算 —— 那才是用户听到的东西
const streamMetrics = run => {
  const { notes, centers, densities, windowNotes } = run;
  const midis = notes.map(id => (id ? MIDI.get(id) : null));
  let overInterval = 0;
  let overRepeat = 0;
  let longestRun = 0;
  let runLen = 0;
  let prev = null;
  let outOfScale = 0;
  let sounding = 0;
  let maxRestRun = 0;
  let restRun = 0;
  let restSegments = 0;
  let noteDuration = 0;
  // 音符时长（从起音到下一次休止）：休止格会把正在响的音放掉，所以休止段长度就是音的实际长度
  const noteLengths = [];
  let held = 0;
  for (const id of notes) {
    if (!id) {
      restRun += 1;
      restSegments = restRun === 1 ? restSegments + 1 : restSegments;
      if (restRun > maxRestRun) maxRestRun = restRun;
      if (held > 0) { noteLengths.push(held); held = 0; }
      prev = null;
      runLen = 0;
      continue;
    }
    restRun = 0;
    held += 1;
    sounding += 1;
    if (!SCALE_PCS.has(MIDI.get(id) % 12)) outOfScale += 1;
    if (prev !== null && Math.abs(MIDI.get(id) - MIDI.get(prev)) > MAX_INTERVAL) overInterval += 1;
    runLen = prev === id ? runLen + 1 : 1;
    prev = id;
    if (runLen > longestRun) longestRun = runLen;
    if (runLen === MAX_REPEAT + 1) overRepeat += 1;
  }
  if (held > 0) noteLengths.push(held);

  const soundingIdx = notes.map((id, i) => (id ? i : -1)).filter(i => i >= 0);
  const rg = halvesByKey(soundingIdx, i => centers[i]);
  const dn = halvesByKey(soundingIdx, i => densities[i]);
  const targetGap = notes.map((_, i) => Math.abs(windowNotes[i] - densities[i] * WINDOW));
  const densitySteps = densities.slice(1).map((d, i) => Math.abs(d - densities[i]));
  const centerSteps = centers.slice(1).map((c, i) => Math.abs(c - centers[i]));
  return {
    overInterval,
    overRepeat,
    longestRun,
    outOfScale,
    sounding,
    noteFraction: sounding / notes.length,
    maxRestRun,
    restSegments,
    restPerSegment: (notes.length - sounding) / Math.max(1, restSegments),
    noteLenMean: mean(noteLengths),
    targetGapMean: mean(targetGap),
    targetGapMax: Math.max(...targetGap),
    unresolvedMean: mean(run.unresolved),
    unresolvedMin: Math.min(...run.unresolved),
    unresolvedEmptyShare: run.unresolved.filter(v => v === 0).length / run.unresolved.length,
    corrDensity: pearson(densities, windowNotes),
    densityLowHalf: mean(dn.low.map(i => windowNotes[i])),
    densityHighHalf: mean(dn.high.map(i => windowNotes[i])),
    densityMean: mean(densities),
    densityMin: Math.min(...densities),
    densityMax: Math.max(...densities),
    densityStepMean: mean(densitySteps),
    densityStepMax: Math.max(...densitySteps),
    meanAbsCenterOffset: mean(soundingIdx.map(i => Math.abs(midis[i] - centers[i]))),
    corrCenter: pearson(soundingIdx.map(i => centers[i]), soundingIdx.map(i => midis[i])),
    midiWhenCenterLow: mean(rg.low.map(i => midis[i])),
    midiWhenCenterHigh: mean(rg.high.map(i => midis[i])),
    centerMin: Math.min(...centers),
    centerMax: Math.max(...centers),
    centerStepMean: mean(centerSteps),
    centerStepMax: Math.max(...centerSteps),
    stalls: run.stalls,
  };
};

const configs = [
  { id:'① 两个 drift 都关（全音 · 中心固定）', register: false, density: false },
  { id:'② 只开 register drift', register: true, density: false },
  { id:'③ 只开 density drift', register: false, density: true },
  { id:'④ 两个都开（默认）', register: true, density: true },
  // ⑤ 机制检查：有 rest 配额但疏密值冻在 0.5 —— 把"配平精度"和"漂移滞后"分开量
  { id:'⑤ 配额精度检查（疏密冻结 0.5）', register: false, density: true, densityDrift: false },
];

const rows = configs.map(config => {
  const agg = { overInterval:0, overRepeat:0, longestRun:0, outOfScale:0, stalls:0, notes:0, sounding:0,
    maxRestRun:0, restPerSeg:[], noteLen:[], targetGap:[], targetGapMax:0, noteFraction:[], densityMean:[],
    corrDensity:[], densityLow:[], densityHigh:[], densityMin:99, densityMax:-99, densityStepMean:[], densityStepMax:0,
    corrCenter:[], meanAbs:[], centerLow:[], centerHigh:[], centerMin:99, centerMax:-99, centerStepMean:[], centerStepMax:0,
    unresolvedMean:[], unresolvedMin:99, unresolvedEmpty:[] };
  seeds.forEach(seed => {
    const run = runStream(seed, ticks, { register: config.register, density: config.density, densityDrift: config.densityDrift });
    const m = streamMetrics(run);
    agg.overInterval += m.overInterval;
    agg.overRepeat += m.overRepeat;
    agg.longestRun = Math.max(agg.longestRun, m.longestRun);
    agg.outOfScale += m.outOfScale;
    agg.stalls += m.stalls;
    agg.notes += run.notes.length;
    agg.sounding += m.sounding;
    agg.maxRestRun = Math.max(agg.maxRestRun, m.maxRestRun);
    agg.restPerSeg.push(m.restPerSegment);
    agg.noteLen.push(m.noteLenMean);
    agg.targetGap.push(m.targetGapMean);
    agg.targetGapMax = Math.max(agg.targetGapMax, m.targetGapMax);
    agg.unresolvedMean.push(m.unresolvedMean);
    agg.unresolvedMin = Math.min(agg.unresolvedMin, m.unresolvedMin);
    agg.unresolvedEmpty.push(m.unresolvedEmptyShare);
    agg.noteFraction.push(m.noteFraction);
    agg.densityMean.push(m.densityMean);
    agg.corrDensity.push(m.corrDensity);
    agg.densityLow.push(m.densityLowHalf);
    agg.densityHigh.push(m.densityHighHalf);
    agg.densityMin = Math.min(agg.densityMin, m.densityMin);
    agg.densityMax = Math.max(agg.densityMax, m.densityMax);
    agg.densityStepMean.push(m.densityStepMean);
    agg.densityStepMax = Math.max(agg.densityStepMax, m.densityStepMax);
    agg.corrCenter.push(m.corrCenter);
    agg.meanAbs.push(m.meanAbsCenterOffset);
    agg.centerLow.push(m.midiWhenCenterLow);
    agg.centerHigh.push(m.midiWhenCenterHigh);
    agg.centerMin = Math.min(agg.centerMin, m.centerMin);
    agg.centerMax = Math.max(agg.centerMax, m.centerMax);
    agg.centerStepMean.push(m.centerStepMean);
    agg.centerStepMax = Math.max(agg.centerStepMax, m.centerStepMax);
  });
  return { config, agg };
});

// 决定性：同一颗种子跑两次，整条音流（含休止）逐位相同
let deterministic = 0;
seeds.forEach(seed => {
  const a = runStream(seed, 120, { register: true, density: true }).notes.map(id => id || '·').join(' ');
  const b = runStream(seed, 120, { register: true, density: true }).notes.map(id => id || '·').join(' ');
  if (a === b) deterministic += 1;
});

console.log(`文件: ${path.relative(ROOT, file)}`);
console.log(`音阶 ${KEY_MODE}（根音 midi ${ROOT_MIDI}）· 窗口 ${WINDOW} 格 · 每颗种子 ${ticks} 拍 · ${seeds.length} 颗种子\n`);
console.log('**A 硬规则与结构**（全部从播放出来的音流上量；休止会打断音程链与连击）\n');
console.log('| 配置 | 音程超限 | 连击超限 | 最长连击 | 调外音 | 空转 | 发声比例 | 最长休止段 | 休止段均长 | 连续发声段均长 | 未定音格 均/最小 | 未定音=0 的拍占比 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
rows.forEach(({ config, agg }) => {
  console.log('| ' + config.id +
    ' | ' + agg.overInterval +
    ' | ' + agg.overRepeat +
    ' | ' + agg.longestRun +
    ' | ' + agg.outOfScale + '/' + agg.notes +
    ' | ' + agg.stalls +
    ' | ' + mean(agg.noteFraction).toFixed(3) +
    ' | ' + agg.maxRestRun +
    ' | ' + mean(agg.restPerSeg).toFixed(2) +
    ' | ' + mean(agg.noteLen).toFixed(2) +
    ' | ' + mean(agg.unresolvedMean).toFixed(2) + ' / ' + agg.unresolvedMin +
    ' | ' + (mean(agg.unresolvedEmpty) * 100).toFixed(1) + '% |');
});

console.log('\n**B density drift：窗口音数有没有跟着疏密目标走**（第 ⑤ 行是"疏密冻结"的配平精度检查，用来把漂移滞后分开）\n');
console.log('| 配置 | 平均疏密 | \\|窗口音数−当前疏密×16\\| 均/最大 | corr(疏密,窗口音数) | 疏密低半·窗口音数 | 疏密高半·窗口音数 | 疏密范围 | 每拍\\|Δ疏密\\| 均/最大 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
rows.forEach(({ config, agg }) => {
  const drifts = config.density;
  console.log('| ' + config.id +
    ' | ' + (drifts ? mean(agg.densityMean).toFixed(3) : '—（固定 0.5，不参与）') +
    ' | ' + (drifts ? mean(agg.targetGap).toFixed(2) + ' / ' + agg.targetGapMax.toFixed(1) : '—') +
    ' | ' + (drifts ? corrText(mean(agg.corrDensity)) : '—') +
    ' | ' + (drifts ? mean(agg.densityLow).toFixed(2) : '—') +
    ' | ' + (drifts ? mean(agg.densityHigh).toFixed(2) : '—') +
    ' | ' + (drifts ? agg.densityMin.toFixed(2) + '–' + agg.densityMax.toFixed(2) : '—') +
    ' | ' + (drifts ? mean(agg.densityStepMean).toFixed(4) + ' / ' + agg.densityStepMax.toFixed(3) : '—') + ' |');
});

console.log('\n**C register drift：音高有没有跟着音区中心走**\n');
console.log('| 配置 | 平均\\|音−中心\\| | corr(中心,音) | 中心低半·平均音高 | 中心高半·平均音高 | 差 | 中心范围 | 每拍\\|Δ中心\\| 均/最大 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
rows.forEach(({ config, agg }) => {
  const on = config.register;
  const low = mean(agg.centerLow);
  const high = mean(agg.centerHigh);
  console.log('| ' + config.id +
    ' | ' + (on ? mean(agg.meanAbs).toFixed(2) : '—') +
    ' | ' + (on ? corrText(mean(agg.corrCenter)) : '—（中心不动）') +
    ' | ' + (on ? low.toFixed(2) : '—') +
    ' | ' + (on ? high.toFixed(2) : '—') +
    ' | ' + (on ? (high - low).toFixed(2) : '—') +
    ' | ' + (on ? agg.centerMin.toFixed(1) + '–' + agg.centerMax.toFixed(1) : '—') +
    ' | ' + (on ? mean(agg.centerStepMean).toFixed(3) + ' / ' + agg.centerStepMax.toFixed(2) : '—') + ' |');
});

console.log(`\n决定性（同一颗种子跑两次，120 拍，含休止）：${deterministic}/${seeds.length} 逐位相同`);

// 交叉核对用：界面上输入的种子是**文本**，经 hashSeed(djb2) 变成数字 —— 与真机结果比对时必须走同一条路
const seedText = getArg('--seed-text', '');
if (seedText) {
  const numeric = hashSeed(seedText);
  const run = runStream(numeric, 48, { register: true, density: true });
  const show = arr => arr.slice(0, 16).map((v, i) => (i === 0 ? v : '')).join('');
  console.log(`\n种子文本 "${seedText}" → hashSeed = ${numeric}`);
  console.log(`  前 16 拍: ${run.notes.slice(0, 16).map(id => id || '·').join(' ')}`);
  console.log(`  疏密轨迹: ${run.densities.slice(0, 16).map(d => d.toFixed(2)).join(' → ')}`);
  console.log(`  中心轨迹: ${run.centers.slice(0, 16).map(c => c.toFixed(1)).join(' → ')}`);
}
if (consoleLines.length) console.log(`页面在桩里的输出（${consoleLines.length} 条）：\n  ` + consoleLines.slice(0, 8).join('\n  '));
