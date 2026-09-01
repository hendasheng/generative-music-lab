# piece-zed 中文注解版

> 目标文件：`generative-pieces/packages/piece-zed/src/piece.js`（224 行，全仓库 60 首曲子里最完整的教学样本）
> 建议打开源码对照阅读。本文所有行号均指该文件。

---

## 0. 全曲架构速览

```
┌─────────────────────────────────────────────────────────────┐
│  activate()  —— 分配资源（加载/渲染/缓存，只做一次）            │
│   ① 请求采样   ② 预渲染 Pad 乐器   ③ 预渲染噪声缓冲             │
│   ④ 建滤波器/播放器节点                                        │
│   └→ 返回 [deactivate, schedule]                             │
├─────────────────────────────────────────────────────────────┤
│  schedule()  —— 指挥演出（沿 Tone.Transport 时间轴安排事件）     │
│   ① 启动 LFO 网（滤波器/音量缓慢漂移）                          │
│   ② 播放循环噪声（"风"）                                       │
│   ③ playRandomChord() 递归 —— 随机和弦，永不停歇                │
│   └→ 返回 end()（停止演出）                                    │
├─────────────────────────────────────────────────────────────┤
│  deactivate() —— 释放所有 Web Audio 节点                       │
└─────────────────────────────────────────────────────────────┘
```

外层还有两个通用包装（在 `@generative-music/utilities`）：

- **`wrapActivate`**（`packages/utilities/src/wrap-activate.js`）：设置 Tone context、注入 `window.generativeMusic.rng` 随机源、输出接 `Compressor → Gain` 总线、传 `gain` 参数做单曲音量归一化。
- **`makeActiveStage`**（`packages/utilities/src/make-active-stage.js`）：每次 schedule 时建一个 Gain 节点做 0.1 秒淡入淡出（防爆音）；deactivate 时先 end 掉所有演出再释放。

**先记住一句话：`activate` 分配内存，`schedule` 安排演出，`deactivate` 释放资源。** 这是全仓库的统一契约。

---

## 1. 导入与素材（第 1–9 行）

```js
import * as Tone from 'tone';
import { wrapActivate, toss, createPrerenderableInstrument, createPrerenderedBuffer } from '@generative-music/utilities';
import { sampleNames } from '../piece.gfm.manifest.json';   // 本曲声明的采样清单
import gainAdjustments from '../../../normalize/gain.json';  // 全站音量归一化表
```

- **manifest**（`piece.gfm.manifest.json`）：每首曲子的"身份证"——标题、封面图、id、标签、发布日期、`sampleNames`（需要哪些采样）。前端播放器靠它渲染浏览页。
- **gain.json**：每首曲子一个系数（zed 是 `0.875`，有的曲子到 `8`），因为不同合成器的响度差异巨大，归一化后用户切歌不会忽大忽小。

---

## 2. 音符空间（第 11–13 行）—— 全曲最重要的"偷懒"

```js
const PITCH_CLASSES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];  // 只留白键
const OCTAVES = [3, 4];
const NOTES = toss(PITCH_CLASSES, OCTAVES);  // 笛卡尔积 → 14 个音符
```

- `toss` 是笛卡尔积工具：`['C','D'] × [3,4]` = `['C3','D3','C4','D4']`。
- 只留白键 = **C 大调 / A 小调的音符空间**。所有随机选择都从这 14 个音里挑，**音乐性不是靠算法保证的，而是靠一开始就缩小选择空间**。
- 生成式音乐第一法则：**先定义好"只能出现什么"，剩下的交给随机**。这样永远不会出难听的音。

---

## 3. createSynth —— Pad 合成器（第 15–60 行）

```js
const synth = new Tone.DuoSynth({
  voice0: { oscillator: { type: 'square' },   // 方波
    envelope: { attack: 5, release: 12 },      // 起音 5 秒！释放 12 秒！
    filterEnvelope: { attack: 5, release: 12 } },
  voice1: { oscillator: { type: 'sawtooth' },  // 锯齿波
    envelope: { attack: 5, release: 12 },
    filterEnvelope: { attack: 5, release: 12 } },
  harmonicity: 0,          // 两个振荡器同频混合
  vibratoRate: 0.45, vibratoAmount: 0.45,
  volume: -20,
});
const reverb = await new Tone.Reverb({ decay: 20 })   // 20 秒衰减的巨型混响
  .set({ wet: 0.5 }).connect(context.destination).generate();
synth.connect(reverb);
```

**环境音乐的核心配方：超慢包络 + 超长混响。**

- `attack: 5` 意味着按下一个音后，声音要花 5 秒才"长"出来——人耳感知不到起音，声音像雾一样弥散开。
- `release: 12` 让声音松手后还要响 12 秒，和弦之间无缝重叠。
- `Reverb.generate()` 是**离线**生成混响的脉冲响应（一个卷积核），要 `await`。
- `DuoSynth` = 两个振荡器（方波+锯齿）各带自己的滤波包络，做出更厚实的音色。

> 对比学习：你第一首曲子里对应的 `createPad` 用的是单振荡器 `PolySynth`，原理完全一样，只是少了一层。

---

## 4. createNoise —— 噪声层（第 62–99 行）

```js
const reverb = await new Tone.Reverb({ decay: 20 }).set({ wet: 0.35 })...
const noiseSynthFxGain = new Tone.Gain().connect(reverb);
const noiseSynth = new Tone.NoiseSynth({ envelope: { sustain: 1, attack: 0 }, volume: -40 })
  .connect(noiseSynthFxGain);

// LFO 1：方波控制噪声音量 → 噪声像"风"一样一阵一阵
const noiseSynthFxGainLfo = new Tone.LFO({ type: 'square' }).set({ phase: 270 })
  .connect(noiseSynthFxGain.gain).start();

// LFO 2：极慢地调制 LFO 1 的频率 → 风的"呼吸节奏"本身也在漂移
const noiseSynthFxGainLfoFrequencyLfo = new Tone.LFO({ min: 2, max: 20, frequency: 0.075 })
  .set({ phase: 90 }).connect(noiseSynthFxGainLfo.frequency).start();
```

**生成式音乐第二法则：LFO 套 LFO，制造永不重复的缓慢变化。**

- 一个方波 LFO 周期性地把噪声音量从 0 开到最大再关掉——听起来就是风声的起伏。
- 关键细节：**LFO 的频率本身又被另一个更慢的 LFO 调制**（2~20 Hz 之间以 0.075 Hz 漂移）。两层循环周期不是整数倍关系，永远不重合，所以听感上永远不会"重复"。

> 对比学习：你第一首曲子里的 `createAir` 完全照搬了这个结构，只是参数更柔和。

---

## 5. activate —— 资源分配（第 101–129 行）

```js
const activate = async ({ sampleLibrary, onProgress }) => {
  const samples = await sampleLibrary.request(Tone.context, sampleNames);  // ① 加载采样

  const padSynth = await createPrerenderableInstrument({   // ② 预渲染 Pad 乐器
    sampleLibrary, samples,
    createInstrument: createSynth,
    notes: NOTES, noteDuration: 20,
    renderedInstrumentName: 'zed__pad',
    onProgress: val => onProgress(val * 0.95),
  });
  ...
  if (!samples['zed__noise']) {                             // ③ 预渲染噪声缓冲
    const fullNoiseSynthBuffer = await createPrerenderedBuffer({
      createSource: createNoise, duration: 2 / 0.075,
    });
    ...
    sampleLibrary.save([['zed__noise', [noiseSynthBuffer]]]);
  }
  ...
  return [deactivate, schedule];
};
```

**生成式音乐第三法则（也是性能核心）：把"贵"的声音计算全部提前，播放时只按一下采样器。**

- `createPrerenderableInstrument`（`utilities/src/create-prerenderable-instrument.js`）：
  - 对 `NOTES` 里每个音符，用 Tone 的 **`Offline` 离线渲染器**把合成器+混响效果链渲染成一段 AudioBuffer（`createPrerenderedBuffer` 里的 `Tone.Offline`）。
  - 渲染结果存进 `sampleLibrary`（IndexedDB 缓存），下次加载直接读缓存秒开。
  - 最后包装成一个 `Tone.Sampler`——播放时触发采样器 = 播放预制好的声音，**CPU 占用接近零**。
- 预渲染队列是串行的（`createPrerenderedBuffer` 里一个 queue 一次只渲染一个），避免内存爆炸。
- 这就是为什么浏览器里能流畅跑 60 首曲子、还能同时开好几首。

> 你第一首曲子暂时**跳过预渲染**（纯合成器实时发声），等理解透了这个概念再升级。见文末"进阶路线"。

---

## 6. schedule —— 指挥演出（第 140–206 行）

### 6.1 LFO 网（第 140–172 行）

```js
const schedule = ({ destination }) => {
  padFilter.connect(destination);
  noiseFilter.connect(destination);
  const noiseSynthMasterGainLfo = new Tone.LFO({ frequency: rng() * 0.05 + 0.05 })
    .connect(noiseSynthMasterGain.gain).start();       // 噪声音量缓慢起伏
  const noiseSynthMasterGainLfoFrequencyLfo = ...;      // 又套一层 LFO
  const padFilterFreqLfo = new Tone.LFO({ min: 100, max: 250, frequency: rng() * 0.05 + 0.05 })
    .connect(padFilter.frequency).start();              // Pad 滤波截止频率漂移
  const noiseFilterFreqLfo = new Tone.LFO({ min: 5000, max: 10000, ... })
    .connect(noiseFilter.frequency).start();            // 噪声滤波漂移
  noisePlayer.start();                                  // "风"开始吹
```

- 所有 LFO 的**参数都乘了随机**（`rng() * 0.05 + 0.05`）——每场演出的漂移速度都不同。
- 所有 LFO 都在 `schedule` 时创建、在 `end` 时销毁——**演出相关的资源随演出而生，随演出而灭**。

### 6.2 playRandomChord —— 递归随机和弦（第 176–194 行）—— 全曲的心脏

```js
const playRandomChord = () => {
  const root = Math.floor(rng() * (NOTES.length - 5));   // 随机根音
  const chord = [root, root + 2, root + 5];              // 根音+2+5 = 三和弦
  const notes = chord.map(index => NOTES[index]);
  const baseDuration = rng() * 3 + 4;                    // 随机时值 4~7 秒
  notes.forEach(note => {
    padSynth.triggerAttackRelease(                       // 每个音随机错开起音时间
      note, baseDuration + rng() - 0.5, `+${rng()}`
    );
  });
  Tone.Transport.scheduleOnce(() => {                    // ★ 递归：把"下一个和弦"
    playRandomChord();                                   //    排到未来，永不停歇
  }, `+${rng() * 3 + 4 + rng() * 3 + 4}`);
};
playRandomChord();
```

拆解这个递归：

1. **随机根音**：从音符空间前段挑（`NOTES.length - 5` 的限定保证和弦在音域内）。
2. **三和弦**：`[root, root+2, root+5]`——注意 zed 用的是 **+2 和 +5**（间隔了一个音的转位式三和弦），比教科书的三度堆叠更有"电子"味道。
3. **人性化**：每个音 `+${rng()}` 秒错开，和弦不是齐奏，而是像真人弹奏一样微微散开。
4. **递归**：`Transport.scheduleOnce` 把下一次 `playRandomChord` 排到 `+随机时长` 之后。注意用的是 **`+` 相对时间字符串**——Tone 会把它换算成 Transport 时间轴上的绝对时刻。**永远不要用 `setTimeout` 做音乐调度**：它受浏览器主线程拖累会漂移，而 Transport 时间轴是精确的音频时钟。
5. 没有终止条件 = **音乐永不结束**。停止靠外层的 `end()` 调 `Transport.cancel()` 清空所有已排事件。

### 6.3 end —— 收尾（第 196–205 行）

```js
return () => {
  padSynth.releaseAll(0);        // 松开所有 Pad 音符（释放包络）
  noisePlayer.stop(0);           // 停掉噪声
  [...lofs].forEach(lfo => lfo.dispose());  // 销毁本场演出的 LFO
};
```

---

## 7. deactivate 与导出（第 208–223 行）

```js
const deactivate = () => { [padSynth, noisePlayer, padFilter, noiseFilter, noiseSynthMasterGain]
  .forEach(node => node.dispose()); };

export default wrapActivate(activate, { gain: GAIN_ADJUSTMENT });
```

- `deactivate` 释放**所有**节点（包括 activate 阶段创建的），彻底归还内存。
- 默认导出被 `wrapActivate` 包装——所以**用户拿到的不是一个普通函数，而是一个符合统一契约的 piece**。

---

## 8. 四个核心概念速记卡

| 概念 | 一句话 | zed 里的体现 |
|---|---|---|
| **Transport 调度** | 所有异步事件排到 Tone 的精确音频时钟上，用 `+时长` 相对时间 | `Transport.scheduleOnce` 递归 |
| **随机源注入** | 所有随机走 `window.generativeMusic.rng`，可被前端换成带种子的 PRNG → 可复现 | 全曲几十处 `rng()` |
| **预渲染** | 贵的合成在 activate 阶段离线渲染成 AudioBuffer 缓存，播放只触发采样器 | `createPrerenderableInstrument` |
| **生命周期** | activate 分配 / schedule 演出 / deactivate 释放，外加淡入淡出防爆音 | `wrapActivate` + `makeActiveStage` |

---

## 9. 对照表：zed → 你的第一首曲子

| zed 的代码 | 你的 `exercises/01-ambient-pulse/index.html` | 变化 |
|---|---|---|
| `NOTES = toss(...)` 白键 | `SCALE = ['C','D','Eb','F','G','Ab','Bb']` C 自然小调 | 更"电子"的暗色 |
| `createSynth` DuoSynth + 20s 混响 | `createPad` PolySynth(锯齿) + 18s 混响 | 简化，原理相同 |
| `createNoise` LFO 套 LFO 的风 | `createAir` 粉噪声 + 同样的 LFO 套 LFO | 几乎照搬 |
| `playRandomChord` 随机三和弦 | `playNextChord` + **根音随机游走**（±1/±2 度） | ★ 新增：和弦会"发展变化" |
| （无） | `createPluck` FM 弹拨旋律层，从当前和弦音里随机挑 | ★ 新增：和声之上的旋律层 |
| （无） | `createDrone` 持续低音随和弦漂移 | ★ 新增：基础低音层 |
| `window.generativeMusic.rng` | 同样全局注入，用 **mulberry32**（带种子可复现） | 前端可输入种子换一版 |
| 预渲染 | 暂不做（纯合成器实时发声） | 见进阶路线 |

---

## 10. 作业与进阶路线

**作业（巩固理解，每个 10 分钟）：**

1. 把 zed 的 `baseDuration` 从 `rng()*3+4` 改成 `rng()*0.5+1`，感受音乐从"氛围"变"节拍"。
2. 给 `NOTES` 加一个 `'Bb'`（变成混合利底亚调式），听听色彩变化。
3. 在 `playRandomChord` 里把 `+2, +5` 改成 `+3, +7`（大三和弦），对比冷暖。

**进阶路线：**

1. **预渲染**：用 `Tone.Offline` 把你曲子的 Pad 渲染成 AudioBuffer 缓存（`utilities/create-prerendered-buffer.js` 的 30 行就是全部秘密）。
2. **真实采样**：按 pieces 仓库 README 的 30 行示例接 `@generative-music/samples-alex-bainter`，把 `createPluck` 换成吉他/马林巴采样。
3. **发布成 npm 包**：照 `packages/piece-zed` 的目录结构（package.json + piece.js + manifest），跑 `npm run build` 后就能被 `pieces-alex-bainter` 聚合包收录。
4. **提交给 Generative.fm**：作者在 [Open-source Objectives gist](https://gist.github.com/metalex9/11923b7faa710215dc7ab39a0e056a65) 里欢迎社区提交乐曲。
