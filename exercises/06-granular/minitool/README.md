# 06 Granular · 小红书小工具（minitool）适配版

把 **0.3.2** 适配成**小红书小工具的离线 zip**：一个纯本地、不联网的 H5 包，由容器（PC 模拟器 / 真机 WebView）加载运行。

★ **小工具相关的一切都在本目录**：文档（本文件是唯一入口）、打包源、门禁脚本、产物。上级的 06 文档与根 `AGENTS.md` 只留一行指针，**不重复这里的任何内容** —— 改小工具先读本文件，别去翻练习文档。

```text
minitool/
├─ README.md   # 本文件：容器差异清单、`--chrome-top` 占位、门禁与命令、验证状态、交付提醒
├─ src/        # 打包源：10 个文件，index.html 在根，约 100 KB（自包含，拷进来而不是引用）
├─ tools/      # compat-scan.mjs（合规扫描）+ build.ps1（一键打包）+ 两个一次性 port 脚本
└─ dist/       # 产物 zip（不进 Git，由 build.ps1 生成）
```

- **打包源**：[`src/`](src/)
- **交付产物**：`dist/granular-minitool-0.3.2.zip`（约 42 KB，`dist/` 不进 Git，构建后才有）
- **构建**：`pwsh exercises/06-granular/minitool/tools/build.ps1`（产物就出在 `minitool/dist/`）

**本目录之外只有两件东西**，都不是小工具自己的内容：构建 Skill 装在**工作区根**的 `.skill/minitool-zip-builder/`（按上传页口令下载，不进 Git，打包时没装就自动跳过体积审计），浏览器回归用的探针在**上级** `../tools/`（它们属于 06 练习本身，`--version minitool/src` 只是借用）。

依据的规范是小红书小工具构建 Skill（`minitool-zip-builder`）+ [在线能力清单](https://miniapp-sandbox.xiaohongshu.com/minitool/doc)（本轮已获取，HTTP 200，以远程为准）。

## 与 0.3.2 的差异

功能与观感照搬 0.3.2（顶栏三键、摄像头窗 + 浮层波形、XY pad + 拖尾、四个旋钮、录制采样、随机音源），只做**容器与内核基线**要求的适配：

| 项 | 0.3.2 | 本版 | 依据 |
| --- | --- | --- | --- |
| 目录 | `exercises/06-granular/0.3.2/` | 自包含的 `src/`，`index.html` 在根 | zip-artifact-spec §1 |
| 共享控件 | 引用 `../../../shared/exercise-controls.js` | 拷进包内（`./exercise-controls.js`），并把其中的 Grid `gap` 改成 `grid-gap` | 资源须全部打包在内 |
| 导入音频 | `<label class="file-button">导入音频<input type="file" accept="audio/*">` | **删除**：容器里文件选择器**只能选图片和视频**（无论 accept 怎么写），音频选不到；菜单里加了一行说明 | device-capabilities §1 |
| 跨页链接 | 菜单里 `<a href="../0.3/">打开 0.3 桌面版本</a>` | **删除**：跳转站外 / 其他小工具都被禁 | device-capabilities §3 |
| JS 语法 | 用了 `?.`（ES2020）、`??`（ES2020）、对象 spread（ES2018） | 全部改写成 ES2017：`withDefault(v, d)`、`Object.assign({}, …)`、显式判空 | js-compatibility §1（无构建链时直接按 ES2017 写） |
| CSS 基线 | `inset`、`min()/max()`、`:has()`、`:focus-visible`、`dvh`、`color-scheme` | 一律换成 Chrome 61 可解析的写法（物理定位、`calc()`、类门控、`100vh` + `--app-height`） | css-compatibility §2 |
| Flex gap | `gap:4px` 等 | 基线用**子项 margin**，`boot.js` 做**布局行为检测**后加 `.supports-flex-gap` 再切 `column-gap/row-gap`；Grid 一律 `grid-gap` | css-compatibility §4 |
| 焦点环 | `:focus-visible`（Chrome 86+） | `boot.js` 维护 `<html>.pointer-nav`（指针操作时挂上、按键摘掉），CSS 只在没有它时画环；pad 另外保留自己的 `.pointer-focus` | css-compatibility §2 |
| 安全区 | `env(safe-area-inset-*)` + `max(12px, …)` | `--safe-top/right/bottom/left` 四级回退：容器注入的 `--safe-area-inset-*` → `@supports` 里优先 `env()` → 基线 0；`padding` 用 `calc(12px + var(--safe-left))` | cross-platform-h5 §3 |
| **容器顶部外壳** | （0.3.2 没有这个概念） | **`--chrome-top` 占位**：小工具顶部还有容器自己的按钮 / 导航栏，压着页面顶栏。默认 0（纯网页预览不变），进容器后 `boot.js` 自动预留（默认 48px，`launchOptions.miniToolEnv.navBarHeight` 有值就用它）；`main` 的 padding-top 与 dialog 的 top 都算进这一项 | 规范只说「导航栏由容器控制」、**没给高度变量**，见下面「容器外壳占位」 |
| 视口 | `width=device-width,initial-scale=1,viewport-fit=cover` | 补 `maximum-scale=1.0,user-scalable=no`，`html{touch-action:manipulation}`，`body{-webkit-touch-callout:none}` | zip-artifact-spec §5 / cross-platform-h5 §1 |
| 新增 | — | [`src/boot.js`](src/boot.js)：Flex gap 行为检测、`--app-height`（软键盘 / 地址栏）、焦点环门控 | js-compatibility §3（能力检测而非 UA 分支） |

**保留的容器能力**：摄像头 `getUserMedia({video})`、麦克风 `getUserMedia({audio})` + `MediaRecorder`、Canvas 2D、`<dialog>`、指针事件、CSS 变量 / Grid / Flex —— 都逐条核对过在线清单的「可用能力」。`MediaRecorder` 与 `mediaDevices.getUserMedia` 在调用前都有能力检测，缺失时给明确提示而不是白屏。

**没有做**：容器端能力 JS API（`window.xhs.miniTool.*`：发笔记 / 存相册 / Storage / 文件系统 / 评论区）。本工具产出的是**声音**不是图片，没有对应的分享需求；要用的话最小接法是「波形截图 → `writeTempFile` → `saveImageToPhotosAlbum` / `postNote`」，需要先确认产品意图。

## 容器外壳占位（`--chrome-top`）

小工具顶部**本来就有容器自己的按钮 / 导航栏**，而页面的顶栏（自由流动 / 随机音源 / 录制 / 播放）也在顶部 —— 两者会压在一起。规范里只说「窗口样式、导航栏、下拉刷新等外壳行为由容器统一控制」，**没有给任何高度变量**；它提供的 `--safe-area-inset-*` 是状态栏 / 刘海的量，不含容器自己那条栏（Android 上通常就是 0）。

所以本版自己预留一条，规则是**「只有确认在容器里才预留」**：

| 场景 | `--chrome-top` | 来源 |
| --- | --- | --- |
| 普通浏览器 / 无 SDK | `0px` | 不预留，布局与 0.3.2 一致 |
| 容器内（`window.xhs.miniTool` 存在） | `48px` | `boot.js` 的 `DEFAULT_CHROME_TOP`（Android 导航栏那一档） |
| 容器声明了高度 | `miniToolEnv.navBarHeight`（兼容 `titleBarHeight` / `chromeHeight` / `statusBarHeight`） | 优先用容器给的值 |

- CSS 里 `main{padding-top:calc(var(--chrome-top) + var(--safe-top))}`，dialog 的 `top` / `max-height` 同样算进这一项；`--chrome-top` 本身在 `style.css` 顶部声明，**要微调就改一处**。
- 判断依据是**能力检测**（`window.xhs.miniTool` 是否存在），不是 UA / 机型分支。
- 实测（390 宽，容器 SDK 用桩注入）：普通浏览器 `--chrome-top=0`、顶栏 top=0；容器内 `48px`、顶栏 top=48、pad 仍 331px；520 高的短视口 pad 183px（页面转为滚动，没被压成一条）；容器声明 `navBarHeight=56` 时按 56 预留。

★ **这个数值需要在模拟器 / 真机上确认**：本机没有容器，48px 是按 Android 导航栏取的档，若模拟器里仍有一截重叠（或反过来空太多），把 `style.css` 的 `--chrome-top` 默认值与 `boot.js` 的 `DEFAULT_CHROME_TOP` 改成同一个数即可（两边注释互相指向）。

## 门禁与命令

```powershell
# 1) 静态合规扫描（容器禁用项 / ES2018+ 语法 / Chrome 61 CSS / 资源引用规则）
node exercises/06-granular/minitool/tools/compat-scan.mjs exercises/06-granular/minitool/src

# 2) 一键打包（内部依次跑扫描 → node --check → 目录自检 → 压缩 → 回读验证 → 体积审计）
pwsh exercises/06-granular/minitool/tools/build.ps1

# 3) Skill 自带的体积审计（build.ps1 已包含；单独跑用；脚本在工作区根 .skill/ 里，未安装则跳过）
node .skill/minitool-zip-builder/scripts/audit_artifact.mjs <目录或 zip>
```

★ `compat-scan.mjs` 是**自己写的**：Skill 自带的 `audit_artifact.*` 只校验包体与文本体积（zip >10MiB 报错、>2MiB 建议），语义规则（禁用 API、ES2017 基线、Chrome 61 CSS）它不解析 —— 那些只能按 reference 的清单逐项核对，所以把清单变成了可复跑的检查。它按行抹掉注释再匹配（否则注释里写的反面例子会被误报），并区分 `grid-gap`（合规）与裸 `gap` / 未被 `.supports-flex-gap` 门控的 `row-gap`（违规）。

**复现这次适配**（port 脚本是一次性记录，已完成；重跑要先从 0.3.2 重新拷贝）：

```powershell
# 1) 重新拷源（含 shared/exercise-controls.js）
# 2) 应用 JS 改写
node exercises/06-granular/minitool/tools/port-es2017.mjs
# 3) 应用 CSS 改写
node exercises/06-granular/minitool/tools/port-css.mjs
```

★ port 脚本踩过的坑记在 `port-es2017.mjs` 顶部：注释里写了反引号把模板字符串截断，插进去半截注释 → `const defaults = …` 被注释掉、`withDefault` 没插进去，而 **`node --check` 与合规扫描全绿**（那是合法 JS），只有浏览器探针报 `defaults is not defined`。**静态检查过 ≠ 能跑，改完必须真开一次页面。**

## 验证状态（区分「已验」与「未验」）

**已验（本轮）**

- 静态合规扫描：`0` 处违规（ES2018+ 0、Chrome 61 CSS 0、禁用 API 0、资源加载 0）。
- 全部 8 个 JS 文件 `node --check` 通过；包内无外部 URL、无内联脚本、无行内事件、脚本为经典脚本且顺序正确（boot → 控件 → 引擎 → 流动 → 录音 → 相机 → 移动端 → app）。
- Skill 体积审计：`PASS: 10 file(s), 0 warning(s)`；zip `PASS`，源 100.4 KB → zip 42.3 KB（建议上限 2 MiB，硬上限 10 MiB）。
- 打包回读：解压后顶层直接是 `index.html`，没有多套一层目录。
- **浏览器回归**（上级 `../tools/` 的 `layout-check` / `live-check`，用 `--version minitool/src` 跑，退出码 0）：布局 13 个视口、pad 拖动、控制点按压档位、拖尾连续性、轴墨色、双击旋钮回默认、顶栏顺序与命中区、录音波形同轴、录完自动播放、随机音源切换与灯状态、输出电平 —— 与 0.3.2 一致。**这一条只证明"我的改写没把功能改坏"，不等于容器验收**（Skill 明确写了：普通浏览器里直跑的结果不可信）。

**未验（必须由人完成，见下面的提醒）**

- **Chrome 61 / Android 8.1 WebView 的实际渲染与解析**：本机没有旧内核，`css-compatibility.md` §7 要求这种情况下标记「**CSS 兼容性未实测**」，`js-compatibility.md` §5 同理。
- **容器 CSP 行为、系统权限弹窗、音视频采集在真实沙箱里的表现**：只在模拟器 / 真机上才能确认。
- **性能**：`performance-budget.md` §6 要求无运行数据时标记「**性能未实测**」——本工具是 Canvas 2D + Web Audio 密集绘制（每帧 rAF 重绘波形与粒子），真机帧率、发热、内存都需要实测。
- **本版没有 WebGL**：不涉及 §4 的 GPU 预算与降级。

## 已知限制

1. **手机上看不到菜单**：0.3.2 的设计是移动端隐藏菜单按钮，而菜单里有混响 / 输出音量 / 种子。手机上只剩四个旋钮 + pad，这两个参数在手机上不可调（PC 模拟器窗口够宽时菜单按钮仍在）。要开放的话得给菜单加一个手机端入口。
2. **麦克风录音依赖容器授权**：录音要求用户手势触发 + 系统弹窗；`MediaRecorder` 在个别 WebView 上可能缺失，本版会给出「浏览器不支持录音」的提示并保留旧素材。
3. **`exercise-controls.js` 是副本**：`shared/exercise-controls.js` 更新后副本不会自动跟，需要重新拷贝（差异只有一处 `gap` → `grid-gap`）。
4. **安全区的四级回退**：容器注入 `--safe-area-inset-*` 时优先用它（模拟器就是这样模拟安全区的），支持 `env()` 的内核再用 `env()`，Chrome 61 落到基线 0 —— 三层都有静态兜底，但没有真机数据。
5. **音频上下文生命周期**：切后台 / `pagehide` 会停止播放（沿用 0.3.2 的行为），容器切走小工具时不会留下还在响的音频。

## 交付提醒（Skill 要求，交给上传页第二步）

**本产物**：`minitool/dist/granular-minitool-0.3.2.zip` —— 43267 B / 42.3 KB，SHA256 `086B6069…2C86`，10 个文件、`index.html` 在根（`dist/` 不进 Git，重新构建会覆盖）。

生成的 zip 请上传到**创服平台**，并按顺序完成三项验证 —— 这三项本轮**都没有做**（无授权、环境也不具备），标记为待你验证，不阻塞 zip 交付：

1. 创服平台**模拟器**：跑完整功能（播放 / 停止、录制采样与授权、摄像头预览与切换、XY pad 与拖尾、四个旋钮与双击回默认、随机音源、自由流动）。
2. **Android 真机**扫码验证同一产物（目标基线是 Android 8.1 / WebView 61）。
3. **iOS 真机**扫码验证同一产物（容器最低 iOS 18.4）。

⚠️ 普通浏览器里打开这个 zip 解出来的页面**不能**作为小工具功能 / 兼容性 / 验收的依据。
