# 蔷薇花园机器人 一键安装脚本 (轻量版)
# 适用于 Windows PowerShell 5.1+

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Green
Write-Host "   蔷薇花园机器人 一键安装脚本  " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

$INSTALL_DIR = "$HOME\iirose-bot"

# 检查并安装 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 Node.js，正在下载安装..." -ForegroundColor Yellow
    $nodeUrl = "https://nodejs.org/dist/v18.20.3/node-v18.20.3-x64.msi"
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller
    Start-Process msiexec.exe -Wait -ArgumentList "/i $nodeInstaller /quiet /norestart"
    Remove-Item $nodeInstaller
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Node.js 安装完成，请重新打开 PowerShell 或手动刷新环境变量。" -ForegroundColor Green
}

# 检查并安装 Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到 Git，正在下载安装..." -ForegroundColor Yellow
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe"
    $gitInstaller = "$env:TEMP\git-installer.exe"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller
    Start-Process $gitInstaller -Wait -ArgumentList "/VERYSILENT /NORESTART"
    Remove-Item $gitInstaller
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "Git 安装完成。" -ForegroundColor Green
}

# 删除旧目录
if (Test-Path $INSTALL_DIR) {
    Write-Host "删除旧目录 $INSTALL_DIR ..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $INSTALL_DIR
}

# 创建安装目录
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
Set-Location $INSTALL_DIR

# 使用 git 稀疏检出仅下载必要文件
Write-Host "正在下载核心文件..." -ForegroundColor Yellow
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/ixix-info/iirose-bot.git temp_repo
Move-Item temp_repo\.git . -Force
Remove-Item temp_repo -Recurse -Force
git sparse-checkout init --cone
git sparse-checkout set bot.js webui package.json
git checkout

# 创建必要目录
New-Item -ItemType Directory -Force -Path data, plugins, webui, logs | Out-Null

# 生成默认配置文件
$config = @{
    username = ""
    password = ""
    defaultRoomId = ""
    roomPassword = ""
    color = "66ccff"
    signature = "Powered by Node.js"
    logLevel = "info"
    ownerUid = ""
    ownerName = ""
    adminList = @()
}
$config | ConvertTo-Json -Depth 3 | Set-Content -Path "data\config.json"

"{}" | Set-Content -Path "data\plugins_enabled.json"

# 安装 npm 依赖
Write-Host "正在安装 Node.js 依赖..." -ForegroundColor Yellow
npm install ws cron express lru-cache winston winston-daily-rotate-file express-session

# 下载 ECharts
Write-Host "下载 ECharts 本地库..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js" -OutFile "webui\echarts.min.js"

# 创建启动脚本
@"
@echo off
cd /d "$INSTALL_DIR"
set WEBUI_PORT=8080
set WEB_USERNAME=admin
set WEB_PASSWORD=admin
node bot.js
pause
"@ | Set-Content -Path "start.bat"

Write-Host "========================================" -ForegroundColor Green
Write-Host "安装完成！" -ForegroundColor Green
Write-Host "启动命令：cd $INSTALL_DIR ; .\start.bat" -ForegroundColor Green
Write-Host "Web 管理面板地址：http://localhost:8080" -ForegroundColor Green
Write-Host "默认登录账号：admin / admin" -ForegroundColor Green
Write-Host "请务必修改默认密码！" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Green
