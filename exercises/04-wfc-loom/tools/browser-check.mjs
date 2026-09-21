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
    const proto = Tone.Synth.prototype;
    const orig = proto.triggerAttackRelease;
    proto.triggerAttackRelease = function (note, duration, time, velocity) {
      window.__notes.push({ note, duration, time, velocity, at: Tone.getContext().currentTime });
      return window.__notes.length;
    };
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
