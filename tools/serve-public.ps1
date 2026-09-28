#!/usr/bin/env pwsh
# 把本仓库发布到公网，供手机真机访问（摄像头 / 麦克风需要 HTTPS 安全上下文）。
#
#   pwsh tools/serve-public.ps1              # 默认端口 8770，自动找空闲端口
#   pwsh tools/serve-public.ps1 -Port 8800
#
# 它做两件事：
#   1) 用 node tools/serve.mjs 从**仓库根**起静态服务器（0.3.1 需要 ../../../shared/，不能只发子目录）
#   2) 用 cloudflared quick tunnel 把它暴露成 https://<随机>.trycloudflare.com
#
# ★ 收尾不要用「杀掉所有 cloudflared.exe」——本机还有别的项目在用自己的隧道
#   （8765 是 moonlight_grains 的参考页，8067 是另一个目录服务）。要停就停本脚本的进程树：
#   直接 Ctrl+C，或按端口找 PID：netstat -ano | Select-String ':8770\s'
param([int]$Port = 8770)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = @(
  'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  'C:\Program Files\cloudflared\cloudflared.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $cloudflared) { throw '找不到 cloudflared.exe，先安装：winget install --id Cloudflare.cloudflared' }

# 端口被占就往上找一个空闲的
$busy = (netstat -ano | Select-String 'LISTENING' | ForEach-Object { if ($_.Line -match ':(\d+)\s') { [int]$matches[1] } }) | Sort-Object -Unique
while ($busy -contains $Port) { $Port++ }

Write-Host "仓库根: $repoRoot"
Write-Host "端口:   $Port"

$server = Start-Process -FilePath 'node' -ArgumentList @((Join-Path $PSScriptRoot 'serve.mjs'), $Port) `
  -WorkingDirectory $repoRoot -PassThru -NoNewWindow

try {
  # 等服务器起来
  $ready = $false
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 250
    try { $null = Invoke-WebRequest "http://127.0.0.1:$Port/" -TimeoutSec 2 -UseBasicParsing; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw "静态服务器没起来（端口 $Port）" }

  Write-Host "`n本地: http://127.0.0.1:$Port/exercises/06-granular/0.3.1/index.html"
  Write-Host "正在开 quick tunnel，下面会打印公网地址（形如 https://xxx.trycloudflare.com）...`n"
  Write-Host "手机打开： <公网地址>/exercises/06-granular/0.3.1/index.html`n"

  & $cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$Port"
}
finally {
  if ($server -and -not $server.HasExited) {
    Write-Host "`n正在停止静态服务器 (PID $($server.Id))..."
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
