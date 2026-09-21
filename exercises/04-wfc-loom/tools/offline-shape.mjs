#!/usr/bin/env node
// 04 0.5 的**音乐形状**离线探针：不开浏览器、不出声，只回答两个问题 ——
//   ① 0.5 现在生成的音流，音乐上是什么形状？（音程分布 / 音级分布 / 音域使用）
//   ② 把 02 0.4 的乐句素材当素材用，和 0.5 的硬规格相容吗？
// 它存在的理由：用户报「听感很差」时，先把"形状"量出来，才知道该改什么 ——
// 而不是继续在音色和效果上找原因。★ 它量不了"好不好听"，那只由耳朵判。
//
// 用法（仓库根目录）：node exercises/04-wfc-loom/tools/offline-shape.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadExercise } from './harness.mjs';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameToMidi = name => {
  const [, letter, accidental = '', octave] = name.match(/^([A-G])(#?)(-?\d)$/) || [];
  return 12 * (Number(octave) + 1) + NOTE_NAMES.indexOf(letter + accidental);
};
const midiToName = midi => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
const pct = (part, whole) => (part / whole * 100).toFixed(1) + '%';

/* ---------- 02 0.4 的素材：只在 02 的文件里有一份，这里直接读它 ---------- */
const aisatsana = fs.readFileSync('exercises/02-aisatsana-markov/0.4/index.html', 'utf8');
const from = aisatsana.indexOf('const PHRASES = [');
const to = aisatsana.indexOf('const SECTION_PHRASES');
if (from < 0 || to < 0) throw new Error('02 0.4 里没找到 PHRASES / SECTION_PHRASES（文件结构变了？）');
const PHRASES = eval(aisatsana.slice(from + 'const PHRASES = '.length, aisatsana.lastIndexOf('];', to) + 2));
const PHRASE_NAMES = 'ABCDEFGHIJ';

const aisatsanaMidi = PHRASES.flat().flat().map(step => nameToMidi(step.n));
const aisatsanaClasses = new Map();
aisatsanaMidi.forEach(midi => aisatsanaClasses.set(NOTE_NAMES[midi % 12], (aisatsanaClasses.get(NOTE_NAMES[midi % 12]) || 0) + 1));
const PC_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
console.log('=== ① 02 0.4 的素材本身是什么形状 ===');
console.log(`${PHRASES.length} 个乐句 × 32 步（八分音符 0.3s）· 共 ${aisatsanaMidi.length} 个音（含双音）· 原始音域 ${midiToName(Math.min(...aisatsanaMidi))}–${midiToName(Math.max(...aisatsanaMidi))}（${Math.max(...aisatsanaMidi) - Math.min(...aisatsanaMidi)} 半音）`);
console.log('  音级分布: ' + PC_ORDER.filter(pc => aisatsanaClasses.has(pc)).map(pc => `${pc} ${pct(aisatsanaClasses.get(pc), aisatsanaMidi.length)}`).join(' · '));
const triads = new Map();
PHRASES.flat().forEach(step => {
  if (step.length < 2) return;
  const key = step.map(s => NOTE_NAMES[nameToMidi(s.n) % 12]).sort().join('+');
  triads.set(key, (triads.get(key) || 0) + 1);
});
console.log('  素材里出现的双音（音级）: ' + [...triads.keys()].map(k => `${k}×${triads.get(k)}`).join(' · '));
console.log('  → 02 的音乐性来自：C 大三和弦的音级占绝对多数（C/E/G）、按段落成句、有音区对比。\n');

/* ---------- 0.5 自己的音流 ---------- */
const { api } = loadExercise({
  file: path.resolve('exercises/04-wfc-loom/0.5/index.html'),
  exportCode: ';globalThis.__probe = { createStream, NOTES };',
});
const SCALE = api.NOTES.map(note => note.midi);
const stream = api.createStream(12345);
const played = [];
for (let i = 0; i < 4000; i += 1) { const step = stream.stepOnce(); if (step.note) played.push(api.NOTES.find(note => note.id === step.note).midi); }
const intervals = played.slice(1).map((midi, i) => Math.abs(midi - played[i]));
const intervalHistogram = new Map();
intervals.forEach(leap => intervalHistogram.set(leap, (intervalHistogram.get(leap) || 0) + 1));
const pitchHistogram = new Map(SCALE.map(midi => [midi, 0]));
played.forEach(midi => pitchHistogram.set(midi, (pitchHistogram.get(midi) || 0) + 1));
console.log('=== ② 0.5 生成的音流（种子 12345，4000 拍）===');
console.log(`${played.length} 个音 · 平均音程 ${(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(2)} 半音 · 级进(≤2) ${pct(intervals.filter(v => v <= 2).length, intervals.length)} · 同音重复 ${pct(intervals.filter(v => v === 0).length, intervals.length)}`);
console.log('  音程分布: ' + [...intervalHistogram.keys()].sort((a, b) => a - b).map(leap => `${leap} ${pct(intervalHistogram.get(leap), intervals.length)}`).join(' · ')
  + '（>5 的跳进只可能出现在休止之后 —— 休止会打断音程链，这是设计如此）');
console.log('  音级分布: ' + SCALE.map(midi => `${midiToName(midi)} ${pct(pitchHistogram.get(midi), played.length)}`).join(' · '));
const counts = SCALE.map(midi => pitchHistogram.get(midi));
console.log(`  最常出现 / 最少出现 = ${(Math.max(...counts) / Math.min(...counts)).toFixed(2)} 倍（接近 1 = 七个音级被一视同仁）`);
console.log('  → 0.5 没有和声、没有重音、没有音区对比：音级几乎均匀、一半以上是级进与同音，所以听着"没有落点"。\n');

/* ---------- ③ 02 素材与 0.5 规格的相容性 ---------- */
const check = sequence => {
  let previous = null, repeat = 1, rest = 0, maxRest = 0, maxInterval = 0, badInterval = 0, badRepeat = 0;
  sequence.forEach(midi => {
    if (midi === null) { rest += 1; maxRest = Math.max(maxRest, rest); return; }
    rest = 0;
    if (previous !== null) {
      const leap = Math.abs(midi - previous);
      maxInterval = Math.max(maxInterval, leap);
      if (leap > 5) badInterval += 1;
      repeat = midi === previous ? repeat + 1 : 1;
      if (repeat > 2) badRepeat += 1;
    }
    previous = midi;
  });
  return { maxInterval, badInterval, badRepeat, maxRest };
};
// 单音化（取最高音 = 02 的旋律声部）→ 在给定音域里贪心选跳进最小的八度位置
const fit = (line, low, high) => {
  let previous = null;
  return line.map(raw => {
    if (raw === null) return null;
    const options = [];
    for (let midi = raw; midi <= high; midi += 12) if (midi >= low) options.push(midi);
    for (let midi = raw - 12; midi >= low; midi -= 12) options.push(midi);
    if (!options.length) return null;
    options.sort((a, b) => Math.abs(a - (previous === null ? (low + high) / 2 : previous)) - Math.abs(b - (previous === null ? (low + high) / 2 : previous)));
    previous = options[0];
    return previous;
  });
};
const lines = PHRASES.map(phrase => phrase.map(step => step.length ? Math.max(...step.map(n => nameToMidi(n.n))) : null));
console.log('=== ③ 02 的乐句能不能直接当 0.5 的初始音符 ===');
console.log('0.5 的规格：A 小调、音程 ≤5 半音、同音 ≤2、连续休止 ≤4；下面按"每句折进音域 + 选跳进最小的八度"试');
console.log('音域                        违规乐句   最高音程  超限音数  最长连休');
for (const [low, high, label] of [[69, 79, 'A4–G5（现在的规格）'], [57, 81, 'A3–A5（两个八度）'], [60, 84, 'C4–C6（两个八度）'], [57, 84, 'A3–C6（2.25 个八度）']]) {
  const results = lines.map(line => check(fit(line, low, high)));
  console.log(`${label.padEnd(26)} ${String(results.filter(r => r.badInterval || r.badRepeat || r.maxRest > 4).length).padStart(6)}/${results.length}  ${String(Math.max(...results.map(r => r.maxInterval))).padStart(8)}  ${String(results.reduce((a, r) => a + r.badInterval, 0)).padStart(8)}  ${String(Math.max(...results.map(r => r.maxRest))).padStart(8)}`);
}
const perPhrase = lines.map((line, index) => {
  const r = check(fit(line, 57, 81));
  return `${PHRASE_NAMES[index]}(${r.maxInterval}/${r.maxRest})`;
});
console.log(`  逐句（两八度 A3–A5 下的 最高音程/最长连休）: ${perPhrase.join(' ')}`);
console.log('  → 素材本来就有 5–8 半音的跳进、尾句还有 7–10 格留白；放宽音域也解决不了，');
console.log('    要直接用整句，就得同时放宽 maxInterval（到 ~7）与连续休止上限（到 ~10）—— 那是改 0.5 的核心规格。');

/* ---------- ④ 和声词汇从哪来：02 素材对 A 小调七个三和弦的覆盖 ---------- */
const DIATONIC = [
  ['Am', ['A', 'C', 'E']], ['Bdim', ['B', 'D', 'F']], ['C', ['C', 'E', 'G']], ['Dm', ['D', 'F', 'A']],
  ['Em', ['E', 'G', 'B']], ['F', ['F', 'A', 'C']], ['G', ['G', 'B', 'D']],
];
const classes = aisatsanaMidi.map(midi => NOTE_NAMES[midi % 12]);
// 相邻两个音都落在这个三和弦里 = "素材在这一刻就活在这个和弦里"
const pairs = [];
for (const phrase of PHRASES) {
  const line = phrase.flat().map(step => NOTE_NAMES[nameToMidi(step.n) % 12]);
  for (let i = 1; i < line.length; i += 1) pairs.push([line[i - 1], line[i]]);
}
console.log('=== ④ 从 02 素材里提炼和声词汇（A 小调七个三和弦）===');
console.log('和弦   单音覆盖   相邻两音都落在和弦内');
const coverage = DIATONIC.map(([name, tones]) => {
  const inside = classes.filter(pc => tones.includes(pc)).length / classes.length;
  const pairInside = pairs.filter(pair => pair.every(pc => tones.includes(pc))).length / pairs.length;
  return { name, tones, inside, pairInside };
}).sort((a, b) => b.pairInside - a.pairInside);
coverage.forEach(row => console.log(`${row.name.padEnd(6)} ${pct(row.inside * classes.length, classes.length).padStart(8)}   ${pct(row.pairInside * pairs.length, pairs.length).padStart(8)}`));
console.log('  → 排序就是"这个和弦在素材里占多少时间"。');
// ★ 这份词汇排序曾用来做过一版"机制⑤ 和声"（Am–C–G–Em，每 16 格换一次、和弦音 ×3 加权）：
//   实测把和弦音占比从 42.1%（随机基线 42.9%）抬到 62.1%、音级集中度 1.66 → 2.26，硬规则仍 0 超限；
//   按用户要求已于 2026-09-22 **回退**（0.5 现在没有和声）。要重做就取上面排序的前四个。
