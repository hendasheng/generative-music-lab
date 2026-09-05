# 03 · Phase Loops

第三份练习：一组固定音符分别运行在独立 loop 中。每个音符都有自己的声音长度、循环周期和初始相位偏移；系统开始后，各个 loop 因周期不同而不断错位，音符之间的先后顺序与重叠关系持续变化，自然形成旋律与和声。

版本：[`0.1`](0.1/)（初始卡片式页面）；[`0.2`](0.2/)（全屏圆环舞台 + HUD 页面结构，音乐逻辑暂与 0.1 相同）。版本目录只保存实现文件，本 README 统一记录整个练习的设计与演进。

灵感来自 Tero Parviainen 的文章 [JavaScript Systems Music](https://teropa.info/blog/2016/07/28/javascript-systems-music)。这篇文章用 Web Audio / Tone.js 重做 Steve Reich 和 Brian Eno 的系统音乐思路：不是直接写一段固定旋律，而是设计一个会自己生成音乐的系统。

## 学习内容

- 固定音符集合如何通过不同 loop 周期产生长期变化
- 初始相位偏移：系统开始时，每条 loop 从自己的不同位置进入
- 每个音符独立设置声音长度、周期与力度
- 低音 drone 也遵守独立 loop 规则，用更长周期托住调性中心
- 复用 02 的 `vsco2-piano-mf` 采样钢琴，便于比较不同生成机制
- 引入 Moodist 的环境音效作为背景 texture events：按周期、概率和淡入淡出出现，不常驻播放
- 使用递归 `Tone.Transport.scheduleOnce` 管理多个长期循环：`scheduledFireAt` 提前交给 Tone 排音频，`visibleFireAt` 只在实际发声时刻推进，避免 lookAhead 造成音画错位
- 用同心圆环显示每条 loop 的旋转音段，并用 `requestAnimationFrame` 平滑刷新
- 0.2 将圆环视觉铺满窗口，标题、控制器、状态和循环参数改为悬浮 HUD；点击舞台可统一显示或隐藏 HUD
- 0.2 的 SVG 层级固定为：灰色轨道在底层，其上依次是播放头、彩色音符、音名与触发轮廓；播放头只作为参照，不遮挡正在经过的音符
- 用种子随机生成可复现的 loop 参数
- 停止、换一版时正确清理 Transport 事件和 Web Audio 节点

## 运行

运行待开发版本请打开 [`0.2/index.html`](0.2/index.html)；保留的基线版本入口是 [`0.1/index.html`](0.1/index.html)。页面通过 unpkg 加载 Tone.js 14.7.58，通过 jsDelivr 加载 02 同款 `vsco2-piano-mf` 钢琴采样，并远程引用 Moodist 仓库中的背景音效，因此首次播放需要联网；钢琴采样加载失败会自动回退 FM 合成钢琴，Moodist 音效加载失败则静默跳过。

也可以在仓库根目录运行：

```powershell
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/exercises/03-phase-process/0.2/
```

## 音乐规则

- 音符集合：F 小调色彩的七个钢琴音，外加三条低音 drone。
- 每个音符是一条独立 loop，不共享节拍网格。
- 每条 loop 有 7.5 到 23 秒之间的周期，彼此刻意错开。
- 每个音符有自己的声音长度，短音像点，长音像云。
- Drone 使用 F2、C3、Ab2，周期约 40 到 70 秒，attack/release 都很长，像慢慢浮现的低频地平线。
- Moodist texture pool 包含 `brown-noise.wav`、`wind-in-trees.mp3`、`birds.mp3`、`busy-street.mp3`、`crowd.mp3`。它们不会永远播放，而是作为环境事件按不同周期和概率淡入淡出；鸟类、街道和人群会在播放后较早尝试入场，当前目标增益分别为 `0.03`、`0.2`、`0.4`；同一时间最多允许四条 texture、其中最多两条 event，避免长期全部常驻。
- 初始相位不是“延迟开始”，而是“这条虚拟磁带已经转到某个位置”：页面启动时会计算它下一次触发还要等多久。
- 采用 02 同款钢琴采样；混响较长，但干声保留清楚，让重叠关系仍然可辨认。
- 页面中的每个同心圆代表一条 loop：彩色弧段是声音长度，白色音名沿圆环曲率附着在弧段前端并随之旋转；当前端顺时针滚动到右侧播放头时，该音响起。配色保持两类单一纯色：所有钢琴音符统一使用橙色，所有 Drone 统一使用绿色；轨道使用接近黑色的中性色并退到背景，播放头使用低对比中性白。触发时播放头始终保持固定，音段继续运动；音段内外边缘复制为两条同色细弧，短音约扩散一个环距，长音可扩散两到三个环距。最内层向中心的距离会在圆心前停止。轮廓从音段头部向尾部裁切、逐渐透明；线宽也随包络由细变粗、再逐渐变细。整个生命周期严格等于该音符的实际声音长度，音符结束、透明度实际绘制为 0 后，才在下一帧移除节点。

## 视觉参考

同心圆 loop 可视化参考 Tero Parviainen 的 [JavaScript Systems Music](https://teropa.info/blog/2016/07/28/javascript-systems-music) 一文中对 tape loop / phase loop 的展示方式：每条圆环代表一条独立循环，彩色弧段代表该 loop 中会发声的片段，固定播放头用于观察不同周期的音段如何逐渐错位。本练习没有直接复制原文代码或素材，而是按同一视觉语义重新实现。

## 素材来源

- 钢琴：`vsco2-piano-mf`，来自 `generative-music/samples-alex-bainter`，VSCO2 免费钢琴采样（CC0）。
- 背景 texture：`brown-noise.wav`、`wind-in-trees.mp3`、`birds.mp3`、`busy-street.mp3`、`crowd.mp3`，远程引用自 [Moodist](https://github.com/remvze/moodist) 仓库的 `public/sounds/`。Moodist 项目代码为 MIT；其 README 说明部分声音来自 Pixabay Content License 或 CC0。本练习当前仅作学习实验引用，后续若发布或分发，应逐个素材核对原始授权与归属说明。

## 与前两个练习的对照

| 练习 | 生成范式 | 核心听点 |
| --- | --- | --- |
| 01 Ambient Pulse | 从零生成 | 和弦、动机和层次实时生长 |
| 02 Aisatsana Markov | 记忆 + 重排 | 固定素材被概率链重新排列 |
| 03 Phase Loops | 系统过程 | 独立周期的相遇关系生成旋律与和声 |

## 后续想法

- 增加 loop 参数编辑器：手动修改周期、相位、时值
- 检测“重叠密度”，在过满时自动缩短少数 loop 的时值或推迟下一次触发
- 做 Music for Airports 风格的采样人声版本
