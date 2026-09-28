// 摄像头开启不能改变布局：这是 0.3.1 的固定回归项。
//
// 起因：<video> 有固有宽高比（1280×720），一旦它参与网格轨道计算，开启摄像头就会把
// 相机窗顶高、把 XY pad 挤小、整页开始滚动——实测 168.5 -> 206.8px，pad 171.5 -> 155px。
// 修法：video 用 position:absolute 填充（见 style.css），比例不再参与轨道计算。
//
// 检查内容：三个视口 × 开启前后，逐项比对布局量；任何一项变化即失败。
//   node exercises/06-granular/tools/camera-layout-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// 版本可通过 --version 指定（默认 0.3.1）。0.3.2 去掉了实时输入与移动端菜单按钮，
// 它的探针会跳过 LIVE 相关断言（见文件内的 hasLive 判断）。
const APP_VERSION = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : '0.3.1';
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const port = 9344;

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

const VIEWPORTS = [
  { name: '竖屏 390x610（栏吃掉后）', width: 390, height: 610, screenHeight: 800, mobile: true },
  { name: '竖屏 390x780（屏 844，栏吃 64）', width: 390, height: 780, screenHeight: 844, mobile: true },
  { name: '横屏 844x330', width: 844, height: 330, screenHeight: 390, mobile: true },
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cam-'));
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

// 用画布流替换 getUserMedia，走真实的 video.srcObject + play() 路径。
const FAKE_CAMERA = `(() => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(0, 0, 1280, 720);
  const stream = c.captureStream(24);
  const track = stream.getVideoTracks()[0];
  const real = track.getSettings.bind(track);
  track.getSettings = () => ({ ...real(), facingMode: 'environment' });
  navigator.mediaDevices.getUserMedia = async () => stream;
  return 'hooked';
})()`;

// 只量会被 video 比例影响的东西（不含必然变化的 videoWidth/status）。
// 波形已改为浮在摄像头窗口底部的浮层，所以量它的下沿与窗口下沿是否对齐。
const SNAP = `(() => {
  const h = sel => { const e = document.querySelector(sel); return e ? +e.getBoundingClientRect().height.toFixed(1) : null; };
  const strip = document.querySelector('.sample-strip');
  const win = document.querySelector('.camera-window');
  const sb = strip?.getBoundingClientRect(), wb = win.getBoundingClientRect();
  return {
    cameraWindow: +wb.height.toFixed(1),
    cameraGroup: h('.camera-group'),
    waveOverlayHeight: sb ? +sb.height.toFixed(1) : null,
    // 「低对齐」：浮层底边应贴住窗口底边（窗口有 1px 边框，所以容差 2px）
    waveBottomGap: sb ? +(wb.bottom - sb.bottom).toFixed(1) : null,
    // 浮层必须是摄像头窗的后代（曾经因为包装层丢失，canvas 裸露在 section 里）
    waveInsideWindow: sb ? win.contains(strip) : false,
    waveTexts: strip ? strip.querySelectorAll('canvas, input').length : 0,
    // 窗内图标默认隐藏（不常驻），点窗口才出现
    controlsHidden: win.classList.contains('controls-hidden'),
    xyWindow: h('.xy-window'),
    xyPad: h('#xy-pad, .xy-pad'),
    coreParameters: h('#coreParameters'),
    docHeight: document.documentElement.scrollHeight,
    // 窗内两个图标：必须 ≥44 命中区，且两个图标不能同形（都在相机窗里，撞脸就分不清）
    camIcons: ['cameraToggle', 'cameraFlip'].map(id => {
      const b = document.getElementById(id), s = b.querySelector('svg');
      const bb = b.getBoundingClientRect(), sb = s.getBoundingClientRect();
      return { id, btn: +bb.width.toFixed(1), icon: +sb.width.toFixed(1), shapes: s.querySelectorAll('path,circle').length };
    }),
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

  let failures = 0;
  console.log('\n=== 摄像头开启前后布局稳定性 ===');
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, screenWidth: vp.width, screenHeight: vp.screenHeight,
      deviceScaleFactor: 2, mobile: vp.mobile,
      screenOrientation: { type: vp.width > vp.height ? 'landscapePrimary' : 'portraitPrimary', angle: vp.width > vp.height ? 90 : 0 },
    });
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const loaded = new Promise(r => loadWaiters.push(r));
    await send('Page.navigate', { url: pageUrl });
    await Promise.race([loaded, sleep(6000)]);
    await sleep(350);

    await evaluate(FAKE_CAMERA);
    const before = await evaluate(SNAP);

    // 窗内控件：默认收起 → 点窗口显示 → 再点隐藏（**所有状态都要能切**）。
    // ★ 测 .camera-actions 这个容器，不要测 #cameraToggle：display:none 加在容器上，
    //   #cameraToggle 自己在 CSS 里恒为 display:grid，测它会永远得到「可见」。
    const visNow = () => evaluate(`(() => {
      const box = getComputedStyle(document.querySelector('.camera-actions')).display !== 'none';
      const flip = getComputedStyle(document.getElementById('cameraFlip')).display !== 'none';
      return { toggle: box && getComputedStyle(document.getElementById('cameraToggle')).display !== 'none', flip: box && flip };
    })()`);
    const tapWindow = () => evaluate(`(() => { const w = document.querySelector('.camera-window');
      w.dispatchEvent(new MouseEvent('click', { bubbles: true })); return null; })()`);

    const idle0 = await visNow();                 // 未打开：必须常驻
    await tapWindow();
    const idle1 = await visNow();                 // 未打开时点窗口**不应**隐藏
    await tapWindow();
    const idle2 = await visNow();                 // 再点仍应常驻
    const cameraOpened = await evaluate(`(async () => {
      const toggle = document.getElementById('cameraToggle');
      const reachable = getComputedStyle(toggle).display !== 'none';
      if (reachable) toggle.click();
      await new Promise(r => setTimeout(r, 1000));
      return { reachable, pressed: toggle.getAttribute('aria-pressed'), videoWidth: document.getElementById('cameraVideo').videoWidth };
    })()`);
    const after = await evaluate(SNAP);
    const active1 = await visNow();               // 打开后应展开（相机 + 切换镜头）
    await tapWindow();
    const active2 = await visNow();               // 打开后点一下应收起
    await tapWindow();
    const active3 = await visNow();               // 再点应恢复 —— 关闭入口必须回得来

    // camIcons / controlsHidden 是派生态，单独断言，不参与「开启前后布局」的扁平比对。
    const changed = Object.keys(before).filter(k => !['camIcons', 'controlsHidden'].includes(k) && before[k] !== after[k]);
    console.log(`\n[${vp.name}]`);
    console.log(`  开启前 相机窗 ${before.cameraWindow} / pad ${before.xyPad} / 文档高 ${before.docHeight}`);
    console.log(`  开启后 相机窗 ${after.cameraWindow} / pad ${after.xyPad} / 文档高 ${after.docHeight}`);
    if (changed.length) {
      failures++;
      console.log(`  ★ 布局被改变：${changed.map(k => `${k} ${before[k]} -> ${after[k]}`).join('，')}`);
    } else {
      console.log('  OK：所有布局量不变');
    }
    if (!cameraOpened.reachable || cameraOpened.pressed !== 'true' || cameraOpened.videoWidth <= 0) {
      failures++;
      console.log(`  ★ 摄像头没开成：相机可见=${cameraOpened.reachable} pressed=${cameraOpened.pressed} videoWidth=${cameraOpened.videoWidth}`);
    } else {
      console.log(`  OK：点相机→预览就绪（videoWidth ${cameraOpened.videoWidth}）`);
    }
    const visProblems = [];
    if (!idle0.toggle) visProblems.push('未打开时相机图标不可见');
    if (idle0.flip) visProblems.push('未打开时切换镜头应当隐藏');
    if (!idle1.toggle || !idle2.toggle) visProblems.push('未打开时点窗口不应隐藏（要常驻）');
    if (!active1.toggle || !active1.flip) visProblems.push('打开后相机与切换镜头都应可见');
    if (active2.toggle) visProblems.push('打开后点一下应收起');
    if (!active3.toggle) visProblems.push('打开后再点没恢复（会关不掉摄像头）');
    if (visProblems.length) {
      failures++;
      console.log(`  ★ 窗内图标显隐：${visProblems.join('，')}`);
    } else {
      console.log('  OK：未打开时图标常驻（点窗口也不隐藏）→ 打开后可点窗口收起/再展开');
    }

    // 波形浮层必须存在、在摄像头窗内、且底边贴合窗口底边。
    // 曾经因为改 HTML 时把 .sample-strip 包装层弄丢，canvas 裸露后按固有尺寸铺开、
    // 几乎盖住整个摄像头；那时这两个字段静默返回 null，没有断言就漏过去了。
    const w = after.waveOverlayHeight, gap = after.waveBottomGap;
    if (after.waveInsideWindow !== true || after.waveTexts < 2 || w === null || w > 80 || Math.abs(gap) > 2) {
      failures++;
      console.log(`  ★ 波形浮层异常：在摄像头窗内=${after.waveInsideWindow} 内含 canvas+input=${after.waveTexts} 高度=${w} 与窗口底边差=${gap}（应 ≤80px、差 ≤2px）`);
    } else {
      console.log(`  OK：波形浮层在摄像头窗内，高 ${w}px，底边对齐（差 ${gap}px）`);
    }

  }

  console.log('\n控制台错误: ' + (errors.length ? errors.join(' | ') : '无'));
  console.log(failures ? `\n★ ${failures} 个视口开启摄像头后布局被改变。` : '\n全部通过：开启摄像头不改变布局。');
  await send('Browser.close').catch(() => {});
  await cleanup();
  process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
