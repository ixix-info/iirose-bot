#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   蔷薇花园机器人 一键安装脚本${NC}"
echo -e "${GREEN}========================================${NC}"

# 检测系统类型
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
    elif command -v termux-setup-storage &>/dev/null; then
        OS="termux"
    else
        echo -e "${RED}无法检测操作系统，退出${NC}"
        exit 1
    fi
}

# 安装 Node.js 18+ (根据不同系统)
install_node() {
    echo -e "${YELLOW}正在安装 Node.js 18+...${NC}"
    case "$OS" in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        centos|rhel|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
            if command -v dnf &>/dev/null; then
                sudo dnf install -y nodejs
            else
                sudo yum install -y nodejs
            fi
            ;;
        arch)
            sudo pacman -S --noconfirm nodejs npm
            ;;
        termux)
            pkg update -y
            pkg install -y nodejs-lts
            ;;
        *)
            echo -e "${RED}不支持的系统，请手动安装 Node.js 18+${NC}"
            exit 1
            ;;
    esac
}

# 安装 git
install_git() {
    echo -e "${YELLOW}正在安装 git...${NC}"
    case "$OS" in
        ubuntu|debian)
            sudo apt-get update && sudo apt-get install -y git
            ;;
        centos|rhel|fedora)
            if command -v dnf &>/dev/null; then
                sudo dnf install -y git
            else
                sudo yum install -y git
            fi
            ;;
        arch)
            sudo pacman -S --noconfirm git
            ;;
        termux)
            pkg install -y git
            ;;
        *)
            echo -e "${RED}请手动安装 git${NC}"
            exit 1
            ;;
    esac
}

# 主流程
detect_os

# 检查并安装 Node.js
if ! command -v node &> /dev/null; then
    install_node
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${YELLOW}Node.js 版本过低，正在升级...${NC}"
        install_node
    fi
fi

# 检查并安装 git
if ! command -v git &> /dev/null; then
    install_git
fi

# 设置安装目录 (Termux 使用内部存储，避免权限问题)
if [ "$OS" = "termux" ]; then
    INSTALL_DIR="$HOME/iirose-bot"
else
    INSTALL_DIR="$HOME/iirose-bot"
fi

# 删除旧目录（如果存在）
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}删除旧目录 $INSTALL_DIR ...${NC}"
    rm -rf "$INSTALL_DIR"
fi

# 克隆仓库
echo -e "${YELLOW}正在克隆仓库...${NC}"
git clone https://github.com/ixix-info/iirose-bot.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 安装依赖
echo -e "${YELLOW}正在安装 Node.js 依赖...${NC}"
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

# 下载 ECharts（用于 Web 图表）
echo -e "${YELLOW}下载 ECharts 本地库...${NC}"
curl -o webui/echarts.min.js https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js

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

# Termux 特殊处理：创建快捷启动文件
if [ "$OS" = "termux" ]; then
    mkdir -p "$HOME/.shortcuts"
    cat > "$HOME/.shortcuts/iirose-bot" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
cd "$INSTALL_DIR"
./start.sh
EOF
    chmod +x "$HOME/.shortcuts/iirose-bot"
    echo -e "${GREEN}已创建 Termux 快捷启动脚本，可在桌面添加快捷方式。${NC}"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}安装完成！${NC}"
echo -e "${GREEN}启动命令：cd $INSTALL_DIR && ./start.sh${NC}"
echo -e "${GREEN}Web 管理面板地址：http://localhost:8080${NC}"
echo -e "${GREEN}默认登录账号：admin / admin${NC}"
echo -e "${RED}请务必修改默认密码！${NC}"
echo -e "${GREEN}========================================${NC}"
