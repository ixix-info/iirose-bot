// 蔷薇花园机器人
// 首次启动请通过 Web 管理面板配置账号、密码等
// 访问 http://服务器IP:8080 或 http://127.0.0.1:8080 进行配置

const WebSocket = require('ws');
const zlib = require('zlib');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');
const express = require('express');
const { LRUCache } = require('lru-cache');
const winston = require('winston');
require('winston-daily-rotate-file');
const session = require('express-session');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// 动态导入 node-fetch（兼容 Node < 18）
let fetch;
(async () => {
    try {
        fetch = globalThis.fetch;
    } catch {
        const { default: nodeFetch } = await import('node-fetch');
        fetch = nodeFetch;
    }
})();

const WS_SERVERS = ['m1', 'm2', 'm8', 'm9', 'm'];
const WS_PORT = 8778;
const HEARTBEAT_INTERVAL = 30000;
const RETRY_BASE_DELAY = 5000;
const MAX_RETRY_DELAY = 30 * 60 * 1000;
const WEBUI_PORT = process.env.WEBUI_PORT || 8080;
const MARKET_INDEX_URL = process.env.MARKET_INDEX_URL || 
    'https://raw.githubusercontent.com/ixix-info/iirose-bot/main/market-index.json';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new winston.transports.DailyRotateFile({
            filename: 'logs/bot-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
            )
        })
    ]
});

let recentLogs = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
    const msg = args.join(' ');
    logger.info(msg);
    recentLogs.push({ time: new Date().toISOString(), message: msg });
    if (recentLogs.length > 200) recentLogs.shift();
    if (global.broadcastLog) global.broadcastLog(msg);
    originalConsoleLog.apply(console, args);
};
console.error = (...args) => {
    const msg = args.join(' ');
    logger.error(msg);
    recentLogs.push({ time: new Date().toISOString(), message: `ERROR: ${msg}` });
    if (recentLogs.length > 200) recentLogs.shift();
    if (global.broadcastLog) global.broadcastLog(`ERROR: ${msg}`);
    originalConsoleError.apply(console, args);
};
console.warn = (...args) => {
    const msg = args.join(' ');
    logger.warn(msg);
    recentLogs.push({ time: new Date().toISOString(), message: `WARN: ${msg}` });
    if (recentLogs.length > 200) recentLogs.shift();
    if (global.broadcastLog) global.broadcastLog(`WARN: ${msg}`);
    originalConsoleWarn.apply(console, args);
};

function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }
function generateMessageId() { return Math.random().toString(36).substring(2, 14); }
function rgbaToHex(rgba) {
    if (/^[0-9a-fA-F]{6}$/.test(rgba)) return rgba;
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return '66ccff';
    const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
    return `${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
function parseAvatar(avatar) {
    if (!avatar) return '';
    if (avatar.startsWith('http')) return avatar;
    return `http://s.iirose.com/images/icon/${avatar}.jpg`;
}
function encode(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"'/]/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;' }[s]));
}
function decode(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x2F;/g, e => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x2F;':'/' }[e]));
}

const encoder = {
    publicMessage(message, color) {
        const messageId = generateMessageId();
        const data = JSON.stringify({ m: message, mc: rgbaToHex(color), i: messageId });
        return { messageId, data };
    },
    privateMessage(uid, message, color) {
        const messageId = generateMessageId();
        const data = JSON.stringify({ g: uid, m: message, mc: rgbaToHex(color), i: messageId });
        return { messageId, data };
    },
    like(uid, msg='') { return `+*${uid}${msg?' '+msg:''}`; },
    dislike(uid, msg='') { return `+!${uid}${msg?' '+msg:''}`; },
    follow(uid) { return `+#0${uid}`; },
    unfollow(uid) { return `+#1${uid}`; },
    payment(uid, money, msg='') { return `+$${JSON.stringify({ g: uid, c: money, m: msg })}`; },
    gradeUser(uid, score) { return `+_*${uid} ${score}`; },
    cancelGradeUser(uid) { return `+_*${uid} !`; },
    bankGet: () => '>*',
    bankDeposit: (amount) => `>^a${amount}`,
    bankWithdraw: (amount) => `>^b${amount}`,
    stockGet: () => '>#',
    stockBuy: (qty) => `>$${qty}`,
    stockSell: (qty) => `>@${qty}`,
    getBalance: () => '=$',
    kick: (username) => `!#["${username}"]`,
    mute: (type, username, time, reason='') => {
        const map = { chat:'41', music:'42', all:'43' };
        return `!h3["${map[type]}","${username}","${time}","${reason}"]`;
    },
    blacklist: (username, time, reason='') => `!hb["${username}","${time}","${reason}"]`,
    setMaxUser: (num) => num ? `!h6["1${num}"]` : '!h6["1"]',
    deleteMessage: (channelId, msgId) => channelId.startsWith('private:') ? `v0*${channelId.split(':')[1]}#${msgId}` : `v0#${msgId}`,
    broadcast: (message, color) => `~${JSON.stringify({ t: message, c: rgbaToHex(color) })}`,
    mediaCard: (type, title, singer, cover, color, duration, bitRate=320, origin=null) => {
        const enc = s => s.replace(/[&<>"'/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;'}[s]));
        title = enc(title); singer = enc(singer); color = enc(color);
        const typeMap = { music:'=0', video:'=1', netease:'@0', bilibili:'*3' };
        const t = origin && typeMap[origin] ? typeMap[origin] : typeMap[type];
        const durText = (sec) => `${Math.floor(sec/60)}分${sec%60}秒`;
        let data = `m__4${t}>${title}>${singer}>${cover}>${color}`;
        if (bitRate) data += `>${bitRate}`;
        if (duration) data += `>>${durText(duration)}`;
        return encoder.publicMessage(data, color);
    },
    mediaData: (type, title, singer, cover, url, duration, lyrics=null, origin=null) => {
        const typeMap = { music:'=0', video:'=1', netease:'@0', bilibili:'*3' };
        const t = origin && typeMap[origin] ? typeMap[origin] : typeMap[type];
        const data = JSON.stringify({ s: url.substring(4), n: title, r: singer, c: cover.substring(4), d: duration, b: `${t}`, l: lyrics });
        return `&1${data}`;
    },
    cutOne: (id) => id ? `!12["${id}"]` : '!11',
    cutAll: () => '!13',
    exchangeMedia: (id1, id2) => `!14["${id1}","${id2}"]`,
    seekMedia: (time) => `!10["${time}"]`,
    mediaOperation: (op, time) => `!15["${op}","${time}"]`,
    getUserProfileByName: (name) => `+-${name}`,
    getSelfInfo: () => '$1',
    getMusicList: () => '%',
    getForum: () => ':-',
    getTasks: () => ':+',
    getMoments: () => ':=',
    getLeaderboard: () => '=-#',
    getStore: () => 'g-',
    getSellerCenter: () => 'g+',
    addToCart: (id) => `gc+${id}`,
    removeFromCart: (id) => `gc-${id}`,
    getFavorites: () => 'g&',
    getFollowedStores: () => 'g@',
    subscribeRoom: (id) => `=^v$1${id}`,
    unsubscribeRoom: (id) => `=^v$0${id}`,
    summonDice: (id) => id>=0 && id<=7 ? `)@${id}` : null,
    getUserMomentsByUid: (uid) => `:*${uid}`,
    getFollowList: (uid) => `+^${uid}`,
    updateSelfInfo: (data) => `$2${JSON.stringify(data)}`,
    moveRoom: (roomId, pass='') => JSON.stringify({ r: roomId, ...(pass && { rp: pass }) }),
    roomNotice: (content) => `!h4["${content}"]`,
    whiteList: (username, action = 'add') => `!hw["${username}","${action}"]`,
    getUserList: () => 'r2',
    guestLogin: (options) => {
        const { roomId, nickname, avatar = 'cartoon/600215', color = '614530', gender = '0' } = options;
        return '*' + JSON.stringify({
            r: roomId, n: nickname, i: avatar, nc: color, s: gender,
            st: 'n', mo: '', uid: 'G' + Date.now() + Math.random().toString(36).substr(2, 8),
            mb: '', mu: '01', fp: '@' + md5(nickname)
        });
    },
    switchRoomLogin: (roomId, lastRoomId, username, passwordMd5, signature = '') => {
        return '*' + JSON.stringify({
            r: roomId, n: username, p: passwordMd5, lr: lastRoomId,
            st: 'd', mo: signature, mb: '', mu: '01', fp: '@' + md5(username)
        });
    },
};

function parsePublicMessage(msg) {
    if (!msg.startsWith('"')) return null;
    const message = msg.slice(1);
    const tmp = message.split('>');
    if (tmp.length === 11 && /^\d+$/.test(tmp[0])) {
        let realMsg = tmp[3];
        let reply = null;
        if (realMsg.includes(' (_hr) ')) {
            const parts = realMsg.split(' (hr_) ');
            realMsg = parts.pop();
            const quotes = [];
            for (let part of parts) {
                const quoteParts = part.split(' (_hr) ');
                if (quoteParts.length === 2) {
                    const authorMatch = quoteParts[1].match(/(.*)_(\d+)$/);
                    if (authorMatch) {
                        quotes.push({
                            message: decode(quoteParts[0]),
                            username: decode(authorMatch[1].trim()),
                            time: Number(authorMatch[2])
                        });
                    }
                }
            }
            if (quotes.length) reply = quotes;
        }
        return {
            type: 'public',
            timestamp: Number(tmp[0]),
            avatar: parseAvatar(tmp[1]),
            username: decode(tmp[2]),
            message: decode(realMsg),
            color: tmp[5],
            uid: tmp[8],
            title: tmp[9] === "'108" ? '花瓣' : tmp[9],
            messageId: Number(tmp[10]),
            replyMessage: reply,
        };
    }
    return null;
}

function parsePrivateMessage(msg) {
    if (!msg.startsWith('""')) return null;
    const item = msg.slice(2).split('<');
    for (let part of item) {
        const tmp = part.split('>');
        if (tmp.length === 11 && /^\d+$/.test(tmp[0])) {
            let realMsg = tmp[4];
            let reply = null;
            if (realMsg.includes(' (_hr) ')) {
                const parts = realMsg.split(' (hr_) ');
                realMsg = parts.pop();
                const quotes = [];
                for (let part of parts) {
                    const quoteParts = part.split(' (_hr) ');
                    if (quoteParts.length === 2) {
                        const authorMatch = quoteParts[1].match(/(.*)_(\d+)$/);
                        if (authorMatch) {
                            quotes.push({
                                message: decode(quoteParts[0]),
                                username: decode(authorMatch[1].trim()),
                                time: Number(authorMatch[2])
                            });
                        }
                    }
                }
                if (quotes.length) reply = quotes;
            }
            return {
                type: 'private',
                timestamp: Number(tmp[0]),
                uid: tmp[1],
                username: decode(tmp[2]),
                avatar: parseAvatar(tmp[3]),
                message: decode(realMsg),
                color: tmp[5],
                messageId: Number(tmp[10]),
                replyMessage: reply,
            };
        }
    }
    return null;
}

function parseMemberUpdate(msg) {
    const parts = msg.split('>');
    if (parts.length < 10) return null;
    const timestamp = parts[0].slice(1);
    const avatar = parts[1];
    const username = parts[2];
    const uid = parts[8];
    const lastPart = parts[parts.length - 1];
    if (parts[3] === "'1") {
        let status = '';
        for (let i = lastPart.length - 1; i >= 0; i--) {
            if (lastPart[i] !== "'") { status = lastPart[i]; break; }
        }
        if (status === 'n' || status === 'd') {
            return {
                type: 'join',
                timestamp,
                avatar: parseAvatar(avatar),
                username: decode(username),
                uid,
                joinType: status === 'n' ? 'new' : 'reconnect',
            };
        }
    }
    if (parts[3] === "'3" && parts[parts.length-2] === '' && lastPart === '2') {
        return {
            type: 'leave',
            timestamp,
            avatar: parseAvatar(avatar),
            username: decode(username),
            uid,
            isMove: false,
        };
    }
    if (parts[3].startsWith("'2")) {
        const targetRoomId = parts[3].slice(2);
        if (lastPart.startsWith('3')) {
            return {
                type: 'leave',
                timestamp,
                avatar: parseAvatar(avatar),
                username: decode(username),
                uid,
                isMove: true,
                targetRoomId,
                color: parts[5],
                title: parts[9],
                room: parts[10],
            };
        }
    }
    return null;
}

function parseMemberUpdateEnhanced(msg) {
    const parts = msg.split('>');
    if (parts.length < 10) return null;
    const timestamp = parts[0].slice(1);
    const avatar = parts[1];
    const username = parts[2];
    const color = parts[3];
    const uid = parts[8];
    if (parts[4] === "'1") {
        return {
            type: 'join',
            timestamp,
            avatar: parseAvatar(avatar),
            username: decode(username),
            color,
            uid,
            joinType: parts[5] === 'n' ? 'new' : parts[5] === 'd' ? 'reconnect' : 'unknown',
        };
    }
    if (parts[4] && parts[4].startsWith("'2")) {
        const targetRoomId = parts[4].length > 2 ? parts[4].slice(2) : null;
        return {
            type: 'leave',
            timestamp,
            avatar: parseAvatar(avatar),
            username: decode(username),
            color,
            uid,
            isMove: !!targetRoomId,
            targetRoomId,
        };
    }
    return null;
}

function parseMusic(msg) {
    if (!msg.startsWith('&1')) return null;
    const tmp = msg.slice(2).split('>');
    if (tmp.length >= 9 && tmp[8] === '') {
        const obj = {
            url: `http${tmp[0].split(' ')[0]}`,
            link: `http${tmp[0].split(' ')[1]}`,
            duration: Number(tmp[1]),
            title: decode(tmp[2]),
            singer: decode(tmp[3].substring(2)),
            owner: tmp[4],
            pic: `http${tmp[6]}`,
        };
        if (tmp.length > 9 && tmp[9]) obj.lyrics = tmp[9].trim();
        return obj;
    }
    return null;
}

function parseBankCallback(msg) {
    if (msg.startsWith('>$')) {
        const tmp = msg.slice(2).split('"');
        return {
            total: Number(tmp[0]),
            income: Number(tmp[1]),
            deposit: Number(tmp[3].split(' ')[0]),
            interestRate: [Number(tmp[5].split(' ')[0]), Number(tmp[5].split(' ')[1])],
            balance: Number(tmp[4]),
        };
    }
    return null;
}

function parseStock(msg) {
    if (msg.startsWith('>')) {
        const list = msg.slice(1).split('>')[0].split('"');
        if (list.length === 5) {
            return {
                unitPrice: Number(Number(list[2]).toFixed(4)),
                totalStock: Number(list[0]),
                personalStock: Number(list[3]),
                totalMoney: Number(Number(list[1]).toFixed(4)),
                personalMoney: Number(list[4]),
            };
        }
    }
    return null;
}

function parseBalance(msg) {
    if (msg.startsWith('`$')) {
        const balance = parseFloat(msg.slice(2));
        return isNaN(balance) ? null : balance;
    }
    return null;
}

function parseSelfMove(msg) {
    if (msg.startsWith('-*')) return { id: msg.slice(2) };
    return null;
}

function parseBroadcast(msg) {
    if (!msg.startsWith('=')) return null;
    const parts = msg.slice(1).split('>');
    if (parts.length < 8) return null;
    return {
        username: parts[0],
        message: decode(parts[1]),
        color: parts[2],
        avatar: parseAvatar(parts[5]),
        timestamp: parts[6],
        messageId: parts[7],
    };
}

function parseMailbox(msg) {
    if (!msg.startsWith('@')) return null;
    const parts = msg.slice(2).split('<');
    for (let part of parts) {
        const tmp = part.split('>');
        if (tmp.length === 3) {
            return {
                type: 'roomNotice',
                notice: decode(tmp[0]),
                background: tmp[1],
                timestamp: Number(tmp[2]),
            };
        }
        if (tmp.length === 7) {
            if (/^'\^/.test(tmp[3])) {
                return {
                    type: 'follower',
                    username: decode(tmp[0]),
                    avatar: parseAvatar(tmp[1]),
                    gender: tmp[2],
                    background: tmp[4],
                    timestamp: Number(tmp[5]),
                    color: tmp[6],
                };
            } else if (/^'\*/.test(tmp[3])) {
                return {
                    type: 'like',
                    username: decode(tmp[0]),
                    avatar: parseAvatar(tmp[1]),
                    gender: tmp[2],
                    background: tmp[4],
                    timestamp: Number(tmp[5]),
                    color: tmp[6],
                    message: decode(tmp[3].substring(2)),
                };
            } else if (/^'h/.test(tmp[3])) {
                return {
                    type: 'dislike',
                    username: decode(tmp[0]),
                    avatar: parseAvatar(tmp[1]),
                    gender: tmp[2],
                    background: tmp[4],
                    timestamp: Number(tmp[5]),
                    color: tmp[6],
                    message: decode(tmp[3].substring(2)),
                };
            } else if (/^'\$/.test(tmp[3])) {
                return {
                    type: 'payment',
                    username: decode(tmp[0]),
                    avatar: parseAvatar(tmp[1]),
                    gender: tmp[2],
                    money: parseInt(tmp[3].split(' ')[0].substring(1)),
                    message: decode(tmp[3].split(' ')[1] || ''),
                    background: tmp[4],
                    timestamp: Number(tmp[5]),
                    color: tmp[6],
                };
            }
        }
    }
    return null;
}

function parseMusicMessage(msg) {
    if (!msg.startsWith('"')) return null;
    const message = msg.slice(1);
    const tmp = message.split('>');
    if (tmp.length === 11 && /^\d+$/.test(tmp[0])) {
        let realMsg = tmp[3];
        if (realMsg.startsWith('m__4@')) {
            const musicData = realMsg.split('>');
            return {
                type: 'music',
                timestamp: Number(tmp[0]),
                avatar: parseAvatar(tmp[1]),
                username: decode(tmp[2]),
                color: tmp[5],
                uid: tmp[8],
                title: tmp[9] === "'108" ? '花瓣' : tmp[9],
                messageId: Number(tmp[10]),
                musicName: decode(musicData[1]),
                musicSinger: decode(musicData[2]),
                musicPic: musicData[3],
                musicColor: musicData[4],
            };
        }
    }
    return null;
}

function parseMessageDeleted(botUid, msg) {
    const publicMatch = msg.match(/^v0#([^_]+)_([^"]+)"?$/);
    if (publicMatch) {
        const [, userId, messageId] = publicMatch;
        return { type: 'message-deleted', userId, messageId, channelId: '', timestamp: Date.now() };
    }
    const privateMatch = msg.match(/^v0\*([^"]+)"([^_]+)_(\d+)$/);
    if (privateMatch) {
        const [, receiverId, senderId, messageId] = privateMatch;
        return { type: 'message-deleted', userId: senderId, messageId, channelId: `private:${senderId}`, timestamp: Date.now() };
    }
    return null;
}

function parseBulkData(msg, botUid) {
    if (!msg.startsWith('%*"')) return null;
    const rawData = msg.slice(3);
    const parts = rawData.split('\\"');
    if (parts.length < 1) return null;
    let userAndRoomDataRaw = parts[0];
    if (userAndRoomDataRaw.endsWith("'")) userAndRoomDataRaw = userAndRoomDataRaw.slice(0, -1);
    const segments = userAndRoomDataRaw.split('<');
    if (segments.length < 2) return null;
    const userList = [];
    const roomList = {};
    const roomIdRegex = /^(?=.*[a-f])([a-f0-9]{10,}_?)+$/;
    for (const segment of segments) {
        if (!segment.trim()) continue;
        const fields = segment.split('>');
        if (fields.length < 2) continue;
        const candidateId = fields[0];
        if (roomIdRegex.test(candidateId)) {
            const idPath = candidateId.split('_');
            let current = roomList;
            for (let i = 0; i < idPath.length - 1; i++) {
                const idPart = idPath[i];
                if (!current[idPart]) current[idPart] = {};
                current = current[idPart];
            }
            const finalId = idPath[idPath.length - 1];
            if (!current[finalId]) current[finalId] = {};
            const room = current[finalId];
            room.id = finalId;
            room.name = fields[1] || '';
            room.online = 0;
            room.users = [];
            room.description = fields[5] ? fields[5].split('&&')[0].trim() : '';
            if (fields[5] && (fields[5].startsWith('s://') || fields[5].startsWith('://'))) {
                const proto = fields[5].startsWith('s://') ? 'https' : 'http';
                const urlPart = fields[5].split(' ')[0].slice(proto === 'https' ? 4 : 3);
                room.background = `${proto}://${urlPart}`;
            }
        } else if (fields[0].includes('/') && fields.length >= 5) {
            userList.push({
                avatar: parseAvatar(fields[0]),
                username: decode(fields[2]),
                color: fields[3],
                room: fields[4],
                uid: fields[8],
            });
        }
    }
    return { userList, roomList };
}

function parseMusicData(msg) {
    if (!msg.startsWith('%1')) return null;
    const url = msg.slice(2);
    return { type: 'music_data', url };
}

function parseUserListResponse(msg) {
    if (!msg.startsWith('u2')) return null;
    const users = [];
    const parts = msg.slice(2).split('<');
    for (const part of parts) {
        const fields = part.split('>');
        if (fields.length >= 9) {
            users.push({
                avatar: parseAvatar(fields[0]),
                gender: fields[1],
                username: decode(fields[2]),
                color: fields[3],
                room: fields[4],
                uid: fields[8],
                signature: fields[10] ? decode(fields[10]) : '',
            });
        }
    }
    return { type: 'userListResponse', users };
}

function parseFollowListResponse(msg) {
    if (!msg.startsWith('|^')) return null;
    const items = [];
    const parts = msg.slice(2).split('<');
    for (const part of parts) {
        const fields = part.split('"');
        if (fields.length >= 2) {
            items.push({ username: fields[0], avatar: fields[1] });
        }
    }
    return { type: 'followListResponse', items };
}

function parseMomentsResponse(msg) {
    if (!msg.startsWith(':=')) return null;
    const moments = [];
    const parts = msg.slice(2).split('<');
    for (const part of parts) {
        const fields = part.split('>');
        if (fields.length >= 8) {
            moments.push({
                username: decode(fields[0]),
                avatar: parseAvatar(fields[1]),
                gender: fields[2],
                content: decode(fields[3]),
                color: fields[4],
                timestamp: Number(fields[5]),
                messageId: fields[6],
            });
        }
    }
    return { type: 'momentsResponse', moments };
}

function parseStoreResponse(msg) {
    if (!msg.startsWith('g-')) return null;
    const stores = [];
    const parts = msg.slice(2).split('<');
    for (const part of parts) {
        const fields = part.split('>');
        if (fields.length >= 10) {
            stores.push({
                id: fields[0], logo: fields[1], name: decode(fields[2]), rating: fields[3],
                tags: fields[4], description: decode(fields[5]), banner: fields[6],
                createdAt: Number(fields[7]), icon: fields[8], level: fields[9],
            });
        }
    }
    return { type: 'storeResponse', stores };
}

function parseSelfInfoResponse(msg) {
    if (!msg.startsWith('$?1')) return null;
    const fields = msg.slice(3).split('"');
    if (fields.length >= 16) {
        return {
            type: 'selfInfoResponse',
            username: decode(fields[0]),
            email: fields[1] || '',
            color: fields[8] || '',
            avatar: parseAvatar(fields[9] || ''),
            uid: fields[10] || '',
            signature: fields[14] ? decode(fields[14]) : '',
        };
    }
    return null;
}

class IiroseBot extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.color = config.color || '66ccff';
        this.logLevel = config.logLevel || 'info';
        this.ws = null;
        this.isRunning = false;
        this.retryCount = 0;
        this.consecutive502Count = 0;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.responseQueue = [];
        this.responseListeners = new Map();
        this.userListCache = new LRUCache({ max: 500 });
        this.roomListCache = new LRUCache({ max: 200 });
        this.currentRoomId = config.defaultRoomId;
        this.loggedIn = false;
        this.cronJobs = [];
        this.commands = new Map();
        this.pluginCommands = new Map();
        this.ownerUid = config.ownerUid || '';
        this.ownerName = config.ownerName || '';
        this.adminList = config.adminList || [];
        this.adminUids = this.adminList.map(a => a.uid);
        this.pluginConfigs = new Map();
        this.pluginSchemas = new Map();
        this.pluginsMeta = new Map();
        this.setMaxListeners(100);
    }

    log(level, ...args) {
        const levels = { error:0, warn:1, info:2, debug:3 };
        if (levels[level] > levels[this.logLevel]) return;
        const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] `;
        console.log(prefix, ...args);
    }

    getPluginConfig(pluginName) {
        if (this.pluginConfigs.has(pluginName)) return this.pluginConfigs.get(pluginName);
        const cfgPath = path.join(__dirname, 'data', 'plugins', pluginName, 'config.json');
        let cfg = {};
        try { if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch(e) {}
        this.pluginConfigs.set(pluginName, cfg);
        return cfg;
    }
    reloadPluginConfig(pluginName) {
        this.pluginConfigs.delete(pluginName);
        return this.getPluginConfig(pluginName);
    }
    registerPluginConfigSchema(pluginName, schema) { this.pluginSchemas.set(pluginName, schema); }

    async connect() {
        if (this.ws) this.disconnect();
        let fastest = 'm1';
        for (const srv of WS_SERVERS) {
            const url = `wss://${srv}.iirose.com:${WS_PORT}`;
            try {
                const latency = await this.testLatency(url);
                if (latency !== null) { fastest = srv; break; }
            } catch(e) {}
        }
        const wsUrl = `wss://${fastest}.iirose.com:${WS_PORT}`;
        this.log('info', `连接服务器 ${wsUrl}`);
        this.ws = new WebSocket(wsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        this.ws.binaryType = 'arraybuffer';
        let encountered502 = false;
        this.ws.on('open', () => {
            this.consecutive502Count = 0;
            this.onOpen();
        });
        this.ws.on('message', (data) => this.onMessage(data));
        this.ws.on('error', (err) => {
            if (err.message && err.message.includes('502')) {
                encountered502 = true;
                this.consecutive502Count++;
            }
            this.log('error', 'WebSocket错误', err.message);
        });
        this.ws.on('close', () => this.onClose(encountered502));
    }

    testLatency(url) {
        return new Promise((resolve) => {
            const start = Date.now();
            const ws = new WebSocket(url);
            const timer = setTimeout(() => { ws.close(); resolve(null); }, 3000);
            ws.on('open', () => { clearTimeout(timer); const latency = Date.now() - start; ws.close(); resolve(latency); });
            ws.on('error', () => { clearTimeout(timer); resolve(null); });
        });
    }

    onOpen() {
        this.log('info', 'WebSocket已连接，发送登录包');
        this.retryCount = 0;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const loginObj = {
            r: this.currentRoomId, n: this.config.username, p: md5(this.config.password),
            st: 'n', mo: this.config.signature, mb: '', mu: '01', fp: `@${md5(this.config.username)}`,
        };
        if (this.config.roomPassword) loginObj.rp = this.config.roomPassword;
        this.ws.send(Buffer.from('*' + JSON.stringify(loginObj)));
    }

    onMessage(data) {
        const arr = new Uint8Array(data);
        let msg = arr[0] === 1 ? zlib.unzipSync(arr.slice(1)).toString() : Buffer.from(arr).toString('utf8');
        if (msg.length < 500) this.log('debug', '收到消息', msg);
        if (this.retryCount !== 0) { this.retryCount = 0; this.log('debug', '收到消息，重试计数已重置'); }

        for (const [prefix, handler] of this.responseListeners) {
            if (msg.startsWith(prefix)) { handler.listener(msg); if (handler.stopPropagation) return; }
        }
        if (this.responseQueue.length) {
            const req = this.responseQueue.shift();
            req.timer();
            req.resolver(msg);
            return;
        }
        if (!this.loggedIn) {
            if (msg.startsWith('%')) {
                if (msg.startsWith('%*"0')) { this.log('error', '登录失败：名字被占用'); this.disconnect(); return; }
                if (msg.startsWith('%*"1')) { this.log('error', '登录失败：用户名不存在'); this.disconnect(); return; }
                if (msg.startsWith('%*"2')) { this.log('error', '登录失败：密码错误'); this.disconnect(); return; }
                if (msg.startsWith('%*"4')) { this.log('error', '登录失败：今日尝试次数达到上限'); this.disconnect(); return; }
                if (msg.startsWith('%*"5')) { this.log('error', '登录失败：房间密码错误'); this.disconnect(); return; }
                if (msg.startsWith('%*"x')) { this.log('error', '登录失败：用户被封禁'); this.disconnect(); return; }
                if (msg.startsWith('%*"n0')) { this.log('error', '登录失败：房间无法进入'); this.disconnect(); return; }
                if (msg.startsWith('%')) {
                    this.loggedIn = true;
                    this.log('info', '登录成功！');
                    this.emit('login');
                    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
                    this.heartbeatTimer = setInterval(() => { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(''); }, HEARTBEAT_INTERVAL);
                }
            }
        }
        let decoded = null;
        try {
            if ((decoded = parsePublicMessage(msg))) this.emit('publicMessage', decoded);
            else if ((decoded = parsePrivateMessage(msg))) this.emit('privateMessage', decoded);
            else if ((decoded = parseMemberUpdate(msg))) this.emit('memberUpdate', decoded);
            else if ((decoded = parseMemberUpdateEnhanced(msg))) this.emit('memberUpdate', decoded);
            else if ((decoded = parseMusic(msg))) this.emit('music', decoded);
            else if ((decoded = parseBankCallback(msg))) this.emit('bank', decoded);
            else if ((decoded = parseStock(msg))) this.emit('stock', decoded);
            else if ((decoded = parseBalance(msg))) this.emit('balance', decoded);
            else if ((decoded = parseSelfMove(msg))) this.emit('selfMove', decoded);
            else if ((decoded = parseBroadcast(msg))) this.emit('broadcast', decoded);
            else if ((decoded = parseMailbox(msg))) this.emit('mailbox', decoded);
            else if ((decoded = parseMusicMessage(msg))) this.emit('musicMessage', decoded);
            else if ((decoded = parseMessageDeleted(this.config.uid, msg))) this.emit('messageDeleted', decoded);
            else if (msg.startsWith('%1')) {
                const musicData = parseMusicData(msg);
                if (musicData) this.emit('musicData', musicData);
                else this.log('warn', `无法解析音乐数据: ${msg.substring(0,100)}`);
            } else if (msg.startsWith('%') && msg.startsWith('%*"')) {
                const bulk = parseBulkData(msg, this.config.uid);
                if (bulk) {
                    if (bulk.userList) { bulk.userList.forEach(u => this.userListCache.set(u.uid, u)); this.emit('userListUpdate', bulk.userList); }
                    if (bulk.roomList) {
                        const flatten = (obj, res=[]) => { for (const k in obj) { const r=obj[k]; if(r.id&&r.name)res.push(r); if(typeof r==='object') flatten(r,res); } return res; };
                        flatten(bulk.roomList).forEach(r => this.roomListCache.set(r.id, r));
                    }
                    this.emit('bulkData', bulk);
                } else this.log('warn', `未知大包格式: ${msg.substring(0,100)}`);
            } else if ((decoded = parseUserListResponse(msg))) this.emit('userListResponse', decoded);
            else if ((decoded = parseFollowListResponse(msg))) this.emit('followListResponse', decoded);
            else if ((decoded = parseMomentsResponse(msg))) this.emit('momentsResponse', decoded);
            else if ((decoded = parseStoreResponse(msg))) this.emit('storeResponse', decoded);
            else if ((decoded = parseSelfInfoResponse(msg))) this.emit('selfInfoResponse', decoded);
            else if (msg.startsWith('%')) this.log('warn', `未知格式消息: ${msg.substring(0,100)}`);
            else if (msg.length < 200) this.log('debug', `未识别的消息: ${msg}`);
        } catch (err) { this.log('error', `消息解析异常: ${err.message}\n原始消息: ${msg.substring(0,200)}`); }
    }

    onClose(was502 = false) {
        this.log('warn', 'WebSocket连接断开');
        this.loggedIn = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (!this.isRunning) return;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        let delay;
        if (was502) {
            const baseDelay = 30000, maxDelay = 300000;
            delay = Math.min(baseDelay * Math.pow(1.5, this.consecutive502Count - 1), maxDelay);
            this.log('info', `检测到502错误，${Math.round(delay/1000)}秒后重连 (连续次数:${this.consecutive502Count})`);
        } else {
            delay = Math.min(RETRY_BASE_DELAY + this.retryCount * 5000, MAX_RETRY_DELAY);
            this.retryCount++;
            this.log('info', `${delay/1000}秒后重连...`);
        }
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    disconnect() {
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.isRunning = false;
    }

    async sendMessage(content, color = this.getColor()) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('未连接');
        const { data } = encoder.publicMessage(content, color);
        this.log('info', `[发送公屏] ${content}`);
        this.ws.send(Buffer.from(data));
    }

    async sendPrivateMessage(uid, content, color = this.getColor()) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('未连接');
        const { data } = encoder.privateMessage(uid, content, color);
        this.log('info', `[发送私聊] 给 ${uid}: ${content}`);
        this.ws.send(Buffer.from(data));
    }

    sendRaw(data) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(Buffer.from(data)); }

    sendAndWait(payload, prefix, timeout = 10000) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.responseListeners.delete(prefix); resolve(null); }, timeout);
            this.responseListeners.set(prefix, { listener: (data) => { clearTimeout(timer); this.responseListeners.delete(prefix); resolve(data); }, stopPropagation: true });
            this.sendRaw(payload);
        });
    }

    async moveToRoom(roomId, password = '') {
        if (roomId === this.currentRoomId) return;
        this.log('info', `移动到房间 ${roomId}${password ? ' (有密码)' : ''}`);
        this.currentRoomId = roomId;
        const oldPass = this.config.roomPassword;
        if (password) this.config.roomPassword = password;
        if (this.ws) this.ws.close();
        return new Promise((resolve, reject) => {
            const onLogin = () => { this.off('login', onLogin); if (password) this.config.roomPassword = oldPass; resolve(); };
            const onError = (err) => { this.off('login', onLogin); if (password) this.config.roomPassword = oldPass; reject(err); };
            this.once('login', onLogin);
            this.once('error', onError);
            this.connect().catch(err => { this.off('login', onLogin); this.off('error', onError); reject(err); });
        });
    }

    async getUser(uid) { const u = this.userListCache.get(uid); return u ? { id: u.uid, name: u.username, avatar: u.avatar } : { id: uid, name: '未知用户' }; }
    async getUserName(uid) { const u = await this.getUser(uid); return u.name; }
    getColor() { return this.color; }
    schedule(cronExpr, cb) { const job = new CronJob(cronExpr, cb, null, true); this.cronJobs.push(job); return job; }
    getRoomList() { return Array.from(this.roomListCache.values()); }

    isOwner(uid) { return uid === this.ownerUid; }
    isAdmin(uid) { return this.isOwner(uid) || this.adminUids.includes(uid); }
    getRole(uid) { if (this.isOwner(uid)) return 'owner'; if (this.isAdmin(uid)) return 'admin'; return 'user'; }
    getRoleName(uid) { if (this.isOwner(uid)) return '主人'; if (this.isAdmin(uid)) return '管理员'; return '普通用户'; }
    getAdminName(uid) { if (uid === this.ownerUid) return this.ownerName; const a = this.adminList.find(a => a.uid === uid); return a ? a.name : null; }

    registerHelp(cmd, desc, usage='') { this.commands.set(cmd, { description: desc, usage }); }
    registerPluginHelp(pluginName, cmd, desc, usage='') {
        if (!this.pluginCommands.has(pluginName)) this.pluginCommands.set(pluginName, new Map());
        this.pluginCommands.get(pluginName).set(cmd, { description: desc, usage });
    }
    generateHelpText(pluginName=null, page=1) {
        const PAGE_SIZE = 10;
        if (!pluginName) {
            let lines = ['【可用插件列表】'];
            if (this.commands.size > 0) lines.push(`• 内置 —— ${this.commands.size} 条命令 (输入 help 内置 查看详情)`);
            for (const [name, cmdMap] of this.pluginCommands) lines.push(`• ${name} —— ${cmdMap.size} 条命令 (输入 help ${name} 查看详情)`);
            if (lines.length === 1) lines.push('当前没有已注册的插件命令。');
            return lines.join('\n');
        }
        let cmds = pluginName === '内置' ? this.commands : this.pluginCommands.get(pluginName);
        if (!cmds || cmds.size === 0) return `❌ 未找到插件「${pluginName}」或该插件没有注册命令。`;
        const total = cmds.size, maxPage = Math.ceil(total / PAGE_SIZE);
        if (page < 1) page = 1; if (page > maxPage && maxPage > 0) page = maxPage;
        const start = (page - 1) * PAGE_SIZE;
        const entries = Array.from(cmds.entries()).slice(start, start + PAGE_SIZE);
        let lines = [`【${pluginName} 命令列表】 (第${page}/${maxPage}页)`];
        for (const [cmd, info] of entries) { let line = `• ${cmd} —— ${info.description}`; if (info.usage) line += `\n  用法：${info.usage}`; lines.push(line); }
        if (maxPage > 1) lines.push(`\n输入 help ${pluginName} 页码 查看其它页（如 help ${pluginName} 2）`);
        return lines.join('\n');
    }

    async start() { if (this.isRunning) return; this.isRunning = true; this.retryCount = 0; this.consecutive502Count = 0; await this.connect(); }
    async stop() { this.cronJobs.forEach(job => job.stop()); this.isRunning = false; this.disconnect(); }

    async unloadPlugin(pluginName) {
        const meta = this.pluginsMeta.get(pluginName);
        if (!meta) throw new Error('插件未加载');
        if (typeof meta.destroy === 'function') await meta.destroy();
        this.pluginsMeta.delete(pluginName);
        this.pluginCommands.delete(pluginName);
        console.log(`插件 ${pluginName} 已卸载`);
    }
    async loadPlugin(pluginName) {
        const enabledMap = loadEnabledPlugins();
        if (enabledMap[pluginName] === false) throw new Error('插件被禁用');
        const pluginsDir = path.join(__dirname, 'plugins');
        const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
        const file = files.find(f => f.replace(/\.js$/, '') === pluginName);
        if (!file) throw new Error('插件文件不存在');
        const pluginPath = path.join(pluginsDir, file);
        delete require.cache[require.resolve(pluginPath)];
        const pluginFunc = require(pluginPath);
        if (typeof pluginFunc !== 'function') throw new Error('插件导出不是函数');
        await pluginFunc(this);
        const name = pluginFunc.name || pluginName;
        this.pluginsMeta.set(name, {
            name, description: pluginFunc.description, usage: pluginFunc.usage,
            dependencies: pluginFunc.dependencies, file, loaded: true, enabled: true,
            destroy: pluginFunc.destroy || null
        });
        if (pluginFunc.configSchema) this.registerPluginConfigSchema(name, pluginFunc.configSchema);
        console.log(`插件 ${name} 动态加载成功`);
    }
    async hotReloadPlugin(pluginName) {
        try { await this.unloadPlugin(pluginName); } catch (e) { this.log('warn', `卸载插件 ${pluginName} 时出错: ${e.message}`); }
        await this.loadPlugin(pluginName);
    }
    async reloadPluginConfig(pluginName) {
        this.pluginConfigs.delete(pluginName);
        const newCfg = this.getPluginConfig(pluginName);
        const meta = this.pluginsMeta.get(pluginName);
        if (meta && typeof meta.onConfigReload === 'function') await meta.onConfigReload(newCfg);
        return newCfg;
    }
}

function loadMainConfig() {
    const cfgPath = path.join(__dirname, 'data', 'config.json');
    try { if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch(e) {}
    return {};
}
function loadEnabledPlugins() {
    const file = path.join(__dirname, 'data', 'plugins_enabled.json');
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) {}
    return {};
}
function saveEnabledPlugins(enabled) {
    const file = path.join(__dirname, 'data', 'plugins_enabled.json');
    try { fs.writeFileSync(file, JSON.stringify(enabled, null, 2)); } catch(e) { console.error('保存插件状态失败', e); }
}

async function ensureNpmDependencies(pluginName, npmDeps) {
    if (!npmDeps || npmDeps.length === 0) return;
    const missing = [];
    for (const dep of npmDeps) { try { require.resolve(dep); } catch(e) { missing.push(dep); } }
    if (missing.length === 0) return;
    console.log(`插件 ${pluginName} 缺失 npm 依赖: ${missing.join(', ')}，正在自动安装...`);
    for (const pkg of missing) {
        try { await execPromise(`npm install ${pkg}`, { cwd: __dirname }); console.log(`  安装 ${pkg} 成功`); }
        catch (e) { console.error(`  自动安装 ${pkg} 失败，请手动执行 npm install ${pkg}`); }
    }
}

async function loadPlugins(bot) {
    const dataDir = path.join(__dirname, 'data');
    const pluginsDataDir = path.join(dataDir, 'plugins');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(pluginsDataDir)) fs.mkdirSync(pluginsDataDir, { recursive: true });
    const pluginsDir = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsDir)) { console.log('未找到 plugins 文件夹'); return; }

    const enabledMap = loadEnabledPlugins();
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
    const plugins = new Map();

    for (const file of files) {
        const pluginPath = path.join(pluginsDir, file);
        try {
            const pluginFunc = require(pluginPath);
            if (typeof pluginFunc !== 'function') { console.warn(`插件 ${file} 没有导出函数`); continue; }
            const pluginName = pluginFunc.name || file.replace(/\.js$/, '');
            const pluginDeps = pluginFunc.dependencies || [];
            const npmDeps = pluginFunc.npmDependencies || [];
            const enabled = enabledMap[pluginName] !== false;
            plugins.set(pluginName, { file, func: pluginFunc, name: pluginName, pluginDeps, npmDeps, enabled, loaded: false });
        } catch(err) { console.error(`加载插件模块 ${file} 失败:`, err); }
    }

    const sorted = [];
    const visited = new Set();
    const visiting = new Set();
    function visit(name) {
        if (visited.has(name)) return;
        if (visiting.has(name)) throw new Error(`循环依赖: ${name}`);
        visiting.add(name);
        const plugin = plugins.get(name);
        if (plugin && plugin.enabled) {
            for (const dep of plugin.pluginDeps) {
                if (!plugins.has(dep)) throw new Error(`插件 ${name} 依赖的插件 ${dep} 不存在`);
                if (!plugins.get(dep).enabled) throw new Error(`插件 ${name} 依赖的插件 ${dep} 未启用`);
                visit(dep);
            }
        }
        visited.add(name);
        visiting.delete(name);
        if (plugin && plugin.enabled) sorted.push(name);
    }
    for (const [name, plugin] of plugins) {
        if (plugin.enabled) {
            try { visit(name); } catch(e) { console.error(`插件 ${name} 依赖错误:`, e.message); plugin.enabled = false; enabledMap[name] = false; saveEnabledPlugins(enabledMap); }
        }
    }

    for (const name of sorted) {
        const plugin = plugins.get(name);
        if (plugin && !plugin.loaded) {
            try {
                await ensureNpmDependencies(plugin.name, plugin.npmDeps);
                const result = await plugin.func(bot);
                bot.pluginsMeta.set(plugin.name, {
                    name: plugin.name, description: plugin.func.description, usage: plugin.func.usage,
                    dependencies: plugin.pluginDeps, file: plugin.file, loaded: true, enabled: true,
                    destroy: (result && result.destroy) || plugin.func.destroy || null
                });
                if (plugin.func.configSchema) bot.registerPluginConfigSchema(plugin.name, plugin.func.configSchema);
                console.log(`插件加载成功: ${plugin.name} (${plugin.file})`);
                plugin.loaded = true;
            } catch(err) {
                console.error(`插件 ${plugin.name} 执行失败:`, err);
                plugin.enabled = false; enabledMap[name] = false; saveEnabledPlugins(enabledMap);
            }
        }
    }
}

const userConfig = loadMainConfig();
const botConfig = {
    username: userConfig.username || '', password: userConfig.password || '',
    defaultRoomId: userConfig.defaultRoomId || '', roomPassword: userConfig.roomPassword || '',
    signature: userConfig.signature || 'Powered by Node.js', color: userConfig.color || '66ccff',
    logLevel: userConfig.logLevel || 'info', ownerUid: userConfig.ownerUid || '',
    ownerName: userConfig.ownerName || '', adminList: userConfig.adminList || [],
};

if (!botConfig.username || !botConfig.password) {
    console.error('错误：未配置机器人账号或密码！');
    console.error('请通过 Web 管理面板（http://localhost:' + WEBUI_PORT + '）进行配置。');
}

const bot = new IiroseBot(botConfig);
bot.encoder = encoder;

bot.registerHelp('help', '显示本帮助信息', '发送 "help" 即可');
bot.registerHelp('ping', '机器人会回复 "pong"', '发送 "ping" 即可');

async function handleHelp(msg) {
    const content = msg.message.trim();
    const match = content.match(/^(help|帮助)(?:\s+(\S+))?(?:\s+(\d+))?$/i);
    if (match) {
        const pluginName = match[2] ? match[2].toLowerCase() : null;
        const page = match[3] ? parseInt(match[3]) : 1;
        const helpText = bot.generateHelpText(pluginName, page);
        if (msg.type === 'private') await bot.sendPrivateMessage(msg.uid, helpText);
        else await bot.sendMessage(helpText);
    }
}
async function handlePing(msg) {
    if (msg.message.includes('ping')) {
        const reply = 'pong';
        if (msg.type === 'private') await bot.sendPrivateMessage(msg.uid, reply);
        else await bot.sendMessage(reply);
    }
}
bot.on('publicMessage', handleHelp);
bot.on('privateMessage', handleHelp);
bot.on('publicMessage', handlePing);
bot.on('privateMessage', handlePing);

const app = express();
const webuiPath = path.join(__dirname, 'webui');
if (!fs.existsSync(webuiPath)) fs.mkdirSync(webuiPath, { recursive: true });

app.use(session({ secret: process.env.SESSION_SECRET || 'default-secret-change-me', resave: false, saveUninitialized: true, cookie: { secure: false, httpOnly: true, maxAge: 24*60*60*1000, sameSite: 'lax' } }));
function isAuthenticated(req, res, next) {
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|map|woff2?|ttf|eot)$/)) return next();
    if (req.path === '/login.html' || req.path === '/api/login' || req.path === '/api/logout') return next();
    if (req.session.authenticated) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    res.redirect('/login.html');
}
app.use(isAuthenticated);
app.use(express.json());
app.use(express.static(webuiPath));

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const validUser = process.env.WEB_USERNAME || 'admin';
    const validPass = process.env.WEB_PASSWORD || 'admin';
    if (username === validUser && password === validPass) { req.session.authenticated = true; res.json({ success: true }); }
    else res.status(401).json({ error: '用户名或密码错误' });
});
app.get('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/status', (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime/3600), minutes = Math.floor((uptime%3600)/60), seconds = Math.floor(uptime%60);
    res.json({
        username: bot.config.username, online: bot.loggedIn, currentRoom: bot.currentRoomId,
        uptime: `${hours}h ${minutes}m ${seconds}s`, color: bot.color, signature: bot.config.signature,
        logLevel: bot.logLevel, ownerUid: bot.ownerUid, ownerName: bot.ownerName, adminList: bot.adminList,
    });
});

app.get('/api/plugins', (req, res) => {
    const plugins = [];
    for (const [name, cmdMap] of bot.pluginCommands) {
        const meta = bot.pluginsMeta.get(name);
        plugins.push({ name, commandCount: cmdMap.size, enabled: meta ? meta.enabled : true });
    }
    const enabledMap = loadEnabledPlugins();
    const pluginsDir = path.join(__dirname, 'plugins');
    if (fs.existsSync(pluginsDir)) {
        const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const pluginName = file.replace(/\.js$/, '');
            if (!plugins.find(p => p.name === pluginName)) plugins.push({ name: pluginName, commandCount: 0, enabled: enabledMap[pluginName] !== false });
        }
    }
    res.json(plugins);
});

app.get('/api/plugins/detail', (req, res) => {
    const plugins = [];
    const enabledMap = loadEnabledPlugins();
    for (const [name, meta] of bot.pluginsMeta) {
        plugins.push({
            name, description: meta.description, usage: meta.usage, dependencies: meta.dependencies || [],
            commandCount: (bot.pluginCommands.get(name) || new Map()).size, enabled: meta.enabled
        });
    }
    const pluginsDir = path.join(__dirname, 'plugins');
    if (fs.existsSync(pluginsDir)) {
        const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const pluginName = file.replace(/\.js$/, '');
            if (!plugins.find(p => p.name === pluginName)) {
                let desc='', usage='', deps=[];
                try { const pf = require(path.join(pluginsDir, file)); desc=pf.description||''; usage=pf.usage||''; deps=pf.dependencies||[]; } catch(e) {}
                plugins.push({ name: pluginName, description: desc, usage, dependencies: deps, commandCount: 0, enabled: enabledMap[pluginName] !== false });
            }
        }
    }
    res.json(plugins);
});

app.get('/api/plugins/deps-graph', (req, res) => {
    const nodes=[], edges=[];
    const enabledMap = loadEnabledPlugins();
    for (const [name, meta] of bot.pluginsMeta) {
        nodes.push({ id: name, label: name, enabled: meta.enabled });
        const deps = meta.dependencies || [];
        for (const dep of deps) edges.push({ from: name, to: dep });
    }
    const pluginsDir = path.join(__dirname, 'plugins');
    if (fs.existsSync(pluginsDir)) {
        const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const pluginName = file.replace(/\.js$/, '');
            if (!nodes.find(n => n.id === pluginName)) {
                nodes.push({ id: pluginName, label: pluginName, enabled: enabledMap[pluginName] !== false });
                try { const pf = require(path.join(pluginsDir, file)); for (const dep of (pf.dependencies||[])) edges.push({ from: pluginName, to: dep }); } catch(e) {}
            }
        }
    }
    res.json({ nodes, edges });
});

app.get('/api/logs', (req, res) => { const limit = parseInt(req.query.limit) || 20; res.json(recentLogs.slice(-limit)); });

app.get('/api/config/main', (req, res) => {
    const cfgPath = path.join(__dirname, 'data', 'config.json');
    try { res.json(fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}); } catch(e) { res.status(500).json({ error: '读取主配置失败' }); }
});
app.post('/api/config/main', (req, res) => {
    const cfgPath = path.join(__dirname, 'data', 'config.json');
    try { fs.writeFileSync(cfgPath, JSON.stringify(req.body, null, 2)); res.json({ success: true }); } catch(e) { res.status(500).json({ error: '保存主配置失败' }); }
});

app.get('/api/config/plugin/:pluginName', (req, res) => {
    const cfgPath = path.join(__dirname, 'data', 'plugins', req.params.pluginName, 'config.json');
    try { res.json(fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}); } catch(e) { res.status(500).json({ error: '读取插件配置失败' }); }
});
app.post('/api/config/plugin/:pluginName', (req, res) => {
    const pluginName = req.params.pluginName;
    const cfgDir = path.join(__dirname, 'data', 'plugins', pluginName);
    const cfgPath = path.join(cfgDir, 'config.json');
    try {
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
        fs.writeFileSync(cfgPath, JSON.stringify(req.body, null, 2));
        bot.reloadPluginConfig(pluginName);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: '保存插件配置失败' }); }
});

app.get('/api/plugin/schema/:pluginName', (req, res) => { res.json(bot.pluginSchemas.get(req.params.pluginName) || {}); });

app.post('/api/plugin/toggle', async (req, res) => {
    const { pluginName, enabled } = req.body;
    const enabledMap = loadEnabledPlugins();
    const wasEnabled = enabledMap[pluginName] !== false;
    if (enabled === wasEnabled) return res.json({ success: true });
    enabledMap[pluginName] = enabled;
    saveEnabledPlugins(enabledMap);
    try {
        if (enabled) await bot.loadPlugin(pluginName);
        else await bot.unloadPlugin(pluginName);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/plugin/reload/:pluginName', async (req, res) => {
    try { await bot.hotReloadPlugin(req.params.pluginName); res.json({ success: true }); }
    catch(err) { console.error(`重载插件 ${req.params.pluginName} 失败:`, err); res.status(500).json({ error: err.message }); }
});

app.post('/api/plugin/reload-config/:pluginName', async (req, res) => {
    try { const newCfg = await bot.reloadPluginConfig(req.params.pluginName); res.json({ success: true, config: newCfg }); }
    catch(err) { res.status(500).json({ error: err.message }); }
});

// ==================== 插件市场 API ====================
const PLUGINS_DIR = path.join(__dirname, 'plugins');

function compareVersions(v1, v2) {
    const toNum = v => v.split('.').map(n => parseInt(n, 10) || 0);
    const a1 = toNum(v1), a2 = toNum(v2);
    for (let i = 0; i < Math.max(a1.length, a2.length); i++) {
        const n1 = a1[i] || 0, n2 = a2[i] || 0;
        if (n1 !== n2) return n1 - n2;
    }
    return 0;
}

app.get('/api/market/list', async (req, res) => {
    if (!fetch) {
        return res.status(500).json({ error: 'fetch 不可用，请升级 Node.js 或安装 node-fetch' });
    }
    try {
        const response = await fetch(MARKET_INDEX_URL);
        if (!response.ok) throw new Error(`获取市场索引失败: ${response.status}`);
        const data = await response.json();
        const installedPlugins = loadEnabledPlugins();
        const pluginsWithStatus = data.plugins.map(p => {
            const localPath = path.join(PLUGINS_DIR, `${p.name}.js`);
            let installed = false, installedVersion = null, hasUpdate = false;
            if (fs.existsSync(localPath)) {
                installed = true;
                try {
                    const pluginModule = require(localPath);
                    installedVersion = pluginModule.version || '0.0.0';
                    hasUpdate = compareVersions(p.version, installedVersion) > 0;
                } catch (e) {}
            }
            return {
                ...p,
                installed,
                installedVersion,
                hasUpdate,
                enabled: installed && installedPlugins[p.name] !== false
            };
        });
        res.json({ success: true, plugins: pluginsWithStatus });
    } catch (err) {
        console.error('获取市场列表失败:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/market/install', async (req, res) => {
    if (!fetch) return res.status(500).json({ error: 'fetch 不可用' });
    const { pluginName, downloadUrl, version } = req.body;
    if (!pluginName || !downloadUrl) return res.status(400).json({ error: '缺少必要参数' });
    const targetPath = path.join(PLUGINS_DIR, `${pluginName}.js`);
    const backupPath = targetPath + '.backup';
    try {
        if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, backupPath);
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`下载失败: ${response.status}`);
        const code = await response.text();
        fs.writeFileSync(targetPath, code, 'utf8');
        delete require.cache[require.resolve(targetPath)];
        if (bot && bot.pluginsMeta) {
            const enabledMap = loadEnabledPlugins();
            if (enabledMap[pluginName] !== false) {
                try { await bot.hotReloadPlugin(pluginName); }
                catch (e) { console.warn(`热重载插件 ${pluginName} 失败:`, e.message); }
            }
        }
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        res.json({ success: true, message: `插件 ${pluginName} 安装成功` });
    } catch (err) {
        console.error('安装插件失败:', err);
        if (fs.existsSync(backupPath)) { fs.copyFileSync(backupPath, targetPath); fs.unlinkSync(backupPath); }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/market/uninstall', async (req, res) => {
    const { pluginName } = req.body;
    const targetPath = path.join(PLUGINS_DIR, `${pluginName}.js`);
    try {
        if (!fs.existsSync(targetPath)) return res.status(404).json({ error: '插件文件不存在' });
        if (bot.pluginsMeta && bot.pluginsMeta.has(pluginName)) await bot.unloadPlugin(pluginName);
        fs.unlinkSync(targetPath);
        const enabledMap = loadEnabledPlugins();
        delete enabledMap[pluginName];
        saveEnabledPlugins(enabledMap);
        res.json({ success: true, message: `插件 ${pluginName} 已卸载` });
    } catch (err) {
        console.error('卸载插件失败:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/system/restart', (req, res) => {
    res.json({ success: true });
    setTimeout(() => { console.log('正在重启...'); process.exit(0); }, 1000);
});

const statsFile = path.join(__dirname, 'data', 'online_stats.json');
app.get('/api/stats/online', (req, res) => {
    let data = [];
    try { if (fs.existsSync(statsFile)) data = JSON.parse(fs.readFileSync(statsFile)); } catch(e) {}
    res.json(data);
});

const server = app.listen(WEBUI_PORT, () => { console.log(`Web 管理面板已启动，访问 http://localhost:${WEBUI_PORT}`); });
const wss = new WebSocket.Server({ server });
global.broadcastLog = (msg) => { wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ time: new Date().toISOString(), message: msg })); }); };

function recordOnlineCount() {
    const roomUsers = Array.from(bot.userListCache.values()).filter(u => u.room === bot.currentRoomId);
    const count = roomUsers.length;
    let stats = [];
    try { if (fs.existsSync(statsFile)) stats = JSON.parse(fs.readFileSync(statsFile)); } catch(e) {}
    stats.push({ time: Date.now(), count, roomId: bot.currentRoomId });
    if (stats.length > 288) stats.shift();
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

if (botConfig.username && botConfig.password) {
    bot.start().then(() => {
        loadPlugins(bot);
        bot.schedule('*/5 * * * *', () => recordOnlineCount());
        setTimeout(recordOnlineCount, 5000);
    }).catch(err => console.error('机器人启动失败', err));
} else {
    console.warn('机器人未配置账号密码，将不会连接蔷薇花园。请通过 Web 面板配置后重启。');
}

process.on('SIGINT', () => {
    console.log('\n收到退出信号，正在关闭...');
    if (wss) { wss.clients.forEach(c => c.close()); wss.close(); }
    server.close(() => { bot.stop(); process.exit(0); });
    setTimeout(() => { console.log('强制退出'); process.exit(1); }, 5000);
});
