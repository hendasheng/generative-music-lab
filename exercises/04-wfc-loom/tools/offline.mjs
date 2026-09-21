#!/usr/bin/env node
// 04 的离线桩：**不开浏览器、不放声音**，直接把页面里的调度代码跑在「假 DOM + 虚拟时钟 + 假 Transport」上，
// 用来量**结构**：音符序列、拍位、时值、力度、权重规则的实际效果、同一颗种子两次是否逐位相同。
//
// 用法（在仓库根目录）：
//   node exercises/04-wfc-loom/tools/offline.mjs
//   node exercises/04-wfc-loom/tools/offline.mjs --file exercises/04-wfc-loom/0.2/index.html --seeds 7,2024
//
// ★ 它能证明什么、不能证明什么（见 AGENTS.md「验证口径」）：
//   能：模型的判决与序列。不能：声音真的响了没有、画面与发声对不对齐、Tone 的报错与生命周期 —— 那三类必须真机。
// ★ 桩必须忠实模拟 Tone 的约定：`Transport.scheduleOnce(fn, t)` 的 t 是**传输时间**，
//   而 fn 收到的参数是**音频上下文时间**（这里取 传输位置 + LOOKAHEAD）。不模拟这条，bug 会在离线全绿。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const LOOKAHEAD = 0.1;              // Tone 默认 lookAhead：回调收到的上下文时间比传输位置早这么多
const ROOT = process.cwd();

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const file = path.resolve(ROOT, getArg('--file', 'exercises/04-wfc-loom/0.3/index.html'));
const seeds = getArg('--seeds', '123456789,7,2024').split(',').map(Number);

// ── 假 DOM：只实现页面真正用到的那几样 ────────────────────────────────────────────
const makeEl = () => {
  const el = {
    value: '', textContent: '', children: [],
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classList: {
      set: new Set(),
      add(...c) { c.forEach(x => this.set.add(x)); },
      remove(...c) { c.forEach(x => this.set.delete(x)); },
      contains(c) { return this.set.has(c); },
    },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {}, setAttribute() {}, blur() {},
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(v) { html = v; this.children.length = 0; },   // 页面用 `innerHTML = ''` 清空
  });
  return el;
};

const elements = new Map();
const elementById = id => {
  if (!elements.has(id)) elements.set(id, makeEl());
  return elements.get(id);
};
const transportControls = Object.assign(makeEl(), {
  seedValue: '',
  setPlaying(v) { this.playing = v; },
  setBusy(v) { this.busy = v; },
  clearSeed() {},
});

const document = {
  getElementById: id => (id === 'transportControls' ? transportControls : elementById(id)),
  createElement: () => makeEl(),
  addEventListener() {},
};

// ── 假 Tone：节点只记录调用，Transport 用虚拟队列驱动 ─────────────────────────────
const context = { currentTime: 0, _timeouts: { _timeline: [] } };
const triggers = [];      // 记录每一次 triggerAttackRelease：桩的"输出"
const consoleLines = [];

const Tone = {
  getContext: () => context,
  now: () => context.currentTime,
  start: async () => {},
  Destination: {},
  Limiter: class { constructor() {} connect() { return this; } dispose() {} },
  Gain: class { constructor() { this.gain = { linearRampToValueAtTime() {} }; } connect() { return this; } dispose() {} },
  Reverb: class { constructor() {} connect() { return this; } dispose() {} async generate() {} },
  MonoSynth: class {},
  PolySynth: class {
    constructor(voice, options) { this.options = options; this.maxPolyphony = 0; }
    connect() { return this; } dispose() {}
    triggerAttackRelease(note, duration, time, velocity) { triggers.push({ note, duration, time, velocity }); }
    triggerRelease() {} releaseAll() {}
  },
  Sampler: class {
    constructor(options) { this.options = options; if (options.onload) queueMicrotask(() => options.onload()); }
    connect() { return this; } dispose() {}
    triggerAttackRelease(note, duration, time, velocity) { triggers.push({ note, duration, time, velocity }); }
    triggerRelease() {} releaseAll() {}
  },
  Transport: {
    _queue: new Map(), _id: 1, seconds: 0,
    scheduleOnce(fn, time) { const id = this._id++; this._queue.set(id, { time, fn }); return id; },
    clear(id) { this._queue.delete(id); },
    cancel() { this._queue.clear(); },
    start() {}, stop() { this.seconds = 0; },
  },
  Draw: { queue: [], schedule(fn, time) { this.queue.push({ fn, time }); }, cancel() { this.queue.length = 0; } },
};

// ── 取出页面里最后一段内联 <script>（带 src 的两段不匹配这个正则）────────────────
const html = fs.readFileSync(file, 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop();
if (!inline) throw new Error('没找到内联 <script>：' + file);

// 在**同一个脚本作用域**里把要用的东西挂到全局（页面里的 const 不是 window 属性）
const EXPORT = `
;globalThis.__probe = {
  setInstrument: v => { instrument = v; },
  activateEngine,
  hasRecentReset: () => activateEngine.toString().includes('noteState.recent'),
  queueSize: () => Tone.Transport._queue.size,
  runOne: () => {
    let bestId = null, best = null;
    for (const [id, entry] of Tone.Transport._queue) { if (!best || entry.time < best.time) { best = entry; bestId = id; } }
    Tone.Transport._queue.delete(bestId);
    const ctx = Tone.getContext();
    ctx.currentTime = best.time + ${LOOKAHEAD};   // 上下文时间比传输位置早 lookAhead（Tone 的约定）
    Tone.Transport.seconds = best.time;
    best.fn(ctx.currentTime);
  },
  transportStop: () => { Tone.Transport.stop(); Tone.Transport.cancel(); },
};`;

const sandbox = {
  document,
  Tone,
  window: { setTimeout: () => 0, clearTimeout() {}, addEventListener() {} },
  console: {
    log: (...a) => consoleLines.push(a.join(' ')),
    warn: (...a) => consoleLines.push('warn: ' + a.join(' ')),
    error: (...a) => consoleLines.push('error: ' + a.join(' ')),
  },
};
vm.runInContext(inline[1] + EXPORT, vm.createContext(sandbox), { filename: file });

const P = sandbox.__probe;
if (!P) throw new Error('导出失败：页面脚本没有执行到结尾（看上面的 console 输出）');

const tick = () => new Promise(resolve => setImmediate(resolve));

// 跑到 Transport 队列空（每一步都会排下一步，排完 64 步就自然停）
const drain = async () => {
  let guard = 0;
  while (P.queueSize() > 0) {
    P.runOne();
    await tick();
    if (++guard > 4000) throw new Error('调度没有收敛，可能是桩的假 Transport 出了问题');
  }
  await tick();
};

const runOnce = async engine => {
  triggers.length = 0;
  engine.schedule();
  await drain();
  return triggers.map(t => ({ note: t.note, time: +t.time.toFixed(6), dur: +t.duration.toFixed(6), vel: +t.velocity.toFixed(6) }));
};

const firstDiff = (a, b) => {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { index: i, a: a[i], b: b[i] };
  }
  return null;
};
const show = n => (n === undefined ? '—' : `${n.note}@${n.time}s dur=${n.dur} vel=${n.vel}`);

console.log(`文件: ${path.relative(ROOT, file)}`);
console.log(`桩: 假 DOM + 虚拟时钟（回调时间 = 传输位置 + ${LOOKAHEAD}s）+ 假 Transport；音色固定为合成器\n`);

const results = [];
for (const seed of seeds) {
  // ① 同一个引擎连跑两场（页面「整曲结束后再按播放」走的就是这条：engine 还在，只调 schedule()）
  const engineA = await P.activateEngine(seed);
  P.transportStop();
  const run1 = await runOnce(engineA);
  P.transportStop();
  const run2 = await runOnce(engineA);

  // ② 对照：**全新引擎**的第 1 场（noteState 一定是干净的）。同一颗种子下它才是"第 2 场应该长什么样"
  const engineB = await P.activateEngine(seed);
  P.transportStop();
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
if (consoleLines.length) console.log(`\n页面在桩里的输出（${consoleLines.length} 条）：\n  ` + consoleLines.slice(0, 10).join('\n  '));
