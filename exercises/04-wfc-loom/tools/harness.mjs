// 04 的离线桩公共部分：**假 DOM + 假 Tone + 虚拟时钟 + 假 Transport**。
// 两个探针共用这一份：
//   - offline.mjs          跑 0.2 / 0.3 的调度（真实 activateEngine + schedule() + Transport）
//   - offline-minimal.mjs  量 0.4 的生成规则（纯函数 generateSequence）
// ★ 为什么必须共用：**假 Transport 的时间约定只能有一处** —— Tone 里 `scheduleOnce(fn, t)` 的 t 是传输时间，
//   而 fn 收到的参数是音频上下文时间（= 传输位置 + lookAhead）。桩漏了这条，bug 会在离线全绿、只在真机暴露。
import fs from 'node:fs';
import vm from 'node:vm';

export const LOOKAHEAD = 0.1;   // Tone 默认 lookAhead：回调收到的上下文时间比传输位置早这么多

const makeEl = () => {
  const el = {
    value: '', textContent: '', children: [],
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classList: {
      set: new Set(),
      add(...c) { c.forEach(x => this.set.add(x)); },
      remove(...c) { c.forEach(x => this.set.delete(x)); },
      toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); },
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

// 取出页面里最后一段内联 <script>（带 src 的两段不匹配这个正则）
const inlineScriptOf = file => {
  const html = fs.readFileSync(file, 'utf8');
  const match = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop();
  if (!match) throw new Error('没找到内联 <script>：' + file);
  return match[1];
};

// 载入一个练习页：给它一份假环境，把页面脚本跑起来，再把 `exportCode` 接在**同一个脚本作用域**后面
// （页面里的 const/函数不是 window 属性，探针只能这样取到它们）。
export const loadExercise = ({ file, exportCode = '' }) => {
  const triggers = [];        // 记录每一次 triggerAttackRelease：桩的"输出"
  const consoleLines = [];
  const context = { currentTime: 0, _timeouts: { _timeline: [] } };

  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  };
  const transportControls = Object.assign(makeEl(), {
    seedValue: '',
    setPlaying(v) { this.playing = v; },
    setBusy(v) { this.busy = v; },
    clearSeed() { this.value = ''; },
  });
  const document = {
    getElementById: id => (id === 'transportControls' ? transportControls : elementById(id)),
    createElement: () => makeEl(),
    addEventListener() {},
  };

  const transport = {
    _queue: new Map(), _id: 1, seconds: 0,
    scheduleOnce(fn, time) { const id = this._id++; this._queue.set(id, { time, fn }); return id; },
    scheduleRepeat(fn, interval, startTime) { const id = this._id++; this._queue.set(id, { time: startTime, fn, interval }); return id; },
    clear(id) { this._queue.delete(id); },
    cancel() { this._queue.clear(); },
    start() {}, stop() { this.seconds = 0; },
  };
  const Tone = {
    getContext: () => context,
    now: () => context.currentTime,
    start: async () => {},
    Destination: {},
    Transport: transport,
    Draw: { queue: [], schedule(fn, time) { this.queue.push({ fn, time }); }, cancel() { this.queue.length = 0; } },
    Limiter: class { constructor() {} connect() { return this; } dispose() {} },
    Gain: class { constructor() { this.gain = { value: 1, linearRampToValueAtTime() {} }; } connect() { return this; } dispose() {} },
    Reverb: class { constructor() {} connect() { return this; } dispose() {} async generate() {} },
    MonoSynth: class {},
    Synth: class {
      constructor(options) { this.options = options; this.triggered = 0; }
      connect() { return this; } dispose() {}
      triggerAttackRelease(note, duration, time, velocity) { this.triggered += 1; triggers.push({ note, duration, time, velocity }); }
      releaseAll() {}
    },
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
  };

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
  vm.runInContext(inlineScriptOf(file) + exportCode, vm.createContext(sandbox), { filename: file });
  if (!sandbox.__probe) throw new Error('导出失败：页面脚本没有执行到结尾（看上面的输出）');

  return {
    api: sandbox.__probe,
    triggers,
    consoleLines,
    context,
    transport,
    elementById,
    transportControls,
  };
};

// 执行队列里**最早**的一个排程：这就是虚拟时钟的全部
export const pump = ({ transport, context }) => {
  let bestId = null;
  let best = null;
  for (const [id, entry] of transport._queue) {
    if (!best || entry.time < best.time) { best = entry; bestId = id; }
  }
  if (!best) return false;
  if (best.interval) {                       // scheduleRepeat：按间隔把下一次排上
    const next = { time: best.time + best.interval, fn: best.fn, interval: best.interval };
    transport._queue.set(bestId, next);
  } else {
    transport._queue.delete(bestId);
  }
  context.currentTime = best.time + LOOKAHEAD;
  transport.seconds = best.time;
  best.fn(context.currentTime);
  return true;
};

export const nextTick = () => new Promise(resolve => setImmediate(resolve));

// 跑到队列空（或到上限）；返回实际执行的步数
export const drainAll = async harness => {
  let steps = 0;
  while (harness.transport._queue.size) {
    pump(harness);
    await nextTick();
    if (++steps > 20000) throw new Error('调度没有收敛，可能是桩的假 Transport 出了问题');
  }
  await nextTick();
  return steps;
};
