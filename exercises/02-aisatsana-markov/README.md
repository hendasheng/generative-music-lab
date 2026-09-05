# 02 · aisatsana 式极简钢琴（Markov 乐句重组）

第二份练习：复刻 Generative.fm 的 [piece-aisatsana](https://generative.fm/music/alex-bainter-aisatsana) 的生成机制——**记忆 + 重排**：音符素材固定，乐句顺序由马尔可夫链重组。

版本：[`0.1`](0.1/)（固定乐句 + 段落链）；[`0.2`](0.2/)（增加段落内音高马尔可夫链，节奏和宏观结构不变）。版本目录只保存实现文件，本 README 统一记录整个练习的设计与演进。

## 学习内容

- 谱面数据 → 八分音符网格量化 → 乐句切分（32 步一组）
- **段落化乐句库**：10 个乐句分 4 段（A 安静 → B 主题 → C 发展 → D 结尾），段落感知转移矩阵模拟原版衔接
- 马尔可夫链训练乐句转换概率，`walk()` 沿概率重组顺序
- 提前 1 秒触发 + ±25ms 人性化抖动
- 乐句素材的**律动设计**：节奏不均匀（切分/附点）、力度重音（0.4~0.8）、双音和弦块、音区对比——模仿人写的旋律而不是机械琶音
- **演奏版本系统**：同一乐句可被弹成完整、骨架、回声或迟到回应；留白来自“这次说多少”，不是插入空白段
- **0.2 实时视觉**：每个音高显示为状态节点，素材中学到的转移显示为有向边；静态乐句历史在底层依次排列，力导向网络在其上方游动，实际发声通过 `Tone.Draw` 同步高亮当前节点与刚走过的边；A/B/C/D 四个段落使用不同的当前状态色
- **0.2 背景 texture**：复用 03 的 Moodist 环境素材（包含 Jungle），以独立随机源、低增益和最多两层并发的方式淡入淡出，不改变钢琴的种子路径
- 与 01 的对照：**从零生成 vs 记忆 + 重排**（两种生成范式）

## 运行

运行当前版本请打开 [`0.2/index.html`](0.2/index.html)；保留的初始版本入口是 [`0.1/index.html`](0.1/index.html)。页面通过 CDN 加载 Tone.js、钢琴采样与环境音，因此首次运行需要联网。

**钢琴采样**：`vsco2-piano-mf`（VSCO2 免费钢琴库，CC0）经 jsDelivr GitHub 镜像远程加载——首次约 50MB（之后走浏览器缓存），加载失败/超时自动回退 FM 合成钢琴，不会卡死。官方 CDN `samples.alexbainter.com` 对直连返回 403（有访问控制），故不走它。0.2 还会远程加载 Moodist 环境音效，单个音效失败或超时会静默跳过。也可在仓库根目录运行 `python -m http.server 8000` 后访问 `http://localhost:8000/exercises/02-aisatsana-markov/0.2/`。

## 0.2 背景 texture

环境层取自 Moodist，目前包含 Brown Noise、Wind in Trees、Jungle、Birds、Busy Street 与 Crowd。Jungle 使用官方 `public/sounds/nature/jungle.mp3`，作为较长的自然底层随机出现，而不是随每个乐句触发。

- texture 使用由演出种子派生的独立 RNG；增加、删除或加载失败都不会改变钢琴的 Markov 行走路径。
- 各层按照自己的出现周期、持续时间和概率调度，并以 5–9 秒淡入淡出；同一时刻最多保留两层，避免环境声掩盖钢琴。
- Jungle 当前周期为 75–145 秒、持续 28–58 秒、出现概率 0.62、目标增益 0.14；听感调整优先改这些参数，不改乐句与段落结构。
- 音效采用并行加载和单项 12 秒超时。某一素材失败时只跳过该层，不阻塞整首作品启动。
- `schedule()` 启动 texture 调度；`end()` 停止播放并清理 Transport 事件；`deactivate()` 释放 Player、Filter、Gain 与 Panner，避免再次播放时复用已停止资源。

## 0.2 视觉与交互

- 马尔可夫状态网络占满窗口并保持响应式居中；节点代表音高，箭头代表素材中存在的转移。
- 节点只有“当前”与“非当前”两个状态。刚弹过的节点逐渐退回非当前色，不额外保留第三种历史状态。
- 乐句历史是网络下方的静态 z 层；新乐句从视窗底部进入，将旧行平滑向上推。移动端历史位于上半屏。
- A/B/C/D 四类乐句分别使用紫、绿、橙、粉色，节点高亮、活动边和乐句文字保持同一主题色。
- 点击舞台可显示或隐藏 HUD；HUD 包含标题、播放控制、状态、图例和机制说明，不参与网络布局。
- 音频由 Transport 预排，视觉只在 `Tone.Draw.schedule(..., audioTime)` 到达实际发声时刻后更新，避免 lookAhead 造成提前高亮。

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
→ 每 32 步选择一种演奏版本播放乐句（完整/骨架/回声/迟到回应）
```

- **音符 100% 来自素材**（记忆），**段落与乐句顺序被概率重组**（重排）——听感是"同一首曲子每次演奏段落顺序不同"
- **段落感来自素材结构**：原版 301 秒谱面含 intro→主题→发展→结尾的性格差异，马尔可夫链保留了段落衔接规律；本练习用 10 个带段落性格的乐句 + 段落转移矩阵模拟
- **留白来自演奏方式**：句尾会自然降密度，双音只在较满版本保留；C 发展段之后会短暂降低整体密度，让段落有回落
- 段落转移矩阵实时显示在页面上，可观察"当前段落 → 下一段落"的概率
- 换一版（新种子）改变行走路径；改 `SECTION_TRANSITIONS` 可调整段落性格（如让发展段更常回落安静）

## 参考资料

- [Alex Bainter：Generating more of my favorite Aphex Twin track（Medium）](https://medium.com/@alexbainter/generating-more-of-my-favorite-aphex-twin-track-cde9b7ecda3a) —— **作者本人的创作手记**：为什么选这首曲子、如何把原曲谱面量化并喂给马尔可夫链、以及他关于"生成更多同一首曲子的可能性"的思路。这是 piece-aisatsana 的第一手设计说明，强烈建议结合源码阅读。

## 版权说明

piece-aisatsana 的素材是 Aphex Twin 原曲（《aisatsana [102]》）的谱面，属他人作品，**不直接搬运**。本练习使用同风格的自写极简琶音（C 大调分解和弦）演示机制；若要复刻原曲听感，建议使用自己的录音或获得授权的采样。

0.2 的背景 texture 远程引用自 [Moodist](https://github.com/remvze/moodist) 的 `public/sounds/`。Moodist 项目代码为 MIT，声音素材可能分别采用 Pixabay Content License 或 CC0；发布或分发前仍需逐个核对原始授权与归属。

## 后续想法

- ~~用真实钢琴采样替换 FM 合成~~ —— **已完成**：改用 `vsco2-piano-mf`（VSCO2 免费钢琴采样，CC0），通过 jsDelivr GitHub 镜像加载，失败时回退 FM 合成。采样音高集合 A0~C8 共 22 个文件（见 0.2/index.html 的 `PIANO_SAMPLES`）
- 增加乐句数量（更多状态 → 更丰富的重组）
- 二阶马尔可夫链（考虑前两个乐句，转换更"连贯"）
- 量化从"步索引"改回"秒级谱面 + BPM 换算"（完整复刻 aisatsana 的数据流）
