以下是完整的 API.md 文件内容，适用于 GitHub 仓库。段落之间使用两个换行分隔。

```markdown
# API 文档


## 机器人实例 API

在插件中，通过 `module.exports = (bot) => { ... }` 获得的 `bot` 参数即机器人实例。


### 核心方法

#### `sendMessage(content[, color])`
发送公屏消息。

- `content` (string): 消息内容
- `color` (string, optional): 颜色（十六进制，不带#），默认使用 `bot.getColor()`
- 返回: `Promise<void>`

#### `sendPrivateMessage(uid, content[, color])`
发送私聊消息。

- `uid` (string): 接收者 UID
- `content` (string): 消息内容
- `color` (string, optional): 颜色
- 返回: `Promise<void>`

#### `sendRaw(data)`
发送原始 WebSocket 字符串（高级用法）。

- `data` (string): 原始消息内容
- 返回: `void`

#### `sendAndWait(payload, prefix[, timeout])`
发送一条命令并等待特定前缀的响应。

- `payload` (string): 要发送的原始数据
- `prefix` (string): 期望响应的前缀（如 `'>$'` 等待银行响应）
- `timeout` (number, optional): 超时时间（毫秒），默认 10000
- 返回: `Promise<string | null>`

#### `moveToRoom(roomId[, password])`
切换房间（会断开重连，成功后 resolve）。

- `roomId` (string): 目标房间 ID（13位小写字母数字）
- `password` (string, optional): 房间密码
- 返回: `Promise<void>`

#### `getUser(uid)`
从缓存获取用户信息。

- `uid` (string): 用户 UID
- 返回: `Promise<{ id: string, name: string, avatar: string }>`

#### `getUserName(uid)`
获取用户名。

- `uid` (string): 用户 UID
- 返回: `Promise<string>`

#### `getRoomList()`
获取扁平化的房间列表（从缓存）。

- 返回: `Array<{ id: string, name: string, online?: number, description?: string, users?: string[], background?: string }>`

#### `getColor()`
获取当前机器人消息颜色。

- 返回: `string`（十六进制，不带#）

#### `schedule(cronExpression, callback)`
注册定时任务（基于 `node-cron`）。

- `cronExpression` (string): cron 表达式，如 `'0 8 * * *'`
- `callback` (function): 定时执行的函数
- 返回: `CronJob` 实例


### 权限系统

#### `isOwner(uid)`
检查是否为机器人主人。

- `uid` (string): 用户 UID
- 返回: `boolean`

#### `isAdmin(uid)`
检查是否为管理员（包含主人）。

- `uid` (string): 用户 UID
- 返回: `boolean`

#### `getRole(uid)`
获取用户角色字符串。

- 返回: `'owner' | 'admin' | 'user'`

#### `getRoleName(uid)`
获取用户角色中文名。

- 返回: `'主人' | '管理员' | '普通用户'`

#### `getAdminName(uid)`
获取管理员显示名（仅主人/管理员）。

- 返回: `string | null`


### 帮助系统

#### `registerHelp(command, description[, usage])`
注册一条内置命令说明。

- `command` (string): 命令名
- `description` (string): 命令描述
- `usage` (string, optional): 用法示例

#### `registerPluginHelp(pluginName, command, description[, usage])`
注册插件命令说明（用于 `help 插件名` 分类展示）。

- `pluginName` (string): 插件名称
- `command` (string): 命令名
- `description` (string): 描述
- `usage` (string, optional): 用法示例

#### `generateHelpText([pluginName[, page]])`
生成帮助文本（供 help 命令调用）。

- `pluginName` (string, optional): 指定插件名，不传则显示所有插件概览
- `page` (number, optional): 分页页码，默认 1
- 返回: `string`


### 配置系统

#### `getPluginConfig(pluginName)`
获取指定插件的配置对象（从 `data/plugins/<pluginName>/config.json` 读取，缓存）。

- `pluginName` (string): 插件名称
- 返回: `object`

#### `reloadPluginConfig(pluginName)`
重新加载指定插件的配置（清除缓存）。

- `pluginName` (string): 插件名称
- 返回: `object`（新配置）

#### `registerPluginConfigSchema(pluginName, schema)`
注册插件配置字段说明（供 Web 界面使用）。

- `pluginName` (string): 插件名称
- `schema` (object): 字段说明对象


### 热重载

#### `hotReloadPlugin(pluginName)`
热重载指定插件（需插件实现 `destroy` 函数）。

- `pluginName` (string): 插件名称
- 返回: `Promise<void>`


### 事件

插件可通过 `bot.on(eventName, callback)` 监听以下事件。

#### `'login'`
机器人登录成功时触发（每次重连也触发）。

- 回调参数: 无

#### `'publicMessage'`
收到公屏消息。

- 回调参数: `msg` 对象
  - `type`: 'public'
  - `timestamp`: number
  - `avatar`: string
  - `username`: string
  - `message`: string
  - `color`: string
  - `uid`: string
  - `title`: string
  - `messageId`: number
  - `replyMessage`: Array | null

#### `'privateMessage'`
收到私聊消息。

- 回调参数: `msg` 对象
  - `type`: 'private'
  - `timestamp`: number
  - `uid`: string
  - `username`: string
  - `avatar`: string
  - `message`: string
  - `color`: string
  - `messageId`: number
  - `replyMessage`: Array | null

#### `'memberUpdate'`
房间成员变化（加入、离开、移动）。

- 回调参数: `event` 对象
  - `type`: 'join' | 'leave'
  - `timestamp`: string
  - `avatar`: string
  - `username`: string
  - `uid`: string
  - `joinType?`: 'new' | 'reconnect'（仅 type='join'）
  - `isMove?`: boolean（仅 type='leave'）
  - `targetRoomId?`: string（移动目标房间）

#### `'music'`
收到音乐播放消息（&1 开头）。

- 回调参数: `data` 对象
  - `url`: string
  - `link`: string
  - `duration`: number
  - `title`: string
  - `singer`: string
  - `owner`: string
  - `pic`: string
  - `lyrics?`: string

#### `'bank'`
银行回调（存款/取款等操作结果）。

- 回调参数: `data` 对象
  - `total`: number
  - `income`: number
  - `deposit`: number
  - `interestRate`: [number, number]
  - `balance`: number

#### `'stock'`
股票信息更新。

- 回调参数: `data` 对象
  - `unitPrice`: number
  - `totalStock`: number
  - `personalStock`: number
  - `totalMoney`: number
  - `personalMoney`: number

#### `'balance'`
查询余额结果。

- 回调参数: `balance` (number)

#### `'selfMove'`
机器人自身移动房间。

- 回调参数: `{ id: string }`（新房间ID）

#### `'broadcast'`
全站广播消息。

- 回调参数: `data` 对象
  - `username`: string
  - `message`: string
  - `color`: string
  - `avatar`: string
  - `timestamp`: string
  - `messageId`: string

#### `'mailbox'`
邮箱消息（点赞、关注、支付等通知）。

- 回调参数: `data` 对象，包含 `type` 字段（`roomNotice` / `follower` / `like` / `dislike` / `payment`）

#### `'musicMessage'`
音乐卡片消息（m__4@ 开头）。

- 回调参数: `data` 对象
  - `type`: 'music'
  - `timestamp`: number
  - `avatar`: string
  - `username`: string
  - `color`: string
  - `uid`: string
  - `title`: string
  - `messageId`: number
  - `musicName`: string
  - `musicSinger`: string
  - `musicPic`: string
  - `musicColor`: string

#### `'musicData'`
原始音乐数据包（%1 开头）。

- 回调参数: `{ type: 'music_data', url: string }`

#### `'messageDeleted'`
消息撤回事件。

- 回调参数: `data` 对象
  - `type`: 'message-deleted'
  - `userId`: string
  - `messageId`: string
  - `channelId`: string
  - `timestamp`: number

#### `'bulkData'`
收到初始大包（包含用户列表和房间树）。

- 回调参数: `{ userList: Array, roomList: Object }`

#### `'userListUpdate'`
用户列表更新。

- 回调参数: `userList` (Array)，每个元素包含 `avatar`, `username`, `color`, `room`, `uid`


## 编码器 API

编码器对象 `encoder` 已挂载到 `bot.encoder`，用于生成各种原始命令字符串，可通过 `bot.sendRaw()` 发送。


### 消息类

#### `encoder.publicMessage(message, color)`
生成公屏消息命令。

- 返回: `{ messageId: string, data: string }`

#### `encoder.privateMessage(uid, message, color)`
生成私聊消息命令。

- 返回: `{ messageId: string, data: string }`


### 音乐与媒体

#### `encoder.mediaCard(type, title, singer, cover, color, duration[, bitRate, origin])`
生成音乐卡片命令（点歌主消息）。

- `type`: 'music' 或 'video'
- `title`, `singer`, `cover`, `color`: 歌曲信息
- `duration`: 时长（秒）
- `bitRate`: 比特率，默认 320
- `origin`: 来源平台（'netease', 'bilibili' 等）
- 返回: `{ messageId: string, data: string }`

#### `encoder.mediaData(type, title, singer, cover, url, duration[, lyrics, origin])`
生成歌曲播放数据命令（需与 mediaCard 配对发送）。

- `url`: 歌曲播放地址
- 其他参数同上
- 返回: `string`

#### `encoder.cutOne([id])`
切歌（不传 id 则切当前）。

- 返回: `string`

#### `encoder.cutAll()`
清空媒体队列。

- 返回: `string`

#### `encoder.exchangeMedia(id1, id2)`
交换两个媒体的位置。

- 返回: `string`

#### `encoder.seekMedia(time)`
跳转到指定时间（格式 "mm:ss" 或秒数）。

- 返回: `string`

#### `encoder.mediaOperation(operation, time)`
快进/快退（'<' 后退，'>' 前进，单位秒）。

- 返回: `string`


### 用户交互

#### `encoder.like(uid[, message])`
点赞。

- 返回: `string`

#### `encoder.dislike(uid[, message])`
点踩。

- 返回: `string`

#### `encoder.follow(uid)`
关注。

- 返回: `string`

#### `encoder.unfollow(uid)`
取消关注。

- 返回: `string`

#### `encoder.payment(uid, money[, message])`
打赏。

- 返回: `string`

#### `encoder.gradeUser(uid, score)`
为用户评分（好感度）。

- 返回: `string`

#### `encoder.cancelGradeUser(uid)`
取消评分。

- 返回: `string`


### 经济系统

#### `encoder.bankGet()`
查询银行。

- 返回: `string`

#### `encoder.bankDeposit(amount)`
存款。

- 返回: `string`

#### `encoder.bankWithdraw(amount)`
取款。

- 返回: `string`

#### `encoder.stockGet()`
查询股票。

- 返回: `string`

#### `encoder.stockBuy(quantity)`
买股票。

- 返回: `string`

#### `encoder.stockSell(quantity)`
卖股票。

- 返回: `string`

#### `encoder.getBalance()`
查询余额。

- 返回: `string`


### 管理命令

#### `encoder.kick(username)`
踢出用户。

- 返回: `string`

#### `encoder.mute(type, username, time[, reason])`
禁言。

- `type`: 'chat', 'music', 'all'
- `time`: 持续时间（秒，或 '&' 永久）
- 返回: `string`

#### `encoder.blacklist(username, time[, reason])`
加入黑名单。

- 返回: `string`

#### `encoder.setMaxUser([num])`
设置房间最大人数。

- 返回: `string`

#### `encoder.deleteMessage(channelId, messageId)`
撤回消息。

- 返回: `string`

#### `encoder.broadcast(message, color)`
全站广播。

- 返回: `string`


### 其他

#### `encoder.getUserProfileByName(username)`
获取用户资料（通过名字）。

- 返回: `string`

#### `encoder.getSelfInfo()`
获取自身信息。

- 返回: `string`

#### `encoder.getMusicList()`
获取歌单。

- 返回: `string`

#### `encoder.getForum()`
获取论坛。

- 返回: `string`

#### `encoder.getTasks()`
获取任务。

- 返回: `string`

#### `encoder.getMoments()`
获取朋友圈。

- 返回: `string`

#### `encoder.getLeaderboard()`
获取排行榜。

- 返回: `string`

#### `encoder.getStore()`
获取商店。

- 返回: `string`

#### `encoder.getSellerCenter()`
获取卖家中心。

- 返回: `string`

#### `encoder.addToCart(itemId)`
加入购物车。

- 返回: `string`

#### `encoder.removeFromCart(itemId)`
移除购物车。

- 返回: `string`

#### `encoder.getFavorites()`
获取收藏夹。

- 返回: `string`

#### `encoder.getFollowedStores()`
获取关注店铺。

- 返回: `string`

#### `encoder.subscribeRoom(roomId)`
订阅房间。

- 返回: `string`

#### `encoder.unsubscribeRoom(roomId)`
取消订阅房间。

- 返回: `string`

#### `encoder.summonDice(diceId)`
掷骰子（0-7）。

- 返回: `string | null`

#### `encoder.getUserMomentsByUid(uid)`
获取用户动态。

- 返回: `string`

#### `encoder.getFollowList(uid)`
获取关注/粉丝列表。

- 返回: `string`

#### `encoder.updateSelfInfo(profileData)`
更新个人信息。

- 返回: `string`

#### `encoder.moveRoom(roomId[, password])`
生成切换房间的原始命令（通常不需要手动调用，使用 `bot.moveToRoom` 即可）。

- 返回: `string`


## Web 仪表盘 HTTP API

Web 仪表盘默认监听 `8080` 端口（可通过环境变量 `WEBUI_PORT` 修改）。所有 API 返回 JSON。


### 状态与日志

#### `GET /api/status`
获取机器人当前状态。

**响应示例**:
```json
{
    "username": "栖云",
    "online": true,
    "currentRoom": "69c8bcf608f44",
    "uptime": "0h 5m 23s",
    "color": "66ccff",
    "signature": "Powered by Node.js",
    "logLevel": "info",
    "ownerUid": "6894ca5e2575b",
    "ownerName": "ixix",
    "adminList": []
}
```

GET /api/logs?limit=20

获取最近日志（默认 20 条）。

响应:

```json
[
    { "time": "2026-04-07T10:00:00.000Z", "message": "Web 仪表盘已启动" }
]
```

插件管理

GET /api/plugins

获取插件命令数量概览。

响应:

```json
[
    { "name": "ai_chat", "commandCount": 1, "enabled": true }
]
```

GET /api/plugins/detail

获取插件详细信息（描述、依赖等）。

响应:

```json
[
    {
        "name": "ai_chat",
        "description": "智能AI助手",
        "usage": "需要配置 apiKey",
        "dependencies": [],
        "commandCount": 1,
        "enabled": true
    }
]
```

GET /api/plugins/deps-graph

获取插件依赖关系图数据。

响应:

```json
{
    "nodes": [{ "id": "ai_chat", "label": "ai_chat", "enabled": true }],
    "edges": [{ "from": "blackjack", "to": "flower_finance" }]
}
```

GET /api/plugin/schema/:pluginName

获取插件配置的字段说明。

响应:

```json
{
    "apiKey": { "type": "string", "description": "API Key" }
}
```

POST /api/plugin/enable

启用/禁用插件（需重启生效）。请求体: { "pluginName": "ai_chat", "enabled": true }

响应: { "success": true }

POST /api/plugin/toggle

热切换插件启用/禁用（无需重启）。请求体同 enable。

响应: { "success": true }

POST /api/plugin/reload/:pluginName

热重载指定插件（需插件支持 destroy 函数）。

响应: { "success": true }

POST /api/plugin/reload-config/:pluginName

热重载指定插件的配置文件（无需重启）。

响应: { "success": true, "config": {...} }

配置管理

GET /api/config/main

获取主配置（data/config.json）。

响应: 主配置对象。

POST /api/config/main

保存主配置。请求体为主配置对象。

响应: { "success": true }

GET /api/config/plugin/:pluginName

获取指定插件的配置（data/plugins/<pluginName>/config.json）。

响应: 插件配置对象。

POST /api/config/plugin/:pluginName

保存插件配置。请求体为插件配置对象。

响应: { "success": true }

图表统计

GET /api/stats/online

获取在线人数统计数据（用于图表）。

响应:

```json
[
    { "time": 1744012800000, "count": 42 },
    { "time": 1744013100000, "count": 45 }
]
```

系统操作

POST /api/system/restart

重启机器人（1 秒后退出进程）。

响应: { "success": true }

登录认证

POST /api/login

登录 Web 管理面板。请求体: { "username": "admin", "password": "admin" }

响应: { "success": true } 或 401 错误。

GET /api/logout

登出，销毁 session。

响应: { "success": true }

插件元数据规范

插件应导出以下属性，以便被系统正确识别和加载：

```javascript
module.exports.name = 'plugin_name';                // 内部名称
module.exports.description = '插件描述';            // 简短描述
module.exports.usage = '使用说明';                  // 帮助信息
module.exports.dependencies = ['dep1', 'dep2'];     // 依赖的插件名称
module.exports.configSchema = { ... };              // 配置字段说明（用于 WebUI）
```

配置 schema 格式：

```javascript
{
    "fieldName": {
        "type": "string|number|boolean|...",
        "description": "字段说明"
    }
}
```

---

以上为完整的 API 文档。如有遗漏，请参考项目源码或提交 Issue。
