#!/bin/bash
# 蔷薇花园机器人一键安装脚本
# 适用于 Ubuntu / Debian / CentOS 7+

set -e

echo "========================================"
echo "   蔷薇花园机器人 一键安装脚本"
echo "========================================"

# 检测操作系统
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "无法检测操作系统，退出"
    exit 1
fi

# 安装 Node.js 和 npm
install_node() {
    echo "正在安装 Node.js 18.x..."
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ] || [ "$OS" = "fedora" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo "请手动安装 Node.js 18+ 和 npm"
        exit 1
    fi
}

# 检查 Node.js
if ! command -v node &> /dev/null; then
    install_node
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "Node.js 版本过低，需要 18+，正在升级..."
        install_node
    fi
fi

# 检查 git
if ! command -v git &> /dev/null; then
    echo "正在安装 git..."
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        sudo apt-get update && sudo apt-get install -y git
    else
        sudo yum install -y git
    fi
fi

# 克隆仓库
REPO_URL="https://github.com/ixix-info/iirose-bot.git"
INSTALL_DIR="$HOME/iirose-bot"
if [ -d "$INSTALL_DIR" ]; then
    echo "目录 $INSTALL_DIR 已存在，请手动删除或备份后重新运行"
    exit 1
fi

echo "正在克隆仓库..."
git clone "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 安装依赖
echo "正在安装 Node.js 依赖..."
npm install ws cron express lru-cache winston winston-daily-rotate-file express-session

# 创建必要目录
mkdir -p data plugins webui logs

# 生成默认配置文件
cat > data/config.json <<EOF
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
EOF

cat > data/plugins_enabled.json <<EOF
{}
EOF

# 创建启动脚本
cat > start.sh <<EOF
#!/bin/bash
cd "$INSTALL_DIR"
export WEBUI_PORT=8080
export WEB_USERNAME=admin
export WEB_PASSWORD=admin
node bot.js
EOF
chmod +x start.sh

echo "========================================"
echo "安装完成！"
echo "启动命令：cd $INSTALL_DIR && ./start.sh"
echo "Web 管理面板地址：http://服务器IP:8080"
echo "默认登录账号：admin / admin"
echo "请务必修改默认密码！"
echo "========================================"
