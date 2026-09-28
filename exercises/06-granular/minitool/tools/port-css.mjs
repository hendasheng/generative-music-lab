#!/usr/bin/env node
/**
 * 一次性移植工具：把 style.css 改成 Chrome 61 基线 + 容器安全区写法。
 *
 *   node tools/port-css.mjs
 *
 * 依据 css-compatibility.md §2/§4 与 cross-platform-h5.md §3：
 *   · inset / min() / max() / :has() / :focus-visible / color-scheme / dvh 都是 Chrome 61 之后的能力
 *   · Flex gap 基线用子项 margin，增强由 boot.js 的行为检测切 .supports-flex-gap
 *   · Grid 间距写 grid-gap（Chrome 61 可解析）
 *   · 安全区用 var(--safe-area-inset-*, …) 组合，且**不把 env() 放进 var() 的 fallback**
 *     （Chrome 61 上会让整条声明 invalid at computed-value time，把基线值一起丢掉）
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '../src/style.css');

const FLEX_GAP_BLOCK = `/* Flex gap 在 Chrome 61 不生效（css-compatibility.md §4）：基线用**子项单边 margin**，
   boot.js 做布局行为检测后给 <html> 加 .supports-flex-gap，再切到 column-gap/row-gap。
   ★ 只用 CSS.supports('gap','1px') / @supports (gap:1px) 不够 —— 它们证明不了 Flex 里真的生效。 */
`;

const edits = [
  {
    note: ':root：容器字体栈 + 去掉 color-scheme + 安全区变量层',
    find: `:root{font-family:Arial,"Microsoft YaHei",sans-serif;color:#252624;background:#deded5;--line:#b5b5ad;--mono:Consolas,monospace;-webkit-tap-highlight-color:transparent;color-scheme:light}`,
    replace: `:root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;color:#252624;background:#deded5;--line:#b5b5ad;--mono:Consolas,monospace;-webkit-tap-highlight-color:transparent;--app-height:100vh;--safe-top:0px;--safe-right:0px;--safe-bottom:0px;--safe-left:0px}
/* 安全区（cross-platform-h5.md §3）：容器在 PC 模拟器注入 --safe-area-inset-*，真机是 env() 真值。
   先按「容器注入变量 → 0」取值；再用 @supports 让认识 env() 的内核优先 env()。
   ★ 不要把 env() 直接写进 var() 的 fallback —— Chrome 61 不认识 env()，
   那样整条声明会 invalid at computed-value time，连基线的 0 都保不住。 */
:root{--safe-top:var(--safe-area-inset-top,0px);--safe-right:var(--safe-area-inset-right,0px);--safe-bottom:var(--safe-area-inset-bottom,0px);--safe-left:var(--safe-area-inset-left,0px)}
@supports (padding-top:env(safe-area-inset-top)){
  :root{--safe-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));--safe-right:var(--safe-area-inset-right,env(safe-area-inset-right,0px));--safe-bottom:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px));--safe-left:var(--safe-area-inset-left,env(safe-area-inset-left,0px))}
}
/* 触摸端基线（cross-platform-h5.md §1）：禁掉双击缩放与长按菜单。 */
html{touch-action:manipulation;height:100%}`,
  },
  {
    note: 'body / main：dvh→vh+--app-height、物理内边距、grid-gap',
    find: `:root{--accent:#ed5b2a;--accent-reverse:#f37944;--accent-soft:#ffd9c6}*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#deded5}main{max-width:980px;margin:auto;background:#deded5;min-height:100dvh;--min-camera:150px;--wave-h:56px;--min-knobs:84px;--min-pad:185px;padding:env(safe-area-inset-top) max(12px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(12px,env(safe-area-inset-left));display:grid;grid-template-rows:auto minmax(0,1fr);gap:8px}`,
    replace: `:root{--accent:#ed5b2a;--accent-reverse:#f37944;--accent-soft:#ffd9c6}*{box-sizing:border-box}
/* Chrome 61 没有 dvh：基线用 100vh，boot.js 把可视高度写进 --app-height（地址栏 / 软键盘变化时跟手）。
   同一属性「旧值在前、新值在后」—— 不认识的声明整条丢弃，所以基线一定生效。 */
body{margin:0;min-height:100vh;min-height:var(--app-height,100vh);background:#deded5;-webkit-touch-callout:none}
main{max-width:980px;margin:auto;background:#deded5;min-height:100vh;min-height:var(--app-height,100vh);--min-camera:150px;--wave-h:56px;--min-knobs:84px;--min-pad:185px;padding-top:var(--safe-top);padding-right:calc(12px + var(--safe-right));padding-bottom:var(--safe-bottom);padding-left:calc(12px + var(--safe-left));display:grid;grid-template-rows:auto minmax(0,1fr);grid-gap:8px}`,
  },
  {
    note: '按钮：去掉 .file-button（本版移除了导入音频）+ 焦点环改成键盘导航门控',
    find: `button,.file-button{font:inherit;font-size:12px;cursor:pointer;color:inherit;background:#ecece4;border:1px solid var(--line);border-radius:4px;padding:9px 12px}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`,
    replace: `button{font:inherit;font-size:12px;cursor:pointer;color:inherit;background:#ecece4;border:1px solid var(--line);border-radius:4px;padding:9px 12px}button:disabled{opacity:.4;cursor:default}
/* 焦点环只在键盘导航时画：boot.js 在 pointerdown 时给 <html> 加 .pointer-nav、按任意键摘掉。
   Chrome 61 没有 :focus-visible（Chrome 86+），用类代替；现代内核同样走这一套，行为一致。 */
html:not(.pointer-nav) button:focus,html:not(.pointer-nav) a:focus{outline:2px solid var(--accent);outline-offset:2px}`,
  },
  {
    note: '顶栏三组按钮：flex gap → margin 基线 + 增强',
    find: `.flow-actions,.main-actions,.camera-actions{display:flex;align-items:center;gap:4px}`,
    replace: FLEX_GAP_BLOCK + `.flow-actions,.main-actions,.camera-actions{display:flex;align-items:center}
.flow-actions>*+*,.main-actions>*+*,.camera-actions>*+*{margin-left:4px}
.supports-flex-gap .flow-actions,.supports-flex-gap .main-actions,.supports-flex-gap .camera-actions{column-gap:4px}
.supports-flex-gap .flow-actions>*+*,.supports-flex-gap .main-actions>*+*,.supports-flex-gap .camera-actions>*+*{margin-left:0}`,
  },
  {
    note: '.performance：grid gap → grid-gap',
    find: `.performance{display:grid;grid-template-rows:auto auto;gap:12px;min-height:0}`,
    replace: `.performance{display:grid;grid-template-rows:auto auto;grid-gap:12px;min-height:0}`,
  },
  {
    note: '相机 video：inset → 物理定位',
    find: `.camera-window video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}`,
    replace: `.camera-window video{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;display:block}`,
  },
  {
    note: 'pad 焦点环：:focus-visible → :focus 基线（尖刺机制不变）',
    find: `.xy-pad:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}`,
    replace: `.xy-pad:focus{outline:2px solid var(--accent);outline-offset:-3px}`,
  },
  {
    note: '拖尾 canvas：inset → 物理定位',
    find: `.xy-trail{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}`,
    replace: `.xy-trail{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;pointer-events:none;z-index:3}`,
  },
  {
    note: 'pad 内覆盖层：inset → 物理定位',
    find: `#positionSurface{position:absolute;inset:0;width:100%;height:100%;opacity:0;touch-action:none;pointer-events:auto}`,
    replace: `#positionSurface{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;opacity:0;touch-action:none;pointer-events:auto}`,
  },
  {
    note: 'footer：flex gap → margin 基线 + 增强',
    find: `footer{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#6a6b65;align-items:start;overflow:hidden}`,
    replace: `footer{display:flex;justify-content:space-between;font-size:10px;color:#6a6b65;align-items:start;overflow:hidden}
footer>*+*{margin-left:8px}
.supports-flex-gap footer{column-gap:8px}
.supports-flex-gap footer>*+*{margin-left:0}`,
  },
  {
    note: 'dialog：inset(简写)/env()/min()/dvh → 物理 + 变量',
    find: `dialog{position:fixed;inset:auto;margin:0;left:max(12px,env(safe-area-inset-left));top:calc(70px + env(safe-area-inset-top));width:min(400px,calc(100vw - 24px));max-height:calc(100dvh - 100px - env(safe-area-inset-top));overflow:auto;`,
    replace: `dialog{position:fixed;top:calc(70px + var(--safe-top));left:calc(12px + var(--safe-left));right:calc(12px + var(--safe-right));bottom:auto;width:auto;max-width:400px;margin:0;max-height:calc(var(--app-height,100vh) - 100px - var(--safe-top));overflow:auto;-webkit-overflow-scrolling:touch;`,
  },
  {
    note: '导入音频控件已移除：删掉 .file-button / :has() / input[type=file] 三条死样式',
    find: `.actions{display:flex;gap:8px;margin:14px 0}input[type=file]{position:absolute;width:1px;height:1px;opacity:0}.file-button:has(input:disabled){opacity:.4;pointer-events:none}.parameters,#outputParameters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}`,
    replace: `.actions{display:flex;margin:14px 0}
.actions>*+*{margin-left:8px}
.supports-flex-gap .actions{column-gap:8px}
.supports-flex-gap .actions>*+*{margin-left:0}
.parameters,#outputParameters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-gap:14px}`,
  },
  {
    note: '菜单滑杆 label：flex gap → margin 基线 + 增强',
    find: `.parameter label{display:flex;justify-content:space-between;gap:4px;font-size:11px}`,
    replace: `.parameter label{display:flex;justify-content:space-between;font-size:11px}
.parameter label output{margin-left:4px}
.supports-flex-gap .parameter label{column-gap:4px}
.supports-flex-gap .parameter label output{margin-left:0}`,
  },
  {
    note: 'main 兜底高度：dvh → vh + 变量',
    find: `main{min-height:100dvh}`,
    replace: `main{min-height:100vh;min-height:var(--app-height,100vh)}`,
  },
  {
    note: '#coreParameters：grid gap → grid-gap',
    find: `#coreParameters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center;gap:8px;padding-top:6px}`,
    replace: `#coreParameters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center;grid-gap:8px;padding-top:6px}`,
  },
  {
    note: '.core-parameter：flex column gap → margin 基线 + 增强',
    find: `.core-parameter{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;--dial-angle:0deg}`,
    replace: `.core-parameter{position:relative;display:flex;flex-direction:column;align-items:center;--dial-angle:0deg}
.core-parameter>*+*{margin-top:4px}
.supports-flex-gap .core-parameter{row-gap:4px}
.supports-flex-gap .core-parameter>*+*{margin-top:0}`,
  },
  {
    note: '旋钮指针：inset → 物理定位',
    find: `.dial-pointer{position:absolute;inset:0;border-radius:50%;transform:rotate(var(--dial-angle))}`,
    replace: `.dial-pointer{position:absolute;top:0;right:0;bottom:0;left:0;border-radius:50%;transform:rotate(var(--dial-angle))}`,
  },
  {
    note: '旋钮 range：inset → 物理定位',
    find: `.core-parameter input{position:absolute;inset:0;margin:auto;width:52px;height:52px;opacity:0;cursor:ns-resize;touch-action:none}`,
    replace: `.core-parameter input{position:absolute;top:0;right:0;bottom:0;left:0;margin:auto;width:52px;height:52px;opacity:0;cursor:ns-resize;touch-action:none}`,
  },
  {
    note: '横屏媒体查询：grid gap → grid-gap；旋钮间距改 margin / gap 两档',
    find: `@media(orientation:landscape) and (min-width:600px){main{--min-knobs:88px;--min-pad:112px;grid-template-rows:54px minmax(0,1fr) 24px;gap:5px}.dial-face{width:38px;height:38px}.core-parameter input{height:44px}.core-parameter{gap:2px}main{--min-knobs:72px}}`,
    replace: `@media(orientation:landscape) and (min-width:600px){main{--min-knobs:88px;--min-pad:112px;grid-template-rows:54px minmax(0,1fr) 24px;grid-gap:5px}.dial-face{width:38px;height:38px}.core-parameter input{height:44px}.core-parameter>*+*{margin-top:2px}.supports-flex-gap .core-parameter{row-gap:2px}.supports-flex-gap .core-parameter>*+*{margin-top:0}main{--min-knobs:72px}}`,
  },
  {
    note: '横屏尾部：xy-group 的 grid gap → grid-gap',
    find: `.xy-group{display:grid;grid-template-rows:minmax(var(--min-pad),1fr) var(--min-knobs);gap:4px;min-height:0}`,
    replace: `.xy-group{display:grid;grid-template-rows:minmax(var(--min-pad),1fr) var(--min-knobs);grid-gap:4px;min-height:0}`,
  },
];

let text = fs.readFileSync(file, 'utf8');
const failures = [];
let applied = 0;
for (const e of edits) {
  const count = text.split(e.find).length - 1;
  if (count === 0) { failures.push(e.note); continue; }
  text = text.split(e.find).join(e.replace);
  applied += count;
  console.log(`OK   ×${count}  ${e.note}`);
}
if (failures.length) {
  console.error('\n有 ' + failures.length + ' 条没匹配上：');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
fs.writeFileSync(file, text);
console.log(`\n共应用 ${applied} 处替换。`);
