// 验证 cloudflared 公网地址是否真的能取到仓库页面，并且页面引用的相对路径都能解析。
const base = process.argv[2];
const entry = '/exercises/06-granular/0.3.1/index.html';
if (!base) { console.error('用法: node verify-tunnel.mjs <base-url>'); process.exit(1); }

const paths = [
  entry,
  '/shared/exercise-controls.js',
  '/exercises/06-granular/0.3.1/style.css',
  '/exercises/06-granular/0.3.1/engine.js',
  '/exercises/06-granular/0.3.1/flow.js',
  '/exercises/06-granular/0.3.1/recorder.js',
  '/exercises/06-granular/0.3.1/camera.js',
  '/exercises/06-granular/0.3.1/mobile.js',
  '/exercises/06-granular/0.3.1/app.js',
  '/',
];

let failures = 0;
for (const p of paths) {
  try {
    const r = await fetch(base + p, { redirect: 'follow' });
    const bytes = (await r.arrayBuffer()).byteLength;
    const ok = r.ok;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : '★FAIL'} ${r.status} ${(bytes / 1024).toFixed(1)}KB cf-ray=${r.headers.get('cf-ray') ?? '-'} ${p}`);
  } catch (error) {
    failures++;
    console.log(`★FAIL ${p} -> ${error.message}`);
  }
}

const page = await (await fetch(base + entry)).text();
const refs = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:|^#/.test(u));
console.log(`\n页面引用的相对路径 ${refs.length} 个：`);
for (const ref of refs) {
  const url = base + '/exercises/06-granular/0.3.1/' + ref;
  try {
    const r = await fetch(url);
    if (!r.ok) failures++;
    console.log(`  ${r.ok ? 'OK  ' : '★404'} ${r.status} ${ref}`);
  } catch (error) {
    failures++;
    console.log(`  ★FAIL ${ref} -> ${error.message}`);
  }
}

// 去掉查询串再比一个版本标记，确认不是缓存里的旧样式。
console.log(`\n页面指向: ${/style\.css\?v=031-4/.test(page) ? 'style.css v=031-4（最新，含录制按钮白点与纵向布局修正）' : '★ 不是最新版本'}`);
console.log(failures === 0 ? '\n全部通过：公网地址可用，相对路径无 404。' : `\n★ 有 ${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
