# upload-cos.ps1 —— App 发版后把三件资产上传到腾讯云 COS（FK 批 docs/APP-SYNC-COS.md）
# 用法（在 App 发版产物目录执行）：
#   pwsh -File F:\dsh\gameprice\scripts\upload-cos.ps1 -Bucket <bucket> -Region ap-shanghai -Version 2.25.1 -Dir .\out
# 依赖：本机已安装 coscli 并配置凭证（coscli config add -b ... -r ... -i ... -k ...）
# 凭证不入库、不打印。
param(
  [Parameter(Mandatory=$true)][string]$Bucket,
  [string]$Region = 'ap-shanghai',
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$Dir = '.',
  [string]$Prefix = 'steamdeals-app'
)
$ErrorActionPreference = 'Stop'
$cos = "cos://$Prefix"  # 占位，下面拼 bucket
$base = "cos://$Bucket/$Prefix"
$files = @(
  "steamdeals-$Version.apk",
  "steamdeals-$Version.apk.sha256",
  'latest.json'
)
foreach ($f in $files) {
  $p = Join-Path $Dir $f
  if (-not (Test-Path $p)) { throw "缺少文件：$p" }
}
if (-not (Get-Command coscli -ErrorAction SilentlyContinue)) {
  throw '未找到 coscli：请先安装并配置（coscli config add -b <bucket> -r <region> -i <SecretId> -k <SecretKey>）'
}
# 先校验远端可访问（配置/权限错误尽早失败）
coscli ls "$base/" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "coscli 无法访问 $base/（检查 bucket/region/凭证）" }
foreach ($f in $files) {
  $p = Join-Path $Dir $f
  coscli cp $p "$base/$f" 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "上传失败：$f" }
}
# 校验远端三件资产存在
$remote = coscli ls "$base/" 2>&1
foreach ($f in $files) {
  if ($remote -notmatch [regex]::Escape($f)) { throw "上传后校验失败：远端未找到 $f" }
}
Write-Host "COS 上传完成：$base/（$($files -join ', ')）"
