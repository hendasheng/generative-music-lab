# 01 · Ambient Pulse

第一份完整练习：用 Tone.js 制作一首可持续运行、可通过种子复现的电子氛围作品。

## 学习内容

- C 自然小调和预设和弦进行
- Pad、Drone、Bass、Pluck、Air 与合成鼓的分层
- 欧几里得节奏和四小节呼吸型底鼓乐句
- 动机记忆、重复、映射、倒影和节奏变形
- 能量参数驱动密度、音色与段落变化
- Mute、Solo、音量推子及音频资源生命周期

## 运行

直接打开 `index.html`。页面通过 unpkg 加载 Tone.js 14.7.58，因此需要联网。

也可以在仓库根目录运行：

```powershell
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/exercises/01-ambient-pulse/
```

## 当前方向

作品以长和弦、慢速音色变化和稀疏氛围脉冲为核心。鼓负责呼吸与段落提示，而不是持续推动舞曲律动。

## 与 Generative.fm 源码的对照

本练习的学习参照是 Generative.fm 的两个开源仓库：[pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter)（乐曲源码）与 [generative-fm/play](https://github.com/generative-fm/play)（前端播放器）。在任何机器上 clone 后，按表中「学习的对象（文件）」列的仓库内路径即可对照阅读：

| 本练习的部件 | 学习的对象（文件） | 说明 |
| --- | --- | --- |
| `activateEngine` / `schedule` / `end` 生命周期 | `generative-pieces/packages/piece-zed/src/piece.js` | 核心契约：activate 分配资源、schedule 沿 Transport 安排演出、end/deactivate 释放。配套逐行中文注解：[`notes/piece-zed-注解版.md`](../../notes/piece-zed-注解版.md) |
| `makeMasterChain`（Compressor + Gain 总线） | 同上的 `wrapActivate` | 每首曲子输出统一接压缩器与增益总线，含音量归一化思想 |
| `playNextChord` 递归（`Transport.scheduleOnce`） | 同上的 `playRandomChord` | 随机/进行和弦 + 递归调度，音乐永不结束的核心手法 |
| `Air` 层（LFO 套 LFO 的噪声风） | 同上的 `createNoise` | 两层 LFO 互调制造永不重复的缓慢变化 |
| `window.generativeMusic.rng` 种子注入 | 同上 + `generative-play/src/playback/playback-middleware.js` | 前端用可注入随机源（Mersenne Twister）替换，实现演出可复现 |
| 播放流程 `schedule()` → `Tone.Transport.start()` | `generative-play/src/playback/playback-middleware.js` | 真实播放引擎的激活顺序：先 schedule 再启动 Transport 时钟 |

**本练习在 zed 之上的扩展**（参考了生态，但属于自研实验）：预设和弦进行、动机记忆/映射/倒影/节奏变形系统、pulse/echo/motion 氛围鼓、侧链 ducking、EQ 频率分区、声像游走、看门狗自愈。
