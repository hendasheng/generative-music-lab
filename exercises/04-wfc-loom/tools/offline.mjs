#!/usr/bin/env node
// 04 的离线桩（**0.2 / 0.3**）：不开浏览器、不放声音，直接把页面里的调度代码跑在
// 「假 DOM + 虚拟时钟 + 假 Transport」上，用来量**结构**：音符序列、拍位、时值，以及
// "同一颗种子两次是否逐位相同"（包括整曲放完后再按播放那条路径）。
//
// 用法（在仓库根目录）：
//   node exercises/04-wfc-loom/tools/offline.mjs
//   node exercises/04-wfc-loom/tools/offline.mjs --file exercises/04-wfc-loom/0.2/index.html --seeds 7,2024
//
// ★ 它能证明什么、不能证明什么（见根 AGENTS.md「验证口径」）：
//   能：模型的判决与序列。不能：声音真的响了没有、画面与发声对不对齐、Tone 的报错与生命周期 —— 那三类必须真机。
// ★ 假环境在 ./harness.mjs（0.4 的离线探针 offline-minimal.mjs 共用同一份）。
import path from 'node:path';
import { loadExercise, drainAll, LOOKAHEAD } from './harness.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const file = path.resolve(ROOT, getArg('--file', 'exercises/04-wfc-loom/0.3/index.html'));
const seeds = getArg('--seeds', '123456789,7,2024').split(',').map(Number);

// 在页面自己的脚本作用域里把要用的东西挂出来（页面里的 const 不是 window 属性）
const EXPORT = `
;globalThis.__probe = {
  setInstrument: v => { instrument = v; },          // 用合成器，避开钢琴采样的异步加载
  activateEngine,
  hasRecentReset: () => activateEngine.toString().includes('noteState.recent'),
};`;

const harness = loadExercise({ file, exportCode: EXPORT });
const P = harness.api;
P.setInstrument('synth');

const runOnce = async engine => {
  harness.triggers.length = 0;
  engine.schedule();
  await drainAll(harness);
  return harness.triggers.map(t => ({ note: t.note, time: +t.time.toFixed(6), dur: +t.duration.toFixed(6), vel: +t.velocity.toFixed(6) }));
};

const firstDiff = (a, b) => {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { index: i, a: a[i], b: b[i] };
  }
  return null;
};
const show = n => (n === undefined ? '—' : `${n.note}@${n.time}s dur=${n.dur} vel=${n.vel}`);
const stopTransport = () => { harness.transport.stop(); harness.transport.cancel(); };

console.log(`文件: ${path.relative(ROOT, file)}`);
console.log(`桩: 假 DOM + 虚拟时钟（回调时间 = 传输位置 + ${LOOKAHEAD}s）+ 假 Transport；音色固定为合成器\n`);

const results = [];
for (const seed of seeds) {
  // ① 同一个引擎连跑两场（页面「整曲结束后再按播放」走的就是这条：engine 还在，只调 schedule()）
  const engineA = await P.activateEngine(seed);
  stopTransport();
  const run1 = await runOnce(engineA);
  stopTransport();
  const run2 = await runOnce(engineA);

  // ② 对照：**全新引擎**的第 1 场（noteState 一定是干净的）。同一颗种子下它才是"第 2 场应该长什么样"
  const engineB = await P.activateEngine(seed);
  stopTransport();
  const fresh = await runOnce(engineB);

  const diff = firstDiff(run2, fresh);
  const control = firstDiff(run1, fresh);
  results.push({ seed, run1, run2, fresh, diff, control });
  console.log(`种子 ${seed}`);
  console.log(`  第 1 场（同一引擎）：${run1.length} 个音，前 6 个 ${run1.slice(0, 6).map(show).join(' | ')}`);
  console.log(`  第 2 场（同一引擎）：${run2.length} 个音`);
  console.log(`  对照（全新引擎）：  ${fresh.length} 个音`);
  console.log(`  第 1 场 vs 对照：${control ? `**不同**：第 ${control.index + 1} 个音 ${show(control.a)} ≠ ${show(control.b)}` : '逐位相同'}`);
  console.log(`  第 2 场 vs 对照：${diff ? `**不同**：第 ${diff.index + 1} 个音 ${show(diff.a)} ≠ ${show(diff.b)}` : '逐位相同'}\n`);
}

const broken = results.filter(r => r.diff);
console.log(`schedule() 里是否清了 noteState.recent：${P.hasRecentReset() ? '是' : '否'}`);
console.log(broken.length
  ? `结论：放完再按播放 ≠ 重新加载 —— ${broken.length}/${results.length} 个种子第 2 场与对照不同（第 1 场逐位相同）。`
  : `结论：${results.length}/${results.length} 个种子第 2 场与对照逐位相同。`);
if (harness.consoleLines.length) {
  console.log(`\n页面在桩里的输出（${harness.consoleLines.length} 条）：\n  ` + harness.consoleLines.slice(0, 10).join('\n  '));
}
