#!/usr/bin/env node
/**
 * 小工具静态合规扫描（Skill 的 audit_artifact.* 只查包体/体积，语义规则要靠清单逐项核对，
 * 这份脚本把那几条清单变成可复跑的检查）。
 *
 *   node tools/compat-scan.mjs ../src          # 扫打包源目录
 *   node tools/compat-scan.mjs ../src --json   # 机器可读
 *
 * 覆盖：
 *   · 容器禁用 API / 行为（device-capabilities.md §6 扫描清单）
 *   · Chrome 61 / ES2017 之外的 JS 语法（js-compatibility.md §1：ES2018+ 须由构建链转译，
 *     本仓库无构建链，所以一律视为违规）
 *   · Chrome 61 不可作为唯一实现的 CSS（css-compatibility.md §2）
 *   · 资源引用规则（zip-artifact-spec.md §3/§4：无内联脚本、无行内事件、无外部 URL、经典脚本）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const asJson = process.argv.includes('--json');
if (!fs.existsSync(root)) { console.error('路径不存在: ' + root); process.exit(2); }

const TEXT = new Set(['.html', '.css', '.js', '.json']);
const ALLOWED = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2']);
const BANNED_FILES = ['node_modules', '.git', '.DS_Store'];

// 每条：[分类, 正则, 说明]
const JS_RULES = [
  ['禁用 API', /\bfetch\s*\(/, '网络请求（容器不联网）'],
  ['禁用 API', /\bXMLHttpRequest\b/, '网络请求（容器不联网）'],
  ['禁用 API', /new\s+WebSocket\s*\(/, '实时通信已禁用'],
  ['禁用 API', /new\s+EventSource\s*\(/, 'SSE 已禁用'],
  ['禁用 API', /new\s+RTCPeerConnection\s*\(/, 'WebRTC 已禁用'],
  ['禁用 API', /navigator\.geolocation/, '定位已禁用'],
  ['禁用 API', /navigator\.clipboard/, '剪贴板已禁用'],
  ['禁用 API', /document\.execCommand\s*\(\s*['"](copy|cut|paste)/, 'execCommand 复制已禁用'],
  ['禁用 API', /navigator\.(bluetooth|usb|hid|serial)/, '硬件连接已禁用'],
  ['禁用 API', /navigator\.getBattery|navigator\.connection|navigator\.credentials|navigator\.locks/, '设备信息 / 凭据已禁用'],
  ['禁用 API', /navigator\.mediaDevices\.(enumerateDevices|getDisplayMedia)/, '设备枚举 / 屏幕共享已禁用'],
  ['禁用 API', /navigator\.storage\.persist|navigator\.serviceWorker/, '持久化存储 / Service Worker 已禁用'],
  ['禁用 API', /new\s+(Shared)?Worker\s*\(/, 'Web Worker 已禁用'],
  ['禁用 API', /DeviceMotionEvent|DeviceOrientationEvent|devicemotion|deviceorientation/, '传感器已禁用'],
  ['禁用 API', /requestFullscreen|webkitRequestFullscreen/, '全屏由容器管理'],
  ['禁用行为', /\beval\s*\(|new\s+Function\s*\(/, '动态执行代码已禁用'],
  ['禁用行为', /WebAssembly\./, 'WASM 已禁用'],
  ['禁用行为', /window\.open\s*\(|window\.prompt\s*\(/, '弹窗 / 新窗口已禁用'],
  ['禁用行为', /location\.(href\s*=|assign\s*\()/, '跳转站外已禁用'],
  ['语法·ES2018+', /\?\.[A-Za-z_$[(]/, '可选链 ?. 是 ES2020，须转译'],
  ['语法·ES2018+', /\?\?/, '空值合并 ?? 是 ES2020，须转译'],
  ['语法·ES2018+', /\{\s*\.\.\./, '对象 spread 是 ES2018，须转译'],
  ['语法·ES2018+', /catch\s*\{/, '可选 catch 绑定是 ES2019，须转译'],
  ['语法·ES2018+', /\|\|=|&&=|\?\?=/, '逻辑赋值是 ES2021，须转译'],
  ['语法·ES2018+', /#[A-Za-z_$][\w$]*\s*[=(]/, 'class 私有字段是 ES2022，须转译'],
  ['运行时 API', /structuredClone|Object\.hasOwn|globalThis/, 'ES2020+ 运行时 API，须能力检测或改写'],
  ['运行时 API', /\.flatMap?\s*\(|Object\.fromEntries|\.matchAll\s*\(|\.replaceAll\s*\(|\.at\s*\(/, 'ES2019+ 运行时 API，基线不可用'],
  ['运行时 API', /Promise\.(allSettled|any)\b/, 'ES2020+ 运行时 API'],
  ['运行时 API', /\.roundRect\s*\(/, 'Canvas roundRect 是 Chrome 99+'],
  ['模块', /^\s*(import|export)\s/m, '容器要求经典脚本，不要 import / export'],
];

const HTML_RULES = [
  ['资源加载', /<script(?![^>]*\bsrc=)[^>]*>(?!\s*<\/script>)/i, '内联 <script> 被 CSP 禁止，JS 必须外置'],
  ['资源加载', /\son[a-z]+\s*=/i, '行内事件处理器被禁用，改用 addEventListener'],
  ['资源加载', /javascript:/i, 'javascript: URI 被禁用'],
  ['资源加载', /<script[^>]*type\s*=\s*["']module["']/i, '不要 type="module"（离线 zip 下 module 解析不可靠）'],
  ['资源加载', /<base\b|<iframe\b|<object\b/i, '<base> / <iframe> / <object> 被禁用'],
  ['资源加载', /<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy/i, '不要自建 CSP（由容器统一管理）'],
  ['外部资源', /(?:src|href)\s*=\s*["']https?:\/\//i, '外部资源加载不到，须打包进 zip'],
];

const CSS_RULES = [
  ['Chrome 61', /\binset\s*:/, 'inset 简写晚于 61，改用 top/right/bottom/left'],
  ['Chrome 61', /\b(?:min|max|clamp)\s*\(/, 'min()/max()/clamp() 晚于 61，先写固定值或 calc()'],
  ['Chrome 61', /\b(?:margin-inline|margin-block|padding-inline|padding-block|inset-inline|inset-block)\b/, '逻辑属性晚于 61，改用物理属性'],
  ['Chrome 61', /\baspect-ratio\s*:/, 'aspect-ratio 晚于 61，用 padding-top 比例盒'],
  ['Chrome 61', /\boverflow\s*:\s*clip\b/, 'overflow: clip 晚于 61，用 hidden'],
  ['Chrome 61', /:has\s*\(/, ':has() 晚于 61，改由 JS 切 class'],
  ['Chrome 61', /:focus-visible/, ':focus-visible 晚于 61，先给 :focus 基线再增强'],
  ['Chrome 61', /@container|@layer|@property\b/, 'Container Queries / @layer / @property 须展开'],
  ['Chrome 61', /\b(?:dvh|svh|lvh)\b/, '动态视口单位晚于 61，用 100vh + JS 变量'],
  ['Chrome 61', /\b(?:color-mix|oklab|oklch|lab|lch)\s*\(/, '现代颜色晚于 61，先写 hex/rgb'],
  ['Chrome 61', /backdrop-filter/, 'backdrop-filter 晚于 61，模糊只能当增强'],
  ['Chrome 61', /text-wrap\s*:|color-scheme\s*:/, '现代排版 / color-scheme 晚于 61'],
  ['Chrome 61', /:is\s*\(|:where\s*\(/, ':is()/:where() 晚于 61'],
  // Flex gap 不在这里查：见下面按行判断的专用逻辑（要区分 grid-gap 与 .supports-flex-gap 门控）
];

const FLEX_GAP_HINT = /display\s*:\s*(inline-)?flex/;

// 注释里的「反面例子」（比如注释里写「Chrome 61 没有 dvh / :focus-visible」）不能算违规，
// 所以先按行把注释内容抹成空白（保留行号），再匹配规则。
function stripComments(text, ext) {
  if (ext === '.css') return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  if (ext === '.js') {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  }
  if (ext === '.html') return text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  return text;
}

// Flex gap：只查**裸 gap**（grid-gap 是 Chrome 61 可解析的写法），
// 以及没被 .supports-flex-gap 门控的 row-gap / column-gap。
const GAP_BARE = /(?<![\w-])gap\s*:/;
const GAP_ROW_COL = /(?<![\w-])(?:row|column)-gap\s*:/;

function walk(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

const files = walk(root);
const problems = [];
const add = (file, line, category, note, text) => problems.push({ file, line, category, note, text: text.trim().slice(0, 120) });

for (const rel of files) {
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  if (BANNED_FILES.includes(base)) add(rel, 0, '包结构', '禁止出现在 zip 内', base);
  if (!ALLOWED.has(ext)) add(rel, 0, '包结构', 'zip 只允许 .html/.css/.js/.json/图片/woff', ext || '(无扩展名)');
  if (!TEXT.has(ext)) continue;
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = stripComments(raw, ext).split('\n');
  const rules = ext === '.js' ? JS_RULES : ext === '.html' ? HTML_RULES : ext === '.css' ? CSS_RULES : [];
  lines.forEach((line, i) => {
    for (const [category, re, note] of rules) if (re.test(line)) add(rel, i + 1, category, note, raw.split('\n')[i]);
  });
}

// flex gap 需要单独判断：裸 gap 一律标出；row-gap / column-gap 只在没有被
// .supports-flex-gap 门控时才算违规（那条增强规则正是参考文档推荐的写法）。
const cssFiles = files.filter(f => f.toLowerCase().endsWith('.css'));
for (const rel of cssFiles) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = stripComments(raw, '.css').split('\n');
  lines.forEach((line, i) => {
    const gated = line.includes('supports-flex-gap');
    if (GAP_BARE.test(line)) {
      const hasFlex = FLEX_GAP_HINT.test(line);
      add(rel, i + 1, 'Flex gap', hasFlex ? 'flex 容器里的裸 gap（基线必须用子项 margin）' : '裸 gap：flex 容器请改 margin 基线，Grid 请写 grid-gap', raw.split('\n')[i]);
    } else if (GAP_ROW_COL.test(line) && !gated) {
      add(rel, i + 1, 'Flex gap', 'row-gap / column-gap 只在 .supports-flex-gap 门控下使用', raw.split('\n')[i]);
    }
  });
}

// 入口检查
if (!files.includes('index.html')) add('index.html', 0, '包结构', 'index.html 必须在包根目录（唯一入口）', '');

const order = ['包结构', '禁用 API', '禁用行为', '模块', '资源加载', '外部资源', '语法·ES2018+', '运行时 API', 'Chrome 61', 'Flex gap'];
problems.sort((a, b) => (order.indexOf(a.category) - order.indexOf(b.category)) || a.file.localeCompare(b.file) || a.line - b.line);

if (asJson) {
  console.log(JSON.stringify({ root, files: files.length, problems }, null, 1));
} else {
  const byCat = new Map();
  for (const p of problems) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  console.log('扫描目录: ' + root + '（' + files.length + ' 个文件）');
  if (!problems.length) console.log('PASS: 未发现违规项');
  for (const [cat, list] of byCat) {
    console.log('\n[' + cat + '] ' + list.length + ' 处');
    for (const p of list) console.log(`  ${p.file}:${p.line}  ${p.note}\n      ${p.text}`);
  }
  console.log('\n合计 ' + problems.length + ' 处');
}
process.exit(problems.length ? 1 : 0);
