# Generative.fm 学习笔记

本文件夹只放**与 Generative.fm 这一族源码相关的**阅读笔记与创作方法论。别的学习主题（别的开源项目、别的技法、别的声音设计来源）另开同级文件夹，不要把不同来源混在这里。

## 这一族的两个上游仓库

| 仓库 | 是什么 | 本文件夹从它读什么 |
| --- | --- | --- |
| [pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter) | 60 首生成式乐曲的源码（monorepo，每首一个 npm 包） | 单首曲子的 `piece.js` 生成逻辑与素材数据；`piece-zed` 与 `piece-aisatsana` 是已逐段读完的两首 |
| [generative-fm/play](https://github.com/generative-fm/play) | play.generative.fm 前端播放器（React + Redux + Tone.js） | `src/playback/playback-middleware.js`：播放引擎的 `activate / schedule / Transport` 流程 |

作者的设计说明见 [WAC 2019 论文：Generative Music in the Browser](https://webaudioconf.com/posts/2019_5/)；`piece-aisatsana` 的创作手记见 [Medium：Generating more of my favorite Aphex Twin track](https://medium.com/@alexbainter/generating-more-of-my-favorite-aphex-twin-track-cde9b7ecda3a)。

## 本文件夹的文件，按建议阅读顺序

| 文件 | 是什么 | 对应练习 |
| --- | --- | --- |
| [`piece-zed-注解版.md`](piece-zed-注解版.md) | 逐段注解 `packages/piece-zed/src/piece.js`（224 行，全仓库最完整的教学样本） | 01 Ambient Pulse |
| [`piece-aisatsana-注解版.js`](piece-aisatsana-注解版.js) | 逐行注解 `packages/piece-aisatsana/src/piece.js`（**记忆 + 重排**范式） | 02 Aisatsana Markov |
| [`piece-aisatsana-数据说明.md`](piece-aisatsana-数据说明.md) | `instructions.json` 的结构、真实示例与量化演示 —— 解释「为什么代码里看不到素材」 | 02 |
| [`aisatsana-创作过程实录.md`](aisatsana-创作过程实录.md) | 用原曲 355 个音符的真实数据把「素材 → 网格 → 乐句 → 衔接」完整走一遍（数字全由脚本算出） | 02 |
| [`aisatsana-创作思维.md`](aisatsana-创作思维.md) | **创作方法论**：怎么想、怎么动手。不讲代码 | 02 |

## 从这里提炼出去的、会影响下次怎么做的规则

本文件夹是**阅读笔记**，不是指令。读完后真正约束后续工作的规则已提炼进 [`AGENTS.md`](../../AGENTS.md) 的「跨练习硬规矩」：

- **可注入的种子随机**（上游是 `window.generativeMusic.rng`，前端用 Mersenne Twister 替换）→ 本仓库的「随机流要分开」。
- **`activate → schedule → end → deactivate` 生命周期契约** → 各练习的 `window.exercise = { activate }` 入口。
- **音频时钟驱动画面**（不用 `Date.now` / `performance.now` 推算音乐时间）。
- **素材与生成分离**：先有音乐素材，再让程序重组它 —— 这是 `piece-aisatsana` 范式的核心，也是 02 的做法。

★ 与本仓库「学习 Generative.fm」的边界：**学的是它的架构与范式，不是复刻它的曲子**。01/02 是按它的机制自写素材；03（相位音乐）、04（WFC）、05（SQIA 音序器）、06（粒子合成）都是别处的来源，笔记不放在本文件夹。
