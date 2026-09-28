#!/usr/bin/env pwsh
# 打包小红书小工具 zip。
#
#   pwsh exercises/06-granular/minitool/tools/build.ps1
#
# 依据 zip-artifact-spec.md §1/§6：
#   · 压缩的必须是「与 index.html 同级的那批文件本身」，不是 src 这个目录 ——
#     否则解压后多套一层、index.html 不在根，容器直接加载不了；
#   · 包内只允许 .html/.css/.js/.json/图片/woff，且只有一个入口 index.html；
#   · 打完后**回读验证**（解到临时目录看顶层结构），不靠"我觉得压对了"。
#
# 门禁顺序：静态合规扫描 → 逐个 node --check → 目录自检 → 打包 → 回读验证 → 体积审计。
param([string]$Out = "")
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$src = (Resolve-Path (Join-Path $here '../src')).Path
# 产物出在 minitool/dist/（小工具自成一块，不往练习目录里放东西）
$dist = Join-Path (Resolve-Path (Join-Path $here '..')).Path 'dist'
if (-not $Out) { $Out = Join-Path $dist 'granular-minitool-0.3.2.zip' }

Write-Host "源目录: $src"

# 1) 静态合规扫描（容器禁用项 / ES2018+ 语法 / Chrome 61 CSS / 资源引用规则）
node (Join-Path $here 'compat-scan.mjs') $src
if ($LASTEXITCODE -ne 0) { throw '兼容扫描未通过，先修完再打包' }

# 2) 语法检查（每个 js 都要能解析；扫描器查语义，node --check 查语法）
Get-ChildItem -Path $src -Filter *.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "语法错误: $($_.Name)" }
}
Write-Host '语法检查通过'

# 3) 目录自检：入口在根、只有允许的类型
if (-not (Test-Path (Join-Path $src 'index.html'))) { throw 'index.html 必须直接位于 src/ 根目录' }
$allowed = @('.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2')
Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
  if ($allowed -notcontains $_.Extension.ToLower()) { throw "包内不允许的文件类型: $($_.Name)" }
}
Write-Host '目录自检通过'

# 4) 打包：压缩 src 下的**内容**
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
if (Test-Path $Out) { Remove-Item $Out -Force }
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $Out -Force
Write-Host "已生成: $Out"

# 5) 回读验证：解到临时目录，顶层必须直接是 index.html（不能先看到一个文件夹）
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('minitool-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Expand-Archive -Path $Out -DestinationPath $tmp -Force
$top = Get-ChildItem $tmp
$topDirs = ($top | Where-Object { $_.PSIsContainer }).Count
$hasEntry = Test-Path (Join-Path $tmp 'index.html')
$entryCount = $top.Count
if (-not $hasEntry) { Remove-Item $tmp -Recurse -Force; throw '回读失败：解压后根目录没有 index.html（多半是压缩时把目录本身压进去了）' }
if ($topDirs -gt 1) { Remove-Item $tmp -Recurse -Force; throw "回读失败：根目录有 $topDirs 个子目录，结构可疑" }
Write-Host "回读验证通过：顶层 $entryCount 项，index.html 在根"

# 6) 体积审计（Skill 自带脚本：zip >10MiB 报错、>2MiB 建议；文本合计 >5MiB 提示）
# Skill 是「按上传页口令下载到工作区 .skill/」的外部前置件，不属于本目录；
# 没装就跳过这一步（它只管体积，语义规则由上面的 compat-scan.mjs 负责），不让打包被卡住。
$audit = Join-Path $here '../../../../.skill/minitool-zip-builder/scripts/audit_artifact.mjs'
if (Test-Path $audit) {
  node $audit $src
  node $audit $Out
} else {
  Write-Warning "跳过体积审计：没找到 $audit（先按上传页口令安装 minitool-zip-builder Skill）"
}
$zipKb = [math]::Round((Get-Item $Out).Length / 1KB, 1)
$rawKb = [math]::Round(((Get-ChildItem $src -Recurse -File | Measure-Object -Property Length -Sum).Sum) / 1KB, 1)
Write-Host "体积：源 ${rawKb} KB → zip ${zipKb} KB"
Remove-Item $tmp -Recurse -Force
Write-Host "交付产物: $Out"
