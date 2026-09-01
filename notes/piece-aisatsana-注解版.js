/* ============================================================================
 * piece-aisatsana 源码中文注解版（专门用于读代码）
 * ----------------------------------------------------------------------------
 * 来源：generative-music/pieces-alex-bainter 仓库
 *       packages/piece-aisatsana/src/piece.js（86 行，MIT 许可）
 * 用途：逐行学习 aisatsana 的生成式写法 —— 「记忆 + 重排」范式
 *       对应本仓库练习：exercises/02-aisatsana-markov/
 * 配套资料：作者 Medium 创作手记
 *       https://medium.com/@alexbainter/generating-more-of-my-favorite-aphex-twin-track-cde9b7ecda3a
 *
 * 全曲机制一句话：
 *   原曲谱面 → 按八分音符网格量化 → 每 32 步切成乐句 → 乐句序列喂给马尔可夫链
 *   → 演出时 chain.walk() 沿概率重组乐句顺序（音符不变、顺序变化）
 * ============================================================================ */

/* ---- 1. 依赖与常量 ---- */

import Chain from 'markov-chains';
// ↑ 马尔可夫链库：训练「状态 → 下一个状态」的转换概率。
//   这里"状态"= 一个乐句（32 步的音符序列），链学会原曲乐句之间的衔接规律。

import * as Tone from 'tone';
import { createSampler, wrapActivate } from '@generative-music/utilities';
// ↑ utilities 提供两个关键工具：
//   createSampler：包装 Tone.Sampler（把采样文件映射成可演奏的乐器）
//   wrapActivate：给每首曲子包一层公共逻辑（设置 context、注入随机源、
//                 输出接 Compressor+Gain 总线、单曲音量归一化）

import instructions from './instructions.json';
// ↑ 原曲谱面数据（Aphex Twin - aisatsana 的 MIDI 导出）。
//   结构：instructions.tracks[1].notes = [{ name: 'E3', time: 0 }, ...]
//   —— name 是音名，time 是秒级时间点。这是「记忆」的来源：素材 100% 来自原曲。

import { sampleNames } from '../aisatsana.gfm.manifest.json';
// ↑ 本曲声明的采样清单（['vsco2-piano-mf']），前端按此按需加载。

import gainAdjustments from '../../../normalize/gain.json';
// ↑ 全站音量归一化表：每首曲子一个系数，响度统一（aisatsana 的系数是 5）。

const BPM = 102;                  // 速度 102 BPM（原曲本身的节奏）
const SECONDS_PER_MINUTE = 60;
const EIGHTH_NOTES_IN_BEAT = 2;   // 每拍 2 个八分音符
const EIGHTH_NOTE_INTERVAL_S =
  SECONDS_PER_MINUTE / (EIGHTH_NOTES_IN_BEAT * BPM);
// ↑ 一个八分音符的秒数 = 60 / (2 × 102) ≈ 0.294s —— 这就是量化的网格宽度。
//   所有音符时间都会被归到最近的网格点上（量化）。

const DELIMITER = ',';            // 乐句编码用的分隔符（见量化部分）
const SONG_LENGTH = 301;          // 素材覆盖 301 秒的原曲片段

/* ---- 2. 钢琴 = 真实采样（不是合成） ---- */

const getPiano = samples => createSampler(samples['vsco2-piano-mf']);
// ↑ vsco2-piano-mf：VSCO2 免费钢琴采样库（CC0），真实录音的琴键。
//   createSampler 加载采样并映射成 Tone.Sampler：
//   播放任意音符时自动选最近的采样音、变速变调补足中间音。
//   「钢琴好听」的根本：真实录音的衰减/泛音/琴键噪声，合成器难以还原。

/* ---- 3. activate：加载素材 → 量化 → 切分 → 训练马尔可夫链 ---- */
/*     activate 只在播放前执行一次（分配资源），对应统一契约的"分配"阶段。 */

const activate = async ({ sampleLibrary }) => {
  const samples = await sampleLibrary.request(Tone.context, sampleNames);
  // ↑ 按 sampleNames 从 CDN 请求采样（web-library 负责拉取 + IndexedDB 缓存）。

  const notes = instructions.tracks[1].notes.slice(0);
  // ↑ 取出谱面音符数组（复制一份，避免改动原数据）。

  const eighthNotes = [];

  /* ★ 步骤 A：量化 —— 把秒级音符按八分音符网格分组。
   * 对每个网格 [time, time+网格宽) 内的所有音符，取名字排序后 join 成字符串：
   *   结果 ["E3,G3", "", "", "C4", ...] —— 每个元素 = 一个八分音符位置上的音符集合。
   *   空字符串 = 该位置休止。这就是后续所有处理的"最小单元"。 */
  for (let time = 0; time <= SONG_LENGTH; time += EIGHTH_NOTE_INTERVAL_S) {
    const names = notes
      .filter(
        note => time <= note.time && note.time < time + EIGHTH_NOTE_INTERVAL_S
      )
      .map(({ name }) => name)
      .sort();
    eighthNotes.push(names.join(DELIMITER));
  }

  /* ★ 步骤 B：切分乐句 —— 每 32 个八分音符 = 一个乐句（≈ 9.4 秒）。
   * 把 301 秒的素材切成若干个 32 步的乐句，乐句是马尔可夫链的"状态"。 */
  const phrases = [];
  const phraseLength = 32;
  const enCopy = eighthNotes.slice(0);
  while (enCopy.length > 0) {
    phrases.push(enCopy.splice(0, phraseLength));
  }

  /* ★ 步骤 C：给每个格子的字符串加上"格子索引"前缀。
   * 格式："索引,音符名..."（该格子有音）或 "索引"（该格子休止）。
   * 为什么带索引？马尔可夫链把整个乐句当一个状态，索引只用于还原
   * 每个音符在乐句内的位置（第几步）。 */
  const phrasesWithIndex = phrases.map(phrase =>
    phrase.map((names, i) =>
      names.length === 0 ? `${i}` : `${i}${DELIMITER}${names}`
    )
  );

  /* ★ 步骤 D：训练马尔可夫链。
   * new Chain(乐句序列) 统计每个乐句后面接什么乐句，学习转换概率。
   * 这是整首曲子的"生成引擎"——但它什么都不生成，
   * 只是学会了"原曲的乐句顺序规律"，然后按规律重新排列。 */
  const chain = new Chain(phrasesWithIndex);

  const piano = await getPiano(samples);

  /* ---- 4. schedule：沿 Transport 循环播放乐句 ---- */
  /*     schedule 在播放时执行（统一契约的"演出"阶段），返回 end 用于停止。 */

  const schedule = ({ destination }) => {
    piano.connect(destination);

    /* 每次调用 = 播放一个乐句：
     *   chain.walk() 按马尔可夫概率取一个乐句状态 → 解析每步的音符 → 触发 */
    const schedulePhrase = () => {
      const phrase = chain.walk();
      phrase.forEach(str => {
        const [t, ...names] = str.split(DELIMITER);   // "3,E3,G3" → t="3", names=["E3","G3"]
        const parsedT = Number.parseInt(t, 10);
        names.forEach(name => {
          const waitTime = parsedT * EIGHTH_NOTE_INTERVAL_S;
          piano.triggerAttack(
            name,
            /* ★ 时间关键点：
             *   +waitTime         音符在乐句内的相对位置（第几步 × 网格宽）
             *   +1                额外提前 1 秒 —— 给采样/调度留余量，
             *                      即使加载稍有延迟也不会错过拍点
             *   +rng()*0.05-0.025 ±25ms 人性化抖动 —— 不再 100% 精确对齐网格，
             *                      像真人演奏的微小偏差
             * 注意：不传力度（velocity）→ 默认满响度（1.0），
             * 原曲所有音符等响，律动感全部来自素材本身的编排。 */
            `+${waitTime + 1 + window.generativeMusic.rng() * 0.05 - 0.025}`
          );
        });
      });
    };

    /* ★ scheduleRepeat：每 32 个八分音符（一个乐句时长）重复调度一次。
     * 与 01 的 scheduleOnce 递归相比，这是"固定周期重复"的写法。 */
    Tone.Transport.scheduleRepeat(
      schedulePhrase,
      phraseLength * EIGHTH_NOTE_INTERVAL_S
    );
    return () => {
      piano.releaseAll(0);   // end：松开所有琴键，采样尾音自然衰减
    };
  };

  const deactivate = () => {
    piano.dispose();         // 释放采样器（资源归还）
  };

  return [deactivate, schedule];
  // ↑ 统一契约：activate → [deactivate, schedule]（与 piece-zed 完全一致）
};

const GAIN_ADJUSTMENT = gainAdjustments['aisatsana'];
// ↑ 单曲音量归一化系数（5）——原版合成输出较弱，靠 wrapActivate 放大到统一响度。

export default wrapActivate(activate, { gain: GAIN_ADJUSTMENT });
// ↑ 默认导出被 wrapActivate 包装：设置 context、注入 window.generativeMusic.rng、
//   输出接 Compressor→Gain 总线并套用 gain 系数。

/* ============================================================================
 * 学习要点速记
 * ----------------------------------------------------------------------------
 * 1. 生成的两种范式：
 *      piece-zed / 01 练习 = 从零生成（音符由算法产生）
 *      piece-aisatsana / 02 练习 = 记忆 + 重排（音符来自素材，顺序由概率重组）
 * 2. 量化 → 切分 → 训练 → walk：一条完整的数据流，每步都是可读的一小段。
 * 3. 素材质量决定上限：马尔可夫链只重排顺序，无法弥补机械的素材
 *    （这也是 02 练习的乐句要精心写律动的原因）。
 * 4. 触发技巧：提前 +1s 防延迟、±25ms 人性化、scheduleRepeat 周期调度、
 *    不传力度保持等响（律动来自编排而非力度）。
 * 5. 真实采样 vs 合成：vsco2-piano-mf 是"好听"的关键，合成器难还原。
 * ============================================================================ */
