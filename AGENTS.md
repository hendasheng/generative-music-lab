# AI Working Context

给后续 AI 编码代理的工作约定。开始工作前：读本文件 → 读当前练习目录的 `README.md` → 04 还要读 [`算法规则.md`](exercises/04-wfc-loom/算法规则.md)。

★ **本文件只写「会改变下一次怎么做」的规则和指针**，长度上限就是工作区指令预算（64KB，超了会被静默截断）。**逐轮演进、实测数字、被否掉的方案、某个练习的视觉细节，一律写进各自的练习文档**（见「各练习入口与文档指针」）。2026-09-21 精简过一次：原文 141KB 被截断到 64KB，连「修改与验证要求」那一节都读不到，于是真机验证被当成了常规手段、每次任务都被拖慢；移出的原文逐字存在 [`notes/agents-历史存档.md`](notes/agents-历史存档.md)，只在需要时查。

## 验证口径（默认走最轻的那条路）

| 改了什么 | 怎么验 | 成本 |
| --- | --- | --- |
| 语法 / 引用 | 抽出 `<script>` 跑 `node --check`；grep 引用 | 秒 |
| 音乐规则（权重、和声、时值、留白、拍位、调度时序） | **离线算**：把调度函数放进「假 DOM + 虚拟时钟 + 假 Transport」跑完整曲，打印每步的拍位 / 时值 / 音高并断言不变量 | 秒 |
| 视觉静态形态（DOM 数量、类名、CSS 变量） | grep + 静态核对 | 秒 |
| **声音真的响了没有 / 画面与发声是否对齐 / 生命周期与报错** | **真机：一轮只开一次，把所有断言写进同一个探针** | 分钟 |

- **只有最后一类才开浏览器**；能离线算清的不要开 —— 上一版把真机当常规手段，是文档被截断后误读的结果。
- **"没报错"不等于"听得对"**：音乐层面的判断只能靠耳朵，不能试听时明确说明；判"有没有声音"要数 `triggerAttackRelease` 的调用次数，不能拿控制台干净当证据。
- 离线桩测的是**结构**（音符序列、拍位、时值、权重分布），真机测的是**行为**（真的响、画面对齐、报错与生命周期）。桩要随着被测代码一起改，否则它会先把 bug 藏起来。

真机验证的必要细节（都是踩过的坑，照抄即可）：

- Chrome 用 `--headless=new --autoplay-policy=no-user-gesture-required --mute-audio`。不加第一个：没有用户手势时音频链停在 suspended，`Tone.start()` 永不 resolve；不加 `--mute-audio`：会**真的从扬声器出声**（无头没有窗口，用户听得见却找不到来源）。
- 沙箱下 Chrome 起不来（IPC 要命名管道）→ 这一条命令需要 `danger-full-access`。
- **启动时拿 PID、结束确认已 kill**：PowerShell 不等 GUI 程序，后台任务显示"完成"时 Chrome 其实还在放。不要用"杀掉所有 chrome.exe"这种粗暴办法（会连用户自己的浏览器一起关）。★ 同理：`job_kill` 掉 `python -m http.server` 的后台任务只杀掉 pwsh，**python 子进程会活下来继续占端口**（探针跑完再访问 8765 仍然是 200）；收尾要按端口找 PID —— `netstat -ano | Select-String ':8765\s'` 然后只 kill 那一个 PID。
- 本地页面 URL 必须带 cache-buster（`?cb=Date.now()`）：`python -m http.server` 只给 `Last-Modified`，启发式缓存会让你测到**改动前**的页面。
- 设种子：`exercise-controls.seedValue` **只有 getter**（赋值是空操作），要写 shadow root 里的 `input` 再派发 `exercise-seed-apply`（它自己就会开始播放，别再补发 `exercise-play`）。
- `Tone.now()` 含 `lookAhead`（默认 0.1s）：量"画面对不对齐"要减掉它。
- 量时间 / 归属要**待在一条时间轴上**（音频比音频、传输比传输）；跨轴换算会造出看起来像真 bug 的系统性偏差。
- 离线桩要**忠实模拟** Tone 的约定：回调收到的 `time` 是**音频上下文时间**，比传输位置早 lookAhead。桩漏了这条，bug 会在离线全绿、只在真机暴露。
- 无头里 `rAF` 被节流到约 1 tick/500ms：要逐帧推进就自己循环调用，别等 rAF。

## 当前协作约定（2026-09-19）

- **测试 HUD 只保留用户要求的条带圆角**，不要因增加功能就自行加调试控件、开关或调试提示。Release、尾音补偿、力度呼吸使用代码中的当前设置。
- **该调整的效果和参数照常调整，必要验证照常做。** 用户限制的是“不要把每次调整都做成 HUD 参数”，不是限制参数调整、功能完善或必要调试。只有用户明确需要在界面上手动调节时，才增加对应控件。

## 项目定位

这是一个个人生成式音乐学习仓库，不是单一作品。后续会不断新增独立练习，用于理解生成式作曲、Tone.js、浏览器音频调度、音色设计和混音。

当前优先级：

1. 听感和音乐逻辑优先于炫技或算法复杂度。
2. 每个练习应能独立运行、独立阅读。
3. 代码中的随机行为应尽量可通过种子复现。
4. 长时间运行时必须正确管理调度器和 Web Audio 资源。
5. 保持学习过程可见，重要音乐规则应写清楚，而不是过早抽象隐藏。
6. 遇到调度、听感、生命周期或视觉同步问题并确认原因后，要把经验沉淀到对应练习文档、`README.md` 或关键代码注释中；**只有「会改变下一次怎么做」的规则才提炼进本文件**（见开头），避免后续代理重复踩坑。

## 仓库约定

- 可运行练习放在 `exercises/编号-英文短名称/`。
- 每个练习至少包含 `index.html` 和 `README.md`。
- 学习笔记与源码注释放在 `notes/`。**某个练习专有的文档要放在该练习目录内**（例如 02 的视觉规范是 [`exercises/02-aisatsana-markov/视觉规则.md`](exercises/02-aisatsana-markov/视觉规则.md)，与它的 README 并列）；`notes/` 只放跨练习的源码阅读与创作方法论。02 0.3 那套状态图视觉的规则（分层与遮挡、由音乐间隔驱动的时长公式、节点/连线的状态机、连线即铰链的力学、参数总表、明确禁止的做法、可量化的验收清单）写在那份视觉规范里：复用或改动这套观感前先读它；练习 README 只记演进与实测，只有「会改变下一次怎么做」的规则才提炼进本文件。
- 新增练习时更新根目录 `README.md` 和 `index.html`。
- 只有两个以上练习真正共用的代码或资源，才抽到根目录共享模块。
- 页面间共用的 `播放 / 停止 / 种子 / 换一版` 控件放在 `shared/exercise-controls.js`。它只负责 UI 和事件，不承载 Tone.js 调度逻辑；各练习继续自己处理 `activate/schedule/end/deactivate` 生命周期。当前形态是一个无构建 Web Component：播放/暂停合并为左侧正方形 icon 按钮，右侧上方是窄种子输入框、下方是同宽 reset icon 按钮；新练习不要再复制旧的 `playBtn/stopBtn/seedInput/regenerateBtn` DOM 和样式。
- 不要把生成的录音、大体积音频和 `node_modules` 提交到 Git。
- 当前没有构建系统；不要仅为“标准化”而引入 npm、打包器或框架。
- 每个练习暴露统一的激活接口 `window.exercise = { activate }`（参考 piece-zed 的 `activate → [deactivate, schedule]` 契约），为以后接入统一播放器留口子；接口只需一行赋值，不引入任何加载器或构建步骤。

## 跨练习硬规矩

改任何练习都会碰到；每条都有实测代价，细节在各自的练习文档里。

**调度与生命周期**

- **异步构建的东西必须有代次或取消机制**：`stop` 可能落在 `activateEngine` 还没跑完的时候（那一刻 `engine` 还是 `null`，停止逻辑等于没接上），而构建完成后照样 `schedule()` 就会产生界面再也够不着的**孤儿引擎**（继续排音、疯狂报错）。做法：`engineGeneration` 计数器，`stop` / `restart` 时自增，构建完成比对代次，不等就 `end()` + `deactivate()` 后 return。★ `stop` 不只要看 `engine`，还要看「正在构建」。
- **包装函数必须把值带出来**：`try { await promise; return { ok:true } }` 丢掉了 resolve 的值，赋值后表现为「Cannot read properties of undefined (reading 'schedule')」。
- **重置「装着待清理资源的数组」要先清资源再重置**，否则旧事件永远清不掉；`schedule()` 必须幂等（先 `forEach(clear)` 再重置）。
- **销毁引擎后要清 Tone 的待执行队列**：Tone 对超过 lookAhead 的音用 `context.setTimeout` 排 release，而 `dispose()` 不取消它们 → 停止后控制台开始刷 `Synth was already disposed`。清 `Tone.getContext()._timeouts._timeline`（私有 API，与 `_ticker` 同类，升级 Tone.js 要复查）。
- **两套时间轴不能混用**：`Transport.scheduleOnce(fn, t)` 的 `t` 是**传输时间**，而 `fn` 收到的 `time` 是**音频上下文时间**（Tone 官方示例就是把它直接喂给 `Tone.Draw.schedule`）。下一步必须用自己维护的传输时间轴位置去排，回调的 `time` 只用于排声音与 `Draw`。配套：不要用 `'+0.5'` 相对时间（回调受 lookAhead 影响提前执行，逐句累加就是漂移）；**不要用改 `Tone.Transport.bpm` 代替自己的速度换算**（已排好的事件会被按新速度重新解释）。
- **一次性声源（`Tone.Oscillator` / `Tone.Noise`）stop 后不复用**；停止后销毁引擎，下次播放重建。`Tone.Sampler` 加载失败时**不要 dispose 那个还在加载的实例**（它的 `onload` 会去写已销毁的对象）。
- Stop / Regenerate 要等淡出完成再 dispose，避免突然切断，或旧定时任务停掉新引擎。

**Tone 的语义要看实现，不要看文档**

- `Sampler.triggerAttack` 每次新建 `ToneBufferSource`，并把当时的 `release` 读进去 —— **没有 voice 池**，所以"每个音自己的 release"只需在触发前改属性，不必复制采样器。
- 但 `Sampler.triggerRelease(note, t)` 会停掉该音高**全部**活动的 source：同音重复时，后一个音自己的释放点会把前一个还在响的长音一起停掉。做法是让旧音在**新音的起音处**退场。
- `PolySynth.set({ envelope:{ release } })` 会改**所有** voice（与 Sampler 的逐音语义相反）。
- `new Tone.PolySynth(voice, options)` 的第二个参数是音色选项，写在里面的 `maxPolyphony` **不生效**，要构造之后 `synth.maxPolyphony = n`。
- **单音 `Tone.Synth` 没有 `releaseAll`**（那是 `PolySynth` / `Sampler` 的接口），松开要用 `triggerRelease`；而且**停止时要先停传输再收声音** —— 顺序反过来时，一次抛错就会把 `Transport.stop()` 一起跳过，表现是"按了停止还在响"（04 0.4 真机检查抓到）。
- **`Tone.Transport.bpm` 是只读 getter**：要写 `Tone.Transport.bpm.value = 112`；严格模式下直接赋值会抛 `Cannot assign to read only property 'bpm'`。另外 `scheduleRepeat` 按 tick 网格排程，Transport 的 BPM 与曲子不一致时会被量化（120 BPM 下 0.2679s → 0.2682s）。★ **反过来用**：把 `Transport.bpm.value = bpm` 与"排程用的秒数"取自同一个 bpm 时，`60/bpm/2` 秒换算成 tick **恒为 96**（bpm 在换算里约掉了）⇒ 八分音符网格永远精确；而且 repeat 的间隔是**按 tick 存的**，播放中改 `Transport.bpm` 网格会自己变快变慢，**不用重排也不用重播**（04 0.5 的 BPM 输入框就是这么做的，离线桩量不到这条 —— 桩里存的是秒数，必须真机量）。代价是：**音的时值、画面位移时长、任何以秒为单位的东西都要在用到的那一刻按当前 bpm 现算**，留一个"建引擎时算死"的旧值就会漂（0.3 的延迟时间踩过）。
- 效果器的延迟时间不要按"建引擎时的 BPM"算死：播放中改 BPM 会让它漂到错误的拍位上。
- **"音头像敲桌子"要先量、再改，量完常常发现无事可做**（04 0.5）：采样起点是否在零点（`attack: 0` 不做淡入，非零起点才是每音一记爆音）、起始 5 ms 的电平、音头的单频频谱、直流偏移 —— 这套读数已经在 `exercises/04-wfc-loom/tools/browser-check.mjs` 里，直接跑就有。实测 `vsco2-piano-mf` 起点就在零点、前 5 ms 是 −36 dB、能量在基频，于是 250 Hz 低切（整段只动 1.7 dB 能量）与 3 ms 淡入都被否掉、已回退。★ 量法上的坑：`raw − HPF(raw)` **不是**"低频频段能量"（相位会让基频成规模混入差值，看着像低频占一大半），要量频段就用单频 DFT 或配对带通。

**可复现与单一来源**

- **随机流要分开**：演出种子派生的 RNG、素材 / 概率 / 调试各用独立流，绝不共用 —— 增删素材或网络加载结果不能改变音乐序列；调试入口也不能消耗演出那条流。
- **一个量只能有一个来源**：同一个量在 CSS 与 JS 各写一份必然半截生效（内联优先级更高）；被 JS 逐帧驱动的属性不要同时挂 CSS transition；历史记录 / 缓存下来的视觉量要存**语义**而不是算好的结果（否则换主题、换段落时它不跟）。
- **音乐判断要待在速度无关的单位里**（拍域），缩放只在最后一步换算 —— 否则同一颗种子在不同 BPM 下会生成不同的曲子（浮点边界比较就能翻掉判决）。
- **删掉一个视觉量要连运行期机制一起删干净**（先 grep 出所有引用再逐个处理）；只剩内部状态、画面上无差别的类名 / 字段也要删，否则下一个人会以为它在起作用。
- ★ **没人要求的效果器、控件不要加**；加了要说清动机与参数。

## 跨练习音量约定

参见根 [README「总音量与母带链约定」](README.md#总音量与母带链约定)。03 0.3 已对齐 02 0.4 的 `MASTER_VOLUME_DB = 6`：压缩 / 滤波之后、最终限幅之前提升总增益。**淡入终点必须为 `10 ** (MASTER_VOLUME_DB / 20)`，不能写死为 1**；淡出仍到 0。默认 +6 dB 是参考起点，不代表各练习听感等响；支路音量、压缩和总增益分开考虑。

★ **支路增益的标定语境包含它后面挂的效果器**：`Tone.Effect`（Reverb 等）的干路会被 `×(1−wet)` 缩放，所以"在带混响的链路末端标定"的采样音量（例如 04 的 `PIANO_VOLUME_DB = 14`）搬到干链里会整体偏响 —— 04 0.5 实测差 **2.6 dB**（0.665 vs 0.492，2.6 dB 正好是 −20·log10(1−0.26)）。把音色/增益在版本之间搬动时，要么连效果链一起搬，要么重新标定，别只搬数字。

## 各练习入口与文档指针

| 练习 | 当前入口 | 改之前先读 | 一句话现状 |
| --- | --- | --- | --- |
| 01 Ambient Pulse | `exercises/01-ambient-pulse/index.html` | 同目录 `README.md`（调式 / 层次 / 鼓型 / 动机系统 / 看门狗阈值） | 六个层次 + 氛围脉冲鼓，单文件 |
| 02 Aisatsana Markov | `exercises/02-aisatsana-markov/0.4/index.html`（0.3 = 无涟漪基线；0.2 / 0.1 保留） | 同目录 **`视觉规则.md`**：画面规则全在里面（分层与遮挡、由音乐间隔驱动的时长公式、节点与连线的状态机、连线力学、参数总表、可量化验收清单、明确禁止的做法）+ `README.md` | 手写乐句的马尔可夫行走 + 状态图视觉 |
| 03 Phase Loops | `exercises/03-phase-process/0.3/index.html`（3D 实现在同目录 `stage.js`） | 同目录 `README.md` 的「0.3 当前基线与衔接」 | 十条同轴环带独立旋转，音名用带面 UV 贴图 |
| 04 Note Tile Collapse | `exercises/04-wfc-loom/0.5/index.html`（**0.5 = 当前**：0.4 的最小 WFC + rolling window + register drift + density drift；0.4 是有已验证基线的有限 16 格版，规格见 [`0.4/实验说明.md`](exercises/04-wfc-loom/0.4/实验说明.md)；动 0.4 / 0.5 之前先读 [`0.4/README.md`](exercises/04-wfc-loom/0.4/README.md) 的「一条规则一验」与 [`0.5/README.md`](exercises/04-wfc-loom/0.5/README.md)，并知道它们**不适用** `算法规则.md`） | 0.3：[`算法规则.md`](exercises/04-wfc-loom/算法规则.md)（现行完整规格 + 0.2 / 0.3 差异表）→ 再看 `README.md` 的演进与实测数字；0.4 / 0.5：各自的 `README.md` | 0.3 二维单音 tile WFC；0.4 一维 16 格 pitch-only；0.5 滚动窗口 + 音区/疏密漂移，可一直跑 |
| 05 Probability Grid | `exercises/05-probability-grid/0.2/index.html` | 同目录上一级 `README.md`：版本差异、五种 Sound、调度及验证范围 | 原生 Web Audio 双轨概率网格；0.2 五种可选音色，0.1 保留基础版；测试入口 `tools/check.cjs` |

**改规则要回同步文档**：04 改完同步 `算法规则.md`（它是**现行规格**、不是历史，开头有 0.2 / 0.3 差异表）；02 改画面同步 `视觉规则.md`；改音乐逻辑时同时检查代码注释与页面上的教学说明是否仍然准确。

**03 的两条画面规矩**：圆环动画必须与音频共享同一套时间状态（音频预排 `scheduledFireAt`、视觉 `visibleFireAt`，只有 `Tone.Draw` 到达那一刻才推进视觉，否则播放头与触发对不上）；同心圆语义是"右侧固定播放头、彩色音段顺时针转、前端到达播放头就发声"，不要再加独立的相位圆点或初始刻度。

**04 的五条规矩**：★ **空间坐标不是音乐时间** —— 重音、和声变换、同音降权、拍内延迟都不能由 `row` / `col` / `step` 派生（选格由熵决定，与播放时刻无关；这条已经踩过四例）；★ **音乐结构只数拍**（`stepBeat`），不数"第几个格子"，而且连续量驱动时间轴时要检查**累积漂移**；★ **量"听感节奏"要量音头与相邻音的起音间隔**，不是量坍缩步长；★ 音色与 BPM 是**演出参数**（`lastSeed` / `pendingSeed` 保住同一首，方便 A/B）；★ **`schedule()` 是"同一个引擎可以被调第二次"的**（整曲结束后引擎不销毁），凡是跨场残留的派生量都要在它里面清掉 —— 漏一个（例如时间重复降权用的 `recent`）就会让"放完再按播放"与重新加载听到的不是同一首。离线桩：[`exercises/04-wfc-loom/tools/offline.mjs`](exercises/04-wfc-loom/tools/offline.mjs)（`node` 直接跑，量音符序列 / 拍位 / 时值 / 重放复现）。

## 后续候选练习

这些只是方向，不是已确定需求：

- Markov chain melody
- Granular texture
- Phase music / process music
- Probability sequencer
- Rule-based counterpoint
- Sample-based ambient system
- 将多个练习接入统一播放器
