#!/usr/bin/env node
// 本仓库的最小静态服务器，给 cloudflared 隧道 / 手机真机访问用。
// 用 node 内置模块自建，不依赖 python：AGENTS.md 记过 `python -m http.server` 的坑——
// job_kill 掉后台任务只杀 pwsh，python 子进程会活下来继续占端口；node 直接跑就没有这层。
//
//   node tools/serve.cjs 8765              # 服务仓库根，默认端口 8765
//   node tools/serve.cjs 0                 # 让系统分配端口（会打印实际端口）
//
// 关键约束：**必须从仓库根提供服务**。0.3.1 的 index.html 引用
// `../../../shared/exercise-controls.js`，只发布 0.3.1/ 一个目录会让共享控件 404。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('bad request'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(repoRoot, pathname);
  // 目录穿越防护：解析后必须仍在仓库内
  if (!file.startsWith(repoRoot + path.sep) && file !== repoRoot) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      // 无缓存：手机上量的是刚改过的版本，不是启发式缓存里的旧页面。
      'Cache-Control': 'no-store, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port;
  console.log(`serving ${repoRoot}`);
  console.log(`  http://127.0.0.1:${actual}/exercises/06-granular/0.3.2/index.html`);
  console.log('PORT=' + actual);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
