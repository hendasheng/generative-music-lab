# Notes

跨练习的学习笔记：源码阅读、创作方法论、技法拆解。**按「学习来源」分组**，一个来源一个文件夹。

```text
notes/
├─ README.md              # 本文件：约定与索引
├─ agents-历史存档.md      # 仓库自身的元文档（不是学习内容，见下）
├─ generative-fm/          # 来源：Generative.fm 一族源码（怎么生成）
└─ melody-for-composers/   # 来源：Melody for Composers 教程（写什么音乐）
```

## 什么放这里、什么不放

| 内容 | 放哪 |
| --- | --- |
| 跨练习的源码阅读、创作方法论、技法拆解 | `notes/<来源>/` |
| **某个练习专有**的文档（视觉规范、算法规格等） | 该练习目录内，与它的 `README.md` 并列 |
| 练习的现行状态与设计决策 | 练习目录的 `README.md` |
| 逐轮演进、实测数字、被否掉的方案 | 练习目录的 `历史记录.md` |
| 「会改变下一次怎么做」的规则与指针 | 仓库根 `AGENTS.md` |

判断标准很简单：**这份东西只有一个练习用得上 → 放练习里；两个以上练习会读 → 放 `notes/<来源>/`。**

## 新增一个学习来源时

1. 建一个文件夹，用**来源名**（`generative-fm`、某个开源项目名、某本书名…），不要用技法名（`markov`、`granular`）—— 同一个技法常常来自多个来源，而同一个来源常常教你好几个技法。
2. 在里面放一份 `README.md`：说明这个来源是什么、上游链接、本文件夹里有哪些文件、建议阅读顺序、以及它对应本仓库的哪个练习。
3. 在下面「现有来源」表里加一行。
4. 读完后如果提炼出了会影响后续工作的规则，把规则写进 `AGENTS.md`（笔记本身不承担指令职责）。

## 现有来源

| 文件夹 | 来源 | 教什么 | 对应练习 |
| --- | --- | --- | --- |
| [`generative-fm/`](generative-fm/) | [pieces-alex-bainter](https://github.com/generative-music/pieces-alex-bainter)（乐曲源码）+ [generative-fm/play](https://github.com/generative-fm/play)（播放器） | 程序**怎么生成**：种子随机、生命周期契约、素材与生成分离 | 01 Ambient Pulse、02 Aisatsana Markov |
| [`melody-for-composers/`](melody-for-composers/) | [Melody for Composers](https://www.youtube.com/playlist?list=PLIATVf_KRULE)（YouTube 播放列表） | 音乐**写什么**：动机的建立、发展、收束 | 01（动机系统）、02（乐句）、04（音乐结构） |

## 关于 `agents-历史存档.md`

它**不是学习笔记**，而是仓库自身的元文档：2026-09-21 `AGENTS.md` 从 141 KB 精简时，逐字移出的原文（当时超过 64 KB 的指令预算被静默截断，「修改与验证要求」整节读不到）。放在 `notes/` 根是为了和「学习内容」区分开，需要时再查，不需要阅读。
