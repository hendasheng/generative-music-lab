// 验证新建的隧道确实在服务 0.3.2：入口、全部被引用资源、相对路径是否 404。
// 用法：node tools/verify-032.mjs <base-url>
const base = (process.argv[2] || 'https://campbell-lips-proceedings-promptly.trycloudflare.com').replace(/\/$/, '');
const dir = '/exercises/06-granular/0.3.2';
const entry = dir + '/index.html';

const files = [
  entry,
  dir + '/app.js', dir + '/engine.js', dir + '/camera.js', dir + '/mobile.js',
  dir + '/flow.js', dir + '/recorder.js', dir + '/style.css',
  '/shared/exercise-controls.js',
  '/exercises/06-granular/',           // 06 首页（应重定向到 0.3.2）
  '/',                                 // 仓库首页
];

let bad = 0;
console.log('=== 资源可达性 ===');
for (const f of files) {
  try {
    const r = await fetch(base + f, { headers: { 'cache-control': 'no-cache' } });
    const len = (await r.arrayBuffer()).byteLength;
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'OK  ' : '★FAIL'} ${r.status} ${(len / 1024).toFixed(1)}KB cf-ray=${r.headers.get('cf-ray') ?? '-'} ${f}`);
  } catch (e) { bad++; console.log(`★FAIL ${f} → ${e.message}`); }
}

const page = await (await fetch(base + entry, { headers: { 'cache-control': 'no-cache' } })).text();
console.log('\n=== 页面内容核对 ===');
const checks = [
  ['是 0.3.2', /0\.3\.2/.test(page)],
  ['不再引用 live.js', !/live\.js/.test(page)],
  ['没有 LIVE 按钮', !/liveInput/.test(page)],
  ['引用 camera.js', /camera\.js/.test(page)],
  ['脚本顺序 流动→录制→播放', page.indexOf('id="freeFlow"') < page.indexOf('id="record"') && page.indexOf('id="record"') < page.indexOf('id="mainPlay"')],
  ['菜单按钮仍在（移动端由 CSS 隐藏）', /id="menuToggle"/.test(page)],
];
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'OK  ' : '★'} ${name}`); }

const refs = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:|^#/.test(u));
console.log(`\n=== 页面引用的 ${refs.length} 个相对路径 ===`);
for (const ref of refs) {
  const u = base + dir + '/' + ref;
  try {
    const r = await fetch(u);
    if (!r.ok) bad++;
    console.log(`  ${r.ok ? 'OK  ' : '★404'} ${r.status} ${ref}`);
  } catch (e) { bad++; console.log(`  ★FAIL ${ref} → ${e.message}`); }
}

console.log(bad ? `\n★ 有 ${bad} 项失败` : '\n全部通过：新隧道服务的就是 0.3.2，相对路径无 404。');
process.exit(bad ? 1 : 0);
