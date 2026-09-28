#!/usr/bin/env node
/**
 * 一次性移植工具：把 0.3.2 的源码改成 Chrome 61 / ES2017 可解析的写法（无构建链）。
 *
 *   node tools/port-es2017.mjs
 *
 * ★ 已经应用完毕，**源码（src/）就是最终产物**，这个脚本只是为了说明每处改动的意图；
 *   要重跑必须先把 0.3.2 的 8 个文件重新拷回 src/（见 README 的「复现这次适配」）。
 *
 * ★ 踩过的坑：HELPER 里一度写了反引号包裹的 Markdown 记号，模板字符串被提前截断，
 *   插进去的是半截注释 —— 结果 `const defaults = ...` 被注释掉、`withDefault` 没插进去，
 *   **node --check 与合规扫描全绿**（那是合法 JS），只有浏览器探针报 `defaults is not defined`。
 *   教训：静态检查过 ≠ 能跑，改完必须真开一次页面。
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(import.meta.dirname, '../src');

// 小工具基线没有 ES2020 的空值合并。加一个显式函数代替嵌套三元，语义等价（只在 null/undefined 时取默认值）。
// ⚠️ 这段是模板字符串的一部分，**不要在这里使用反引号**。
const HELPER = `
  // ---- Chrome 61 基线补丁（本包不引构建链，直接按 ES2017 写）----
  // ES2020 的空值合并用这个显式函数代替，语义相同：只在 null / undefined 时取默认值。
  function withDefault(value, fallback) { return value == null ? fallback : value; }
`;

const EDITS = {
  'engine.js': [
    {
      note: '顶部加基线补丁 helper',
      find: `  const defaults = { position: .35,`,
      replace: HELPER + `  const defaults = { position: .35,`,
    },
    {
      note: '干声八度派生：对象 spread → Object.assign',
      find: `    return {...base,rate,length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.4,wetOnly:true};`,
      replace: `    return Object.assign({},base,{rate:rate,length:length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.4,wetOnly:true});`,
    },
    {
      note: '湿声八度派生：对象 spread → Object.assign',
      find: `    return {...base,rate,length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.8,octave:12};`,
      replace: `    return Object.assign({},base,{rate:rate,length:length,offset:Math.min(base.offset,Math.max(0,duration-length*rate)),peak:base.peak*.8,octave:12});`,
    },
    {
      note: 'reverb 缺省值 ?? → withDefault',
      find: `    wet.gain.value=Math.max(0,Math.min(1,params.reverb ?? .3))*.8;`,
      replace: `    wet.gain.value=Math.max(0,Math.min(1,withDefault(params.reverb,.3)))*.8;`,
    },
    {
      note: 'volume 缺省值 ?? → withDefault',
      find: `    output.gain.value=10**((params.volume ?? 0)/20);`,
      replace: `    output.gain.value=10**((withDefault(params.volume,0))/20);`,
    },
    {
      note: '事件对象：spread + 可选链 + ?? 一起改写',
      find: `      const event = { ...plan(params, duration, rng), when, origin:liveSource?.origin ?? 0 };`,
      replace: `      const event = Object.assign({}, plan(params, duration, rng), { when: when, origin: withDefault(liveSource && liveSource.origin, 0) });`,
    },
    {
      note: 'reverb 缺省值 ?? → withDefault（湿声八度判定）',
      find: `      if((params.reverb ?? .3)>0 && shimmer()<.45)spawnVoice(octaveEvent(event,duration));`,
      replace: `      if(withDefault(params.reverb,.3)>0 && shimmer()<.45)spawnVoice(octaveEvent(event,duration));`,
    },
    {
      note: 'reverb 缺省值 ?? → withDefault（滑杆回写）',
      find: `    wet.gain.setTargetAtTime(Math.max(0,Math.min(1,params.reverb ?? .3))*.8,now,.03);`,
      replace: `    wet.gain.setTargetAtTime(Math.max(0,Math.min(1,withDefault(params.reverb,.3)))*.8,now,.03);`,
    },
    {
      note: 'volume 缺省值 ?? → withDefault（滑杆回写）',
      find: `    output.gain.setTargetAtTime(10**(Math.max(-24,Math.min(6,params.volume ?? 0))/20),now,.03);`,
      replace: `    output.gain.setTargetAtTime(10**(Math.max(-24,Math.min(6,withDefault(params.volume,0)))/20),now,.03);`,
    },
    {
      note: '环形缓冲计数 ?? → withDefault',
      find: `        const total = liveSource.count ?? 0;`,
      replace: `        const total = withDefault(liveSource.count,0);`,
    },
  ],

  'recorder.js': [
    {
      note: 'release()：可选链 → 显式判空',
      find: `    function release(s){clearTimeout(s.limit);clearInterval(s.clock);s.stream?.getTracks().forEach(t=>t.stop());s.source?.disconnect();s.analyser?.disconnect();if(s.context && s.context.state!=='closed'){void s.context.close().catch(()=>{});}s.analyser=null;}`,
      replace: `    function release(s){clearTimeout(s.limit);clearInterval(s.clock);if(s.stream)s.stream.getTracks().forEach(t=>t.stop());if(s.source)s.source.disconnect();if(s.analyser)s.analyser.disconnect();if(s.context && s.context.state!=='closed'){void s.context.close().catch(function(){});}s.analyser=null;}`,
    },
    {
      note: 'cancel()：可选链 → 显式判空',
      find: `if(s.recorder?.state==='recording')s.recorder.stop();`,
      replace: `if(s.recorder && s.recorder.state==='recording')s.recorder.stop();`,
    },
    {
      note: 'finish()：可选链 → 显式判空',
      find: `    function finish(){const s=session;if(!s?.recorder || s.finishing)return;`,
      replace: `    function finish(){const s=session;if(!(s && s.recorder) || s.finishing)return;`,
    },
    {
      note: '录音能力检测：可选链 → 显式判空',
      find: `if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined')`,
      replace: `if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder==='undefined')`,
    },
    {
      note: 'waveform()：可选链 → 显式判空',
      find: `    function waveform(){const s=session;if(!s?.analyser || s.recorder?.state!=='recording')return null;`,
      replace: `    function waveform(){const s=session;if(!(s && s.analyser) || !(s.recorder && s.recorder.state==='recording'))return null;`,
    },
    {
      note: 'columns()：可选链 → 显式判空',
      find: `      const s=session;if(!s?.recorder || s.recorder.state!=='recording')return null;`,
      replace: `      const s=session;if(!(s && s.recorder) || s.recorder.state!=='recording')return null;`,
    },
  ],

  'camera.js': [
    {
      note: 'release()：可选链 → 显式判空',
      find: `    const release=s=>s?.getTracks().forEach(t=>t.stop());`,
      replace: `    const release=s=>{if(s)s.getTracks().forEach(t=>t.stop());};`,
    },
    {
      note: '摄像头能力检测：可选链 → 显式判空',
      find: `        if(!navigator.mediaDevices?.getUserMedia)throw new Error('请通过 HTTPS 或 localhost 打开摄像头');`,
      replace: `        if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia))throw new Error('当前环境不支持摄像头');`,
    },
  ],

  'app.js': [
    {
      note: '参数对象：对象 spread → Object.assign',
      find: `  const params = { ...Granular.defaults };`,
      replace: `  const params = Object.assign({}, Granular.defaults);`,
    },
    {
      note: 'setAudioSession：可选链 → typeof 能力检测（stop 路径）',
      find: `    Granular.setAudioSession?.('playback');`,
      replace: `    if (typeof Granular.setAudioSession === 'function') Granular.setAudioSession('playback');`,
    },
    {
      note: 'setAudioSession：可选链 → typeof 能力检测（record onState）',
      find: `      Granular.setAudioSession?.(state==='recording' || state==='requesting' ? 'play-and-record' : 'playback');`,
      replace: `      if (typeof Granular.setAudioSession === 'function') Granular.setAudioSession(state==='recording' || state==='requesting' ? 'play-and-record' : 'playback');`,
    },
  ],
};

let applied = 0;
const failures = [];
for (const [file, edits] of Object.entries(EDITS)) {
  const full = path.join(src, file);
  let text = fs.readFileSync(full, 'utf8');
  for (const e of edits) {
    const count = text.split(e.find).length - 1;
    if (count === 0) { failures.push(`${file}: 找不到 → ${e.note}\n    ${e.find.slice(0, 90)}`); continue; }
    text = text.split(e.find).join(e.replace);
    applied += count;
    console.log(`OK   ${file}  ×${count}  ${e.note}`);
  }
  fs.writeFileSync(full, text);
}
if (failures.length) {
  console.error('\n有 ' + failures.length + ' 条没匹配上（源码已变？）：');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`\n共应用 ${applied} 处替换。`);
