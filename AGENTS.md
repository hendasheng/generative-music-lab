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

## 仓库约定

- 可运行练习放在 `exercises/编号-英文短名称/`。
- 每个练习至少包含 `index.html` 和 `README.md`。
- 学习笔记与源码注释放在 `notes/`。
- 新增练习时更新根目录 `README.md` 和 `index.html`。
- 只有两个以上练习真正共用的代码或资源，才抽到根目录共享模块。
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

## 修改与验证要求

- 修改音乐逻辑时，同时检查注释和页面上的教学说明是否仍然准确。
- 修改 JavaScript 后至少执行一次语法检查。
- 涉及播放、停止、换一版或长时间调度时，应在浏览器实际验证控制台和生命周期。
- 音乐层面的判断要区分代码推演和实际监听；不能试听时应明确说明。
- 保留用户已有实验和笔记，不要为了重构删除尚未确认无用的内容。

## 后续候选练习

这些只是方向，不是已确定需求：

- Markov chain melody
- Granular texture
- Phase music / process music
- Probability sequencer
- Rule-based counterpoint
- Sample-based ambient system
- 将多个练习接入统一播放器
