// music.js - 点歌插件
const axios = require('axios');
const path = require('path');

// 插件元数据（供主框架识别）
module.exports.name = 'music';        // 内部名称，不影响 help 显示
module.exports.description = '点歌插件（内部API，支持选择搜索结果）';
module.exports.usage = '点歌 <歌曲名> 或 !点歌 <歌曲名>';
module.exports.dependencies = [];

module.exports = async (bot) => {
    // 关键：使用文件名作为 help 系统中的插件名
    const pluginName = path.basename(__filename, '.js'); // 结果为 'music'
    // 或者直接写 const pluginName = 'music';
    
    const getConfig = () => bot.getPluginConfig(pluginName);
    let config = getConfig();
    const prefix = config.prefix || '点歌';
    const defaultColor = config.defaultColor || bot.getColor() || '66ccff';

    // 注册帮助命令
    bot.registerPluginHelp(pluginName, prefix, `点歌一首，例如：${prefix} 海阔天空`, `${prefix} <歌曲名>`);
    bot.registerPluginHelp(pluginName, `!${prefix}`, `点歌一首（英文前缀）`, `!${prefix} <歌曲名>`);

    // 存储用户等待选择的会话
    const waitingUsers = new Map();

    // 辅助：发送选择列表
    async function sendSelectionList(msg, isPrivate, results, keyword) {
        if (!results.length) {
            const failMsg = `未找到歌曲“${keyword}”`;
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, failMsg);
            else await bot.sendMessage(failMsg);
            return false;
        }

        let listMsg = `找到 ${results.length} 首与“${keyword}”相关的歌曲，请回复编号点歌：\n`;
        for (let i = 0; i < results.length; i++) {
            const s = results[i];
            listMsg += `${i+1}. ${s.name} - ${s.artist}\n`;
        }
        listMsg += `回复 1-${results.length} 选择歌曲，回复“取消”放弃。`;

        if (isPrivate) await bot.sendPrivateMessage(msg.uid, listMsg);
        else await bot.sendMessage(listMsg);

        waitingUsers.set(msg.uid, {
            keyword,
            results,
            isPrivate,
            timestamp: Date.now()
        });
        return true;
    }

    // 搜索歌曲（返回最多20条）
    async function searchSongs(keyword, limit = 20) {
        try {
            const url = `https://a.iirose.com/lib/php/api/search_163Music.php?s=${encodeURIComponent(keyword)}&l=${limit}&p=1`;
            const resp = await axios.get(url, {
                headers: { 'Referer': 'https://a.iirose.com/', 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });
            const data = resp.data;
            if (data.code === 200 && data.result?.songs?.length > 0) {
                return data.result.songs.map(song => ({
                    id: song.id,
                    name: song.name,
                    artist: song.ar?.[0]?.name || '未知歌手',
                    cover: song.al?.picUrl || '',
                    fee: song.fee,
                    duration: song.dt
                }));
            }
            return [];
        } catch (err) {
            console.error(`[点歌插件] 搜索失败: ${err.message}`);
            return [];
        }
    }

    // 获取播放地址及详情
    async function getSongInfoById(songId) {
        try {
            const parseUrl = `https://a.iirose.com/lib/php/api/parse_163Music.php?i=${songId}&l=`;
            const parseResp = await axios.get(parseUrl, {
                headers: { 'Referer': 'https://a.iirose.com/', 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });
            const parseData = parseResp.data;
            if (parseData.code !== 200 || !parseData.data || !parseData.data.length) return null;
            const song = parseData.data[0];
            const playUrl = song.url;
            if (!playUrl) return null;
            const duration = Math.floor(song.time / 1000);

            // 获取详情（封面、歌手、歌名）
            const infoUrl = `https://a.iirose.com/lib/php/api/info_163Music.php?i=${songId}&l=`;
            const infoResp = await axios.get(infoUrl, {
                headers: { 'Referer': 'https://a.iirose.com/', 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });
            let title = '未知歌曲', singer = '未知歌手', cover = '';
            if (infoResp.data.code === 200 && infoResp.data.songs && infoResp.data.songs.length) {
                const info = infoResp.data.songs[0];
                title = info.name;
                singer = info.ar?.[0]?.name || '未知歌手';
                cover = info.al?.picUrl || '';
            }
            return { title, singer, cover, url: playUrl, duration, lyrics: parseData.lrc || '' };
        } catch (err) {
            console.error(`[点歌插件] 获取详情失败: ${err.message}`);
            return null;
        }
    }

    // 发送音乐卡片
    async function sendMusicCard(msg, isPrivate, songInfo, color) {
        const { title, singer, url, cover, duration, lyrics } = songInfo;
        if (isPrivate) {
            await bot.sendPrivateMessage(msg.uid, `点歌成功：${title} - ${singer}\n� ${url}`, color);
            return;
        }

        if (!bot.encoder) {
            await bot.sendMessage(`点歌：${title} - ${singer}\n播放地址：${url}`, color);
            return;
        }

        try {
            const dataCmd = bot.encoder.mediaData(1, title, singer, cover, url, duration, lyrics, 'netease');
            await bot.sendRaw(dataCmd);
            const cardCmd = bot.encoder.mediaCard(1, title, singer, cover, color, duration, 320, 'netease');
            await bot.sendRaw(cardCmd.data);
            await bot.sendMessage(`已点歌：${title} - ${singer}`, color);
        } catch (err) {
            console.error(`[点歌插件] 发送卡片失败: ${err.message}`);
            await bot.sendMessage(`点歌：${title} - ${singer}\n请手动播放：${url}`, color);
        }
    }

    // 处理选择回复
    async function handleSelectionReply(msg, isPrivate) {
        const waiting = waitingUsers.get(msg.uid);
        if (!waiting) return false;

        const content = msg.message.trim();
        if (content === '取消') {
            waitingUsers.delete(msg.uid);
            const cancelMsg = '已取消点歌。';
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, cancelMsg);
            else await bot.sendMessage(cancelMsg);
            return true;
        }

        const idx = parseInt(content, 10);
        if (isNaN(idx) || idx < 1 || idx > waiting.results.length) {
            const errorMsg = `请输入 1-${waiting.results.length} 之间的数字，或回复“取消”。`;
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, errorMsg);
            else await bot.sendMessage(errorMsg);
            return true;
        }

        const selected = waiting.results[idx - 1];
        waitingUsers.delete(msg.uid);

        const loadingMsg = '正在获取播放地址，请稍候...';
        if (isPrivate) await bot.sendPrivateMessage(msg.uid, loadingMsg);
        else await bot.sendMessage(loadingMsg);

        const songInfo = await getSongInfoById(selected.id);
        if (!songInfo) {
            const failMsg = `获取歌曲“${selected.name}”播放地址失败，可能受版权限制。`;
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, failMsg);
            else await bot.sendMessage(failMsg);
            return true;
        }

        await sendMusicCard(msg, isPrivate, songInfo, defaultColor);
        return true;
    }

    // 命令入口
    async function handleCommand(msg, isPrivate = false) {
        const content = msg.message || '';
        const currentConfig = getConfig();
        const currentPrefix = currentConfig.prefix || '点歌';
        const currentColor = currentConfig.defaultColor || bot.getColor() || '66ccff';

        let commandPrefix = content.startsWith('!') ? `!${currentPrefix}` : currentPrefix;
        if (!content.startsWith(commandPrefix)) return false;

        const keyword = content.slice(commandPrefix.length).trim();
        if (!keyword) {
            const tip = `用法：${commandPrefix} <歌曲名>，例如：${commandPrefix} 海阔天空`;
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, tip);
            else await bot.sendMessage(tip);
            return true;
        }

        if (!bot.loggedIn) {
            const tip = '机器人未连接，请稍后再试';
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, tip);
            else await bot.sendMessage(tip);
            return true;
        }

        const searchingMsg = '正在搜索歌曲，请稍候...';
        if (isPrivate) await bot.sendPrivateMessage(msg.uid, searchingMsg);
        else await bot.sendMessage(searchingMsg);

        const results = await searchSongs(keyword, 20);
        if (!results.length) {
            const failMsg = `未找到歌曲“${keyword}”`;
            if (isPrivate) await bot.sendPrivateMessage(msg.uid, failMsg);
            else await bot.sendMessage(failMsg);
            return true;
        }

        await sendSelectionList(msg, isPrivate, results, keyword);
        return true;
    }

    // 监听消息
    bot.on('publicMessage', async (msg) => {
        if (msg.uid === bot.userInfo?.id) return;
        const handled = await handleSelectionReply(msg, false);
        if (!handled) await handleCommand(msg, false);
    });

    bot.on('privateMessage', async (msg) => {
        if (msg.uid === bot.userInfo?.id) return;
        const handled = await handleSelectionReply(msg, true);
        if (!handled) await handleCommand(msg, true);
    });

    // 定期清理超时会话（5分钟）
    setInterval(() => {
        const now = Date.now();
        for (const [uid, data] of waitingUsers.entries()) {
            if (now - data.timestamp > 300000) waitingUsers.delete(uid);
        }
    }, 300000);

    console.log(`[点歌插件] 已启动，插件名: ${pluginName}，命令前缀: ${prefix}`);
    console.log(`[点歌插件] 帮助已注册，用户可使用 "help ${pluginName}" 查看命令`);

    const destroy = () => {
        bot.removeAllListeners('publicMessage');
        bot.removeAllListeners('privateMessage');
        console.log('[点歌插件] 已卸载');
    };
    module.exports.destroy = destroy;
};

