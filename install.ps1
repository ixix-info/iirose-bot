# 蔷薇花园机器人 Windows 一键安装脚本 (PowerShell)
# 需要管理员权限（用于安装 Node.js 和 Git）

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "蔷薇花园机器人 安装程序"

Write-Host "========================================" -ForegroundColor Green
Write-Host "   蔷薇花园机器人 一键安装脚本" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# 检查是否以管理员身份运行
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "错误: 请以管理员身份运行此脚本 (右键 PowerShell -> 以管理员身份运行)" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

# 检查 winget 是否可用 (Windows 10/11 自带)
$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
    Write-Host "错误: 未找到 winget，请确保 Windows 10/11 已安装应用安装程序。" -ForegroundColor Red
    Write-Host "您可以从 Microsoft Store 安装 '应用安装程序'。" -ForegroundColor Yellow
    Read-Host "按 Enter 退出"
    exit 1
}

# 安装 Node.js (如果未安装)
function Install-NodeJS {
    Write-Host "正在检查 Node.js..." -ForegroundColor Yellow
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "Node.js 未安装，正在通过 winget 安装..." -ForegroundColor Yellow
        winget install OpenJS.NodeJS --silent --accept-package-agreements --accept-source-agreements
        # 刷新环境变量
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Write-Host "Node.js 安装失败，请手动安装 Node.js 18+ 后重试。" -ForegroundColor Red
            Read-Host "按 Enter 退出"
            exit 1
        }
    }
    $nodeVersion = node -v
    Write-Host "Node.js 版本: $nodeVersion" -ForegroundColor Green
}

# 安装 Git (如果未安装)
function Install-Git {
    Write-Host "正在检查 Git..." -ForegroundColor Yellow
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Host "Git 未安装，正在通过 winget 安装..." -ForegroundColor Yellow
        winget install Git.Git --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Host "Git 安装失败，请手动安装 Git 后重试。" -ForegroundColor Red
            Read-Host "按 Enter 退出"
            exit 1
        }
    }
    Write-Host "Git 已安装" -ForegroundColor Green
}

# 主安装流程
try {
    Install-NodeJS
    Install-Git

    $InstallDir = "$env:USERPROFILE\iirose-bot"
    if (Test-Path $InstallDir) {
        Write-Host "删除旧目录: $InstallDir" -ForegroundColor Yellow
        Remove-Item -Recurse -Force $InstallDir
    }

    Write-Host "正在克隆仓库..." -ForegroundColor Yellow
    git clone https://github.com/ixix-info/iirose-bot.git $InstallDir

    Set-Location $InstallDir

    Write-Host "正在安装 Node.js 依赖..." -ForegroundColor Yellow
    npm install ws cron express lru-cache winston winston-daily-rotate-file express-session

    # 创建必要目录
    New-Item -ItemType Directory -Force -Path data, plugins, webui, logs | Out-Null

    # 生成默认配置文件
    $configJson = @'
{
    "username": "",
    "password": "",
    "defaultRoomId": "",
    "roomPassword": "",
    "color": "66ccff",
    "signature": "Powered by Node.js",
    "logLevel": "info",
    "ownerUid": "",
    "ownerName": "",
    "adminList": []
}
'@
    Set-Content -Path "data\config.json" -Value $configJson -Encoding utf8

    $pluginsEnabledJson = '{}'
    Set-Content -Path "data\plugins_enabled.json" -Value $pluginsEnabledJson -Encoding utf8

    # 下载 ECharts
    Write-Host "下载 ECharts 本地库..." -ForegroundColor Yellow
    $echartsUrl = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"
    Invoke-WebRequest -Uri $echartsUrl -OutFile "webui\echarts.min.js"

    # 创建 Windows 启动脚本 (start.bat)
    $startBatContent = @"
@echo off
cd /d "$InstallDir"
set WEBUI_PORT=8080
set WEB_USERNAME=admin
set WEB_PASSWORD=admin
node bot.js
pause
"@
    Set-Content -Path "start.bat" -Value $startBatContent -Encoding ascii

    # 创建 PowerShell 启动脚本 (start.ps1) 用于无窗口运行
    $startPs1Content = @"
`$env:WEBUI_PORT="8080"
`$env:WEB_USERNAME="admin"
`$env:WEB_PASSWORD="admin"
Set-Location "$InstallDir"
node bot.js
"@
    Set-Content -Path "start.ps1" -Value $startPs1Content -Encoding utf8

    Write-Host "========================================" -ForegroundColor Green
    Write-Host "安装完成！" -ForegroundColor Green
    Write-Host "启动命令：" -ForegroundColor Green
    Write-Host "  双击运行 $InstallDir\start.bat" -ForegroundColor Cyan
    Write-Host "  或在 PowerShell 中运行：$InstallDir\start.ps1" -ForegroundColor Cyan
    Write-Host "Web 管理面板地址：http://localhost:8080" -ForegroundColor Green
    Write-Host "默认登录账号：admin / admin" -ForegroundColor Green
    Write-Host "请务必修改默认密码！" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Green
}
catch {
    Write-Host "安装失败: $_" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}
