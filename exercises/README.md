# Exercises

每个练习使用独立目录，避免后续实验互相覆盖。

## 命名规则

```text
编号-英文短名称
```

例如：

```text
01-ambient-pulse
02-markov-melody
03-granular-texture
```

## 每个练习至少包含

```text
练习目录/
├─ README.md    # 学习目标、音乐规则、运行方式和后续想法
└─ index.html   # 可直接运行的入口
```

需要额外代码时，可以在练习内部增加 `src/`、`styles/` 或 `assets/`。同一练习需要保留多个实验版本时，使用 `0.1/`、`0.2/` 这样的子目录；每个练习只在根目录保留一份 `README.md`，版本变化也集中记录在这里，版本目录不再重复放 README。只有多个练习确实共用的内容，才提升到仓库根目录，避免过早抽象。

公共播放控件放在 `shared/exercise-controls.js`。新练习直接使用 `<exercise-controls id="transportControls"></exercise-controls>`，监听 `exercise-play`、`exercise-stop`、`exercise-regenerate` 事件，并通过 `seedValue`、`clearSeed()`、`setPlaying()`、`setBusy()` 同步状态。组件只负责 UI，各练习仍保留自己的音频引擎和调度逻辑；不要再复制旧的播放、停止、种子、换一版按钮代码。

新增练习后，同时更新根目录 `README.md` 和 `index.html` 的作品列表。
