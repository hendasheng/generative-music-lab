# Granular 0.3.1 · 手机双窗口

基于本项目 0.3 创建；**0.3 是颗粒合成器的基地**，本版使用它的合成器，`engine.js`、`flow.js`、`recorder.js` 与当前 0.3 逐字节相同（见下节）。未移植 moonlight_grains_0.4.1 的引擎或月光视觉。保留暖灰面板、橙色指示点、点阵 XY 与真实粒子波形。

## 与 0.3 的关系：0.3 是基地，本版跟它

**合成器的调整一律优先在 0.3 实现并测试**，稳定后再搬到本版。本版只负责手机交互外壳（摄像头、菜单、XY + 四旋钮、顶栏按钮），不单独调音。

- 声音相关的文件是 0.3 的副本：`engine.js`（合成器）、`flow.js`（参数游走）、`recorder.js`（录音）、`live.js` + `live-worklet.js`（实时输入采集）。后四者与 0.3 逐字节相同；**`engine.js` 现在有意不同**（见下节「输出音量」），差异只有默认值与新增的 `levels()`，需要时按新基线重新对齐。
- 实时输入已接入：顶栏「LIVE」按钮开启麦克风，走 0.3 的 8 秒环形缓冲（`LiveInput.ring` + AudioWorklet `grain-capture`），开启后自动开始播放，再点一次关闭并停止。**开启时音源自动切回内置素材**（`adoptDemoSource()`：实时采样来自麦克风，与上一次导入的文件无关；且它不经 `load()`，因为 `load()` 会先 `stop()` 把刚拿到的 liveSource 清掉）。本版只做「开 / 关」一个按钮，**没有**移植 0.3 的「冻结」按钮（`liveSource.freeze()` 仍在引擎里可用，要加随时能接）。开启期间录音按钮禁用（两者都要麦克风）。
- 实时输入时素材只有「最近 8 秒」，因此 XY pad 左右轴标签会切成「较早 / 刚刚」，回到素材模式恢复「起点 / 终点」；`engine.events` 的 `origin` 字段用来把事件的窗口坐标换算回当前窗口（见 `app.js` 的 `draw()`）。
- 想改实时输入的行为，先看 0.3 怎么接（`app.js` 的 `liveUI()` 与按钮处理），不要在 0.3.1 里另写一套。

**从 0.3 搬合成器改动的流程**（每次都走，别只看了眼色差）：

1. 在 0.3 改 + 验证（`node tools/check.cjs 0.3`，听感在 0.3 上定）。
2. 把改动搬到本版；若整体替换 `engine.js` / `flow.js` / `recorder.js`，直接覆盖。
3. 跑 `node exercises/06-granular/tools/engine-sync-check.cjs <同步前的 engine.js> exercises/06-granular/0.3.1/engine.js` 证明**声音没变**：它把两份引擎放进各自的 vm realm，逐字节比对计划事件、干/湿声八度派生、`inputGain`、`defaultSpray`、XY 映射、导出面，以及引擎 `schedule()` 后真正排给 `BufferSource.start` 的 when/offset/rate 序列。若这次同步**就是要改声音**（例如从 0.3 搬一次调音），那么这个脚本会报差异——那正是预期结果，此时改跑本版的听感验收，并把新基线重新记下来。
4. 本版页面另跑 `node tools/check.cjs 0.3.1` 与 `layout-check.mjs`。

★ 该脚本有个坑：两份引擎在不同 realm 里，`node:assert/strict` 的 `deepEqual`（即 `deepStrictEqual`）会连 **prototype** 一起比，值完全相同也会失败（`same structure but are not reference-equal`）。所以它按值比较，不要改回 `assert.deepEqual`。

## 操作

- 竖屏：上方视频与波形，下方 XY 与四个旋钮。横屏宽度至少 600px 时两组并排。
- 顶栏三个区：左侧菜单与自由流动，**正中播放 / 暂停**，右侧**录制采样在前、实时输入在后**，两者之间留 **10px** 间距（`.main-actions{gap:10px}`；`gap:0` 会让两个标记贴成一整块）。居中靠 `display:grid` 三栏等宽（`1fr auto 1fr`）+ 左右 `justify-self`，并给右侧组**等量 `padding-right`** 抵消那段间距——否则播放键会偏离正中（实测 5px）。原 `GRANULAR / 0.3.1` 标题已删。
- **图标用 Lucide 的官方路径，本地内联**：参考实现是 `<script src="https://unpkg.com/lucide@latest/...">` + `<i data-lucide="play">` 由 JS 渲染；本版不引入该脚本，而是把 Lucide 的 `path` 原样内联进 HTML（无 CDN、离线可用，与「无构建」约定一致）。六个图标与 Lucide 名称一一对应：`menu`、`infinity`、`play`、`camera`、`refresh-cw`、`x`。
  ★ 这里踩过坑：最早那版是**手抄的近似路径**，只有 `menu` 恰好与 Lucide 同形，所以和参考实现放在一起就不像一套。改图标时请从 <https://github.com/lucide-icons/lucide/tree/main/icons> 取对应 `.svg` 的 `path`，不要手画。
  ★ **切镜头不能用 `switch-camera`**：那个图标本身就是「相机机身 + 镜头圆 + 箭头」（5 个图元），和 `camera` 并排放在同一个窗里会撞脸、分不清。改用 `refresh-cw`（4 条纯箭头路径，无机身）。`tools/camera-layout-check.mjs` 会断言窗内两个图标的**图元数不同**，防止再撞。
  `play` / `pause` 由 `mobile.js` 切换（`pauseIcon` 不是 Lucide 图标名，是两条竖线，沿用参考实现的做法）。
- **摄像头窗内的图标比顶栏小一档**：顶栏 48px 按钮 / 24px 图标；窗内 `.camera-actions .icon-button` 是 **44px 按钮 / 20px 图标**（仍满足 iOS 44×44 命中区下限，但在画面角落不喧宾夺主）。
- **按钮尺寸按 iOS HIG 定**（[Apple《UI Design Dos and Don'ts》](https://developer.apple.com/design/tips/)：Hit Targets ≥ **44×44 points**、Text Size ≥ **11 points**）：五个按钮的**命中区一律 48×48**（图标按钮 `48×48`；LIVE 与录制是 `48×48` 的透明容器，内部标记块更小）。混合尺寸时靠两层 `align-items:center` 对齐（见下）。
- **录制与 LIVE 用同一种结构**：透明容器 + 内部**无描边**的圆角标记块。标记块**两者同尺寸同圆角**（44×26、r=6，录制中收成 26×26 方块），比命中区小一圈——既同套又留足手指面积。**尺寸偏小会被看成「不是一套」**，所以尺寸也列入契约：`tools/live-check.mjs` 断言两者同高同圆角且宽度 ≥40px。录制标记是红底 + 白色圆点（14px）；**LIVE 标记一直是绿底白字**（`--live:#3f9d4a`，字号 14px——11px 只是 iOS 正文下限，小号全大写字母在手机上偏弱），激活后换更亮的 `--live-bright:#46b455` 并开始 `live-breathe` 呼吸（1.8s 透明度 1 → 0.5 → 1，`aria-pressed=true` 驱动）。等待授权时文案变「等待」。
  ★ 已知取舍：白字压在 `#3f9d4a` 上对比度只有 **3.42:1**，激活的 `#46b455` 更低（**2.65:1**），都低于 WCAG AA 对小于 18pt 正文的 4.5:1。若要达标又不改白字，把两个绿调深即可：`#2f7d3a` → 5.10:1、`#2b6e34` → 6.21:1（激活态用更亮的同族绿）。当前按用户要求保留现取值。
- ★ **顶栏垂直对齐有两层，少一层就会错位**：图标按钮 48px、LIVE 只有 32px，混排时必须 (1) `.mobile-header` 网格 `align-items:center`，(2) `.flow-actions` / `.main-actions` 也 `align-items:center`。只做第一层不够——网格对齐的是这两个 flex 容器（它们被拉伸到 48px 高），容器内部的按钮仍按默认 `stretch` 贴顶，实测 LIVE 中心 16 而不是 24。`tools/live-check.mjs` 会断言五个按钮的垂直中心偏差 ≤1px。
- 点击摄像头窗开启视频；窗内图标分两种状态：
  - **摄像头未打开：图标常驻**——此状态下不存在「隐藏」，点窗口也不隐藏（用户必须看得到入口在哪）。
  - **打开之后：点窗口显示 / 再点隐藏**，运行中也能收起来看画面；再点一下即回来。
  - 两条约束：**从闲置进入采集的那一刻重置为展开**（刚点完相机不该立刻看不到关闭键）；**运行中收起后必须能再展开**——相机图标是关闭摄像头的唯一入口，绝不能出现「关不掉」。切换镜头只在运行时显示（关着时无意义，按钮本来也是 disabled）。隐藏用 `display:none` 而不是透明——否则看不见却仍能被读屏与 Tab 聚焦（类名 `controls-hidden` / `flip-hidden`）。
  - ★ 探针要测 **`.camera-actions` 容器**的 `display`，不要测 `#cameraToggle`：`display:none` 加在容器上，按钮自己在 CSS 里恒为 `display:grid`，测它会永远得到「可见」，断言形同虚设（踩过一次）。
- 默认优先后置，前置画面镜像。仅本地实时显示，不录像、不拍照、不上传、不调制声音。
- 权限等待期间可再次点击取消；切换前释放旧设备，缺少另一侧镜头时明确提示，可重新开启原镜头。拒绝权限不会影响 XY 或声音。
- 摄像头使用 audio:false；麦克风由「实时输入」与「录制采样」两个按钮控制，两者互斥（都要麦克风）。部分移动设备同时开启摄像头与麦克风的行为需真机确认。
- XY 保留上方聚焦正放、下方散开倒放，手动操作关闭自由流动。
- 粒子长度、密度、立体声散布、音高四个旋钮常驻 XY 下方；导入、种子、其余粒子参数和空间/输出参数放在菜单中。视频下方波形条显示粒子并支持取样位置调整。
- 隐藏页面/离开时停止声音、取消录音并关闭摄像头；回来后手动重新开启。

使用手机浏览器通过 HTTPS 访问（开发可用 localhost），允许所需设备权限。此版本是网页，不含原生 App 或安装清单。

## 文件

camera.js：CameraPreview.create(video,onState)，start/stop/toggle/flip 与 active；异步请求代次隔离，取消后的迟到流立即释放。mobile.js：菜单、摄像头 UI、共享播放组件的本版本适配。app.js：保留 0.3 参数逻辑，适配图标状态与录音计时。共享 exercise-controls.js 未修改。

UI 参考目录：`C:/Users/HenDaSheng/Desktop/web-visual-bigbigworld/projects/moonlight_grains/moonlight_grains_0.4.1`，参考按钮布局与图标。**图标即 Lucide**（该实现用 unpkg 的 lucide 脚本按名字渲染；本版把同样的 `path` 内联，见「操作」一节）。

## 验证

仓库根运行 `node exercises/06-granular/tools/camera-check.cjs`、`node exercises/06-granular/tools/check.cjs 0.3.1` 和 `node exercises/06-granular/tools/layout-check.mjs`。摄像头模拟测试覆盖前后切换、镜像、拒绝权限、请求取消、迟到授权隔离及轨道中断/释放。引擎测试通过。

`layout-check.mjs` 是 0.3.1 的**真机视口探针**：自己起本地服务器（跑完关掉，不留占端口的子进程），用 Chrome CDP 在十三个视口（竖屏 844/704/610/600/580/520/490、横屏 330/300/250、桌面 1280/1440/760）里量各区块实际高度，断言 pad 不被压扁，并在 390×610 下派发指针事件确认 XY pad 与旋钮仍能拖动。Chrome 的 IPC 要命名管道，这条命令在沙箱下需要 `danger-full-access`。

浏览器已验证 390×844 竖屏分组布局、844×390 横屏并排、无横向溢出、菜单开关、自由流动与键盘接管，检查时无控制台错误；纵向布局修正后按上表的视口逐一复测。未在代理侧启用真实摄像头/麦克风或试听；前后镜头与同时采集仍需手机真机验收。


0.3.1 布局调整：XY Pad 正下方常驻四个 dial（粒子长度、密度、立体声散布、音高），支持上下/左右拖动、方向键和 Shift 精细拖动。旋钮指针跟随实际参数与自由流动，手动操作关闭流动。波形条移入摄像头分组，紧贴视频下方；菜单仅保留其余参数、音源和种子。

录制按钮三态：静止是**红底 + 白色圆点**（与参考 UI 的 `.record-button::before` + `.record-dot` 同形，白点 10px、红块 30×18），录制中收成 18×18 方块并隐藏白点（同播放键 ▶ → ⏸ 的家族语义），等待授权（disabled）时整块降到 0.4 不透明度。移植自参考实现时白点曾漏掉，只剩一个红块；`.record-mark::after` 负责该白点，`[aria-pressed=true]` 时 `display:none`。注意 0.3 桌面版用的是文字按钮，不受此影响，两边不要互相照抄。

## iOS：音频会被系统压低（录制后尤其明显）

**真机上「声音特别小、尤其录制」的主因不在增益，而在 iOS 音频会话类别。** 参考实现的 `engine.js` 第 24–30 行已经写明并处理了，本版原先没有搬过来：

- 默认（`auto`）会话有两个坑：输出跟着**静音开关**走；而且**采集麦克风期间系统会把整个页面的输出压低**（[WebKit #236219](https://bugs.webkit.org/show_bug.cgi?id=236219)：非 MediaStreamTrack 音频在录音时被衰减）。
- 更关键的是**离开麦克风后不切回**，iOS 会把之后的播放一直留在被压低的那一档。所以表现为「录完之后一直很小」。

处理方式（照搬参考，`engine.js` 的 `setAudioSession` + `app.js` 四处接线）：

```js
function setAudioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (_) {}
}
```

| 时机 | 会话类型 |
| --- | --- |
| `play()` | `liveSource \|\| livePending` 时 `play-and-record`，否则 `playback` |
| 录音 `onState` | `recording` / `requesting`（或实时输入开着）时 `play-and-record`，其余 `playback` |
| 打开实时输入 | `play-and-record` |
| `stop()` | `playback` |

★ `play()` 里**不能硬写** `playback`：实时输入开着时 `play()` 也会被调用，会把刚声明的 `play-and-record` 顶掉，采集期又回到被压低的那一档。判据必须是「当前是否在用麦克风」。

`navigator.audioSession` 是很新的 API（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)，标注 limited availability），所以全部走特性检测 `?.()`——不支持时静默跳过，不影响旧 Safari。`tools/live-check.mjs` 装一个可写探针记录取值序列，断言**必须出现 `play-and-record`，且结束时回到 `playback`**。

### 另一处未搬的 iOS 差异（待定）

参考实现整页**共用一个 AudioContext**，并在**首次用户手势的同一个调用栈**里同步 `prime()` 建好并 `resume()`（`engine.js` 第 15–23 行），理由是「每次 `play()` 新建 context 在 iOS 上会一律停在 suspended、完全没声音」；它对 `resume()` 还有 400ms 超时兜底，因为 iOS 缺手势时该 promise **永不 settle**。本版仍是**每次 `play()` 新建 **context**（`deactivate()` 时 `close()`）。这是比会话类别更大的架构差异，**本次没有改**：它需要把上下文抬到共享层并改 `deactivate` 的所有权语义，风险与改动面都大，且要真机才能确认收益。若 iOS 上出现「第一次播放没声音、要再点一次」，多半就是这一条。

## 输出音量：默认调大一档

起因是「声音特别小，录制和播放都小」。查参考实现（`moonlight_grains_0.4.1`）后确认：**两边的增益链代码完全相同**（`inputGain` 目标 RMS 0.16/峰值 0.85 上限、`peak = .38/√(density×length)`、master 启播淡入 +6dB、`output = 10^(volume/20)`、compressor −6dB/12:1），参考的 AnalyserNode 只是电平表、直通不改声音。差别只在两个默认值：

| | reverb | volume | 干声实测 |
| --- | --- | --- | --- |
| 0.3.1 改前 | .3 | **0** | 峰值 −7.5 / RMS **−15.5 dBFS** |
| 0.4.1 参考 | .65 | **6** | 峰值 −2.5 / RMS **−10.2 dBFS** |

6 dB ≈ 2 倍幅度。本版默认改为与参考一致（`reverb .65` / `volume 6`），改后真实引擎读数 **峰值 −3.4 / RMS −7.9 dBFS**（3 秒稳定段）。仍在压缩器 −6dB 阈值之上工作，峰值低于满刻度，未见削顶。

- 接线与生命周期都变了：引擎在 compressor 与 `destination` 之间加了 `AnalyserNode`，并导出 `levels()`（与参考同名，返回线性 `{peak, rms}`）。它**直通不改声音**，用途是测量与将来的电平显示。`deactivate()` 会 `disconnect()` 它。
- ★ **采样窗要够长**：启播头 1.2 秒还在淡入与起播阶段，实测 RMS −14.7 dBFS，3 秒才到 −7.9。用短窗量电平会把正常音量误判成偏小——我第一版断言就是这么误报的。
- 回归入口：`tools/live-check.mjs` 会读真实引擎的 `levels()`，断言 RMS 落在 **−12…−4 dBFS** 且峰值 **≤ −0.5 dBFS**（太小＝听不见，太大＝削顶）。改动默认增益后跑它。
- 离线桩 `tools/check.cjs` 也补了 `createAnalyser()`——桩要随被测代码一起改，否则 `levels()` 一读就崩。
- 若在 iOS 上仍明显偏小，先排除设备侧：媒体音量、以及 iOS 的**静音拨片**（Web Audio 通常不受它影响，但如果音频会话类别被降级就会受影响）。本版没有改动音频会话类别。

## 录制波形：必须与 pad 的「起点 / 终点」同轴

用户反馈「波形和 XY pad 的起点 / 终点对不上」。根因是**两条轴语义不同**：

- pad 的横轴 `position` 是**采样位置 0–100%**（波形上的竖线、`起点/终点` 都指它）。
- 而录制中的波形原先画的是 analyser 的**43ms 时域滚动窗口**——那是**时间轴**，与位置无关。所以播放头永远对不上波形内容。

**做法：录制波形与采样波形同构**——按位置分 1000 列、随录制从左向右累积（列 = 位置）。实现放在采集侧（`recorder.js`），因为那本来就是滚动窗口的职责：

- `recorder.columns()` 返回 `{mins, maxs, have}`：每次刷新把 analyser 的当前时域块按 `floor(已录毫秒 / 25ms)` 累进对应列，一个像素列一个 25ms 桶（与解码后 `analyse()` 的 1000 列同构，所以录制中与载入后的波形看起来是连续的）。
- `have[i]=0` 的列**不画**：未录到的部分留白，波形随录制向右生长，而不是先铺满再显示成平线。
- app.js 的绘制改成按列 `fillRect`，播放头与采样波形用同一句 `params.position*w`——同一个位置量映射到同一处像素。

实时输入模式（LIVE）则用 `liveSource.peaks()`（8 秒环形窗概貌），与 pad 切到「较早 / 刚刚」的语义一致。

★ 调试这条时的两个测量坑：
1. Chrome 假麦克风默认**静音**，平线分不清「画错」还是「没输入」。要用 `--use-file-for-fake-audio-capture=<wav>%noloop` 喂已知波形（如连续 440Hz）才能验证。
2. `getImageData` 读的是**设备像素**，不受 canvas transform 影响；而绘制用的是 CSS 宽度。用「最右有笔画像素」比宽度会得出错误结论（取样区域有限时早期/后期同时被截断），**要用「有笔画列数」度量墨水量**。

回归：`tools/live-check.mjs` 的「录制波形与 pad 同轴」——断言 1.2s 与 2.7s 的有笔画列数显著增加，且早期只占左侧一小段。

## 录完自动播放

录制结束 → 解码载入 → **自动起播**（`onResult` 里 `load(...).then(()=>play())`）。顺序有讲究：`load()` 内部会先 `stop()`，所以必须等它 resolve 后再 `play()`，否则两者会互相抢。`play()` 的守卫（`loading` / `recordPreparing` / `recorder.active`）在 load 完成后都已复位，实测可起播。回归在 `tools/live-check.mjs` 的「录完自动播放」。

## 实时输入的响度：输入层缺口与 A/B 诊断

排查 iOS「输出偏小」时按「先定位、再补偿」的顺序做，逐条结论：

| 检查项 | 结论 |
| --- | --- |
| `getUserMedia` 关掉三项语音处理 | ✅ 本来就是（`live.js`、`recorder.js` 都显式 `echoCancellation/noiseSuppression/autoGainControl: false`） |
| Granular 后有 makeup gain | ✅ `output` 就是，公式 `10^(volume/20)`，默认 +6 dB、上限 +6 dB；实时输入与素材路径共用同一公式，A/B 才可比 |
| Gain 后有压缩/限幅 | ✅ `compressor`（−6 dB / 12:1 / knee 3 / 3 ms / 150 ms）在 output 之后、destination 之前 |
| 点击后 `resume()` | ✅ `engine.js`、`live.js`、`recorder.js` 三处都在用户手势路径上 |
| 麦克风前后输出变化 | ✅ 已用 `setAudioSession` 处理（play-and-record ⇄ playback，见上一节） |
| **实时输入的输入补偿** | ❌ **原来是写死 `input.gain = 1`，等于不补偿**——素材路径有 `inputGain`（最多 4 倍），实时路径没有 |

最后一条是「麦克风输入层」的实打实缺口：iOS 采集到的麦克风电平常远低于桌面，而实时路径不做任何抬升。已改为**按环形缓冲的当前电平反复标定**，与素材路径共用同一个目标（RMS .16 / 峰值 .85 / 最多 4 倍，即最多 +12 dB），每 250 ms 重估一次、只在变化超过 5% 时改（避免把增益本身变成调制噪声）。离线断言：安静麦克风（峰值 0.02）被抬到 4 倍上限。

### A/B 诊断入口（`window.__iosAB`，刻意保留）

真机 iOS 上用它区分「麦克风输入层」与「Granular DSP 层」：

```js
await __iosAB.start()    // A：麦克风 → 直通 destination（★ 戴耳机，否则啸叫）
__iosAB.read()           // { path:'raw', gainDb, peakDb, rmsDb }
await __iosAB.engine()   // B：内建素材 → 引擎
__iosAB.read()           // { path:'engine', gainDb, peakDb, rmsDb }
__iosAB.gain(-6)         // 两条路径同时改增益，量「还差多少 dB」
await __iosAB.stop()
```

两条路径经过**同一个 output 增益公式**，音量设成相同值再比，差异就只来自 DSP。

★ **本机（Chrome 无头 + 假麦克风）量不到 A 的真实数值**：实测假麦克风峰值为 `0.0000`，两条约束都一样，所以 A 路径恒读 −99 dB。这不是接线问题。A 的数值必须在 iOS 真机上读，别拿无头结果当依据。

### ★ 未解决：iOS 上 LIVE 的响度仍然偏小（2026-09-26）

**现状：问题没有解决。** 桌面正常，iOS Safari 上 LIVE（实时麦克风 → 引擎）输出仍明显偏小。已做的改动都没能消除它，用户实测反馈依然偏小。

已排除的（有据可查，不要再重复排查）：

| 已排除 | 依据 |
| --- | --- |
| 采集约束被语音处理干扰 | `echoCancellation/noiseSuppression/autoGainControl` 两项都已显式 `false` |
| 采集后未切回会话类别 | `setAudioSession` 已在 `play/录音/实时输入/stop` 四处接线，探针实测序列 `playback → play-and-record → playback` |
| 输出链路缺增益或限幅 | `output`（+6 dB）+ `compressor`（−6 dB / 12:1）位置正确 |
| 实时路径完全没有输入补偿 | 已改为按环形缓冲电平标定（最多 ×4 = +12 dB），离线断言通过 |
| 单纯是设备音量 | 用户已确认不是系统音量问题 |

**卡在哪**：需要真机上的 A/B 数值才能判断量级——是「麦克风采集本身就只有那么小」（那要抬输入补偿上限或换采集参数），还是「DSP 之后才变小」（那要查混响/压缩/八度层）。本机测不了（假麦克风无信号）。

**下一步（按顺序）**：

1. 在 iOS Safari 上跑 `window.__iosAB`，把 **A（`raw`）与 B（`engine`）两次 `read()` 的 `rmsDb`/`peakDb`** 记下来。
2. 按差值分诊：
   - A 与 B 接近且都偏小 → 问题在**采集层**（考虑抬 `inputGain` 上限、或改 `channelCount` / 采样率约束）；本版当前上限是 **4×（+12 dB）**，`gainForLevel()` 一行可调。
   - A 明显大于 B → 问题在 **DSP 层**，查实时输入路径上多出来的环节（shimmer 八度、混响干湿）。
   - 两者都远低于桌面上同素材的 B → **采集层绝对电平**问题（设备/浏览器差异）。
3. 只有拿到数值才决定补偿量；**不要先凭猜提高所有平台的增益**（会破坏已经正常的桌面端）。

★ 排查时留意：A 路径是「麦克风 → destination」直通，**必须戴耳机**，否则扬声器串回麦克风会啸叫。

## iOS 全屏适配：画布色必须与 theme-color 一致

Safari 的顶部 / 底部工具栏区域显示 **`theme-color`**，而页面画布的底色由 **`html` 的 `background`** 决定（`html` 有背景、`body` 无背景时，前者会被提升为整个视口的画布背景）。两者不一致时，收放工具栏就露出一深一浅两块，看起来像「背景没填满」。

本版原先正是这种情况：`html` = `#bfc0b8`（更深的暖灰外框），`main` 与 `theme-color` = `#deded5`。现统一为 **`#deded5`**（`html` / `body` / `main` / `theme-color` 四处同色）。

对照清单（`tools/layout-check.mjs` 逐条断言）：

| 要求 | 做法 |
| --- | --- |
| `viewport-fit=cover` | `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` |
| 全屏容器优先 `100dvh` | `body` 与 `main` 都是 `min-height:100dvh`（不是 `100vh`） |
| html / body / 主容器背景一致 | 四处（含 `theme-color`）同为 `#deded5`，断言按 RGB 数值比较（避免 `#deded5` 与 `rgb(222,222,213)` 的字符串误报） |
| `theme-color` 与页面背景一致 | `#deded5` |
| safe-area 不给 body 留白 | `body` 无 padding；`env(safe-area-inset-*)` 只加在 `main` 的 padding 上，背景仍铺满整屏 |

★ 副作用（有意）：`main` 有 `max-width:980px`，宽屏上两侧原本是与画布同色的外框；现在外框与内容同色，等于把那圈深色边框去掉了。这正是「背景铺满、不出现额外色块」的要求，且只在宽屏可见。

★ 探针比较颜色时要先归一：CSS 写 `#deded5`，`getComputedStyle` 返回 `rgb(222, 222, 213)`，直接比字符串会误报不一致（踩过一次）。

## 开启摄像头不得改变布局

`<video>` 有固有宽高比（1280×720）。只要它参与网格轨道计算，**一开启摄像头布局就跳**：空 video 高 0，有流之后按比例把相机窗顶高、把 XY pad 挤小、整页开始滚动。实测（竖屏 390×610）：相机窗 168.5 → 206.8px、pad 171.5 → 155px、文档高 610 → 632。

修法两条，缺一不可：

- `.camera-window video` 用 `position:absolute; inset:0` 填充，比例不再参与轨道计算（保留 `object-fit:cover`，画面仍按比例裁切、不拉伸）。
- `.camera-window` 保留 `min-height:var(--min-camera)`，且 `--min-camera` 不能取太小。它是竖屏 `1fr` 轨道的下限：给得低就先压取景窗——实测 48px 时相机窗只剩 116.5px、pad 却占 223.5px，比例失衡；扫过 48/90/120/150/180/220 后取 **150px**（390×610 下相机窗 167.5 / pad 172.5，390×780 下 252.5 / 257.5），再往上到 180px pad 就触底、文档开始变高。

回归入口 `node exercises/06-granular/tools/camera-layout-check.mjs`：用画布流替换 `getUserMedia`（走真实的 `video.srcObject` + `play()` 路径），在竖屏 610 / 780 与横屏 330 三个视口比对开启前后的相机窗、波形条、XY 窗、pad、旋钮行与文档高，**任何一项变化即失败**；同时断言**波形浮层仍在摄像头窗内、高度 ≤80px、底边贴合窗口底边**。改布局或动摄像头相关 CSS 后跑它。

★ 那条浮层断言是补漏来的：早先改 HTML 时误删了 `.sample-strip` 包装层，canvas 裸露在 `section` 里，`width/height:100%` 失去参照后按固有尺寸铺开、几乎盖住整个摄像头画面；当时探针里已经有「浮层高度 / 底边差」两个字段，但**没有断言**，`null` 也没报错，所以这个 bug 一路漏到了真机。教训：探针里量到的量要么断言，要么删掉，别留着好看的字段。

视频与波形属于同一组，XY 与四个旋钮属于同一组；竖屏上下排列，横屏两组并排，旋钮始终在 XY 下方。


## 纵向布局修正：手机浏览器可视高度不是屏幕高度

0.3.1 是**网页**，跑在手机浏览器里，而浏览器自己的地址栏 / 工具栏会吃掉一截可视高度；`window.innerHeight` 往往只有设备屏幕高度的 70%–90%，横屏地址栏展开时甚至只剩 250–330px。此前的纵向布局用「屏幕高度」的思路写死了行高，真机上把 XY pad 压成了横向一条：

- 根因：`main` 同时设了 `height:100dvh` 与 `min-height:620px`（横屏 390px），且行高写死（`64px … 100px 32px`）。可视高度低于该下限时页面被钉住，顶部/旋钮/页脚这几行不会缩，被挤到 0 的正是那个 `1fr` 行 → `xy-group` 变矮 → XY pad 变矮，而且**没有下限**。
- 实测（改前）：竖屏可视高 610px 时 pad 只剩 **114px**、高 704px 时 **156px**；横屏虽然靠 `min-height:390px` 把 pad 稳在 180px，代价是整个下层（旋钮与页脚）被推到屏幕外，要滚 140px 才看得见。

改为「按可视高度自适应 + 该滚就滚」：

- `main` 去掉 `height:100dvh` 与像素级 `min-height`，改为 `min-height:100dvh` + `grid-template-rows:auto minmax(0,1fr)`；`body` 同样 `min-height:100dvh`。可视高度不够时页面变高并滚动，而不是把内容压扁。
- `--min-pad` 给 XY 窗一个真下限（竖屏 185px、横屏 112px，边框盒实测得 pad 净高 **155px / 84px**），`--min-knobs` 保住四旋钮行。
- `--min-camera` 也是**承重**的，不要删：相机窗没有下限时，`<video>` 会用固有宽高比把整页顶高（实测文档高 610 → 696，反而多出滚动）。这些 `min-height` 的原因都写在 `style.css` 注释里。

改后实测（`node exercises/06-granular/tools/layout-check.mjs`，Chrome CDP 按被浏览器吃掉后的高度逐个视口量）：

| 场景（可视高） | pad 高 | 文档高 / 是否滚动 |
| --- | --- | --- |
| 竖屏 844（桌面参考） | 302 | 844 / 否 |
| 竖屏 704（屏 844，栏吃 140） | 232 | 704 / 否 |
| 竖屏 610（屏 800，栏吃 190） | 186 | 610 / 否 |
| 竖屏 580（刚好到下限） | 170 | 580 / 否 |
| 竖屏 520（栏 + 键盘将出） | 155 | 549 / 是 |
| 横屏 330（屏 390） | 136 | 330 / 否 |
| 横屏 250（极端） | 94 | 288 / 是 |

即：**pad 全程 ≥ 94px，最短边不会再被压成一条**；只有可视高度低于约 580px（竖屏）或 250px（横屏）时才出现滚动，滚多少取决于缺多少。

### 精简到「只留内容」

界面只保留四块内容：摄像头 / 波形 / XY pad / 参数（含四个旋钮）。据此删掉/收紧的东西：

- **底部状态行删掉**：`footer` 改为 `sr-only`，`#status` 与 `#recordTime` 仍留在 DOM 里（app.js 持续写入：启动失败原因、录音秒数等），对屏幕阅读器可见，但不再占版面。因此 `main` 只剩 `auto minmax(0,1fr)` 两行。
- **两个窗口标题删掉**：`01 / CAMERA` 与 `02 / POSITION × TEXTURE` 及配套 CSS 一并移除（无可操作内容，纯装饰）；顶栏 `GRANULAR / 0.3.1` 品牌字也删掉，播放键居中，右侧为实时输入与录制。
- **波形条整条让给摄像头**：原来 `.sample-strip` 是 `.camera-group` 的第二行（46px），占掉的正是摄像头的高度。现改为**浮在摄像头窗口底部的浮层**（`.sample-strip` 绝对定位 `bottom:0`、`height:var(--wave-h)` 默认 56px、`z-index:2`），`.camera-group` 只剩一行，摄像头窗从 180 → **261px**（竖屏 610 下）。
- **波形只留粒子**：画布背景色连同 8 条网格竖线一起删掉，只画采样粒子、播放中的粒子与取样位置竖线；`#duration` 读数加重了 `text-shadow` 以便压在画面上仍可读。竖直位置由画布自身高度决定（`h/2 ± h*0.42`），不再依赖原来那套写死的 `22px` 内缩。摄像头状态文字上移到 `bottom:calc(var(--wave-h) + 12px)`，不再与波形重叠。取样位置拖拽仍可用（`#positionSurface` 叠在浮层上，`pointer-events:auto`）。
- **粒子读数要细**：粒子条原作者是 **2px**、端点圆 **r=3**，手机上会糊成一片。现改为**条 1px、端点 r=2**（`fillRect(a, y-.5, len, 1)` / `arc(x, y, 2, …)`）。粒子一多就不要再加粗，否则又会糊。
- **波形按峰值归一化**（参考实现的 `WAVE_AUTO_GAIN`）：麦克风原始电平常只有 ±0.2~0.4，按 ±1 直画又小又平，小声时几乎看不见波动。两处都归一化了：**录音实时波形**（`recorder.waveform()`，变响快/变轻慢的不对称平滑：400ms / 1600ms）与**采样波形**（`peaks`，按整段的峰值一次性算）。`WAVE_FLOOR = .02`、`DRAW_MAX_SCALE = 32` 是「最多放大多少倍」的两个闸门：
  - 素材峰值 ≥ 0.031（约 −30 dBFS）→ 一律放大到铺满；
  - 0.02…0.031 → 按 `1/peak` 放大（上限 ×50）；
  - 低于 0.02 → 停在 ×50，避免把底噪放大成满屏（−30 dBFS 以下本来就当噪声处理）。
  实测（56px 浮层）：峰值 0.01 → 7.5px，0.02 → 15px，0.05 → 23.5px，0.4 → 23.5px。
  ★ 显示增益**只影响画面，不改音频**；`DRAW_MAX_SCALE` 一开始设成 8 是被 `WAVE_FLOOR:0.12` 挡住的（`1/0.12 = 8.33`），真正的闸门是 floor 而不是 cap——调这两个值时先看 `1/floor`。
  `tools/live-check.mjs` 分两档断言：峰值 ≥0.02 的柱子必须 ≥12px（看得清），峰值 0.01 的必须在 4…30px（可见但不糊满）。
- **XY pad 与参数区之间不要分隔线**：`#coreParameters` 去掉了 `border-top`。`tools/live-check.mjs` 断言它 `border-top-width` 为 0。
- **XY pad 下方的读数行删掉**：`#xyDescription`（「位置 35% · 散布 ±3% · 倒放 0%」）从 DOM 移除，`xy-window` 不再需要两行网格（`.xy-pad` 改为 `height:100%` 填满）。同一行文字仍写进 `pad` 的 `aria-label`，读屏仍有反馈。这 28px 直接归 pad：竖屏 700 下 pad 230.5 → **258.5px**。
- **坐标文字收紧并回中**：四个 `.axis-label` 的盒子原来是 12px 字 + 3px 上下 padding = 18px，现改为 `line-height:1` + `1px 4px`，盒子正好等于文字高；`起点 / 终点` 原来只有 `top:50%` 没有回中，盒子中心比 pad 中线低 9px（半个盒高），补 `translateY(-50%)` 后与 `padCenterY` 完全相等。上下两个离边从 27 / 18px 收到 10 / 6px。
- **旋钮去掉外圈**：原来的外圈来自 `box-shadow:inset 0 0 0 5px` 加 7px 内缩的深色圆盘，视觉上就是一圈多余的环。现改为单层空心圆（1px 描边）加橙色指针，直径 52 → 46px，指针与圆等径只做旋转。
- **旋钮区收紧**：`--min-knobs` 100 → 84px（横屏 88 → 72px），内边距 8 → 6px，标签与读数统一 9px。命中区改用 `inset:0;margin:auto` 与旋钮同心，不再手算 `left` 偏移。

省下的高度自动流向摄像头与 XY pad（两者都是 `1fr`）。竖屏 610 下：pad 172 → **186px**，相机窗 167 → **180.5px**；竖屏 780 下分别为 270.5 / 265.5px。

不要退回「写死行高 + 像素级 min-height」的写法。改布局后跑 `layout-check.mjs`：它会断言所有视口的 pad ≥ 80px，并在 390×610 下实测 XY pad 拖动与旋钮拖动是否仍然响应（尺寸好看但拖不动不算通过）。
