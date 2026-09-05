# AI Working Context

本文件用于让后续 AI 编码代理快速理解仓库。开始工作前，请先阅读本文件、根目录 `README.md`，以及当前练习目录内的 `README.md`。

## 项目定位

这是一个个人生成式音乐学习仓库，不是单一作品。后续会不断新增独立练习，用于理解生成式作曲、Tone.js、浏览器音频调度、音色设计和混音。

当前优先级：

1. 听感和音乐逻辑优先于炫技或算法复杂度。
2. 每个练习应能独立运行、独立阅读。
3. 代码中的随机行为应尽量可通过种子复现。
4. 长时间运行时必须正确管理调度器和 Web Audio 资源。
5. 保持学习过程可见，重要音乐规则应写清楚，而不是过早抽象隐藏。
6. 遇到调度、听感、生命周期或视觉同步问题并确认原因后，要把经验沉淀到 `AGENTS.md`、对应练习 `README.md` 或关键代码注释中，避免后续代理重复踩坑。

## 仓库约定

- 可运行练习放在 `exercises/编号-英文短名称/`。
- 每个练习至少包含 `index.html` 和 `README.md`。
- 学习笔记与源码注释放在 `notes/`。
- 新增练习时更新根目录 `README.md` 和 `index.html`。
- 只有两个以上练习真正共用的代码或资源，才抽到根目录共享模块。
- 页面间共用的 `播放 / 停止 / 种子 / 换一版` 控件放在 `shared/exercise-controls.js`。它只负责 UI 和事件，不承载 Tone.js 调度逻辑；各练习继续自己处理 `activate/schedule/end/deactivate` 生命周期。当前形态是一个无构建 Web Component：播放/暂停合并为左侧正方形 icon 按钮，右侧上方是窄种子输入框、下方是同宽 reset icon 按钮；新练习不要再复制旧的 `playBtn/stopBtn/seedInput/regenerateBtn` DOM 和样式。
- 不要把生成的录音、大体积音频和 `node_modules` 提交到 Git。
- 当前没有构建系统；不要仅为“标准化”而引入 npm、打包器或框架。
- 每个练习暴露统一的激活接口 `window.exercise = { activate }`（参考 piece-zed 的 `activate → [deactivate, schedule]` 契约），为以后接入统一播放器留口子；接口只需一行赋值，不引入任何加载器或构建步骤。

## 当前练习：01 Ambient Pulse

入口：`exercises/01-ambient-pulse/index.html`

技术基础：

- Tone.js 14.7.58，通过 unpkg CDN 加载。
- 单 HTML 文件，包含界面、样式和音频引擎，便于学习和实验。
- 使用带种子的 Mulberry32 RNG，让演出可复现。
- Tone.Transport 负责音乐事件；普通计时器只用于淡出收尾和健康检查。

音乐设计：

- 调式：C 自然小调。
- 层次：Pad、Drone、Bass、Pluck、Drums、Air。
- 和弦持续 8、12 或 16 秒；已取消 4 秒和弦，避免 Pad 长起音/长释放堆叠。
- Pad attack 4 秒、release 10 秒、reverb decay 20 秒。
- Pad 高通 110Hz；Bass 音量 -11dB；Drone 呼吸增益约 0.025–0.09。
- 鼓不是舞曲鼓组，而是 `pulse / echo / motion` 三种氛围脉冲。
- Kick 使用跨和弦延续的四小节呼吸乐句，有留空、弱回应和轻微力度变化。
- 鼓型约每八个和弦变化；Fill 不使用密集 Kick 滚奏。
- Pluck 使用可继承、映射、倒影和节奏变化的动机系统；移调后重新吸附到当前和弦。

## 已知的重要实现经验

- Tone.Oscillator、Tone.Noise 等一次性声源 stop 后不要复用；停止后应销毁引擎，下次播放重建。
- 最长和弦为 16 秒，看门狗阈值必须明显大于它；当前为 25 秒。
- 对共享 duck gain 安排 Kick automation 时，Kick 必须按时间升序调度。
- `Tone.getContext()._ticker` 是 Tone.js 私有实现。当前代码为时钟恢复使用它；升级 Tone.js 时优先重新评估这一部分。
- Stop/Regenerate 必须等淡出完成再 dispose，避免突然切断或旧定时任务停止新引擎。
- 低频问题首先检查 Pad、Drone、Bass、Kick sub 的叠加，不要只靠 Limiter 或整体降音量解决。
- 03 Phase Loops 的圆环动画必须与音频触发共享同一套时间状态。Tone.Transport 回调会受 lookAhead 影响提前执行，不能在 Transport 回调里直接推进视觉状态，否则会出现播放头和音符触发对不上的问题。做法：音频预排使用 `scheduledFireAt`；视觉显示使用 `visibleFireAt`；只有在 `Tone.Draw.schedule(..., audioTime)` 对应的实际发声时刻才推进 `visibleFireAt` 和触发视觉高亮。
- 03 的同心圆视觉语义：右侧固定播放头不动，彩色音段顺时针转动；当音段前端到达播放头时，该音触发。不要再加入独立的“当前相位圆点”或“初始相位小刻度”，这些标记容易让音画关系变得含混。
- 03 0.2 的 SVG 绘制层级为：灰色轨道 → 固定播放头 → 彩色音符与白色音名 → 触发轮廓。播放头后的扇形/梯形感应区域已确认无语义并删除，不要恢复。
- 03 0.2 的音符触发轮廓必须与音符 `duration` 同寿命：从音段头部向尾部裁切，透明度和线宽按包络下降，实际绘制一帧透明度 0 后再删除。扩散距离随音长由约一到三个环距变化，向中心时必须在圆心前停止。
- 03 0.2 的 Moodist Texture 目前只保留背景音频和概率调度，不提供测试按钮或对应视觉。淡入淡出统一由下游 Gain 管理，Tone.Player 不再叠加素材级长淡入。
- 02 0.2 的 Moodist 背景 texture 必须使用由演出种子派生的独立 RNG，不能与钢琴共用随机流，否则增删素材或网络加载结果会改变 Markov 乐句路径。远程环境音应逐项设置加载超时，允许单项失败，并在 `end/deactivate` 中同时清理 Transport 事件和音频节点。

## 修改与验证要求

- 修改音乐逻辑时，同时检查注释和页面上的教学说明是否仍然准确。
- 修改 JavaScript 后至少执行一次语法检查。
- 涉及播放、停止、换一版或长时间调度时，应在浏览器实际验证控制台和生命周期。
- 音乐层面的判断要区分代码推演和实际监听；不能试听时应明确说明。
- 保留用户已有实验和笔记，不要为了重构删除尚未确认无用的内容。
- 每次修复一个明确问题后，检查是否需要更新项目记忆或练习文档；尤其是用户指出“不要再踩同样的坑”时，必须补充记录。

## 后续候选练习

这些只是方向，不是已确定需求：

- Markov chain melody
- Granular texture
- Phase music / process music
- Probability sequencer
- Rule-based counterpoint
- Sample-based ambient system
- 将多个练习接入统一播放器
