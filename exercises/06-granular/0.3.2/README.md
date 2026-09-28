# Granular 0.3.2 · 精简顶栏

基于 0.3.1（手机双窗口）。声音引擎、参数与其余交互**均未改动**，本版只动顶栏。

## 与 0.3.1 的差异

| 项 | 0.3.1 | 0.3.2 |
| --- | --- | --- |
| 实时输入（LIVE） | 有（按钮 + `live.js` + `live-worklet.js` + `setAudioSession` 的采集分支 + `window.__iosAB` 诊断） | **去掉**：不加载那两个文件，没有按钮与诊断入口；引擎的第四个参数 `liveSource` 恒为 `null`，走素材路径 |
| 菜单按钮 | 所有尺寸都显示 | **移动端隐藏**（`@media(max-width:759px)`）；桌面宽度仍保留，菜单内的功能（导入音频 / 种子 / 六个滑杆 / 混响 / 输出音量）完全不变 |
| 顶栏按钮分布 | 菜单+自由流动在左、播放居中、录制+LIVE 在右 | **自由流动最左、录制中间、播放最右** |
| 顶栏布局 | `grid-template-columns:1fr auto 1fr` | **同样是 `grid`**，移动端只把菜单按钮 `display:none` |

菜单里的功能一项没删：`#settings` 对话框与其中所有控件都在，只是移动端没有打开它的按钮（桌面仍可打开）。录音链路保留 `setAudioSession`（录制期 `play-and-record`、其余 `playback`），这条与实时输入无关，是 iOS 录音后不被压低所必需。

### 顶栏「中间居中」的写法（踩过）

录制键要在正中，**只能靠 `grid-template-columns:1fr auto 1fr` 的两侧等宽轨道**保证：它与左右两组各有多少按钮、每个多宽都无关。建版时为了「两端对齐」在移动端改成 `flex` + `justify-content:space-between`，居中就变成了「左组宽 = 右组宽」才成立——而 `.main-actions` 上还带着 0.3.1 时代的 `padding-right:10px`（当时录制/LIVE 在右边、播放居中，用它把播放键顶回正中），于是移动端变成 48 : 58，录制键被顶偏。

实测（`tools/layout-check.mjs --version 0.3.2`，13 个视口）：

| | flex 版（错） | grid 版（现行） |
| --- | --- | --- |
| 中间列偏移 | **−5px**（≤759px 的全部视口） | 0px |
| 录制标记相对 header 中心 | — | 0px |
| 播放键右内缩 | 10px（没贴右） | 0px |
| 自由流动左内缩 | 0px | 0px |

`layout-check` 现在把这条钉住了：中间列偏移、录制标记偏移、移动端流动左内缩、播放右内缩都断言 ≤1px；0.3.1 因为结构不同（播放居中、录制/LIVE 在右）只查中间列，探针按**结构**（`#record` 是否是 header 的直接子元素）分支，不按版本号。

## 文件

`engine.js`、`flow.js`、`recorder.js`、`camera.js`、`app.js`、`mobile.js`、`style.css`、`index.html`。
**没有** `live.js` / `live-worklet.js`（本版不使用）。

★ 建版时踩过一次：拷文件时漏了 `camera.js`，而 `index.html` 仍引用它 → `mobile.js` 里 `CameraPreview.create()` 抛 `ReferenceError`，整个 `mobile.js` 失效（菜单开合、相机按钮、播放键接线全废）。**报错只在浏览器里出现，静态检查看不出来**；而且当时 `live-check` 还报了「通过」——因为菜单按钮的隐藏类恰好被 CSS 媒体查询挡住了，属于**假绿**。教训：新建版本目录后要核对「`index.html` 引用的每个脚本都在目录里」，并跑一次 `camera-layout-check`（它会在页面里真实创建 `CameraPreview`）。

## 验证

```powershell
node tools/check.cjs 0.3.2                      # 引擎离线回归
node tools/record-check.cjs                     # 录音回归
node tools/live-check.mjs --version 0.3.2       # 顶栏顺序、菜单隐藏、命中区、标记、录完自动播放
node tools/layout-check.mjs --version 0.3.2     # 13 个视口布局、全屏适配、铺满
node tools/camera-layout-check.mjs --version 0.3.2   # 摄像头三视口稳定性 + 控件显隐
```

探针都支持 `--version`（默认 0.3.1）。`live-check` 会先探测页面上有没有 LIVE 按钮，无 LIVE 时跳过实时输入与 A/B 诊断那几段，改为断言「顺序 流动 ＜ 录制 ＜ 播放」「录制居中」「移动端菜单隐藏」。

### 探针自己的一个假绿（已修）

`live-check` 末尾是 `process.exit(ok ? 0 : 1)`，而它**会覆盖** `process.exitCode`——文件里原本散着 6 处 `if (!x) process.exitCode = 1`，全是死代码：打印一堆 `★` 照样以 0 退出（0.3.2 的 A/B 段就是这么来的：没有 `__iosAB`，`abOk` 恒 false，于是「打印 ★ + 输出『通过』+ 退出码 0」三件事同时发生）。现在所有断言都汇总进 `commonOk` / `ok`，判定只从末尾一处出去。★ 顺带一条通用教训：**用 `| Select-String` 看探针输出会把退出码一起藏掉**，要判成败就 `> file 2>&1` 之后读 `$LASTEXITCODE`。

实测（390×700 竖屏，现行 grid 版）：流动中心 36、录制 195、播放 354（视口 390，正中 195）；可见按钮垂直中心偏差 0px；命中区全部 ≥44×44；控制台无错误、无未捕获异常；`live-check` / `layout-check` 退出码均为 0。
