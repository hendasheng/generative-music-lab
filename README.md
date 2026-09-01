# Generative Music Lab

一个用于学习、拆解和实践生成式音乐的个人实验仓库。练习以可直接在浏览器中运行的独立作品为主，目前使用 [Tone.js](https://tonejs.github.io/) 构建音频引擎。

## 练习

| 编号 | 名称 | 内容 | 运行方式 |
| --- | --- | --- | --- |
| 01 | [Ambient Pulse](exercises/01-ambient-pulse/) | C 自然小调、氛围合成、动机发展与呼吸型节奏 | 打开 `exercises/01-ambient-pulse/index.html` |

也可以直接打开根目录的 `index.html`，从作品索引进入各个练习。

## 目录结构

```text
generative-music-lab/
├─ exercises/                 # 独立、可运行的生成式音乐练习
│  ├─ README.md               # 新增练习的约定
│  └─ 01-ambient-pulse/
│     ├─ README.md            # 本练习的目标与音乐设计
│     └─ index.html           # 可直接运行的作品
├─ notes/                     # 源码阅读与学习笔记
├─ index.html                 # 仓库作品索引
├─ .editorconfig
├─ .gitignore
└─ README.md
```

## 本地运行

当前练习没有构建步骤。可以直接双击对应的 `index.html`，也可以在仓库根目录启动静态服务器：

```powershell
python -m http.server 8000
```

然后打开 <http://localhost:8000>。

Tone.js 当前从 CDN 加载，因此首次运行需要联网。若以后需要完全离线，可把固定版本放入 `vendor/`，再改为相对路径引用。

## 学习方向

- 用受控音阶与和声空间约束随机性
- 用种子随机数生成可复现的演出
- 设计长期运行但不过度重复的段落与动机
- 理解 Tone.Transport、AudioContext 与音频资源生命周期
- 练习频段分工、动态控制和生成式混音

## 参考资料

### 源码参考仓库（在任何机器上 `git clone` 后即可对照；以下均为仓库内路径，不依赖本机位置）

| 来源仓库 | 是什么 | 建议先看（仓库内路径） |
| --- | --- | --- |
| [pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter) | 60 首生成式乐曲的源码（monorepo，每首一个 npm 包） | `packages/piece-zed/src/piece.js`（224 行完整教学样本，对应下方中文注解） |
| [generative-fm/play](https://github.com/generative-fm/play) | play.generative.fm 前端播放器（React + Redux + Tone.js） | `src/playback/playback-middleware.js`（播放引擎：activate/schedule/Transport 流程） |

### 在线资源

- [Generative.fm](https://generative.fm/) —— 官网与线上播放器（浏览页：https://play.generative.fm/browse）
- [Tone.js 文档](https://tonejs.github.io/) —— 本项目使用的 Web Audio 库（v14.7.58）
- [Alex Bainter：Generative Music in the Browser（WAC 2019 论文）](https://www.ntnu.edu/documents/1282113268/1290817924/WAC2019-CameraReadySubmission-5.pdf/94ee9ecd-13c0-ada9-04bb-095ae1656b40?t=1575408761206#1#1) —— 作者的设计思路与系统架构说明
- [Generative.fm Open-source Objectives（gist）](https://gist.github.com/metalex9/11923b7faa710215dc7ab39a0e056a65) —— 作者的开源计划，含向 Generative.fm 提交乐曲的说明

### 本仓库笔记

- [piece-zed 中文注解](notes/piece-zed-注解版.md) —— 对照 `../generative-pieces/packages/piece-zed/src/piece.js` 逐段阅读

## 许可

目前未添加开源许可证。代码公开到 GitHub 后，默认仍保留所有权利；确定分享方式后再选择 MIT、GPL 或其他许可证。
