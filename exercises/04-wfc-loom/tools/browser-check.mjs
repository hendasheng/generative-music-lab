#!/usr/bin/env node
// 04 的**真机批量探针**：一次 Chrome 运行里把"必须真机才能验"的东西全查一遍 ——
// 声音真的响了没有（数 triggerAttackRelease 的次数，不看控制台干不干净）、
// 画面与发声的状态、停止 / 再播放的生命周期、控制台报错。
//
// 用法（在仓库根目录；**必须先起本地静态服务器**，且这条命令在沙箱里需要 danger-full-access，
// 因为 Chrome 的 IPC 要命名管道）：
//   python -m http.server 8765
//   node exercises/04-wfc-loom/tools/browser-check.mjs --url http://127.0.0.1:8765/exercises/04-wfc-loom/0.4/
//
// ★ 它跑完会用 CDP 的 `Browser.close` 关掉自己启动的 Chrome，并按 PID 兜底 kill —— 
//   历史上出现过"后台任务显示完成、Chrome 其实还在放音乐"的事故，别再那样。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const baseUrl = getArg('--url', 'http://127.0.0.1:8765/exercises/04-wfc-loom/0.4/');
const port = Number(getArg('--port', '9222'));
const seed = getArg('--seed', '12345');
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'cb=' + Date.now();   // cache-buster：否则会测到改动前的页面

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chromePath) { console.error('找不到 Chrome：' + CHROME_CANDIDATES.join(' / ')); process.exit(1); }

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--autoplay-policy=no-user-gesture-required',   // 没有用户手势时 AudioContext 停在 suspended，Tone.start() 不 resolve
  '--mute-audio',                                 // ★ 否则会真的从扬声器出声（无头没有窗口，用户听得见却找不到来源）
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',                                  // ★ 不把目标页写在命令行里：页面还在加载时连上去，
], { stdio:'ignore', detached:false });          //   上下文会被随后的导航销毁（报 "Execution context was destroyed"）

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => {
  try { chrome.kill(); } catch {}
  try { fs.rmSync(userDataDir, { recursive:true, force:true }); } catch {}
};

const waitForTarget = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('等不到 Chrome 的调试目标');
};

const main = async () => {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  const loadWaiters = [];
  let seq = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(resolve => resolve());
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async (fnSource, attempt = 0) => {
    try {
      const result = await send('Runtime.evaluate', {
        expression: `(${fnSource})()`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面里抛错了');
      return result.result.value;
    } catch (error) {
      // 页面正在导航 / 上下文被替换时重试（连上去太早就是这个症状）
      if (attempt < 3 && /Execution context was destroyed|Cannot find context/.test(error.message)) {
        await sleep(500);
        return evaluate(fnSource, attempt + 1);
      }
      throw error;
    }
  };

  // ★ 显式导航并等 load 事件，再等页面把 window.exercise 挂上 —— 不要在页面还加载时就开始 eval
  const loaded = new Promise(resolve => loadWaiters.push(resolve));
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);
  const ready = await evaluate(`async () => { for (let i=0;i<100;i+=1){ if (window.exercise && window.Tone) return true; await new Promise(r=>setTimeout(r,100)); } return false; }`);
  if (!ready) throw new Error('页面 10 秒内没有就绪（window.exercise / Tone 没挂上）');
  await sleep(400);

  // ① 装计量器（数 triggerAttackRelease —— 判"有没有声音"只能数调用次数），再设种子并开始播放。
  //    设种子必须写 shadow root 里的 input 再派发 Enter：`exercise-controls.seedValue` 只有 getter。
  const play = await evaluate(`async () => {
    window.__notes = [];
    window.__pageErrors = [];
    window.addEventListener('error', e => window.__pageErrors.push(String(e.message)));
    const proto = typeof PIANO_SAMPLE_BASE !== 'undefined' ? Tone.Sampler.prototype : Tone.Synth.prototype;
    const orig = proto.triggerAttackRelease;
    proto.triggerAttackRelease = function (note, duration, time, velocity) {
      window.__notes.push({ note, duration, time, velocity, at: Tone.getContext().currentTime });
      return orig.call(this, note, duration, time, velocity);
    };
    window.__visualCheck = { frames:0, mismatches:0, reused:0, moving:0 };
    if (document.querySelector('.cell[data-cell-id]')) {
      const draw = Tone.Draw.schedule.bind(Tone.Draw);
      let previous = new Map();
      Tone.Draw.schedule = (fn, time) => draw(() => {
        fn();
        const check = window.__visualCheck;
        check.frames++;
        const now = document.querySelector('.cell.now');
        const actual = now?.querySelector('.val')?.textContent || null;
        const sound = window.__notes.find(n => Math.abs(n.time - time) < 0.00001);
        const expected = sound ? sound.note.replace(/[0-9]/g, '') : null;
        if (actual !== expected || Boolean(now?.classList.contains('hit')) !== Boolean(sound)) check.mismatches++;
        const current = new Map([...document.querySelectorAll('.cell')].map(el => [el.dataset.cellId, el]));
        for (const [id, el] of current) {
          if (previous.get(id) === el) check.reused++;
          for (const animation of el.getAnimations()) {
            if (animation.effect.getKeyframes().some(frame => frame.transform)) check.moving++;
          }
        }
        previous = current;
      }, time);
    }
    const readDrift = () => {
      const value = document.getElementById('driftValue');
      const marker = document.getElementById('driftMarker');
      const dValue = document.getElementById('densityValue');
      const dMarker = document.getElementById('densityMarker');
      return {
        value: value ? value.textContent : null,
        left: marker ? marker.style.left : null,
        density: dValue ? dValue.textContent : null,
        densityLeft: dMarker ? dMarker.style.left : null,
      };
    };
    const controls = document.getElementById('transportControls');
    const input = controls.shadowRoot.querySelector('input');
    input.value = ${JSON.stringify(seed)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    for (let i=0;i<350 && !window.__notes.length;i++) await new Promise(r=>setTimeout(r,100));
    if (!window.__notes.length) throw new Error('音源未触发：' + document.getElementById('status').textContent);
    await new Promise(r => setTimeout(r, 2400));
    const midStatus = document.getElementById('status').textContent.slice(0, 120);
    const midCount = window.__notes.length;
    const midDone = document.querySelectorAll('.cell.done').length;
    const midRests = document.querySelectorAll('.cell.rested').length;
    const driftA = readDrift();
    await new Promise(r => setTimeout(r, 2600));
    const vals = [...document.querySelectorAll('.cell .val')].map(el => el.textContent);
    const letters = window.__notes.map(n => n.note.replace(/[0-9]/g, ''));
    return {
      visualCheck: window.__visualCheck,
      notes: window.__notes.length,
      first: window.__notes.slice(0, 6).map(n => n.note + '@' + n.time.toFixed(3) + ' v' + n.velocity.toFixed(2)),
      gaps: window.__notes.slice(1, 6).map((n, i) => +(n.time - window.__notes[i].time).toFixed(4)),
      midStatus, midCount, midDone, midRests, driftA, driftB: readDrift(),
      letters: [...new Set(letters)].sort().join(''),
      cells: document.querySelectorAll('.cell').length,
      done: document.querySelectorAll('.cell.done').length,
      rests: document.querySelectorAll('.cell.rested').length,
      hit: document.querySelectorAll('.cell.hit').length,
      sequence: vals.join(' '),
      status: document.getElementById('status').textContent.slice(0, 170),
      pageErrors: window.__pageErrors.slice(),
    };
  }`);

  // ①b 钢琴采样：把"音头听起来像敲桌子"里**能量的那一半**量出来（剩下的只能靠耳朵）。
  //     它回答的是三个问题，每一个都能否掉一整类改法：
  //       ① 起点是否在零点 —— Tone 的 `attack: 0` 不做淡入，非零起点才是"每音一记爆音"
  //       ② 音头的能量在哪个频段 —— 低频闷响可以用低切，宽带/基频就不能
  //       ③ 电平：采样峰值 × 各级增益，对比母带链 Limiter(-1) 的天花板
  //     ★ 数字怎么读：dB 都是相对同一窗口里的最强分 bin。
  const piano = await evaluate(`async () => {
    if (typeof PIANO_SAMPLE_BASE === 'undefined') return null;
    const raw = await Tone.getContext().rawContext.decodeAudioData(
      await (await fetch(PIANO_SAMPLE_BASE + 'a4.wav')).arrayBuffer());
    const source = raw.getChannelData(0);
    const sr = raw.sampleRate;
    const rms = (data, from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += data[i] * data[i]; return Math.sqrt(sum / Math.max(1, to - from)); };
    const mean = (data, from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += data[i]; return sum / Math.max(1, to - from); };
    const dB = ratio => 20 * Math.log10(Math.max(ratio, 1e-12));
    const ms = t => Math.round(sr * t);
    // 单频能量：汉宁窗单点 DFT（频率不必落在整数 bin 上；各频点用同一套窗，相对值可比）
    const bin = (from, to, frequency) => {
      let re = 0, im = 0; const n = to - from;
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
        const phase = 2 * Math.PI * frequency * (from + i) / sr;
        re += source[from + i] * w * Math.cos(phase);
        im -= source[from + i] * w * Math.sin(phase);
      }
      return Math.sqrt(re * re + im * im) / (n / 2);
    };
    const FREQUENCIES = [60, 100, 150, 200, 300, 440, 600, 880, 1320, 2000];
    const band = (from, to) => {
      const values = FREQUENCIES.map(f => bin(from, to, f));
      const max = Math.max(...values);
      return FREQUENCIES.map((f, i) => f + ':' + dB(values[i] / max).toFixed(0));
    };
    // ★ 不能写 Math.max(...source)：几十万个采样会直接爆栈
    let peak = 0, min = 0;
    for (const value of source) { if (value > peak) peak = value; if (value < min) min = value; }
    const windows = [[0.005, '0-5ms'], [0.01, '5-10ms'], [0.02, '10-20ms'], [0.05, '20-50ms'], [0.1, '50-100ms'], [0.2, '100-200ms'], [0.4, '200-400ms']];
    const reference = Math.max(...windows.map(w => rms(source, 0, ms(w[0]))));
    const envelope = windows.map((w, i) => w[1] + ' ' + dB(rms(source, i === 0 ? 0 : ms(windows[i - 1][0]), ms(w[0])) / reference).toFixed(1));
    return {
      channels: raw.numberOfChannels, sampleRate: sr, duration: +raw.duration.toFixed(2),
      first: [source[0], source[1], source[2], source[3]].map(v => +v.toFixed(6)),
      peak: +peak.toFixed(4), min: +min.toFixed(4),
      dcOnset: +mean(source, 0, ms(0.04)).toFixed(6), dcAll: +mean(source, 0, source.length).toFixed(6),
      envelope, attackBand: band(0, ms(0.04)), bodyBand: band(ms(0.2), ms(0.4)),
      level: { volumeDb: PIANO_VOLUME_DB, velocity: VELOCITY, masterDb: MASTER_VOLUME_DB,
        wet: typeof PIANO_REVERB_WET === 'undefined' ? null : PIANO_REVERB_WET },
    };
  }`);

  // ①c BPM 是演出参数：播放中改它必须立刻改变步长，而且**不重播**（步数继续涨、音流继续走）。
  //     ★ "改 BPM 后网格自己跟着走"是 Tone 把秒数换算成 tick 的**内部行为**，离线桩量不到，只能在这里量。
  const tempo = await evaluate(`async () => {
    const input = document.getElementById('bpmInput');
    const hint = document.getElementById('bpmHint');
    if (!input) return null;
    const readTick = () => {
      const match = document.getElementById('status').textContent.match(/第\\s*(\\d+)\\s*拍/);
      return match ? Number(match[1]) : null;
    };
    const before = { value: input.value, hint: hint.textContent, tick: readTick(), notes: window.__notes.length };
    input.value = '180';
    input.dispatchEvent(new Event('change', { bubbles:true }));
    const mark = window.__notes.length;
    await new Promise(r => setTimeout(r, 2600));
    const after = { value: input.value, hint: hint.textContent, tick: readTick(), notes: window.__notes.length };
    const notes = window.__notes.slice(mark);
    const gaps = notes.slice(1).map((n, i) => +(n.time - notes[i].time).toFixed(6));
    input.value = '112';
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await new Promise(r => setTimeout(r, 600));
    return { before, after, gaps, expected: +(60 / 180 / 2).toFixed(6), count: notes.length };
  }`);

  // ② 停止 → 淡出 380ms 之后必须彻底不再出声。
  //    ★ 判据要避开淡出窗口：停止后 380ms 内本来还会响 1–2 个音（那是有意的淡出）。
  const stopped = await evaluate(`async () => {
    document.getElementById('transportControls').dispatchEvent(new CustomEvent('exercise-stop', { bubbles:true }));
    await new Promise(r => setTimeout(r, 1000));           // 让淡出（380ms）与在飞的音都跑完
    const settled = window.__notes.length;
    await new Promise(r => setTimeout(r, 900));            // 再等一段：这段时间内不该有新音
    return { settled, later: window.__notes.length, status: document.getElementById('status').textContent.slice(0, 120) };
  }`);

  // ③ 再按播放 → 必须重新出声（这一条专门验"停止把 signal.cancelled 置真之后忘了复位"这类 bug）
  const resumed = await evaluate(`async () => {
    const before = window.__notes.length;
    document.getElementById('transportControls').dispatchEvent(new CustomEvent('exercise-play', { bubbles:true }));
    await new Promise(r => setTimeout(r, 2200));
    return { before, after: window.__notes.length, status: document.getElementById('status').textContent.slice(0, 120) };
  }`);

  console.log('=== 04 真机批量检查 ===');
  console.log(`URL: ${url}\n`);
  console.log('滚动与音画对应: ' + JSON.stringify(play.visualCheck));
  if (play.visualCheck.frames && (play.visualCheck.mismatches || !play.visualCheck.reused || !play.visualCheck.moving)) throw new Error('滚动或音画对应检查失败');
  console.log('① 播放（种子文本 ' + seed + '）');
  console.log(`   2.4s 处: 已发声 ${play.midCount} 个 · 界面已确定 ${play.midDone} / ${play.cells} 格`);
  console.log(`     状态栏: ${play.midStatus.replace(/\\s+/g, ' ')}`);
  console.log(`   5.0s 处: 发声 ${play.notes} 个 · 前 6 个 ${play.first.join(' | ')}`);
  console.log(`   相邻间隔(s): ${play.gaps.join(', ')}　（期望 0.267857 = 112 BPM 的八分音符）`);
  console.log(`   用到的音名: ${play.letters}　（A minor 应当只出现 A B C D E F G）`);
  if (play.driftA.value !== null) {
    console.log(`   音区漂移读数: ${play.driftA.value} → ${play.driftB.value}　标记位置 ${play.driftA.left || '—'} → ${play.driftB.left || '—'}` +
      (play.driftA.value !== play.driftB.value ? '（在动 ✓）' : '（**没动** ✗）'));
  }
  if (play.driftA.density !== null) {
    console.log(`   疏密读数: ${play.driftA.density} → ${play.driftB.density}　标记位置 ${play.driftA.densityLeft || '—'} → ${play.driftB.densityLeft || '—'}` +
      (play.driftA.density !== play.driftB.density ? '（在动 ✓）' : '（**没动** ✗）'));
    console.log(`   DOM 休止格: 2.4s 处 ${play.midRests} 个 · 5.0s 处 ${play.rests} 个（rest 格不发声）`);
  }
  console.log(`   DOM: ${play.cells} 个 cell · 已确定 ${play.done} · 高亮 ${play.hit}`);
  console.log(`   状态栏: ${play.status.replace(/\\s+/g, ' ')}`);
  console.log(`   页面 error 监听: ${play.pageErrors.length}`);
  if (piano) {
    const gain = Math.pow(10, piano.level.volumeDb / 20) * piano.level.velocity * Math.pow(10, piano.level.masterDb / 20);
    const dry = piano.level.wet === null ? 1 : 1 - piano.level.wet;
    console.log('\n①b 钢琴采样（A4.wav 原始解码 · 用来定位"音头听起来不对"到底是哪一类问题）');
    console.log(`   ${piano.channels} 声道 · ${piano.sampleRate} Hz · ${piano.duration}s · 首采样 [${piano.first.join(', ')}] · 峰值 ${piano.peak} / ${piano.min}`);
    console.log(`   直流：音头 40ms ${piano.dcOnset} · 整段 ${piano.dcAll}（都在噪声量级才正常）`);
    console.log('   音头包络（dB rel 最强窗口）: ' + piano.envelope.join(' · '));
    console.log('   音头 40ms 频谱（相对最高分 bin）: ' + piano.attackBand.join(' '));
    console.log('   200-400ms 频谱（相对最高分 bin）: ' + piano.bodyBand.join(' '));
    console.log(`   电平推算：${piano.peak} × ${gain.toFixed(2)}（+${piano.level.volumeDb} dB 采样 · velocity ${piano.level.velocity.toFixed(3)} · +${piano.level.masterDb} dB 母带）` +
      ` = ${(piano.peak * gain).toFixed(3)}${piano.level.wet === null ? '' : `　→ 过 Reverb 干路 ×${dry.toFixed(2)} = ${(piano.peak * gain * dry).toFixed(3)}`}` +
      '　（Limiter(-1) 天花板 0.891）');
  }
  if (tempo) {
    // 改 BPM 时已经在飞的那一步仍按旧间隔，所以第一个间隔跳过
    const ratios = tempo.gaps.slice(1).map(gap => +(gap / tempo.expected).toFixed(3));
    const offGrid = ratios.filter(ratio => Math.abs(ratio - Math.round(ratio)) > 0.05);
    console.log('\n①c BPM 演出参数（播放中 112 → 180，随后改回 112）');
    console.log(`   提示行: ${tempo.before.hint} → ${tempo.after.hint}`);
    console.log(`   步数: 第 ${tempo.before.tick} 拍 → 第 ${tempo.after.tick} 拍（继续涨 = 没有重播）· 改后 ${tempo.count} 个音`);
    console.log(`   改后间隔 ÷ 期望 ${tempo.expected}s: ${ratios.join(', ') || '（没有新音）'}`);
    if (!ratios.length) throw new Error('改 BPM 之后没有继续发声');
    if (offGrid.length) throw new Error('改 BPM 后的间隔没有落在八分音符网格上：' + offGrid.join(', '));
    if (typeof tempo.before.tick === 'number' && typeof tempo.after.tick === 'number' && tempo.after.tick <= tempo.before.tick) {
      throw new Error('改 BPM 之后步数没有继续涨（像是重播了）');
    }
  }
  console.log('\n② 停止后（1000ms 已过淡出，再等 900ms）');
  console.log(`   发声次数 ${stopped.settled} → ${stopped.later}${stopped.settled === stopped.later ? '（冻结 ✓）' : '（**还在响** ✗）'}`);
  console.log('\n③ 再按播放（暂停语义）');
  console.log(`   发声次数 ${resumed.before} → ${resumed.after}${resumed.after > resumed.before ? '（重新出声 ✓）' : '（**没有出声** ✗）'}`);
  console.log(`\n控制台 error ${consoleErrors.length} 条 · 未捕获异常 ${exceptions.length} 条`);
  consoleErrors.slice(0, 5).forEach(line => console.log('   console.error: ' + line.slice(0, 200)));
  exceptions.slice(0, 5).forEach(line => console.log('   exception: ' + String(line).slice(0, 200)));

  await send('Browser.close').catch(() => {});
  ws.close();
};

main().then(() => { cleanup(); process.exit(0); })
  .catch(error => { console.error('探针失败：' + error.message); cleanup(); process.exit(1); });
