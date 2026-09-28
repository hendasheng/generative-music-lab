#!/usr/bin/env node
// 06/0.3.1 的**真机视口布局探针**：0.3.1 是网页不是 App，手机浏览器会把可视高度吃掉
// 一截（地址栏 / 工具栏 / 键盘），可用高度远小于设备屏幕高度。这个脚本就按"被吃掉之后"
// 的高度量各区块的实际像素高度，专门回答"XY pad 是不是被挤成一条"。
//
// 用法（仓库根目录；Chrome 的 IPC 要命名管道，这条命令在沙箱里需要 danger-full-access）：
//   node exercises/06-granular/tools/layout-check.mjs
//
// 它自己起一个本地静态服务器并关掉，用完 CDP `Browser.close` + PID 兜底 kill Chrome，
// 不会留下占端口的 python 子进程（AGENTS.md 里记过这个坑）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const shotDir = process.env.SHOT_DIR || null;

// 版本可通过 --version 指定（默认 0.3.1）。0.3.2 去掉了实时输入与移动端菜单按钮，
// 它的探针会跳过 LIVE 相关断言（见文件内的 hasLive 判断）。
const APP_VERSION = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : '0.3.1';
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const chromePort = Number(process.env.CDP_PORT || 9333);

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chromePath) { console.error('找不到 Chrome：' + CHROME_CANDIDATES.join(' / ')); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.cjs': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(repoRoot, rel);
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// 默认测本机服务器；传 --url <公网地址> 可让 Chrome 真的走 CDN / 隧道去加载页面，
// 这样量到的是「外部访问者拿到的那一版」，而不只是本机文件系统。
const urlArgIndex = process.argv.indexOf('--url');
const remoteBase = urlArgIndex >= 0 ? process.argv[urlArgIndex + 1].replace(/\/$/, '') : null;
const pageRoot = remoteBase ?? origin;
const pageUrl = `${pageRoot}/exercises/06-granular/${APP_VERSION}/index.html?cb=${Date.now()}`;
if (remoteBase) console.log('页面来源：' + remoteBase + '（公网，经隧道/边缘）');

// height = 浏览器真正留给页面的可视高度（已被地址栏/工具栏吃掉），screenHeight = 设备屏幕高度。
const VIEWPORTS = [
  { name: '桌面参考 390x844 (无浏览器栏)', width: 390, height: 844, screenHeight: 844, mobile: false },
  { name: '手机竖屏 iOS (屏 844，栏吃掉 140)', width: 390, height: 704, screenHeight: 844, mobile: true },
  { name: '手机竖屏 安卓 (屏 800，栏吃掉 190)', width: 360, height: 610, screenHeight: 800, mobile: true },
  { name: '竖屏 边界 600', width: 390, height: 600, screenHeight: 800, mobile: true },
  { name: '竖屏 边界 580 (pad 刚好到下限)', width: 390, height: 580, screenHeight: 800, mobile: true },
  { name: '竖屏 栏 + 键盘将出 (屏 844，只剩 520)', width: 390, height: 520, screenHeight: 844, mobile: true },
  { name: '小屏竖屏 (屏 667，栏吃掉 177)', width: 375, height: 490, screenHeight: 667, mobile: true },
  { name: '手机横屏 (屏 390，栏吃掉 60)', width: 844, height: 330, screenHeight: 390, mobile: true },
  { name: '极短横屏 (地址栏全展开，只剩 300)', width: 844, height: 300, screenHeight: 390, mobile: true },
  { name: '极短横屏 极端 (只剩 250)', width: 844, height: 250, screenHeight: 390, mobile: true },
  { name: '桌面宽屏 1280x800', width: 1280, height: 800, screenHeight: 800, mobile: false },
  { name: '桌面宽屏 1440x900', width: 1440, height: 900, screenHeight: 900, mobile: false },
  { name: '窄桌面 760x700 (并排边界)', width: 760, height: 700, screenHeight: 700, mobile: false },
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chrome-layout-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws = null;
const cleanup = async () => {
  try { await new Promise(r => server.close(r)); } catch {}
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
};

const waitForTarget = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('等不到 Chrome 的调试目标');
};

const MEASURE = `(() => {
  const r = sel => { const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
  const main = document.querySelector('main');
  return {
    innerHeight: window.innerHeight,
    docScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    overflowsViewport: document.documentElement.scrollHeight > window.innerHeight + 1,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    mainHeight: main ? +main.getBoundingClientRect().height.toFixed(1) : null,
    mainMinHeight: main ? getComputedStyle(main).minHeight : null,
    performance: r('.performance'),
    cameraGroup: r('.camera-group'),
    xyGroup: r('.xy-group'),
    cameraWindow: r('.camera-window'),
    sampleStrip: r('.sample-strip'),
    xyPad: r('#xy-pad, .xy-pad'),
    xyWindow: r('.xy-window'),
    xyDescription: r('#xyDescription'),
    xyWindowRows: getComputedStyle(document.querySelector('.xy-window')).gridTemplateRows,
    xyGroupRows: getComputedStyle(document.querySelector('.xy-group')).gridTemplateRows,
    // iOS 全屏适配：画布色（html）、body、主容器、theme-color 四者必须一致。
    // 曾出现 html=#bfc0b8 / main=#deded5 / theme-color=#deded5：Safari 工具栏显示
    // theme-color 而画布是另一个色，收放工具栏时看起来像「背景没填满」。
    fullscreen: {
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      mainBg: getComputedStyle(main).backgroundColor,
      themeColor: (document.querySelector('meta[name="theme-color"]') || {}).content ?? null,
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content ?? null,
      bodyPadding: getComputedStyle(document.body).paddingTop + '/' + getComputedStyle(document.body).paddingBottom,
      mainPaddingTop: getComputedStyle(main).paddingTop,
      mainPaddingBottom: getComputedStyle(main).paddingBottom,
    },
    // 页面必须铺满可视区：iOS Safari 工具栏收/放时可视高度会变，
    // 若布局停在偏矮的高度，上下就会各留一条空白带。
    viewportGap: (() => {
      const m = main.getBoundingClientRect();
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      return { innerHeight: window.innerHeight, visualViewport: +vh.toFixed(1),
        mainTop: +m.top.toFixed(1), mainBottom: +m.bottom.toFixed(1),
        gapTop: +m.top.toFixed(1), gapBottom: +(vh - m.bottom).toFixed(1),
        docScrollHeight: document.documentElement.scrollHeight,
        units: (() => { const p = document.createElement('div');
          const read = u => { p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:' + u; document.body.appendChild(p);
            const h = p.getBoundingClientRect().height; p.remove(); return +h.toFixed(1); };
          const r = { vh: read('100vh'), dvh: read('100dvh'), svh: read('100svh'), lvh: read('100lvh') };
          return r; })() };
    })(),
    cameraWindowMinHeight: getComputedStyle(document.querySelector('.camera-window')).minHeight,
    xyWindowMinHeight: getComputedStyle(document.querySelector('.xy-window')).minHeight,
    minPadVar: getComputedStyle(main).getPropertyValue('--min-pad'),
    minCameraVar: getComputedStyle(main).getPropertyValue('--min-camera'),
    coreParameters: r('#coreParameters'),
    portraitLayout: matchMedia('(orientation:landscape) and (min-width:600px)').matches,
    xyColumns: getComputedStyle(document.querySelector('.performance')).gridTemplateColumns,
    xyRows: getComputedStyle(document.querySelector('.performance')).gridTemplateRows,
    mainRows: getComputedStyle(main).gridTemplateRows,
    // 顶栏对齐：中间那一列必须**真的**落在 header 正中（左右两侧宽度不等时 flex 会偏）。
    // 用 grid 的 1fr auto 1fr 时中间列必然居中；用 flex space-between 时
    // 「左组宽 = 右组宽」才成立——padding-right 之类的补偿会打破它。
    // 0.3.2 是「流动 / 录制 / 播放」三段（#record 是 header 的直接子元素），
    // 0.3.1 是「录制+LIVE」在右侧、播放居中，所以断言按结构分支，不按版本号。
    header: (() => {
      const h = document.querySelector('.mobile-header');
      const hr = h.getBoundingClientRect();
      const box = sel => { const el = document.querySelector(sel); if (!el) return null;
        const b = el.getBoundingClientRect(); return b.width ? b : null; };
      const center = b => b ? +((b.left + b.right) / 2 - (hr.left + hr.right) / 2).toFixed(1) : null;
      const mid = h.children[1];
      const spread = document.getElementById('record').parentElement === h; // 0.3.2 的「录制居中」结构
      const mark = spread ? box('#record .record-mark') : null;
      return {
        display: getComputedStyle(h).display,
        spread,
        midName: mid ? (mid.id || mid.className) : null,
        midOffset: center(mid.getBoundingClientRect()),
        recordMarkOffset: mark ? +((mark.left + mark.right) / 2 - (hr.left + hr.right) / 2).toFixed(1) : null,
        flowInset: spread && box('#freeFlow') ? +(box('#freeFlow').left - hr.left).toFixed(1) : null,
        playInset: spread && box('#mainPlay') ? +(hr.right - box('#mainPlay').right).toFixed(1) : null,
        menuVisible: !!box('#menuToggle'),
      };
    })(),
  };
})()`;

const main = async () => {
  const target = await waitForTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
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
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面里抛错了');
    return result.result.value;
  };

  const INTERACT = `(() => {
    const out = {};
    const pad = document.getElementById('xyPad');
    const dot = document.getElementById('xyDot');
    const r = pad.getBoundingClientRect();
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1,
    }));
    const before = { left: dot.style.left, top: dot.style.top };
    fire(pad, 'pointerdown', r.left + r.width * 0.8, r.top + r.height * 0.8);
    out.padMoved = { before, after: { left: dot.style.left, top: dot.style.top } };
    out.padResponded = before.left !== dot.style.left || before.top !== dot.style.top;
    fire(window, 'pointerup', 0, 0);

    const key = document.getElementById('p-density');
    const slider = key || [...document.querySelectorAll('input[type=range]')].find(i => i.closest('.core-parameter'));
    const srect = slider.getBoundingClientRect();
    const valueBefore = slider.value;
    fire(slider, 'pointerdown', srect.left + srect.width / 2, srect.top + 4);
    fire(window, 'pointermove', srect.left + srect.width / 2, srect.top + 4 - 60);
    out.dial = { id: slider.id, before: valueBefore, after: slider.value, responded: valueBefore !== slider.value };
    fire(window, 'pointerup', 0, 0);
    out.dialHitSize = { w: +srect.width.toFixed(1), h: +srect.height.toFixed(1) };
    return out;
  })()`;

  // 录制按钮的三个状态：静止（红底 + 白点）、录制中（方块无点）、等待授权（禁用变淡）。
  // 只看 CSS 不算验证，这里把三种状态各截一张图，并读回白点的实际尺寸。
  const RECORD_PROBE = `(() => {
    const btn = document.getElementById('record');
    const mark = btn.querySelector('.record-mark');
    const dot = getComputedStyle(mark, '::after');
    const box = mark.getBoundingClientRect();
    return {
      ariaPressed: btn.getAttribute('aria-pressed'),
      mark: { w: +box.width.toFixed(1), h: +box.height.toFixed(1) },
      dot: { content: dot.content, w: dot.width, h: dot.height, radius: dot.borderRadius, bg: dot.backgroundColor, display: dot.display },
      label: btn.getAttribute('aria-label'),
    };
  })()`;

  const results = [];
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height,
      screenWidth: vp.width, screenHeight: vp.screenHeight,
      deviceScaleFactor: vp.mobile ? 3 : 1, mobile: vp.mobile,
      screenOrientation: { type: vp.width > vp.height ? 'landscapePrimary' : 'portraitPrimary', angle: vp.width > vp.height ? 90 : 0 },
    });
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const loaded = new Promise(resolve => loadWaiters.push(resolve));
    await send('Page.navigate', { url: pageUrl });
    await Promise.race([loaded, sleep(6000)]);
    await sleep(500);
    results.push({ name: vp.name, ...(await evaluate(MEASURE)) });
    if (shotDir) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width, height: vp.height, screenWidth: vp.width, screenHeight: vp.screenHeight,
        deviceScaleFactor: 1, mobile: vp.mobile,
        screenOrientation: { type: vp.width > vp.height ? 'landscapePrimary' : 'portraitPrimary', angle: vp.width > vp.height ? 90 : 0 },
      });
      await sleep(250);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(shotDir, { recursive: true });
      const file = path.join(shotDir, vp.name.replace(/[^\\w\\u4e00-\\u9fa5]+/g, '_') + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    }
  }

  const pad = n => String(n).padStart(6);
  console.log('\\n=== 06/0.3.1 视口布局实测（高度 = 浏览器留给页面的高度）===');
  console.log('场景'.padEnd(40) + '视口高  文档高  溢出  pad高   pad宽  摄像头高  波形条高  旋钮高');
  for (const r of results) {
    console.log(
      r.name.padEnd(40) +
      pad(r.innerHeight) + pad(r.docScrollHeight) + pad(r.overflowsViewport ? 'YES' : 'no') +
      pad(r.xyPad ? r.xyPad.h : 'X') + pad(r.xyPad ? r.xyPad.w : 'X') +
      pad(r.cameraWindow ? r.cameraWindow.h : 'X') + pad(r.sampleStrip ? r.sampleStrip.h : 'X') +
      pad(r.coreParameters ? r.coreParameters.h : 'X') +
      (r.horizontalOverflow ? '  横向溢出!' : '')
    );
  }
  console.log('\\n--- 明细 ---');
  for (const r of results) {
    console.log(`\\n[${r.name}] innerHeight=${r.innerHeight} doc=${r.docScrollHeight} main=${r.mainHeight} (min-height:${r.mainMinHeight})`);
    console.log(`  mainRows      = ${r.mainRows}`);
    console.log(`  performance   = ${JSON.stringify(r.performance)}`);
    console.log(`  grid cols/rows= ${r.xyColumns} / ${r.xyRows}`);
    console.log(`  cameraGroup=${JSON.stringify(r.cameraGroup)} xyGroup=${JSON.stringify(r.xyGroup)}`);
    console.log(`  pad=${JSON.stringify(r.xyPad)} knobs=${JSON.stringify(r.coreParameters)}`);
    console.log(`  cameraWindow=${JSON.stringify(r.cameraWindow)} xyWindow=${JSON.stringify(r.xyWindow)}`);
    console.log(`  xyWindow rows=${r.xyWindowRows} minH=${r.xyWindowMinHeight} | cameraWindow minH=${r.cameraWindowMinHeight}`);
    console.log(`  xyGroup rows=${r.xyGroupRows} | vars(--min-pad=${r.minPadVar}, --min-camera=${r.minCameraVar})`);
  }
  // 顶栏对齐回归：中间那一列必须居中（历史上 0.3.2 移动端用 flex space-between +
  // 右侧 padding:10px，录制键被顶偏 5px）；0.3.2 另需流动贴左、播放贴右。
  console.log('\\n=== 顶栏对齐（中间列 vs header 中心）===');
  const misaligned = [];
  for (const r of results) {
    const h = r.header;
    const flowBad = h.flowInset !== null && !h.menuVisible && Math.abs(h.flowInset) > 1;
    const markBad = h.recordMarkOffset !== null && Math.abs(h.recordMarkOffset) > 1;
    const bad = Math.abs(h.midOffset) > 1 || flowBad || markBad
      || (h.playInset !== null && Math.abs(h.playInset) > 1);
    const extra = h.spread
      ? ` 录制标记偏移=${h.recordMarkOffset}px 流动内缩=${h.flowInset}px${h.menuVisible ? '(菜单在前，不适用)' : ''} 播放内缩=${h.playInset}px`
      : `（0.3.1 结构：录制/LIVE 在右侧，只查中间列）`;
    console.log(`  ${bad ? '★ ' : 'OK '}${r.name.padEnd(38)} display=${h.display.padEnd(5)} 中间列=${h.midName} 偏移=${h.midOffset}px${extra} 菜单=${h.menuVisible ? '显示' : '隐藏'}`);
    if (bad) misaligned.push(`${r.name}(中间列偏移 ${h.midOffset}px / 标记 ${h.recordMarkOffset} / 流动 ${h.flowInset} / 播放 ${h.playInset})`);
  }
  if (misaligned.length) { console.log('★ 顶栏没对齐：' + misaligned.join(', ')); process.exitCode = 1; }
  else console.log('OK: 中间列在所有视口都居中（±1px）；0.3.2 的录制标记居中、移动端流动贴左播放贴右。');

  console.log('\\n控制台错误: ' + (consoleErrors.length ? consoleErrors.join(' | ') : '无'));
  console.log('未捕获异常: ' + (exceptions.length ? exceptions.join(' | ') : '无'));

  // 布局改了行高以后，必须确认 XY pad 与四个旋钮仍然真的能操作（不是只有尺寸好看）。
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 610, screenWidth: 390, screenHeight: 800, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  });
  const loaded = new Promise(resolve => loadWaiters.push(resolve));
  await send('Page.navigate', { url: pageUrl });
  await Promise.race([loaded, sleep(6000)]);
  await sleep(400);
  const inter = await evaluate(INTERACT);
  console.log('\\n=== 交互回归（390x610 竖屏）===');
  console.log(`  XY pad 拖动: ${inter.padResponded ? '响应' : '★无响应★'}  ${JSON.stringify(inter.padMoved)}`);
  console.log(`  旋钮 ${inter.dial.id}: ${inter.dial.responded ? '响应' : '★无响应★'}  ${inter.dial.before} -> ${inter.dial.after}  命中区 ${inter.dialHitSize.w}x${inter.dialHitSize.h}px`);
  if (!inter.padResponded || !inter.dial.responded) process.exitCode = 1;

  console.log('\\n=== 录制按钮三态 ===');
  const states = [
    ['idle', () => {}],
    ['recording', () => { const b = document.getElementById('record'); b.setAttribute('aria-pressed', 'true'); }],
    ['disabled', () => { const b = document.getElementById('record'); b.setAttribute('aria-pressed', 'false'); b.disabled = true; }],
  ];
  for (const [name, apply] of states) {
    await evaluate(`(${apply.toString()})()`);
    await sleep(120);
    const info = await evaluate(RECORD_PROBE);
    console.log(`  ${name.padEnd(10)} mark=${info.mark.w}x${info.mark.h} dot=${info.dot.w}x${info.dot.h} radius=${info.dot.radius} bg=${info.dot.bg} display=${info.dot.display} pressed=${info.ariaPressed}`);
    if (shotDir) {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 64, scale: 3 } });
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, `record-${name}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  const idle = await evaluate(`(() => { const b = document.getElementById('record'); b.disabled = false; b.setAttribute('aria-pressed','false'); return null; })()`);
  void idle;

  // 引擎冒烟：页面加载的 engine.js 必须真能排程（同步自 0.3 后仍走 buffer 路径，
  // 不传第四个参数）。用 engine.events 增长作为「真的在排粒子」的证据。
  const audio = await evaluate(`(async () => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const buffer = Granular.demo(ctx);
    const params = { ...Granular.defaults };
    const engine = await Granular.create(buffer, params, 'probe-seed');
    const before = engine.events.length;
    engine.schedule();
    await new Promise(r => setTimeout(r, 400));
    const after = engine.events.length, active = engine.active, t = engine.time;
    params.density = 40;
    await engine.deactivate();
    return { before, after, active, time: t, hasOrigin: engine.events.some(e => 'origin' in e) };
  })()`);
  console.log('\\n=== 引擎冒烟（真实浏览器）===');
  console.log(`  事件 ${audio.before} -> ${audio.after}，活动声部 ${audio.active}，音频时钟 ${audio.time.toFixed(3)}s`);
  console.log(`  声音${audio.after > 0 ? '已排程' : '★未排程★'}；事件含 origin 字段: ${audio.hasOrigin}（本版不接实时输入，应为 false）`);
  if (audio.after <= 0) process.exitCode = 1;
  if (audio.hasOrigin) { console.log('★ 意外：出现了只在实时输入路径才有的 origin 字段'); process.exitCode = 1; }

  // iOS 全屏适配：四条硬要求（对照用户给的验收清单）
  const fs0 = results[0].fullscreen;
  // 颜色比较要先归一：CSS 里写 #deded5，计算值是 rgb(222, 222, 213)，直接比字符串会误报。
  const rgb = c => {
    const s = String(c).replace(/\s+/g, '');
    const hex = /^#([0-9a-f]{6})$/i.exec(s);
    if (hex) { const n = parseInt(hex[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    const m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) return m[1].split(',').slice(0, 3).map(x => Math.round(parseFloat(x)));
    return [s];
  };
  const norm = c => rgb(c).join(',');
  const fsProblems = [];
  if (!/viewport-fit=cover/.test(fs0.viewport || '')) fsProblems.push('viewport 缺 viewport-fit=cover');
  if (norm(fs0.htmlBg) !== norm(fs0.mainBg)) fsProblems.push(`画布色(${fs0.htmlBg}) 与主容器底色(${fs0.mainBg}) 不一致`);
  if (norm(fs0.bodyBg) !== norm(fs0.mainBg)) fsProblems.push(`body 底色(${fs0.bodyBg}) 与主容器底色不一致`);
  if (norm(fs0.themeColor) !== norm(fs0.mainBg)) fsProblems.push(`theme-color(${fs0.themeColor}) 与主容器底色(${fs0.mainBg}) 不一致`);
  if (fs0.bodyPadding !== '0px/0px') fsProblems.push(`body 不该留 safe-area padding（现在是 ${fs0.bodyPadding}）`);
  console.log('\n=== iOS 全屏适配 ===');
  console.log(`  viewport: ${fs0.viewport}`);
  console.log(`  画布色 html=${fs0.htmlBg}  body=${fs0.bodyBg}  main=${fs0.mainBg}  theme-color=${fs0.themeColor}`);
  console.log(`  safe-area: body padding=${fs0.bodyPadding}（应为 0）  main padding-top=${fs0.mainPaddingTop} bottom=${fs0.mainPaddingBottom}`);
  console.log(`  ${fsProblems.length ? '★ ' + fsProblems.join('；') : 'OK：画布/body/主容器/theme-color 四色一致，viewport-fit=cover，safe-area 只加在内容容器上'}`);
  if (fsProblems.length) process.exitCode = 1;
  // 页面必须铺满可视区（iOS 工具栏收放引起的空白带就靠这条抓）
  const gaps = results.map(r => ({ name: r.name, ...r.viewportGap }));
  console.log('\n=== 铺满检查（页面与可视区的关系）===');
  for (const g of gaps) {
    const pad = g.gapBottom <= 1 && g.gapTop <= 1;
    console.log(`  ${pad ? 'OK：' : '★ 未铺满：'}${g.name} innerHeight=${g.innerHeight} main=${g.mainTop}…${g.mainBottom} 下空隙=${g.gapBottom} 文档高=${g.docScrollHeight}`);
  }
  console.log(`  单位取值（本机 Chrome 无头里通常全部相等，量不出 iOS 差异）: ${JSON.stringify(gaps[0].units)}`);
  const notFilled = gaps.filter(g => g.gapBottom > 1 || g.gapTop > 1);
  if (notFilled.length) { console.log('★ ' + notFilled.length + ' 个视口页面没铺满'); process.exitCode = 1; }

  const thinnest = results.filter(r => r.xyPad).reduce((a, b) => (a.xyPad.h <= b.xyPad.h ? a : b));
  console.log(`\\n最薄的 pad: ${thinnest.xyPad.h}px @ ${thinnest.name}`);

  // 回归断言：pad 不能再被压成一条（历史上竖屏会掉到 0，横屏恒 110 但整页被 min-height 钉住）。
  const collapsed = results.filter(r => r.xyPad && r.xyPad.h < 80);
  if (collapsed.length) {
    console.log('★ 失败：以下视口把 XY pad 压到 80px 以下 → ' + collapsed.map(r => `${r.name}=${r.xyPad.h}px`).join(', '));
    process.exitCode = 1;
  } else {
    console.log('OK: 所有视口的 pad 都 ≥ 80px，没有被压成一条。');
  }

  await send('Browser.close').catch(() => {});
  await cleanup();
  process.exit(0);
};

main().catch(async error => { console.error(error); await cleanup(); process.exit(1); });
