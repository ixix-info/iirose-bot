
# API 文档

本文档描述了 iirose-bot 机器人框架的核心 API，适用于插件开发者。

## 1. 机器人实例 `bot`

在插件中，通过 `module.exports = (bot) => { ... }` 获得的 `bot` 对象。

### 1.1 核心方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `sendMessage(content[, color])` | 发送公屏消息，颜色默认 `bot.getColor()` | `Promise<void>` |
| `sendPrivateMessage(uid, content[, color])` | 发送私聊消息 | `Promise<void>` |
| `sendRaw(data)` | 发送原始 WebSocket 字符串 | `void` |
| `sendAndWait(payload, prefix[, timeout])` | 发送命令并等待特定前缀的响应，超时返回 `null` | `Promise<string\|null>` |
| `moveToRoom(roomId[, password])` | 切换房间（会断开重连，成功后 resolve） | `Promise<void>` |
| `getUser(uid)` | 从缓存获取用户信息 | `Promise<{id, name, avatar}>` |
| `getUserName(uid)` | 获取用户名 | `Promise<string>` |
| `getRoomList()` | 获取扁平化的房间列表（从缓存） | `Array<RoomInfo>` |
| `getColor()` | 获取机器人消息颜色 | `string` |
| `schedule(cronExpression, callback)` | 注册定时任务（基于 `node-cron`） | `CronJob` |

### 1.2 权限系统

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `isOwner(uid)` | 是否为主人 | `boolean` |
| `isAdmin(uid)` | 是否为管理员（包含主人） | `boolean` |
| `getRole(uid)` | 返回 `'owner'` / `'admin'` / `'user'` | `string` |
| `getRoleName(uid)` | 返回中文角色名 | `string` |
| `getAdminName(uid)` | 返回管理员显示名（仅主人/管理员） | `string\|null` |

### 1.3 帮助系统

| 方法 | 说明 |
|------|------|
| `registerHelp(command, description[, usage])` | 注册内置命令说明 |
| `registerPluginHelp(pluginName, command, description[, usage])` | 注册插件命令说明（用于 `help 插件名`） |
| `generateHelpText([pluginName[, page]])` | 生成帮助文本（分页） |

### 1.4 配置系统

| 方法 | 说明 |
|------|------|
| `getPluginConfig(pluginName)` | 读取插件配置（缓存） |
| `reloadPluginConfig(pluginName)` | 重新加载插件配置 |
| `registerPluginConfigSchema(pluginName, schema)` | 注册插件配置字段说明（供 Web 界面使用） |

### 1.5 热重载

| 方法 | 说明 |
|------|------|
| `hotReloadPlugin(pluginName)` | 热重载指定插件（需插件实现 `destroy` 函数） |
| `unloadPlugin(pluginName)` | 动态卸载插件 |
| `loadPlugin(pluginName)` | 动态加载插件 |

### 1.6 事件

插件可通过 `bot.on(eventName, callback)` 监听：

| 事件 | 回调参数 | 说明 |
|------|----------|------|
| `'login'` | 无 | 机器人登录成功（每次重连也触发） |
| `'publicMessage'` | `msg` 对象 | 公屏消息 |
| `'privateMessage'` | `msg` 对象 | 私聊消息 |
| `'memberUpdate'` | `event` 对象 | 成员加入/离开/移动 |
| `'music'` | `data` 对象 | 音乐播放消息（&1 开头） |
| `'bank'` | `data` 对象 | 银行回调 |
| `'stock'` | `data` 对象 | 股票信息更新 |
| `'balance'` | `balance` (number) | 余额查询结果 |
| `'selfMove'` | `{ id }` | 机器人自身移动房间 |
| `'broadcast'` | `data` 对象 | 全站广播 |
| `'mailbox'` | `data` 对象 | 邮箱消息（点赞、关注、支付等） |
| `'musicMessage'` | `data` 对象 | 音乐卡片消息 |
| `'musicData'` | `{ url }` | 原始音乐数据包（%1 开头） |
| `'messageDeleted'` | `data` 对象 | 消息撤回 |
| `'bulkData'` | `{ userList, roomList }` | 大包数据（用户列表、房间树） |
| `'userListUpdate'` | `userList` 数组 | 用户列表更新 |

**消息对象结构示例**：

```javascript
// publicMessage
{
    type: 'public',
    timestamp: 1234567890,
    avatar: 'http://...',
    username: '用户',
    message: '内容',
    color: '66ccff',
    uid: 'abc123...',
    title: '花瓣',
    messageId: 12345,
    replyMessage: null
}

// memberUpdate (加入)
{
    type: 'join',
    timestamp: '1234567890',
    avatar: 'http://...',
    username: '用户',
    uid: 'abc123...',
    joinType: 'new'  // 或 'reconnect'
}

// memberUpdate (离开/移动)
{
    type: 'leave',
    timestamp: '1234567890',
    avatar: 'http://...',
    username: '用户',
    uid: 'abc123...',
    isMove: true,          // true 表示移动到其他房间
    targetRoomId: 'roomId' // 移动目标房间
}
```

2. 编码器 encoder

挂载在 bot.encoder，用于生成各种原始命令字符串。

2.1 消息类

方法 返回值
encoder.publicMessage(message, color) { messageId, data }

encoder.privateMessage(uid, message, color) { messageId, data }

2.2 音乐与媒体

方法 说明
encoder.mediaCard(type, title, singer, cover, color, duration[, bitRate, origin]) 发送音乐卡片（点歌）

encoder.mediaData(type, title, singer, cover, url, duration[, lyrics, origin]) 发送歌曲数据（配合卡片使用）

encoder.cutOne([id]) 切歌（指定 id 则切到该媒体）

encoder.cutAll() 清空媒体队列

encoder.exchangeMedia(id1, id2) 交换两个媒体的位置

encoder.seekMedia(time) 跳转到指定时间（"mm:ss" 或秒数）

encoder.mediaOperation(operation, time) 快进/快退（'<' 或 '>'）

2.3 用户交互

方法 说明

encoder.like(uid[, message]) 点赞

encoder.dislike(uid[, message]) 点踩

encoder.follow(uid) 关注

encoder.unfollow(uid) 取消关注

encoder.payment(uid, money[, message]) 打赏

encoder.gradeUser(uid, score) 为用户评分

encoder.cancelGradeUser(uid) 取消评分


2.4 经济系统

方法 说明
encoder.bankGet() 查询银行

encoder.bankDeposit(amount) 存款

encoder.bankWithdraw(amount) 取款

encoder.stockGet() 查询股票

encoder.stockBuy(quantity) 买股票

encoder.stockSell(quantity) 卖股票

encoder.getBalance() 查询余额

2.5 管理命令

方法 说明

encoder.kick(username) 踢出用户

encoder.mute(type, username, time[, reason]) 禁言（type 为 'chat', 'music', 'all'）

encoder.blacklist(username, time[, reason]) 加入黑名单

encoder.setMaxUser([num]) 设置房间最大人数

encoder.deleteMessage(channelId, messageId) 撤回消息

encoder.broadcast(message, color) 全站广播

2.6 其他

方法 说明

encoder.getUserProfileByName(username) 获取用户资料（通过名字）

encoder.getSelfInfo() 获取自身信息

encoder.getMusicList() 获取歌单

encoder.getForum() 获取论坛

encoder.getTasks() 获取任务

encoder.getMoments() 获取朋友圈

encoder.getLeaderboard() 获取排行榜

encoder.getStore() 获取商店

encoder.getSellerCenter() 获取卖家中心

encoder.addToCart(itemId) 加入购物车

encoder.removeFromCart(itemId) 移除购物车

encoder.getFavorites() 获取收藏夹

encoder.getFollowedStores() 获取关注店铺

encoder.subscribeRoom(roomId) 订阅房间

encoder.unsubscribeRoom(roomId) 取消订阅房间

encoder.summonDice(diceId) 掷骰子（0-7）

encoder.getUserMomentsByUid(uid) 获取用户动态

encoder.getFollowList(uid) 获取关注/粉丝列表

encoder.updateSelfInfo(profileData) 更新个人信息

3. Web 仪表盘 HTTP API

默认监听 8080 端口（环境变量 WEBUI_PORT 可修改）。所有 API 返回 JSON。

3.1 状态与日志

方法 路径 说明

GET /api/status 获取机器人状态（在线、房间、运行时间等）

GET /api/logs?limit=20 获取最近日志（默认 20 条）

GET /api/stats/online 获取在线人数历史数据（用于图表）

3.2 插件管理

方法 路径 说明

GET /api/plugins 获取插件命令数量概览

GET /api/plugins/detail 获取插件详细信息（描述、依赖、启用状态）

GET /api/plugins/deps-graph 获取插件依赖图数据（nodes, edges）

GET /api/plugin/schema/:pluginName 获取插件配置字段说明

POST /api/plugin/toggle 启用/禁用插件（热切换，无需重启）

POST /api/plugin/reload/:pluginName 热重载插件（需插件实现 destroy）

POST /api/plugin/reload-config/:pluginName 热重载插件配置

3.3 配置管理

方法 路径 说明

GET /api/config/main 获取主配置

POST /api/config/main 保存主配置

GET /api/config/plugin/:pluginName 获取插件配置

POST /api/config/plugin/:pluginName 保存插件配置

3.4 系统操作

方法 路径 说明

POST /api/system/restart 重启机器人（1 秒后退出进程）

3.5 登录认证

方法 路径 说明

POST /api/login 登录（用户名密码，返回 { success }）

GET /api/logout 登出，销毁 session

4. 插件元数据规范

插件应导出以下属性（可选但推荐）：

```javascript
module.exports.name = 'plugin_name';                // 内部名称（依赖和配置使用）
module.exports.description = '插件描述';            // 简短描述
module.exports.usage = '使用说明';                  // 帮助信息
module.exports.dependencies = ['dep1', 'dep2'];     // 依赖的插件名称
module.exports.configSchema = { ... };              // 配置字段说明（用于 WebUI）
```

配置 schema 格式示例：

```javascript
module.exports.configSchema = {
    apiKey: { type: 'string', description: 'API 密钥' },
    timeout: { type: 'number', description: '超时时间（秒）' },
    enabled: { type: 'boolean', description: '是否启用' }
};
```

5. 注意事项

· 所有异步方法返回 Promise，可使用 await。
· 机器人未登录时（bot.loggedIn === false），部分功能不可用，建议监听 'login' 事件。
· Web 仪表盘 API 默认无认证，生产环境请通过环境变量设置 WEB_USERNAME 和 WEB_PASSWORD 启用基本认证，或使用反向代理。
· 插件热重载需要插件实现 destroy 函数清理资源（事件监听、定时器等）。
