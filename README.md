# iirose-bot

IIROSE（蔷薇花园）聊天室机器人，支持插件系统、Web 管理面板、热重载等功能。

[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)](https://nodejs.org/)
## 特性

- 插件系统，支持热加载、热重载、依赖自动安装

- Web 管理面板（状态监控、插件管理、配置编辑、在线图表）
  

## 快速安装

一键安装脚本：

```bash
curl -sSL https://raw.githubusercontent.com/ixix-info/iirose-bot/install.sh | bash
```
以后启动:

```bash
cd ~/iirose-bot
node bot.js
```


首次启动会提示配置账号密码，请访问 http://你的服务器IP:8080 进行配置。

## 手动安装

如果一键脚本不适用，可以手动安装：


### 克隆仓库

```
git clone https://github.com/ixix-info/iirose-bot.git
cd iirose-bot

```


### 安装依赖

```
npm install ws cron express lru-cache winston winston-daily-rotate-file express-session
```


### 创建必要目录

```
mkdir -p data plugins webui logs
```


### 启动机器人

```
export WEBUI_PORT=8080
export WEB_USERNAME=admin
export WEB_PASSWORD=admin
node bot.js

```

## 配置说明

首次配置

1. 访问 http://服务器IP:8080，使用默认账号 admin / admin 登录
3. 进入 配置中心 页面
5. 填写机器人账号、密码、默认房间 ID（13位小写字母数字）
6. 点击保存，然后点击 重启机器人

## 环境变量

变量 说明 默认值

WEBUI_PORT Web 面板端口 8080

WEB_USERNAME Web 登录用户名 admin

WEB_PASSWORD Web 登录密码 admin

SESSION_SECRET Session 加密密钥 default-secret-change-me

LOG_LEVEL 日志级别 info

## 配置文件

· 主配置：data/config.json（机器人账号、房间、权限等）

· 插件启用状态：data/plugins_enabled.json

· 插件配置：data/plugins/<插件名>/config.json

## 目录结构

```
iirose-bot/
├── bot.js                 # 主程序
├── start.sh               # 启动脚本
├── data/                  # 配置数据
│   ├── config.json
│   ├── plugins_enabled.json
│   └── plugins/           # 插件配置目录
├── plugins/               # 插件目录
├── webui/                 # Web 管理面板静态文件
├── logs/                  # 日志目录
└── install.sh             # 一键安装脚本
```

## 插件开发

插件基本结构

```javascript
module.exports = (bot) => {
    // 插件逻辑
    bot.on('publicMessage', async (msg) => {
        if (msg.message === '!hello') {
            await bot.sendMessage(`你好，${msg.username}`);
        }
    });
};

module.exports.name = 'myplugin';
module.exports.description = '插件描述';
module.exports.usage = '使用说明';
module.exports.dependencies = [];  // 依赖的其他插件名称
module.exports.configSchema = {
    enabled: { type: 'boolean', description: '是否启用' }
};
```

## 热重载支持

插件若需要支持热重载，可导出 destroy 函数清理资源：

```javascript
const destroy = () => {
    bot.removeListener('publicMessage', handler);
    clearInterval(timer);
};
module.exports.destroy = destroy;
```

## bot 实例 API

详细 API 请参考 API 文档([API.md](https://github.com/ixix-info/iirose-bot/blob/main/API.md))。

## 注意事项

1. 账号安全

· 建议使用专用"人工智能"账号运行机器人，避免账号封禁风险

· 密码以 MD5 哈希传输，但仍需妥善保管

· 请勿将 data/config.json 提交到公开仓库

2. 网络稳定性

· 机器人需要稳定互联网连接，若频繁断线可调整 WS_SERVERS 顺序

· 默认心跳间隔 30 秒，可修改 HEARTBEAT_INTERVAL

3. 插件依赖

· 部分插件会自动安装 npm 依赖（需项目目录有写入权限）

· 若自动安装失败，请手动执行 npm install <包名>

4. 资源占用

· 内存约 150-300 MB（视插件数量）

· 日志按天滚动，保留 14 天

5. 安全建议（生产环境）

· 修改 Web 面板默认密码（通过环境变量）

· 定期更新：git pull 后重启机器人

## 常见问题

问题                    解决方法

登录失败（用户名/密码错误） 检查 data/config.json 中的账号密码，用户名不要带 [* *]

Web 面板无法访问          检查防火墙是否开放 8080 端口；确认 node bot.js 是否运行

插件加载失败              查看控制台错误日志，手动安装缺失依赖

机器人不回复消息           确认已配置账号并重启；检查房间 ID 是否正确

频繁断线重连              修改 WS_SERVERS 顺序，或增加 HEARTBEAT_INTERVAL

未介绍的bug,问题               前往本仓库的[bugfeedback.txt](https://github.com/ixix-info/iirose-bot/edit/main/bugfeedback.md)检查和提交

贡献

欢迎提交 Issue 和 Pull Request。本项目使用 GPL v3.0 许可证，任何贡献都将以相同许可证授权。

