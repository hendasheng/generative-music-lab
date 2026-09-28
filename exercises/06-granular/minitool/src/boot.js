/* 小工具启动准备（包内经典脚本 —— 容器 CSP 禁止内联脚本，所以这些检测必须外置）。
 *
 * 三件事都是「Chrome 61 基线 + 能力检测」的规定动作（js-compatibility.md §3 / css-compatibility.md §4）：
 *   1) Flex gap：Chrome 61 有 Grid gap 但没有 Flex gap，语法检测看不出这个区别，
 *      必须真的建一个 Flex 容器量布局行为；支持时给 <html> 加 .supports-flex-gap，
 *      CSS 里那条 column-gap/row-gap 增强才生效（基线一直是子项 margin）。
 *   2) 可视高度：Chrome 61 没有 dvh/svh/lvh。基线是 100vh，boot 把真实可视高度写进
 *      --app-height（软键盘、地址栏收放、横竖屏都会触发重算）。
 *   3) 焦点环：Chrome 61 没有 :focus-visible（Chrome 86+）。用「最近一次交互是不是指针」
 *      代替：指针操作时给 <html> 挂 .pointer-nav，按下任意键摘掉；CSS 只在没有这个类时画环。
 *   4) 容器外壳占位：小工具顶部还有**容器自己的按钮 / 导航栏**（规范说它由容器控制，但只提供
 *      --safe-area-inset-*，那是状态栏/刘海的量）。进容器后把 --chrome-top 设成实际占位，
 *      页面的顶栏就不会压在它下面。纯网页预览时不设，保持 0。
 *
 * 注意：只做能力检测，不按 UA / 机型 / 系统版本分支（js-compatibility.md §3）。
 */
(function () {
  'use strict';

  var root = document.documentElement;
  // 容器顶部按钮/导航栏的默认占位（px）。规范没给高度变量，这是 Android 导航栏那一档；
  // 若 launchOptions.miniToolEnv 里带了高度就优先用它；真机上量到不对就改这一个数。
  var DEFAULT_CHROME_TOP = 48;

  // 1) Flex gap 的布局行为检测（照抄 css-compatibility.md §4 的实现）
  function supportsFlexGap() {
    var flex = document.createElement('div');
    flex.style.position = 'absolute';
    flex.style.visibility = 'hidden';
    flex.style.display = 'flex';
    flex.style.flexDirection = 'column';
    flex.style.rowGap = '1px';
    flex.appendChild(document.createElement('div'));
    flex.appendChild(document.createElement('div'));
    document.body.appendChild(flex);
    var supported = flex.scrollHeight === 1;
    document.body.removeChild(flex);
    return supported;
  }

  // 2) 可视高度 → --app-height（CSS 用 var(--app-height, 100vh)，静态兜底始终在）
  function syncHeight() {
    var viewport = window.visualViewport;
    var height = (viewport && viewport.height) || window.innerHeight || 0;
    if (height > 0) root.style.setProperty('--app-height', height + 'px');
  }

  // 3) 焦点环门控：默认按指针算（不画环），按键盘才允许画
  root.classList.add('pointer-nav');
  window.addEventListener('pointerdown', function () { root.classList.add('pointer-nav'); }, true);
  window.addEventListener('keydown', function () { root.classList.remove('pointer-nav'); }, true);

  // 4) 容器外壳占位 → --chrome-top（默认 0，只有确认在容器里才预留）
  function readChromeTop(launchOptions) {
    var env = launchOptions && launchOptions.miniToolEnv;
    var candidates = [env && env.navBarHeight, env && env.titleBarHeight, env && env.chromeHeight, env && env.statusBarHeight];
    for (var i = 0; i < candidates.length; i++) {
      var value = Number(candidates[i]);
      if (value > 0) return value;
    }
    return DEFAULT_CHROME_TOP;
  }
  function syncChromeTop(launchOptions) {
    root.style.setProperty('--chrome-top', readChromeTop(launchOptions) + 'px');
  }
  function detectChrome() {
    var xhs = window.xhs;
    var miniTool = xhs && xhs.miniTool;
    if (!miniTool) return;                       // 普通浏览器 / 无 SDK：不预留
    syncChromeTop(xhs.launchOptions);            // 先用手上的同步值
    if (typeof miniTool.getLaunchOptions === 'function') {
      try {
        var pending = miniTool.getLaunchOptions();
        if (pending && typeof pending.then === 'function') pending.then(syncChromeTop).catch(function () {});
      } catch (error) { /* 同步值已经够用 */ }
    }
  }

  function ready() {
    // Flex gap 检测要往 body 里插临时节点，所以必须等 body 存在
    if (supportsFlexGap()) root.classList.add('supports-flex-gap');
    detectChrome();
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', syncHeight);
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', syncHeight);
    }
  }

  if (document.body) ready();
  else document.addEventListener('DOMContentLoaded', ready);
})();
