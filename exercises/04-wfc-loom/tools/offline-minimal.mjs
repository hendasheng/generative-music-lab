#!/usr/bin/env node
// 04 0.4 的离线探针：量**生成规则**（纯函数 generateSequence），不开浏览器、不放声音。
//
// 用法（在仓库根目录）：
//   node exercises/04-wfc-loom/tools/offline-minimal.mjs
//   node exercises/04-wfc-loom/tools/offline-minimal.mjs --seeds 30 --cells-check
//
// ★ 0.4 的规矩是「一条规则一验」：所以这里的对照**不是**"WFC vs 纯随机"
//   （用户明确说不需要纯随机版：那个问题他能想象），而是**每次只关掉一条规则**，
//   看这条规则自己削掉了什么。两条规则都关掉的那种全局随机对照，这里故意不做。
// ★ 假环境在 ./harness.mjs。它能证明模型（序列、规则效果、决定性），
//   证明不了"真的响了 / 画面对不对齐" —— 那要真机（见根 AGENTS.md「验证口径」）。
import path from 'node:path';
import { loadExercise } from './harness.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const file = path.resolve(ROOT, getArg('--file', 'exercises/04-wfc-loom/0.4/index.html'));
const seedCount = Number(getArg('--seeds', '30'));
const seeds = Array.from({ length: seedCount }, (_, i) => (i + 1) * 7919);

const EXPORT = `
;globalThis.__probe = {
  createModel, MAX_INTERVAL, MAX_REPEAT, CELL_COUNT, NOTES, hashSeed,
  KEY_ROOT, KEY_MODE, ROOT_MIDI, SCALE_STEPS, SCALE_IDS,
};`;

const { api, consoleLines } = loadExercise({ file, exportCode: EXPORT });
const { createModel, MAX_INTERVAL, MAX_REPEAT, CELL_COUNT, NOTES, hashSeed, KEY_ROOT, KEY_MODE, ROOT_MIDI, SCALE_STEPS, SCALE_IDS } = api;
const MIDI = new Map(NOTES.map(note => [note.id, note.midi]));
const SCALE_PCS = new Set(SCALE_STEPS[KEY_MODE].map(step => (ROOT_MIDI + step) % 12));

// ★ 驱动方式与页面**完全一致**：页面在每拍调一次 `model.stepOnce()`（顺便发那个音），
//   探针就在循环里一步步调同一个方法 —— 不另写一条"纯函数版"的路径去测（那样测的可能是页面不用的代码）。
const runToEnd = (seed, config) => {
  const model = createModel(seed, { maxInterval: config.maxInterval, maxRepeat: config.maxRepeat });
  let chosen = 0;
  while (model.stepOnce()) chosen += 1;
  return { notes: model.notes(), report: model.report, chosen };
};

// 探针自己算这些量，不用页面里的统计函数（验证时不要复用被验证的代码）
// ★ "超限"一律按**规则写在代码里的那个值**（MAX_INTERVAL / MAX_REPEAT）算，
//   而不是按当前配置的值 —— 否则关掉规则时"超限数"永远是 0，正好把要量东西掩盖掉。
const measure = notes => {
  let maxInterval = 0;
  let overLimit = 0;
  let longestRun = 1;
  let run = 1;
  let runsOverRepeat = 0;
  for (let i = 1; i < notes.length; i += 1) {
    const step = Math.abs(MIDI.get(notes[i]) - MIDI.get(notes[i - 1]));
    if (step > maxInterval) maxInterval = step;
    if (step > MAX_INTERVAL) overLimit += 1;
    run = notes[i] === notes[i - 1] ? run + 1 : 1;
    if (run > longestRun) longestRun = run;
    if (run === MAX_REPEAT + 1) runsOverRepeat += 1;
  }
  return { maxInterval, overLimit, longestRun, runsOverRepeat };
};

const configs = [
  { id:'① 默认（interval 5 / repeat 2）', maxInterval: MAX_INTERVAL, maxRepeat: MAX_REPEAT },
  { id:'② 只关规则①（interval ∞ / repeat 2）', maxInterval: Infinity, maxRepeat: MAX_REPEAT },
  { id:'③ 只关规则②（interval 5 / repeat ∞）', maxInterval: MAX_INTERVAL, maxRepeat: Infinity },
  // ④ 机制检查：把音程收紧到 2 半音，传播才会把某些格子削到"只剩一个候选"，
  //    从而压到「传播推出 → 直接确定 → 继续向外约束」这条分支（默认参数下这条分支一次都不会走到）。
  //    这一行不是音乐方案，只用来证明机制是活的。
  { id:'④ 机制检查（interval 2 / repeat 2）', maxInterval: 2, maxRepeat: MAX_REPEAT },
];

const rows = configs.map(config => {
  const agg = { maxIntervalMax: 0, overLimitTotal: 0, longestRunMax: 0, runsOverRepeatTotal: 0, removedSum: 0, relaxations: 0, badLength: 0, chosenSum: 0, forcedSum: 0, outOfScale: 0, notesTotal: 0, sample: null };
  seeds.forEach((seed, i) => {
    const { notes, report, chosen } = runToEnd(seed, config);
    if (notes.length !== CELL_COUNT || notes.some(id => !id)) agg.badLength += 1;
    const m = measure(notes);
    agg.maxIntervalMax = Math.max(agg.maxIntervalMax, m.maxInterval);
    agg.overLimitTotal += m.overLimit;
    agg.longestRunMax = Math.max(agg.longestRunMax, m.longestRun);
    agg.runsOverRepeatTotal += m.runsOverRepeat;
    agg.removedSum += report.removed;
    agg.relaxations += report.relaxations;
    agg.chosenSum += chosen;
    agg.forcedSum += report.forced;
    // 调外音 = 音的 pitch class 不在音阶结构里（候选只从音阶派生，所以正常应当恒为 0）
    notes.forEach(id => { agg.notesTotal += 1; if (!SCALE_PCS.has(MIDI.get(id) % 12)) agg.outOfScale += 1; });
    if (i === 0) agg.sample = notes.join(' ');
  });
  agg.removedAvg = agg.removedSum / seeds.length;
  agg.chosenAvg = agg.chosenSum / seeds.length;
  agg.forcedAvg = agg.forcedSum / seeds.length;
  return { config, agg };
});

// 决定性：同一颗种子生成两次必须逐位相同
let deterministic = 0;
seeds.forEach(seed => {
  const a = runToEnd(seed, configs[0]).notes.join(' ');
  const b = runToEnd(seed, configs[0]).notes.join(' ');
  if (a === b) deterministic += 1;
});

console.log(`文件: ${path.relative(ROOT, file)}`);
console.log(`调: ${KEY_ROOT} ${KEY_MODE}（音阶结构 ${SCALE_STEPS[KEY_MODE].join('/')}，根音 midi ${ROOT_MIDI}）· 每颗 ${CELL_COUNT} 个 Cell · BPM 112 / 八分音符 / Velocity 90\n`);
console.log('每条规则单独关掉，看它自己削掉了什么。\n"主动坍缩"= 按熵顺序真正做过选择的次数（候选最少且大于 1）；"传播推出"= 被约束削到只剩一个候选而直接确定的格数：\n');
console.log('| 配置 | 最大相邻音程 | 超限相邻对 | 最长同音连击 | 超限连击段 | 主动坍缩(均) | 传播推出(均) | 削减(均) | 放宽 | 调外音 | 长度异常 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
rows.forEach(({ config, agg }) => {
  console.log(`| ${config.id} | ${agg.maxIntervalMax} | ${agg.overLimitTotal} | ${agg.longestRunMax} | ${agg.runsOverRepeatTotal} | ${agg.chosenAvg.toFixed(1)} | ${agg.forcedAvg.toFixed(1)} | ${agg.removedAvg.toFixed(1)} | ${agg.relaxations} | ${agg.outOfScale}/${agg.notesTotal} | ${agg.badLength} |`);
});
console.log('');
rows.forEach(({ config, agg }) => console.log(`${config.id}\n  样例: ${agg.sample}`));
console.log(`\n决定性（同一颗种子生成两次）：${deterministic}/${seeds.length} 逐位相同`);

// 交叉核对用：界面上输入的种子是**文本**，经 hashSeed(djb2) 变成数字 —— 与真机结果比对时必须走同一条路
// （★ "输入框填 12345" ≠ "数字 12345"，这是两首不同的曲子）
const seedText = getArg('--seed-text', '');
if (seedText) {
  const numeric = hashSeed(seedText);
  const { notes, chosen } = runToEnd(numeric, configs[0]);
  const m = measure(notes);
  const outside = notes.filter(id => !SCALE_PCS.has(MIDI.get(id) % 12));
  console.log(`\n种子文本 "${seedText}" → hashSeed = ${numeric}`);
  console.log(`  离线序列: ${notes.join(' ')}`);
  console.log(`  最大音程 ${m.maxInterval} · 最长连击 ${m.longestRun} · 超限对 ${m.overLimit} · 3 连击段 ${m.runsOverRepeat} · 主动坍缩 ${chosen} 次 · 调外音 ${outside.length}`);
}
if (consoleLines.length) console.log(`页面在桩里的输出（${consoleLines.length} 条）：\n  ` + consoleLines.slice(0, 8).join('\n  '));
