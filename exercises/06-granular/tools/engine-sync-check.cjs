#!/usr/bin/env node
// 0.3.1 从 0.3 同步引擎时，必须证明「合成器听起来没变」。
// 这两份引擎的计划层（plan / dryOctaveEvent / octaveEvent / inputGain / defaultSpray）
// 是与版本无关的共用代码，本脚本用同一批种子把两边的输出逐字节比对：
//   - 计划事件序列（offset / length / rate / reverse / pan / peak）
//   - 引擎 schedule 后真正排给 BufferSource 的 start(when, offset) 序列
//   - 每条随机流（粒子 / timing / shimmer / harmony）的消耗
// 只有这些全等，才敢说 0.3.1 的声音没有变化。
//
// 用法：node exercises/06-granular/tools/engine-sync-check.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const before = process.argv[2] || path.join(__dirname, 'engine-0.3.1-before.js');
const after = process.argv[3] || path.join(__dirname, '../0.3.1/engine.js');

if (!fs.existsSync(before)) {
  console.error('找不到同步前的引擎快照：' + before);
  console.error('把同步前的 0.3.1/engine.js 放好再跑；本脚本用于证明同步没有改变声音。');
  process.exit(1);
}

// 与 check.cjs 同款的最小 Web Audio 桩。每个 realm 一个类；实例按创建顺序记进 contexts，
// 因为引擎会自己 new AudioContext —— 那才是真正排程的实例（早先量错实例，start 次数假报 0）。
function makeAudioContextClass(contexts) {
  class Param {
    constructor() { this.value = 0; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
    cancelScheduledValues() {}
    setValueCurveAtTime() {}
  }
  class Node {
    constructor(ctx) {
      this.ctx = ctx; this.frequency = new Param(); this.Q = new Param(); this.gain = new Param();
      this.pan = new Param(); this.playbackRate = new Param(); this.threshold = new Param();
      this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param();
      ctx.nodes.push(this);
    }
    connect(n) { return n; }
    disconnect() {}
    start(t, offset) { this.ctx.starts.push({ t, offset, rate: this.playbackRate.value }); }
    stop() {}
  }
  return class AudioContext {
    constructor() { contexts.push(this); this.currentTime = 0; this.sampleRate = 44100; this.nodes = []; this.starts = []; this.destination = {}; }
    async resume() {}
    async close() {}
    createBiquadFilter() { return new Node(this); }
    createConvolver() { return new Node(this); }
    createGain() { return new Node(this); }
    createDynamicsCompressor() { return new Node(this); }
    createBufferSource() { return new Node(this); }
    createStereoPanner() { return new Node(this); }
    // 桩要跟着被测代码走：0.3.1 的引擎在 compressor 与 destination 之间插了 AnalyserNode
    // 并用它做 levels() 电平读数。没有这一条，整个同步检查会在 create() 里崩掉
    // （TypeError: ctx.createAnalyser is not a function）——这条崩掉的时候默认调用
    // 正因缺快照提前退出，所以一直没人看见。与 check.cjs 里的同款桩保持一致。
    createAnalyser() { const a = new Node(this); a.fftSize = 2048; a.getFloatTimeDomainData = buf => buf.fill(0); return a; }
    createBuffer(ch, len, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: c => data[c] };
    }
  };
}

function load(file) {
  const intervals = new Map();
  const contexts = [];
  let id = 0;
  const AudioContext = makeAudioContextClass(contexts);
  const sandbox = {
    window: {}, AudioContext, Float32Array,
    setInterval: fn => { intervals.set(++id, fn); return id; },
    clearInterval: i => intervals.delete(i), setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return { G: sandbox.window.Granular, AudioContext, contexts, intervals };
}
const A = load(before);
const B = load(after);

// ★ 两份引擎各在自己的 vm realm 里，对象/数组的 prototype 不同。
// `node:assert/strict` 的 deepEqual 就是 deepStrictEqual，会比较 prototype，
// 于是「值完全一样」也会失败（报 "same structure but are not reference-equal"）。
// 所以这里必须按值比，不能用 assert.deepEqual。
const valueEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some(k => !kb.includes(k))) return false;
  return ka.every(k => valueEqual(a[k], b[k]));
};
const assertSame = (actual, expected, label, context) => {
  if (valueEqual(actual, expected)) return;
  assert.fail(`${label} 不一致 ${context || ''}\n  实际=${JSON.stringify(actual)}\n  期望=${JSON.stringify(expected)}`);
};

// 1) 计划层：同一批种子逐字节比对，覆盖全部参数角。
const planParams = [
  { ...A.G.defaults },
  { ...A.G.defaults, position: 0, spray: .5, reverse: 1, size: 15, density: 2, pitch: -24, pan: 1 },
  { ...A.G.defaults, position: 1, spray: 0, reverse: 0, size: 1000, density: 60, pitch: 24, pan: 0 },
  { ...A.G.defaults, position: .63, spray: .2, reverse: .37, size: 180, density: 24, pitch: 7, pan: .8 },
];
let compared = 0;
for (const params of planParams) {
  for (const duration of [.002, .1, 8, 30]) {
    for (const seed of ['grain-01', 'a', 'seed:timing', '测试']) {
      const ra = A.G.random(seed), rb = B.G.random(seed);
      const seqA = Array.from({ length: 200 }, () => A.G.plan(params, duration, ra));
      const seqB = Array.from({ length: 200 }, () => B.G.plan(params, duration, rb));
      assertSame(seqB, seqA, 'plan ', `params=${JSON.stringify(params)} duration=${duration} seed=${seed}`);
      compared += 200;
    }
  }
}
console.log(`PASS: 计划层逐字节一致，${compared} 个事件（4 组参数 × 4 种时长 × 4 个种子 × 200）。`);

// 2) 派生事件（干声八度 / 湿声八度）
for (const params of planParams) {
  for (const duration of [.002, .1, 8]) {
    for (const seed of ['grain-01', 'b']) {
      const ra = A.G.random(seed), rb = B.G.random(seed);
      for (let i = 0; i < 100; i++) {
        const base = A.G.plan(params, duration, ra);
        const baseB = B.G.plan(params, duration, rb);
        assertSame(B.G.dryOctaveEvent(baseB, duration), A.G.dryOctaveEvent(base, duration), 'dryOctaveEvent');
        assertSame(B.G.octaveEvent(baseB, duration), A.G.octaveEvent(base, duration), 'octaveEvent');
      }
    }
  }
}
console.log('PASS: 干声/湿声八度派生一致（1200 对）。');

// 3) 输入补偿与默认散布
for (const v of [0, .0001, .01, .16, .9]) {
  const buf = { numberOfChannels: 2, getChannelData: () => new Float32Array(1000).fill(v) };
  assert.equal(B.G.inputGain(buf), A.G.inputGain(buf), 'inputGain 不一致 @' + v);
}
for (const s of [.5, 1, 8, 30]) assert.equal(B.G.defaultSpray(s), A.G.defaultSpray(s), 'defaultSpray 不一致 @' + s);
console.log('PASS: inputGain 与 defaultSpray 一致。');

// 4) XY 映射
for (const x of [0, .2, .5, .9, 1]) for (const y of [0, .25, .5, .75, 1]) {
  assertSame(B.G.fromXY(x, y), A.G.fromXY(x, y), 'fromXY');
  assertSame(B.G.toXY({ ...A.G.defaults, position: x, spray: y * .5 }), A.G.toXY({ ...A.G.defaults, position: x, spray: y * .5 }), 'toXY');
}
console.log('PASS: XY 映射一致。');

// 5) 真正排给 Web Audio 的调度序列（引擎 schedule 后的 start(when, offset)）
(async () => {
  // ★ 这份清单是「当前引擎导出面」的快照，改引擎导出面时**必须同步改这里**，否则整条
  //   同步检查会在这一步假失败。踩过一次：0.3.1 从 0.3 同步时新增了 setAudioSession、
  //   并把 levels 收进 create() 的返回值，清单却没改——之后默认调用一直因为「找不到
  //   engine-0.3.1-before.js 快照」提前退出，没人发现这条断言早就过不去了。
  const API_KEYS = ['defaults', 'random', 'plan', 'demo', 'create', 'dryOctaveEvent', 'octaveEvent', 'inputGain', 'defaultSpray', 'fromXY', 'toXY', 'reverseFromSpray', 'setAudioSession'];
  assertSame(Object.keys(B.G).sort(), Object.keys(A.G).sort(), '导出面');
  assertSame(Object.keys(B.G).sort(), [...API_KEYS].sort(), '导出面与预期');
  console.log('PASS: 导出面一致（' + API_KEYS.length + ' 项）。');

  const drive = async (mod) => {
    // 先用一个独立实例造素材（AudioContext 桩的 createBuffer 是实例方法），
    // 再让引擎 create —— 引擎会自己 new 一个 AudioContext，那才是真正排程的实例，
    // 排在 staging 之后。
    const staging = new mod.AudioContext();
    const buffer = staging.createBuffer(2, staging.sampleRate * 8, staging.sampleRate);
    const marker = mod.contexts.length;
    const eng = await mod.G.create(buffer, { ...mod.G.defaults }, 'sync-seed');
    const ctx = mod.contexts[marker];      // create 新建的那个上下文
    assert(ctx, '引擎没有创建自己的 AudioContext');
    assert.equal(mod.contexts.length, marker + 1, '引擎应恰好创建一个 AudioContext');
    eng.schedule();
    // 用虚拟时钟推进若干步，模拟真实调度循环
    const steps = [];
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += .025;
      const tick = [...mod.intervals.values()][0];
      if (tick) tick();
      steps.push(ctx.starts.length);
    }
    const starts = ctx.starts.map(s => ({ t: +s.t.toFixed(9), offset: +s.offset.toFixed(9), rate: +s.rate.toFixed(9) }));
    const events = eng.events.map(e => ({ offset: +e.offset.toFixed(9), length: +e.length.toFixed(9), rate: e.rate, reverse: e.reverse, pan: +e.pan.toFixed(9), peak: +e.peak.toFixed(9), wetOnly: !!e.wetOnly, octave: e.octave ?? null }));
    await eng.deactivate();
    return { starts, events, steps };
  };
  const ra = await drive(A);
  const rb = await drive(B);
  assertSame(rb.starts, ra.starts, '调度序列（start when/offset/rate）');
  assertSame(rb.events, ra.events, '引擎事件序列');
  assertSame(rb.steps, ra.steps, '逐步排程数量');
  console.log(`PASS: 调度序列一致（${ra.starts.length} 次 BufferSource.start，40 个调度步，事件 ${ra.events.length} 条）。`);
  console.log('\n结论：0.3.1 同步 0.3 引擎后，计划层与音频调度逐字节相同，声音未变。');
})().catch(error => { console.error(error); process.exitCode = 1; });
