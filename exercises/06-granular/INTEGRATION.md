# Granular 0.3 接入说明（供 AI 与开发者阅读）

核对日期：2026-09-24。来源：generative-music-lab 的 `exercises/06-granular/0.3/`，基线提交 `d111265`，含后续麦克风录音与实时波形扩展。项目构想名为 **Moonlight Grains / 月光音乐会**；命名不代表已经完成与其他项目的合并。

本文描述现有实现及移植要求，不是新增 API 的声明。目标项目、框架、音频架构尚未确定，先检查宿主再选接入方式。保留原仓库 0.1、0.2、0.3 基线，在目标项目实现适配。无需为了移植额外引入 Tone.js、框架或打包器；已有框架沿用宿主约定。

## 1. 要带哪些文件

路径以原仓库根目录为基准：

| 文件 | 职责及依赖 |
| --- | --- |
| `exercises/06-granular/0.3/engine.js` | 原生 Web Audio 引擎、随机数、XY 映射；经典脚本 IIFE，导出 `window.Granular`，无 DOM 依赖 |
| `exercises/06-granular/0.3/flow.js` | 参数游走计算，依赖 Granular，导出 `window.FreeFlow`；自身不创建定时器 |
| `exercises/06-granular/0.3/recorder.js` | 麦克风录音、30 秒限制、实时分析波形及录音资源清理，导出 `window.SampleRecorder` |
| `exercises/06-granular/0.3/app.js` | 页面状态、导入、控制器、自由流动定时器、Canvas 和事件绑定；强依赖原页面 DOM |
| `exercises/06-granular/0.3/index.html`、`style.css` | 独立页面结构和样式；CSS 有全局选择器，嵌入时需限定作用域 |
| `shared/exercise-controls.js` | 独立页面的播放、停止、种子控件；自定义元素 `exercise-controls` |
| `exercises/06-granular/tools/check.cjs` | 引擎离线回归检查，路径按原目录组织 |
| 本文与同目录 `README.md` | 接入契约及版本背景 |

只复用声音：带 engine.js；需要游走再带 flow.js，由宿主写控制器。

复用整套交互：以上 UI 文件也要带，适配 DOM、样式、事件及生命周期。原加载顺序是共享控件 → engine.js → flow.js → recorder.js → app.js，脚本在页面元素之后执行。原相对路径和返回首页链接移植后需要修改。不要同时启动原 app 控制器和宿主控制器。

## 2. 现有引擎接口

```js
const params = { ...Granular.defaults }; // 此对象由控制器长期持有
const engine = await Granular.create(audioBuffer, params, 'seed-01');
engine.schedule();
// 后续修改同一个对象，影响未来计划的粒子：
params.density = 30;
// 停止并释放：
await engine.deactivate();
```

这是接口用法片段，不包含生产接入所需的异步取消和组件卸载处理。`create` 应从用户播放手势触发；不保证无手势自动播放成功。

- `create(buffer, params, seed)` 返回 Promise，解析为 `{schedule, end, deactivate, events, time, active}`。
- `schedule()` 启动内部定时器；重复调用不叠加调度。创建成功不会自动 schedule。
- `end()` 取消调度，35ms 淡出，约 50ms 后清理声部和事件，但不关闭上下文；返回 Promise。
- `deactivate()` 等待 end，然后断开总线并关闭引擎自己的 AudioContext。停止后需要重新 create 才能再播放；不是暂停/继续接口。
- `time` 是只读音频上下文当前秒数；`active` 包含待播放与活动声部，不等于当前可听见粒子数。
- `events` 为引擎维护的事件数组，可只读用于显示；不要 splice 或更改事件，不要把它当完整录制历史。
- `Granular.random(seed)`、`plan(params, durationSeconds, rng)` 为纯计算；`demo(context)` 生成八秒双声道内置素材。

**当前不支持传入 AudioContext、输出节点、宿主主音量或外部 transport。** 引擎自行创建上下文，输出直连其 destination。目标项目若需要统一混音/效果器，必须先扩展工厂以接收上下文和输出，明确所有权：只有自建上下文才能在销毁时 close；宿主借出的上下文不能关闭。不得把尚未实现的参数当现有 API 调用。

`window.exercise.activate()` 是原页面的简易入口，返回新引擎；它不会把该引擎登记为 app.js 的内部 engine，也不会自动关联页面播放状态、粒子绘制和停止按钮。宿主应自行持有和销毁返回值，不能混用这两条控制路径。

## 3. 参数契约

| 键 | 范围 | 默认值 | 单位/语义 |
| --- | --- | --- | --- |
| position | 0–1 | 0.35 | 相对整段音源的取样中心 |
| spray | 0–0.5 | 0.03125 | 八秒初始素材对应 ±250ms；加载后由 defaultSpray(duration) 重设 |
| reverse | 0–1 | 0 | 每颗粒子倒放概率 |
| size | 15–1000 | 180 | 输出时长，毫秒 |
| density | 2–60 | 24 | 每秒粒子数，可为小数 |
| pan | 0–1 | 0.8 | 随机声像范围 ±pan，不是固定左右平衡 |
| pitch | −24–24 | 0 | 半音，播放倍率 `2 ** (pitch / 12)` |
| reverb | 0–1 | 0.3 | 并行混响发送量，保持干声 |
| volume | −24–6 | 0 | dB，相对既有 +6dB master 的输出增益 |

复制 defaults，不直接修改全局 defaults。引擎持有 params 的对象引用；响应式框架若替换对象，必须把更新写回引擎持有的对象，不能只刷新 UI。

范围来自页面约束，create/plan 并未全面验证输入。宿主须拒绝 NaN/Infinity、非正密度、空音源等无效值，并按表钳制。显示时可以四舍五入，内部游走不要每帧量化成整数。

## 4. XY 和手动接管：保留已确认的语义

坐标 x 向右增大，y 向下增大，均为 0–1：

```js
position = x;
spray = y * 0.5;
reverse = (2 * spray) ** 2.5;
```

`Granular.fromXY(x,y)` 返回上述三项并钳制坐标；`toXY(params)` 只根据 position/spray 返回点位。顶端纯正放、中点约 18% 倒放、底端纯倒放。

**fromXY 本身不处理覆盖规则。** 原 app 的 setXY 在新旧 spray 差值小于 `1e-8` 时移除映射结果中的 reverse，保留手动设定；有纵向变化才重算倒放。独立 Reverse 滑块不移动 XY。单独调整 spray 滑块会移动 XY，但保留当前 reverse。波形拖动只改 position。

手动操作 XY、波形或任意参数（包括 pitch），首先关闭整个自由流动并同步开关状态，再应用修改。键盘输入同样处理。松手不自动恢复。自动 step 更新不能走这个手动入口，否则流动会自己关闭。

XY、波形、滑块和数值显示必须读取同一份实际参数。保留指针捕获、窗口 pointerup/cancel 兜底及失焦释放，避免拖动卡住。移植 app.js 的 document 级 dragstart 拦截时应限制到乐器区域，避免阻止宿主的其他拖放功能。

## 5. 自由流动

`FreeFlow.create(params, seed)` 返回 `{step, reset}`，不会自动运行；`step(dtSeconds)` 原地更新 params。宿主维护唯一 25ms 定时器，使用 performance.now 的差值，单步最多 0.1 秒，避免长卡顿后跳跃。

| 独立参数 | 每段周期 | 目标距离基数 |
| --- | --- | --- |
| position | 6–13 秒 | 0.28 |
| spray | 9–18 秒 | 0.11 |
| size | 7–15 秒 | 220ms |
| density | 5–11 秒 | 15/s |
| pan | 11–21 秒 | 0.30 |

目标距离取基数的 40–100%，方向各自随机，边界反射并钳制，使用五次平滑曲线连接。各参数使用 `seed + ':flow:' + key` 的独立随机流，不消耗粒子随机序列。

pitch 不参与流动。reverse 跟随 spray 映射；开启时保存手动 reverse 与映射值之差，用 4 秒平滑衰减此偏差，保持起点连续。

停止流动需清宿主定时器并丢弃实例，保留当前 params。step 的 held 参数虽存在，当前产品规则是手动操作关闭全部流动，不要接成松手自动继续。停止播放、导入和页面隐藏同样关闭流动。可以在音频未播放时观察参数游走。

同种子只保证相同输入及操作/推进时序下的结果；墙钟定时器、手势时刻和不同起始参数会影响输出，不应宣称只要种子一样就能完整重放演出。

## 6. 生命周期与导入适配

1. 控制器统一持有 buffer、params、seed、当前 engine、启动代次及导入代次。防止重复 play 生成多个引擎。
2. 每次异步 create 前记录代次；stop/卸载增加代次。create 返回时如代次过期，立即 await 返回引擎的 deactivate，不能 schedule。
3. stop 先清流动、使启动失效并移出当前 engine 引用，再 await 旧引擎淡出销毁；后续重播使用新实例。
4. 导入异步读取/解码完成后检查导入代次，只允许最后一次结果生效；失败保留原 buffer。组件卸载也应使导入结果失效。
5. 原页面在 visibilitychange(hidden) 和 pagehide 停止播放；嵌入单页应用还需在路由退出/组件卸载时主动清理。

原 app.js 是一次性页面脚本，**没有 mount/unmount 或 dispose 接口**。它的 requestAnimationFrame 持续运行且未保存取消句柄，监听器也没有批量解绑。组件化时必须补上取消 rAF、清流动计时器、解绑元素/window/document 事件、释放指针及销毁当前/迟到引擎；仅移除 DOM 不够。

原导入策略：最大 `40 * 1024 * 1024` 字节，本地 decodeAudioData，解码后取前 30 秒及前两个声道（不是多声道混音），不上传。文件格式支持由浏览器解码器决定。先完整解码再裁剪，不是流式读取；压缩文件解码内存可能明显大于文件大小。若更改这些限制，需要同时更新 UI 与文档。

公共控件发出 exercise-play、exercise-stop、exercise-seed-apply、exercise-regenerate；seedValue 是 getter，原 app 使用 setPlaying、setBusy、clearSeed。种子应用/换一版会停止并重建引擎。宿主可用自己的控件适配这些动作，无需保留原自定义元素。

## 7. 调度、视觉与混音

- 内部每 25ms 预排未来 120ms，参数改变不会回写已排粒子。卡顿跳过积压，不补发密集过期粒子。不要用渲染帧驱动粒子发声。
- 声部上限 192；每颗粒子链为 BufferSource → Hann Gain → StereoPanner → bus → input 补偿 → 干声 / convolver → wet 并行 → master → output → compressor → destination。
- master 淡入到 +6dB，末级压缩器不是严格限幅器。与宿主声音合奏时重新评估总增益，避免宿主与引擎重复加 +6dB。
- events 字段：offset（原音源秒）、length（输出秒）、rate、reverse、pan、peak、when（该引擎音频上下文秒）。
- 绘制令 age = engine.time − event.when；只画 `0 <= age < length`。正放读取 offset + age × rate；倒放读取 offset + (length − age) × rate。不得用 Date.now/performance.now 直接减 when。
- 原图以 pan 表示上下位置，浅灰正放、橙色倒放。波形散布阴影用当前 params，粒子则用其已排定事件快照。

如保留原面板：01 音频与 02 Pad 平级，标题 100px、操作面 300px、读数 48px；窄屏操作面 235px。参数第一排 position/spray/reverse，第二排 size/density/pan/pitch。宿主可重设计视觉，但需保持控制归属与实际值同步。

## 8. 接入步骤与验收

先读目标项目 AGENTS.md，检查已有音频上下文、播放入口、路由卸载、状态管理、样式作用域；明确是独立引擎还是接入宿主混音。列明要搬的文件及要新增的适配后再实现。当前未指定目标路径，不据此直接开始合并。

原仓库离线检查（从仓库根运行）：

```text
node exercises/06-granular/tools/check.cjs 0.3
node --check exercises/06-granular/0.3/engine.js
node --check exercises/06-granular/0.3/flow.js
node --check exercises/06-granular/0.3/app.js
```

搬动目录后需调整测试的相对路径。check.cjs 覆盖粒子计划、XY 映射和引擎调度/清理，不覆盖浏览器 UI、flow.js 完整行为或实际听感。

接入后至少验收：

- 内置音源与真实文件导入；失败后仍可播放旧素材；连续导入只采用最后一次。
- 播放/停止/重播，快速播放后停止、未完成启动时卸载，不残留声音或计时器。
- XY 上中下位置的倒放映射，Reverse 手动覆盖与横向保留，波形/滑块/XY 同步。
- 流动从当前值平滑开始、各参数不同步游走、pitch 不变，任何手动调整关闭全部流动。
- 切后台、路由退出及重新进入后的清理；若共享 AudioContext，不破坏宿主其他声音。
- 真实浏览器的音频启动和粒子/声音时序；实际试听合奏音量、倒放质感与爆音。控制台无报错不能替代试听。

源版已做引擎离线回归与独立流动模拟；最新固定高度布局仅做静态检查，未完成最新布局浏览器视觉验收，代理未实际试听。目标项目必须独立验收。

## 9. 目标项目 AGENTS.md 可加入的指引

复制本文到目标项目后，把下文路径替换为实际相对路径，不要照搬原仓库的全部 AGENTS.md：

> 修改或接入 Moonlight Grains 粒子合成器前，先阅读其 INTEGRATION.md。以 06 / 0.3 为基线，保留参数单位、XY 倒放映射、手动操作关闭自由流动和音频时钟同步规则。现有引擎自行拥有 AudioContext；共享宿主上下文需显式适配所有权。组件卸载必须取消异步启动/导入、清定时器与动画并释放节点。实际迁移路径和入口以本项目为准。


## 10. 麦克风采样扩展（0.3）

新增 `0.3/recorder.js`，经典脚本导出 `window.SampleRecorder`，在 app.js 前加载。`SampleRecorder.create({onState,onResult,onError})` 返回 start/finish/cancel 和只读 active；LIMIT 为 30 秒。onState 状态为 idle/requesting/recording/processing，录制状态附秒数；onResult 接收完整 Blob，宿主负责解码和载入。start 异步请求麦克风，cancel 能使迟到授权失效；finish 提前结束并收集最终 dataavailable，再交付结果；cancel 丢弃本次结果。模块自行管理定时器及 MediaStreamTrack，结束或取消都释放。

原 app 在录制开始前 await stop，禁用播放/其他音源选择。权限等待可取消；切后台/pagehide 取消。没有监听链、下载或持久存储。过短（小于 0.25 秒）、权限/设备/解码失败保留旧 buffer。结果走现有 load 路径，裁剪至最多 30 秒/两声道。30 秒停止定时器不是硬实时保证，最终解码裁剪是时长硬上限。MediaRecorder 格式需在目标浏览器验证；麦克风需要安全上下文和用户授权，跨源 iframe 还需宿主允许 microphone。

宿主卸载时也必须调用 recorder.cancel，并使其 onResult 后续解码任务失效；不要仅停合成器而留下麦克风。源 app 的录音互斥只管其内部播放路径，若宿主使用 exercise.activate，必须在宿主统一执行互斥。测试入口 `node exercises/06-granular/tools/record-check.cjs` 为模拟 API 单元检查，不代表已完成真麦克风和编解码验收。


### 录音实时波形补充

recorder 实例另提供 `waveform()`：录制中返回重复使用的 2048 点 Float32Array（当前时域快照），其他状态返回 null。只读使用，不持有为录音历史。模块自行创建分析 AudioContext，以 MediaStreamSource → AnalyserNode 取样，不接 destination；finish/cancel/error 时清节点并关闭该上下文。宿主用已有 rAF 绘制即可，不再新增音频计时器。该分析上下文与粒子播放上下文独立，组件卸载必须 cancel。原 app 录制时用橙色即时波形替换旧素材波形，解码完成后恢复采样全貌；并非累计录音可视化。

## 11. 原始参考入口

- [Granula GitHub 仓库：serezhaOk/Granula](https://github.com/serezhaOk/Granula) · [合成器页面](https://granula.serezhaok.com/)；作者 [Sergei Diuzhev / Patreon](https://www.patreon.com/u78044153)：XY 音色联动的交互参考。
- [ZYA granular 在线演示](https://www.zya.cc/granular)：基础粒子参数与浏览器交互对照。
- [arekdurlik/waa-granular 源码仓库](https://github.com/arekdurlik/waa-granular)：Web Audio 粒子采样机制对照。

这些链接用于追溯参考背景，不是本组件的依赖或 API 文档。移植以本地 0.3 实现和本接入说明为准；不要为复刻原项目而恢复 0.2 四角宏，也不要据产品页面推定开源许可。完整参考说明见同目录 README.md 的「参考项目与原始链接」。


## 12. 采样增益与空间扩展

0.3 引擎新增 inputGain(buffer)、defaultSpray(duration) 纯函数以及 params.reverb / params.volume。输入补偿按全素材统计 RMS/peak，最多 4 倍，RMS<0.001 不提升，响素材不变，源 buffer 不修改。不得在宿主重复执行同等归一化而无重新标定。

引擎生成独立固定种子的 4.5s 双声道卷积脉冲，默认 ConvolverNode 归一化；干声保持，湿声发送为 reverb × 0.8。volume 经 10^(dB/20) 转换，两个实时音频增益以 30ms setTargetAtTime 平滑。空间与输出不参加自由流动或 XY 映射。末级压缩器前保留 +6dB master。deactivate 必须释放 input/convolver/wet/output 及原节点，停止对完整干湿输出淡出，无尾音续播。

每次 load 成功设置 params.spray=defaultSpray(buffer.duration)，此策略位于 app 控制器；单独调用引擎 create 不会重设 params。fromXY/toXY 的范围和 reverse 曲线未变。粒子调度使用独立 timing 随机流产生 ±10% 间隔扰动。原听感与输出链描述以本节及参数表更新为准。新输出区不改变原三项 XY、四项独立参数分排。


### 高八度空间层与高频衰减更新

引擎新增 octaveEvent(base,duration)：rate ×2、length 最多 ×1.25 且钳制素材边界、peak ×0.4、wetOnly=true，继承原粒子声像和倒放。混响非零时用独立 seed+:shimmer 随机流以 45% 概率触发，仅连 shimmerInput（相同素材补偿）→ convolver，不连干声 bus。events 包含该声部，宿主可用 wetOnly 区分。共享 192 声部上限。convolver 返回经过 4.5kHz lowpass 再进入 wet，deactivate 清理 shimmerInput 和滤波器；离线节点桩需支持 createBiquadFilter。主 pitch 参数及 flow.js 不变。demo 移除主动添加的白噪声；导入素材未做降噪。


### 0.3 原音与八度的音乐层次

主粒子有 15% 概率直接升高八度，峰值乘 0.8，原音仍占 85%；独立 `:harmony` 随机流，不改变 pitch 滑块。湿声高八度依旧从原始粒子事件派生，不从已升八度的主声部再升，避免意外 +24 半音。混响为 0 时仍可听到少量干声八度。没有加入四度、五度或低八度。干声八度事件有 octave=12 标记，视觉按真实 rate 移动。

自由流动的密度目标改为：开启时密度 × (开启时长度 / 当前长度目标)^0.45 × 0.8–1.2 随机系数，并钳制到 2–60；独立时间曲线平滑接近，因此长粒子倾向更疏、短粒子倾向更密，并非逐帧强制反比。起点保留当前值，手动操作仍关闭流动。离线边界/清理、十分钟流动模拟通过，尚未实际试听本轮改动。


### 0.3 混响清晰度与八度高频处理

混响返回：Convolver → 180Hz 高通 → 原 4.5kHz 低通 → wet → master。只削减湿声低频堆积，原音干声仍直达 bus，不经过新增滤波。湿声高八度单独在进入卷积前通过 3.5kHz 低通；干声高八度通过更轻的 6kHz 低通后进入 bus。三处新增滤波 Q 均为 0.707，保留原增益、概率、音高和 XY 行为，无新增控件。deactivate 需释放 wetLowCut、shimmerTone、octaveTone。离线节点连接与清理检查通过；具体听感仍需实际试听。
