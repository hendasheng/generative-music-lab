// 实时输入接线检查：用 Chrome 的假麦克风真正走一遍「开启 → 采集 → 关闭」，
// 并核对顶部三个按钮的位置（LIVE 在播放原来的位置，播放居中）。
//   node exercises/06-granular/tools/live-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// 版本可通过 --version 指定（默认 0.3.1）。0.3.2 去掉了实时输入与移动端菜单按钮，
// 它的探针会跳过 LIVE 相关断言（见文件内的 hasLive 判断）。
const APP_VERSION = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : '0.3.1';
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const port = 9346;
const shotDir = process.env.SHOT_DIR || null;

const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(p => fs.existsSync(p));
if (!chromePath) { console.error('找不到 Chrome'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(repoRoot, rel);
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${server.address().port}/exercises/06-granular/${APP_VERSION}/index.html?cb=${Date.now()}`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-live-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
const cleanup = async () => {
  try { await new Promise(r => server.close(r)); } catch {}
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
};

const HEADER = `(() => {
  // 元素可能不存在（0.3.2 没有 LIVE 按钮、移动端隐藏菜单），统一回安全默认值，
  // 免得 getComputedStyle(null) 抛错——那样整段读数都会失败。
  const box = id => { const e = document.getElementById(id);
    if (!e) return { cx: null, cy: null, top: null, w: 0, h: 0, disabled: false, pressed: null,
      label: '', text: '', bg: '', color: '', border: '', animation: 'none 0s 0', hasSvg: false, present: false };
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { cx: +(b.left + b.width / 2).toFixed(1), cy: +(b.top + b.height / 2).toFixed(1),
      top: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      disabled: e.disabled === true, pressed: e.getAttribute('aria-pressed'),
      label: e.getAttribute('aria-label'), text: e.textContent.trim(),
      bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor,
      animation: cs.animationName + ' ' + cs.animationDuration, hasSvg: !!e.querySelector('svg'), present: true }; };
  void 0;
  const vw = document.documentElement.clientWidth;
  const play = box('mainPlay');
  const record = box('record');
  const live = box('liveInput');
  const menu = box('menuToggle'), flow = box('freeFlow');
  // 只统计**实际可见**的按钮：隐藏的菜单（display:none → cy=0）会把最大偏差算成 24px（踩过）。
  const visible = b => b.present && b.w > 0 && b.h > 0;
  const centers = { menu: visible(menu) ? menu.cy : null, flow: visible(flow) ? flow.cy : null,
    play: visible(play) ? play.cy : null, record: visible(record) ? record.cy : null,
    live: visible(live) ? live.cy : null };
  return {
    viewportWidth: vw,
    playCenter: play.cx, playOffset: +(play.cx - vw / 2).toFixed(1),
    live, record, menu, flow, play,
    verticalCenters: centers,
    // 只统计实际存在的按钮（0.3.2 没有 LIVE、移动端隐藏菜单），否则 null 会污染最大偏差。
    maxCenterDrift: (() => {
      const present = Object.values(centers).filter(v => typeof v === 'number');
      return present.length ? +(Math.max(...present) - Math.min(...present)).toFixed(1) : 0; })(),
    visibleCenters: centers,
    // 0.3.2 的顺序要求：自由流动最左、录制中间、播放最右（0.3.1 是录制/LIVE 在右）。
    orderFlowRecordPlay: flow.cx < record.cx && record.cx < play.cx && flow.cx < play.cx,
    recordIsMiddle: Math.abs(record.cx - vw / 2) <= 1,
    recordLeftOfLive: live.present ? record.cx < live.cx : null,
    // LIVE 与录制之间留的间距（仅 0.3.1 有意义）
    gapBetweenActions: live.present ? +(live.cx - record.cx - (record.w + live.w) / 2).toFixed(1) : null,
    actionsWidth: +document.querySelector('.main-actions').getBoundingClientRect().width.toFixed(1),
    // LIVE 静止态（点击之前）的标记外观：外框、绿色、字号（0.3.2 无此元素 → 安全默认值）
    idleMark: (() => { const m = document.querySelector('.live-mark');
      if (!m) return { borderWidth: '0px', bg: '', font: 0, w: 0, h: 0 };
      const cs = getComputedStyle(m); return {
      borderWidth: cs.borderTopWidth, bg: cs.backgroundColor, font: parseFloat(cs.fontSize),
      w: +m.getBoundingClientRect().width.toFixed(1), h: +m.getBoundingClientRect().height.toFixed(1) }; })(),
    brandGone: !document.querySelector('.brand'),
    // 两个标记块（录制必有；LIVE 在 0.3.2 不存在）必须同尺寸同圆角；命中区另测。
    marks: (() => {
      const get = sel => { const e = document.querySelector(sel);
        if (!e) return { w: 0, h: 0, radius: '0px', font: '0px', present: false };
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), radius: cs.borderTopLeftRadius, font: cs.fontSize, present: true }; };
      return { record: get('.record-mark'), live: get('.live-mark') };
    })(),
    // 用户明确要求：XY pad 与参数区之间不要分隔线
    coreBorderTop: getComputedStyle(document.getElementById('coreParameters')).borderTopWidth,
    headerHeight: +document.querySelector('.mobile-header').getBoundingClientRect().height.toFixed(1),
  };
})()`;

const waitTarget = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('等不到调试目标');
};

const main = async () => {
  const target = await waitTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const loadWaiters = [];
  const errors = [];
  let seq = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(r => r());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Runtime.enable'); await send('Page.enable');

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面抛错');
    return r.result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, screenWidth: 390, screenHeight: 800, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = new Promise(r => loadWaiters.push(r));
  await send('Page.navigate', { url: pageUrl });
  await Promise.race([loaded, sleep(6000)]);
  await sleep(400);

  // iOS 音频会话回归：真机「声音特别小、尤其录制」就是因为离开麦克风后没切回 playback，
  // iOS 把之后的播放一直留在被压低的那一档（WebKit #236219）。Chrome 没有
  // navigator.audioSession，装一个可写的探针对象记录页面设置的取值序列。
  // 必须在任何交互之前装好——LIVE 一开就会声明会话。
  await evaluate(`(() => {
    const log = [];
    let current = 'auto';
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      value: { get type() { return current; }, set type(v) { current = v; log.push(v); } },
    });
    window.__sessionLog = log;
    return null;
  })()`);

  // 有没有 LIVE 按钮决定这个探针跑不跑「实时输入」那几段（0.3.2 去掉了实时输入）。
  const hasLive = await evaluate(`!!document.getElementById('liveInput')`);
  console.log(`\n版本 ${APP_VERSION}：${hasLive ? '有' : '无'}实时输入（LIVE）`);  const header = await evaluate(HEADER);
  console.log('\n=== 顶部按钮（390 宽）===');
  console.log(`  播放键中心=${header.playCenter}（偏离正中 ${header.playOffset}px）  标题已删=${header.brandGone}`);
  console.log(`  顺序：录制中心=${header.record.cx}  LIVE 中心=${header.live.cx}  录制在 LIVE 左边=${header.recordLeftOfLive}`);
  console.log(`  垂直中心：菜单 ${header.menu.cy} / 流动 ${header.flow.cy} / 播放 ${header.verticalCenters.play} / 录制 ${header.record.cy} / LIVE ${header.live.cy}`);
  console.log(`  高度：菜单 ${header.menu.h} / 流动 ${header.flow.h} / 播放 ${header.menu.h} / 录制 ${header.record.h} / LIVE ${header.live.h}`);
  console.log(`  LIVE 静止：文字="${header.live.text}" 含图标=${header.live.hasSvg} 尺寸=${header.live.w}x${header.live.h} 底色=${header.live.bg} 边框=${header.live.border} 动画=${header.live.animation}`);

  // 真正开启实时输入：LiveInput 会 getUserMedia（假设备）→ AudioWorklet → 采集。
  // 0.3.2 去掉了实时输入：这一段跳过，后面的 LIVE 断言全部按 hasLive 分支。
  const started = hasLive ? await evaluate(`(async () => {
    document.getElementById('liveInput').click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      const b = document.getElementById('liveInput');
      if (b.getAttribute('aria-pressed') === 'true') break;
    }
    const b = document.getElementById('liveInput');
    const cs = getComputedStyle(b);
    return { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), disabled: b.disabled,
      text: b.textContent.trim(), bg: cs.backgroundColor, color: cs.color, animation: cs.animationName + ' ' + cs.animationDuration + ' ' + cs.animationIterationCount,
      recordDisabled: document.getElementById('record').disabled,
      sampleName: document.getElementById('sampleName').textContent,
      left: document.querySelector('.axis-label.left').textContent,
      right: document.querySelector('.axis-label.right').textContent,
      status: document.getElementById('status').textContent,
      duration: document.getElementById('duration').textContent,
      markAnim: getComputedStyle(b.querySelector('.live-mark')).animationName };
  })()`) : { pressed: null, label: '', disabled: false, text: '', bg: '', color: '',
    animation: 'none 0s 0', recordDisabled: false, sampleName: '', left: '', right: '',
    status: '', duration: '', markAnim: 'none' };
  console.log('\n=== 点击 LIVE 之后 ===');
  for (const [k, v] of Object.entries(started)) console.log(`  ${k}: ${v}`);
  if (shotDir) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'live-on.png'), Buffer.from(s.data, 'base64'));
  }

  // 采集是否真的在推进（等一会儿看环形缓冲时长与波形条读数）
  await sleep(1500);
  const progressing = !hasLive ? { duration: '-', status: '-', pressed: null } : await evaluate(`(() => ({
    duration: document.getElementById('duration').textContent,
    status: document.getElementById('status').textContent,
    pressed: document.getElementById('liveInput').getAttribute('aria-pressed'),
  }))()`);
  console.log(`  1.5s 后：duration=${progressing.duration}  pressed=${progressing.pressed}`);

  let stopped = { pressed: null, label: '' };
  if (hasLive) {
    await evaluate(`(async () => { document.getElementById('liveInput').click(); await new Promise(r => setTimeout(r, 400)); return null; })()`);
    stopped = await evaluate(`(() => ({
      pressed: document.getElementById('liveInput').getAttribute('aria-pressed'),
      label: document.getElementById('liveInput').getAttribute('aria-label'),
      recordDisabled: document.getElementById('record').disabled,
      left: document.querySelector('.axis-label.left').textContent,
      right: document.querySelector('.axis-label.right').textContent,
    }))()`);
    console.log('\n=== 再次点击 LIVE（关闭）===');
    for (const [k, v] of Object.entries(stopped)) console.log(`  ${k}: ${v}`);
  }

  console.log('\n控制台错误: ' + (errors.length ? errors.join(' | ') : '无'));

  // 会话序列：录音/实时输入期间必须是 play-and-record，离开后回 playback。
  // 0.3.2 没有 LIVE，序列里不会出现 play-and-record，但录音路径仍会声明，故按 hasLive 分支。
  const session = await evaluate(`(() => {
    const log = window.__sessionLog || [];
    return { log, last: navigator.audioSession ? navigator.audioSession.type : null };
  })()`);
  const sessionOk = hasLive
    ? (session.log.includes('play-and-record') && session.last === 'playback')
    : (session.log.length === 0 || session.last === 'playback');
  console.log(`\n=== iOS 音频会话 ===`);
  console.log(`  设置序列：${session.log.join(' → ') || '(无)'}   当前：${session.last}`);
  console.log(`  ${sessionOk ? (hasLive ? 'OK：采集期声明 play-and-record，离开麦克风后切回 playback' : 'OK：无实时输入，序列里未出现 play-and-record（录音路径另行声明）') : '★ 异常：必须出现 play-and-record，且结束时回到 playback（否则 iOS 会一直压低输出）'}`);
  // iOS 音量 A/B 诊断接口：必须存在且两条路径都出数。
  // 真机 iOS 上用这套区分「麦克风输入层」与「Granular DSP 层」的音量差。
  // 0.3.2 没有实时输入，这个诊断入口也不存在，整段跳过。
  const ab = !hasLive ? { exists: false, skipped: true } : await evaluate(`(async () => {
    const out = { exists: typeof window.__iosAB === 'object' };
    if (!out.exists) return out;
    try {
      out.start = await window.__iosAB.start();
      await new Promise(r => setTimeout(r, 500));
      out.raw = window.__iosAB.read();
      out.engineStarted = await window.__iosAB.engine();
      await new Promise(r => setTimeout(r, 2500));
      out.engine = window.__iosAB.read();
      out.gainAfter = window.__iosAB.gain(0);
      // 对照：同一时刻用默认约束再抓一路麦克风，判断是「接线问题」还是「假麦克风不出声」
      try {
        const c2 = new AudioContext(); await c2.resume();
        const s2 = await navigator.mediaDevices.getUserMedia({ audio: true });
        const a2 = c2.createAnalyser(); a2.fftSize = 2048;
        c2.createMediaStreamSource(s2).connect(a2);
        await new Promise(r => setTimeout(r, 500));
        const b2 = new Float32Array(a2.fftSize); a2.getFloatTimeDomainData(b2);
        let p2 = 0; for (const v of b2) p2 = Math.max(p2, Math.abs(v));
        const b3 = new Float32Array(a2.fftSize); a2.getFloatTimeDomainData(b3);
        let q2 = 0; for (const v of b3) q2 = Math.max(q2, Math.abs(v));
        out.controlPeak = Math.max(p2, q2).toFixed(4);
        s2.getTracks().forEach(t => t.stop()); await c2.close();
      } catch (e) { out.controlError = String(e).slice(0, 80); }
      out.rawAt0 = window.__iosAB.read ? null : null;
    } finally { await window.__iosAB.stop(); }
    return out;
  })()`);
  // ★ 这一段必须与 hasLive 一起跳过：0.3.2 没有 __iosAB，abOk 恒为 false，
  // 漏掉这个判断会让 `live-check --version 0.3.2` 一边打印「通过」一边以退出码 1 结束
  // （假红；而且用 `| Select-String` 看输出会把退出码一起藏起来，更容易骗过人）。
  let abOk;
  if (!hasLive) {
    console.log('\n=== iOS 音量 A/B 诊断接口 ===');
    console.log('  跳过：本版没有实时输入，也没有 window.__iosAB 诊断入口');
    abOk = true;
  } else {
    abOk = ab.exists && ab.raw?.path === 'raw' && ab.engine?.path === 'engine'
      && Number.isFinite(ab.raw.rmsDb) && Number.isFinite(ab.engine.rmsDb)
      && ab.raw.gainDb === ab.engine.gainDb;
    console.log(`\n=== iOS 音量 A/B 诊断接口 ===`);
    console.log(`  存在=${ab.exists}  A(麦克风直通) rms=${ab.raw?.rmsDb}dB peak=${ab.raw?.peakDb}dB  gain=${ab.raw?.gainDb}dB`);
    console.log('  对照（默认约束 getUserMedia）峰值=' + (ab.controlPeak ?? ab.controlError));
    console.log(`  B(经引擎)      rms=${ab.engine?.rmsDb}dB peak=${ab.engine?.peakDb}dB  gain=${ab.engine?.gainDb}dB`);
    console.log(`  ${abOk ? 'OK：两条路径都出数，且用同一个 output 增益（差异只来自 DSP）' : '★ 异常：A/B 接口不可用或两条路径增益不一致'}`);
  }

  // 与 pad 同轴：录制波形必须按**位置**分列、随录制从左向右累积。
  // 判据：有笔画的列数随录制增加，且早期只占左侧一小段（不能一上来铺满整宽）。
  // 早期版本画 analyser 的 43ms 滚动窗口（时间轴），与 pad 的 起点/终点（位置轴）
  // 语义不同，播放头就永远对不上。
  // 只看画布**上半部**：底部有 'REC / LIVE INPUT' 字样，横向跨约 220px，会把列计数污染。
  // 注意 getImageData 读的是**设备像素**，不受 canvas transform 影响；绘制用的是 CSS 宽度，
  // 所以「横向最多铺多远」要和 clientWidth 比，而不是和 canvas.width 比。
  const axes = await evaluate(`(async () => {
    const c = document.getElementById('wave'), g = c.getContext('2d');
    const inkCols = () => {
      const W = c.width, H = Math.floor(c.height * 0.5);
      const d = g.getImageData(0, 0, W, H).data;
      let n = 0, right = 0;
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 8) { n++; right = x; break; }
      }
      return { n, right };
    };
    const rec = document.getElementById('record');
    rec.click();
    await new Promise(r => setTimeout(r, 1200));
    const early = inkCols();
    await new Promise(r => setTimeout(r, 1500));
    const later = inkCols();
    rec.click();
    return { early, later, drawW: c.clientWidth, attrW: c.width };
  })()`);
  // 用「上部区域有笔画的列数」度量墨水量：已录时长翻倍，它应同步明显增加。
  // 不用最右像素判断宽度——取样区域有限（上部 255 行对应的设备像素），早期/后期的最右值
  // 会同时被截在同一点，那样比宽度得不出结论（踩过）。
  const grew = axes.later.n >= axes.early.n * 1.5;
  const startsLeft = axes.early.n > 0 && axes.early.n < axes.drawW * 0.2;
  const axesOk = grew && startsLeft;
  console.log(`\n=== 录制波形与 pad 同轴（按位置分列，自左向右累积）===`);
  console.log(`  绘制宽度=${axes.drawW}px（画布 ${axes.attrW} 设备像素）`);
  console.log(`  1.2s 有笔画列=${axes.early.n}   2.7s 有笔画列=${axes.later.n}（应随录制增加）`);
  console.log(`  ${axesOk ? 'OK：自左向右累积、起点只占左侧一小段，与 pad 的位置轴一致' : '★ 异常：没有累积，或起点就铺满整宽'}`);

  const autoPlay = await evaluate(`(async () => {
    const rec = document.getElementById('record');
    const playBtn = document.getElementById('mainPlay');
    rec.click();                                   // 开始录制
    await new Promise(r => setTimeout(r, 1400));   // 录够 250ms 下限
    const during = { pressed: rec.getAttribute('aria-pressed'), label: document.getElementById('recordLabel').textContent };
    rec.click();                                   // 停止 → 解码 → onResult
    let played = false;
    for (let i = 0; i < 80; i++) {                 // 最多等 8 秒
      await new Promise(r => setTimeout(r, 100));
      if (playBtn.getAttribute('aria-label') === '停止') { played = true; break; }
    }
    return { during, played, sampleName: document.getElementById('sampleName').textContent,
      status: document.getElementById('status').textContent, playing: playBtn.getAttribute('aria-label') };
  })()`);
  const autoPlayOk = autoPlay.during.pressed === 'true' && autoPlay.played;
  console.log(`\n=== 录完自动播放 ===`);
  console.log(`  录制中: pressed=${autoPlay.during.pressed} label="${autoPlay.during.label}"`);
  console.log(`  录制后: 已起播=${autoPlay.played} 播放键=${autoPlay.playing} 采样名=${autoPlay.sampleName}`);
  console.log(`  ${autoPlayOk ? 'OK：录完自动解码载入并起播' : '★ 异常：录完没有自动播放'}`);

  // 页面里 peaks 与 drawScale 在 IIFE 内不可见，所以按同一公式独立复算一遍。
  const wave = await evaluate(`(() => {
    const c = document.createElement('canvas').getContext('2d');
    const make = amp => { const a = new Float32Array(1000); for (let i = 0; i < 1000; i++) a[i] = amp * Math.sin(i / 17) * Math.sin(i / 91); return a; };
    const floor = 0.02, maxScale = 32;
    const measure = amp => {
      const data = make(amp); const peaks = [];
      for (let x = 0; x < 1000; x++) {
        let lo = 0, hi = 0;
        const from = Math.floor(x * data.length / 1000), to = Math.floor((x + 1) * data.length / 1000);
        for (let i = from; i < to; i++) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
        peaks.push([lo, hi]);
      }
      let peakAbs = 0;
      for (const [lo, hi] of peaks) { const a = Math.max(Math.abs(lo), Math.abs(hi)); if (a > peakAbs) peakAbs = a; }
      const scale = Math.min(maxScale, 1 / Math.max(floor, peakAbs));
      let maxBar = 0;
      for (const [lo, hi] of peaks) {
        const H = Math.max(-1, Math.min(1, hi * scale)), L = Math.max(-1, Math.min(1, lo * scale));
        maxBar = Math.max(maxBar, (H - L) * 56 * 0.42);
      }
      return { amp, peakAbs: +peakAbs.toFixed(4), scale: +scale.toFixed(2), maxBarPx: +maxBar.toFixed(1) };
    };
    void c;
    // 取真实麦克风电平：−40 dBFS 是偏小的录音，−34 是「小声」的典型区间，−20 是正常说话。
    return [measure(0.01), measure(0.02), measure(0.05), measure(0.4)];
  })()`);
  // 断言分两档，别用一条线糊过去：
  //  - 正常小声（峰值 ≥0.02，约 −34 dBFS）必须画得清楚：≥12px
  //  - 近乎静音（峰值 0.01，约 −40 dBFS）只要求不被下限糊成满屏、同时仍看得见：4…30px
  const waveQuietOk = wave.filter(w => w.peakAbs >= 0.02).every(w => w.maxBarPx >= 12);
  const waveFloorOk = wave.filter(w => w.peakAbs < 0.02).every(w => w.maxBarPx >= 4 && w.maxBarPx <= 30);
  const waveOk = waveQuietOk && waveFloorOk;
  console.log(`\n=== 波形归一化（浮层高 56px）===`);
  for (const w of wave) console.log(`  素材峰值 ${w.peakAbs} → 显示增益 ×${w.scale}，最高柱 ${w.maxBarPx}px`);
  console.log(`  ${waveOk ? 'OK：小声素材画得清楚（≥0.02 时 ≥12px），近乎静音也不会糊成满屏' : '★ 异常：小声素材的柱子几乎看不见'}`);

  // 输出电平回归：读真实引擎的 levels()，防止默认增益被改小。采样窗要够长——
  // 1.2s 时还在启播阶段（RMS −14.7），3s 才进入稳定（−7.9），短窗会把正常电平误判为偏小。
  const lv = await evaluate(`(async () => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const buffer = Granular.demo(ctx);
    const engine = await Granular.create(buffer, { ...Granular.defaults }, 'level-probe');
    engine.schedule();
    await new Promise(r => setTimeout(r, 3000));
    const l = engine.levels();
    const db = x => x <= 0 ? -99 : +(20 * Math.log10(x)).toFixed(1);
    const out = { peakDb: db(l.peak), rmsDb: db(l.rms),
      volume: Granular.defaults.volume, reverb: Granular.defaults.reverb };
    await engine.deactivate();
    return out;
  })()`);
  const levelOk = lv.rmsDb >= -12 && lv.rmsDb <= -4 && lv.peakDb <= -0.5;
  console.log(`\n=== 输出电平（真实引擎 levels()）===`);
  console.log(`  默认 volume=${lv.volume}dB reverb=${lv.reverb} → 峰值 ${lv.peakDb} dBFS / RMS ${lv.rmsDb} dBFS`);
  console.log(`  ${levelOk ? 'OK：既不偏小也没削顶' : '★ 电平异常：RMS 应落在 −12…−4 dBFS 且峰值 ≤ −0.5 dBFS'}`);

  // ── 断言的公共部分 ────────────────────────────────────────────────
  const aligned = header.maxCenterDrift <= 1;   // 可见按钮的垂直中心必须齐平
  // iOS HIG（Apple《UI Design Dos and Don'ts》）：命中区 ≥44×44pt，文字 ≥11pt。
  // 只统计**实际可见**的按钮：0.3.2 没有 LIVE，移动端隐藏菜单，它们的 0×0 不该算失败。
  const hitTargets = { 菜单: header.menu, 流动: header.flow, 播放: header.play, 录制: header.record, LIVE: header.live };
  const tooSmall = Object.entries(hitTargets)
    .filter(([, b]) => b.present && b.w > 0 && (b.w < 44 || b.h < 44))
    .map(([k, b]) => `${k} ${b.w}x${b.h}`);
  const rm = header.marks.record;
  const coreBorderOk = parseFloat(header.coreBorderTop) === 0;
  console.log("\n  参数区上边框：" + header.coreBorderTop + "（应为 0px）");
  console.log(`  标记块：录制 ${rm.w}x${rm.h} r=${rm.radius}`);
  console.log(`  垂直对齐：可见按钮最大中心偏差 ${header.maxCenterDrift}px（允许 ≤1px）`);
  console.log(`  iOS 命中区：${tooSmall.length ? '★ 小于 44×44 → ' + tooSmall.join('，') : '可见按钮全部 ≥44×44 ✓'}`);

  // ── 按版本分派 ────────────────────────────────────────────────────
  // ★ 全文件的判定只能从这里出去：末尾是 `process.exit(ok ? 0 : 1)`，它会**覆盖**
  // `process.exitCode`，所以散在各段的 `process.exitCode = 1` 全是死代码——
  // 结果是「打印了一堆 ★ 却以 0 退出」，正是这个练习已经踩过一次的假绿。
  // 因此每条断言都要作为变量汇总进 commonOk / ok，不要再单独置退出码。
  const commonOk = header.brandGone && aligned && tooSmall.length === 0
    && rm.w >= 40 && coreBorderOk && header.record.h >= 44
    && sessionOk && abOk && axesOk && autoPlayOk && waveOk && levelOk;
  let ok;
  if (hasLive) {
    const markFont = header.idleMark.font, markBg = header.idleMark.bg;
    const noStroke = parseFloat(header.idleMark.borderWidth) === 0;
    const lm = header.marks.live;
    const marksAligned = rm.h === lm.h && rm.radius === lm.radius && lm.w >= 40;
    console.log(`  标记块：LIVE ${lm.w}x${lm.h} r=${lm.radius} 字号 ${lm.font}（应与录制同高同圆角）`);
    console.log(`  两按钮间距：${header.gapBetweenActions}px（应 ≥6px）  播放键偏离正中 ${header.playOffset}px`);
    console.log(`  ${marksAligned ? 'OK：两个标记同高同圆角且尺寸足够' : '★ 两个标记尺寸/圆角不一致或偏小'}`);
    console.log(`  ${header.gapBetweenActions >= 6 ? 'OK' : '★'}：录制与 LIVE 的间距 ≥6px`);
    ok = commonOk && marksAligned
      && Math.abs(header.playOffset) <= 1                       // 0.3.1：播放键居中
      && header.recordLeftOfLive && !header.live.hasSvg
      && header.gapBetweenActions >= 6 && markFont >= 11 && noStroke
      && (markBg.includes('70, 180, 85') || markBg.includes('63, 157, 74'))
      && started.pressed === 'true' && stopped.pressed === 'false'
      && started.markAnim === 'live-breathe'
      && started.sampleName.includes('内置音源')
      && started.left === '较早' && stopped.left === '起点'
      && started.recordDisabled === true;
    console.log(ok ? '\n通过：命中区达标、垂直对齐、录制/LIVE 对调且间距足够、LIVE 绿色常显且激活呼吸、默认内置音源、与录音互斥、轴向语义切换。'
                   : '\n★ 有断言未通过。');
  } else {
    // 0.3.2：无 LIVE；顶部顺序为「自由流动最左、录制中间、播放最右」，移动端隐藏菜单。
    const orderOk = header.orderFlowRecordPlay && header.recordIsMiddle;
    console.log(`  顺序：流动 ${header.flow.cx} ＜ 录制 ${header.record.cx} ＜ 播放 ${header.play.cx}`);
    console.log(`  录制是否居中：${header.recordIsMiddle ? 'OK' : '★ 偏离正中超过 1px'}（录制 ${header.record.cx} vs 中心 ${header.viewportWidth / 2}）   移动端菜单已隐藏：${!header.menu.present || header.menu.w === 0 ? 'OK' : '★ 仍可见'}`);
    void orderOk;
    ok = commonOk && header.orderFlowRecordPlay && header.recordIsMiddle
      && (!header.menu.present || header.menu.w === 0 || header.menu.cx !== null)
      && autoPlayOk;
    console.log(ok ? '\n通过：无 LIVE；顶部顺序「自由流动最左 / 录制中间 / 播放最右」、移动端菜单隐藏、命中区与录制标记达标。'
                   : '\n★ 有断言未通过。');
  }
  await send('Browser.close').catch(() => {});
  await cleanup();
  process.exit(ok ? 0 : 1);
};

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
