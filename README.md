# Generative Music Lab

一个用于学习、拆解和实践生成式音乐的个人实验仓库。练习以可直接在浏览器中运行的独立作品为主，目前使用 [Tone.js](https://tonejs.github.io/) 构建音频引擎。

## 练习

| 编号 | 名称 | 内容 | 运行方式 |
| --- | --- | --- | --- |
| 01 | [Ambient Pulse](exercises/01-ambient-pulse/) | C 自然小调、氛围合成、动机发展与呼吸型节奏 | 打开 `exercises/01-ambient-pulse/index.html` |
| 02 | [Aisatsana Markov 0.4](exercises/02-aisatsana-markov/0.4/) | 极简钢琴、段落与句内音高的马尔可夫链重组、Moodist 环境 texture；birds 发声期间还有一层"旋转游走的线"涟漪（0.4 = 0.3 + 涟漪，形式借鉴 okazz 的 sketch，仅借动作、不搬代码；涟漪的疏密跟着素材每一段的响度，不是某一刻） | 打开 `exercises/02-aisatsana-markov/0.4/index.html`；上一版是 `0.3/index.html`（没有涟漪的基线） |
| 03 | [Phase Loops 0.3](exercises/03-phase-process/0.3/) | 独立音符循环、3D 分层环带、固定播放头与音画同步 | 打开 `exercises/03-phase-process/0.3/index.html` |
| 04 | [Note Tile Collapse 0.2](exercises/04-wfc-loom/0.2/) | WFC 约束坍缩、二维单音 tile 填充、**时间轴上的和声进行**（强拍锁和弦音 + 倾向解决）、钢琴采样 / 合成器双音色、BPM 与动态时值线 | 打开 `exercises/04-wfc-loom/0.2/index.html`；上一版是 `0.1/index.html`（矩阵织机实验） |

也可以直接打开根目录的 `index.html`，从作品索引进入各个练习。

## 目录结构

```text
generative-music-lab/
├─ exercises/                 # 独立、可运行的生成式音乐练习
│  ├─ README.md               # 新增练习的约定
│  ├─ 01-ambient-pulse/
│  │  ├─ README.md            # 本练习的目标与音乐设计
│  │  └─ index.html           # 可直接运行的作品
│  └─ 02-aisatsana-markov/
│     ├─ README.md            # 本练习的演进与实测数据
│     ├─ 视觉规则.md          # 本练习专有的视觉规范（可复用的规则文档）
│     ├─ 0.1/ 0.2/ 0.3/ 0.4/   # 各版本的实现文件（0.4 = 当前版本）
│  └─ 04-wfc-loom/
│     ├─ README.md            # WFC / 约束织机的设计记录与各轮实测
│     ├─ 算法规则.md          # 0.2 现行算法的完整规格（数据模型 / 每步顺序 / 权重表 / 边界）
│     └─ 0.1/ 0.2/            # 0.2 = 当前版本（二维单音 tile WFC + 和声进行 + 钢琴采样）；0.1 = 矩阵织机实验
├─ notes/                     # 跨练习的源码阅读与学习笔记
├─ shared/                    # 两个以上练习共用的轻量组件或工具
│  └─ exercise-controls.js    # 公共播放/暂停、种子、reset 控件
├─ index.html                 # 仓库作品索引
├─ .editorconfig
├─ .gitignore
└─ README.md
```

## 本地运行

当前练习没有构建步骤。可以直接双击对应的 `index.html`，也可以在仓库根目录启动静态服务器：

```powershell
python -m http.server 8000
```

然后打开 <http://localhost:8000>。

Tone.js 当前从 CDN 加载，因此首次运行需要联网。若以后需要完全离线，可把固定版本放入 `vendor/`，再改为相对路径引用。

## 总音量与母带链约定

需要统一调节响度的练习使用一条共享输出链：

`各声部及效果 → 混音 / 压缩 / 滤波（按作品需要）→ 总增益与淡入淡出 → 最终 Limiter(-1) → Destination`

- 总音量使用明确的 dB 参数 `MASTER_VOLUME_DB`，参考 02 0.4 与 03 0.3 的默认值 **+6 dB**。转换为线性增益：`Math.pow(10, MASTER_VOLUME_DB / 20)`，+6 dB 约为 1.995 倍振幅；0 dB 为 1 倍。+6 dB 是当前作品的起点，不是所有作品必须采用的响度标准。
- 淡入从 0 升到上述目标增益，不能仍写死为 1，否则总音量设置会失效；淡出回到 0，完成后再释放节点。也可独立设置淡入淡出 Gain，但总增益仍须放在最终限幅之前。
- 所有声部，包括环境声，都经过共享总输出。整体偏小先检查总增益；单独某层偏小才调整该层的 `volume`（dB）或 `targetGain`（线性值），不要混淆两种单位。
- 最终限幅之后不再追加提升增益。限幅控制峰值，提高总增益可能带来更多压缩，并不保证听感等比例变响；若出现明显挤压，应回到声部平衡和压缩设置检查。
- 总音量不能代替低频清理、声部平衡与实际监听。新作品需要用自己的密集段和稀疏段检验；浏览器静音测试只能验证接线、增益及生命周期，不能代替听感判断。

03 0.3 的具体链路为 `钢琴 / Drone / 环境声 → Compressor → 35Hz 高通 → masterGain → Limiter(-1) → Destination`；默认 +6 dB，淡入 1.2 秒、淡出 0.8 秒。02 0.4 的压缩仅在钢琴支路，两者共用总音量原则，不要求照搬各自的压缩设置。

## 学习方向

- 用受控音阶与和声空间约束随机性
- 用种子随机数生成可复现的演出
- **随机必须有依据、且只用在需要的地方**：能由音乐本身算出来的量（音程、密度、概率、发声次数……）就不要用随机数去凑；纯粹的随机即使可复现也毫无意义（02 0.3 的视觉布局就是这么改的 —— 见该练习的 [`视觉规则.md`](exercises/02-aisatsana-markov/视觉规则.md) §6「跨度与形状」）
- 设计长期运行但不过度重复的段落与动机
- 理解 Tone.Transport、AudioContext 与音频资源生命周期
- 练习频段分工、动态控制和生成式混音

## 参考资料

### 源码参考仓库（在任何机器上 `git clone` 后即可对照；以下均为仓库内路径，不依赖本机位置）

| 来源仓库 | 是什么 | 建议先看（仓库内路径） |
| --- | --- | --- |
| [pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter) | 60 首生成式乐曲的源码（monorepo，每首一个 npm 包） | `packages/piece-zed/src/piece.js`（224 行完整教学样本，对应下方中文注解） |
| [generative-fm/play](https://github.com/generative-fm/play) | play.generative.fm 前端播放器（React + Redux + Tone.js） | `src/playback/playback-middleware.js`（播放引擎：activate/schedule/Transport 流程） |

### 在线资源

- [Generative.fm](https://generative.fm/) —— 官网与线上播放器（浏览页：https://play.generative.fm/browse）
- [Tone.js 文档](https://tonejs.github.io/) —— 本项目使用的 Web Audio 库（v14.7.58）
- [Alex Bainter：Generative Music in the Browser（WAC 2019 论文）](https://webaudioconf.com/posts/2019_5/) —— 作者的设计思路与系统架构说明（WAC 官网论文页；完整论文集 PDF：[WAC 2019 Proceedings](https://www.ntnu.edu/documents/1282113268/1292502725/WAC_2019_proceedings.pdf)，本篇见第 46 页起）
- [Alex Bainter：Generating more of my favorite Aphex Twin track（Medium）](https://medium.com/@alexbainter/generating-more-of-my-favorite-aphex-twin-track-cde9b7ecda3a) —— 作者关于 piece-aisatsana 的创作手记（Markov 链重混原曲的思路），对应本仓库 02 练习
- [Tero Parviainen：JavaScript Systems Music](https://teropa.info/blog/2016/07/28/javascript-systems-music) —— 用 Web Audio / Tone.js 学习 Reich 与 Eno 的系统音乐思路，对应本仓库 03 练习
- 向 Generative.fm 提交乐曲：作者曾在一份 Open-source Objectives gist 中说明，该 gist 现已不可用；可参考 [pieces-alex-bainter 仓库](https://github.com/generative-music/pieces-alex-bainter) 的 README 了解乐曲包的安装、构建与使用方式

### 本仓库笔记

- [02 视觉规则](exercises/02-aisatsana-markov/视觉规则.md) —— **练习专有的视觉规范**（放在该练习目录内）：02 「持续存在的状态图」的完整规则 —— 分层与遮挡、由音乐间隔驱动的时长公式、节点与连线的状态机、连线即铰链的力学、参数总表、明确禁止的做法、可量化的验收清单（参考实现 `0.4/index.html`；§14.6 是 birds 涟漪那层，§15 是"什么时候允许用随机"）。要在别的练习里复用同一套观感，直接读这份
- [piece-zed 中文注解](notes/piece-zed-注解版.md) —— 对照 pieces-alex-bainter 仓库内 `packages/piece-zed/src/piece.js` 逐段阅读
- [piece-aisatsana 中文注解（代码注释版）](notes/piece-aisatsana-注解版.js) —— 对照 `packages/piece-aisatsana/src/piece.js` 逐行阅读（记忆 + 重排范式，对应 02 练习）
- [piece-aisatsana 素材数据说明](notes/piece-aisatsana-数据说明.md) —— instructions.json 的结构、真实示例与量化演示
- [aisatsana 创作过程实录](notes/aisatsana-创作过程实录.md) —— 用原曲 355 个音符的真实数据把「素材 → 网格 → 乐句 → 衔接」完整走一遍（所有数字由脚本算出）
- [aisatsana 式创作思维](notes/aisatsana-创作思维.md) —— **创作方法论**：怎么想、怎么动手（素材 → 网格 → 乐句块 → 衔接 → 重组），不讲代码

## 许可

目前未添加开源许可证。代码公开到 GitHub 后，默认仍保留所有权利；确定分享方式后再选择 MIT、GPL 或其他许可证。
