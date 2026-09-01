# 02 · aisatsana 式极简钢琴（Markov 乐句重组）

第二份练习：复刻 Generative.fm 的 [piece-aisatsana](https://generative.fm/music/alex-bainter-aisatsana) 的生成机制——**记忆 + 重排**：音符素材固定，乐句顺序由马尔可夫链重组。

## 学习内容

- 谱面数据 → 八分音符网格量化 → 乐句切分（32 步一组）
- **段落化乐句库**：10 个乐句分 4 段（A 安静 → B 主题 → C 发展 → D 结尾），段落感知转移矩阵模拟原版衔接
- 马尔可夫链训练乐句转换概率，`walk()` 沿概率重组顺序
- 提前 1 秒触发 + ±25ms 人性化抖动
- 乐句素材的**律动设计**：节奏不均匀（切分/附点）、力度重音（0.4~0.8）、双音和弦块、音区对比——模仿人写的旋律而不是机械琶音
- 与 01 的对照：**从零生成 vs 记忆 + 重排**（两种生成范式）

## 运行

直接打开 `index.html`（通过 unpkg 加载 Tone.js，需联网）。

**钢琴采样**：`vsco2-piano-mf`（VSCO2 免费钢琴库，CC0）经 jsDelivr GitHub 镜像远程加载——首次约 50MB（之后走浏览器缓存），加载失败/超时自动回退 FM 合成钢琴，不会卡死。官方 CDN `samples.alexbainter.com` 对直连返回 403（有访问控制），故不走它。也可在仓库根目录运行 `python -m http.server 8000` 后访问 `http://localhost:8000/exercises/02-aisatsana-markov/`。

## 与 Generative.fm 源码的对照

本练习的机制来自开源仓库 [pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter)（clone 后按仓库内路径阅读）：

| 本练习 | 源码位置 | 说明 |
| --- | --- | --- |
| `PHRASES` 乐句库 | `packages/piece-aisatsana/src/instructions.json` | 原曲谱面量化后的乐句素材（本练习为自写素材，见版权说明） |
| `buildMarkovChain` | `packages/piece-aisatsana/src/piece.js` 的 `new Chain(...)` | aisatsana 用 `markov-chains` npm 库；本练习自实现一阶链，原理相同 |
| `createPiano`（真实采样） | 同文件第 16 行 `createSampler(samples['vsco2-piano-mf'])` | 钢琴 = **真实采样** `vsco2-piano-mf`（VSCO2 免费钢琴库，CC0）。官方 CDN 403 → 本练习用本地 mp3 / jsDelivr wav 逐级加载。**为什么 generative.fm 快**：① mp3/ogg 压缩格式（约 wav 的 1/10）② IndexedDB 缓存二次秒开 ③ 懒加载只取单曲所需采样 |
| `playPhrase` + `scheduleRepeat` | 同文件的 `schedulePhrase` + `Tone.Transport.scheduleRepeat` | 乐句按节拍重复调度 |
| `+1 秒预延迟 + 抖动` | 同文件第 60–63 行 | 音符提前触发留出采样加载余量 + 人性化 |
| BPM 与网格 | 同文件第 8–12 行 | aisatsana 用 102 BPM 八分音符（0.294s）；本练习 0.3s 近似 |

## 机制说明

```
乐句库（10 句，分 4 段：安静/主题/发展/结尾）
→ 段落感知马尔可夫链：段落层按转移矩阵选段（主循环 A→B→C→A），句层段内选句
→ 每 32 步播放一个乐句
```

- **音符 100% 来自素材**（记忆），**段落与乐句顺序被概率重组**（重排）——听感是"同一首曲子每次演奏段落顺序不同"
- **段落感来自素材结构**：原版 301 秒谱面含 intro→主题→发展→结尾的性格差异，马尔可夫链保留了段落衔接规律；本练习用 10 个带段落性格的乐句 + 段落转移矩阵模拟
- 段落转移矩阵实时显示在页面上，可观察"当前段落 → 下一段落"的概率
- 换一版（新种子）改变行走路径；改 `SECTION_TRANSITIONS` 可调整段落性格（如让发展段更常回落安静）

## 参考资料

- [Alex Bainter：Generating more of my favorite Aphex Twin track（Medium）](https://medium.com/@alexbainter/generating-more-of-my-favorite-aphex-twin-track-cde9b7ecda3a) —— **作者本人的创作手记**：为什么选这首曲子、如何把原曲谱面量化并喂给马尔可夫链、以及他关于"生成更多同一首曲子的可能性"的思路。这是 piece-aisatsana 的第一手设计说明，强烈建议结合源码阅读。

## 版权说明

piece-aisatsana 的素材是 Aphex Twin 原曲（《aisatsana [102]》）的谱面，属他人作品，**不直接搬运**。本练习使用同风格的自写极简琶音（C 大调分解和弦）演示机制；若要复刻原曲听感，建议使用自己的录音或获得授权的采样。

## 后续想法

- ~~用真实钢琴采样替换 FM 合成~~ —— **已完成**：改用 `vsco2-piano-mf`（VSCO2 免费钢琴采样，CC0），Tone.Sampler + samples.alexbainter.com CDN 直连（与 piece-aisatsana 相同音源）。采样音高集合 A0~C8 共 22 个文件（见 index.html 的 `PIANO_SAMPLES`）
- 增加乐句数量（更多状态 → 更丰富的重组）
- 二阶马尔可夫链（考虑前两个乐句，转换更"连贯"）
- 量化从"步索引"改回"秒级谱面 + BPM 换算"（完整复刻 aisatsana 的数据流）
