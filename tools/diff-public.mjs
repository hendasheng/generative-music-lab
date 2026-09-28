// 逐条隧道查：它指向哪个本地端口、那个端口返回的是不是最新版。
import fs from 'node:fs';

const TUNNELS = [
  { name: '我新开的 (PID 105720)', metrics: 20243 },
  { name: '你原有的 #1 (PID 40216)', metrics: 20241 },
  { name: '你原有的 #2 (PID 87204)', metrics: 20242 },
];

// 最新版的判别特征
const MARKERS = {
  'LIVE 无描边类名': /live-mark/,
  'Lucide camera 路径': /M13\.997 4a2 2 0 0 1 1\.76/,
  '无 GRANULAR 标题': h => !/class="brand"/.test(h),
  '样式版本': h => (h.match(/style\.css\?v=([\w-]+)/) || [])[1] ?? '无',
};

const local = fs.readFileSync('exercises/06-granular/0.3.1/index.html', 'utf8');
const cssLocal = fs.readFileSync('exercises/06-granular/0.3.1/style.css', 'utf8');

for (const t of TUNNELS) {
  console.log(`\n=== ${t.name} ===`);
  let host = null, service = null;
  try {
    host = (await (await fetch(`http://127.0.0.1:${t.metrics}/quicktunnel`, { signal: AbortSignal.timeout(4000) })).json()).hostname;
    const cfg = await (await fetch(`http://127.0.0.1:${t.metrics}/config`, { signal: AbortSignal.timeout(4000) })).json();
    service = cfg.config?.ingress?.[0]?.service ?? '(未知)';
  } catch (e) { console.log('  读不到 metrics：' + e.message); continue; }

  console.log(`  本地目标: ${service}`);
  console.log(`  公网地址: https://${host}`);

  const url = `https://${host}/exercises/06-granular/0.3.1/index.html`;
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    const html = await r.text();
    console.log(`  该地址取 0.3.1/index.html -> HTTP ${r.status}`);
    if (r.status !== 200) { console.log(`  内容片段: ${html.slice(0, 120).replace(/\s+/g, ' ')}`); continue; }
    for (const [label, test] of Object.entries(MARKERS)) {
      const v = typeof test === 'function' ? test(html) : test.test(html);
      console.log(`    ${label}: ${v}`);
    }
    const same = html === local;
    console.log(`    与本地 index.html 逐字节一致: ${same ? '是 ✓' : '★ 否'}`);
    try {
      const cssRemote = await (await fetch(`https://${host}/exercises/06-granular/0.3.1/style.css`, { signal: AbortSignal.timeout(15000) })).text();
      console.log(`    style.css 与本地一致: ${cssRemote === cssLocal ? '是 ✓' : '★ 否'}（${cssRemote.length} vs ${cssLocal.length} 字节）`);
    } catch { console.log('    style.css 取不到'); }
  } catch (e) {
    console.log(`  ★ 取不到页面: ${e.message}`);
  }
}
