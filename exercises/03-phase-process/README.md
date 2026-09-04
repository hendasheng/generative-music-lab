# 03 · Phase Loops

第三份练习：一组固定音符分别运行在独立 loop 中。每个音符都有自己的声音长度、循环周期和初始相位偏移；系统开始后，各个 loop 因周期不同而不断错位，音符之间的先后顺序与重叠关系持续变化，自然形成旋律与和声。

灵感来自 Tero Parviainen 的文章 [JavaScript Systems Music](https://teropa.info/blog/2016/07/28/javascript-systems-music)。这篇文章用 Web Audio / Tone.js 重做 Steve Reich 和 Brian Eno 的系统音乐思路：不是直接写一段固定旋律，而是设计一个会自己生成音乐的系统。

## 学习内容

- 固定音符集合如何通过不同 loop 周期产生长期变化
- 初始相位偏移：系统开始时，每条 loop 从自己的不同位置进入
- 每个音符独立设置声音长度、周期与力度
- 复用 02 的 `vsco2-piano-mf` 采样钢琴，便于比较不同生成机制
- 使用 `Tone.Transport.scheduleRepeat` 管理多个长期循环
- 用种子随机生成可复现的 loop 参数
- 停止、换一版时正确清理 Transport 事件和 Web Audio 节点

## 运行

直接打开 `index.html`。页面通过 unpkg 加载 Tone.js 14.7.58，并通过 jsDelivr 加载 02 同款 `vsco2-piano-mf` 钢琴采样，因此首次播放需要联网；采样加载失败会自动回退 FM 合成钢琴。

也可以在仓库根目录运行：

```powershell
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/exercises/03-phase-process/
```

## 音乐规则

- 音符集合：F 小调色彩的七个音，外加一个低音锚点。
- 每个音符是一条独立 loop，不共享节拍网格。
- 每条 loop 有 7.5 到 23 秒之间的周期，彼此刻意错开。
- 每个音符有自己的声音长度，短音像点，长音像云。
- 初始相位不是“延迟开始”，而是“这条虚拟磁带已经转到某个位置”：页面启动时会计算它下一次触发还要等多久。
- 采用 02 同款钢琴采样；混响较长，但干声保留清楚，让重叠关系仍然可辨认。

## 与前两个练习的对照

| 练习 | 生成范式 | 核心听点 |
| --- | --- | --- |
| 01 Ambient Pulse | 从零生成 | 和弦、动机和层次实时生长 |
| 02 Aisatsana Markov | 记忆 + 重排 | 固定素材被概率链重新排列 |
| 03 Phase Loops | 系统过程 | 独立周期的相遇关系生成旋律与和声 |

## 后续想法

- 增加 loop 参数编辑器：手动修改周期、相位、时值
- 用圆环可视化每条 loop 当前相位
- 检测“重叠密度”，在过满时自动降低某些 loop 力度
- 做 Music for Airports 风格的采样人声版本
