#!/bin/bash
# 蔷薇花园机器人 - 一键安装脚本
# 支持 Termux、Ubuntu/Debian、CentOS/RHEL、Fedora、Arch Linux

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   蔷薇花园机器人 一键安装脚本${NC}"
echo -e "${GREEN}========================================${NC}"

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    elif command -v termux-info >/dev/null 2>&1; then
        OS="termux"
    else
        OS="unknown"
    fi
    echo -e "${YELLOW}检测到系统: $OS${NC}"
}

# 安装 Node.js (18+)
install_node() {
    echo -e "${YELLOW}正在安装 Node.js 18+...${NC}"
    case "$OS" in
        termux)
            pkg update -y
            pkg install -y nodejs-lts git
            ;;
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs git
            ;;
        centos|rhel|fedora)
            if command -v dnf >/dev/null; then
                sudo dnf module enable -y nodejs:18
                sudo dnf install -y nodejs git
            else
                curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
                sudo yum install -y nodejs git
            fi
            ;;
        arch)
            sudo pacman -S --noconfirm nodejs npm git
            ;;
        *)
            echo -e "${RED}不支持的操作系统，请手动安装 Node.js 18+ 和 git${NC}"
            exit 1
            ;;
    esac
}

# 安装编译工具（某些 npm 包可能需要）
install_build_tools() {
    echo -e "${YELLOW}安装编译工具...${NC}"
    case "$OS" in
        termux)
            pkg install -y binutils
            ;;
        ubuntu|debian)
            sudo apt-get install -y build-essential
            ;;
        centos|rhel|fedora)
            if command -v dnf >/dev/null; then
                sudo dnf groupinstall -y "Development Tools"
            else
                sudo yum groupinstall -y "Development Tools"
            fi
            ;;
        arch)
            sudo pacman -S --noconfirm base-devel
            ;;
        *)
            echo -e "${YELLOW}跳过编译工具安装，请确保系统已安装 make/gcc${NC}"
            ;;
    esac
}

# 克隆或创建项目目录
setup_project() {
    PROJECT_DIR="$HOME/iirose-bot"
    if [ -d "$PROJECT_DIR" ]; then
        echo -e "${YELLOW}目录 $PROJECT_DIR 已存在，将使用现有目录${NC}"
        cd "$PROJECT_DIR"
        # 拉取最新代码（如果 git 仓库存在）
        if [ -d .git ]; then
            git pull
        fi
    else
        echo -e "${YELLOW}正在创建项目目录...${NC}"
        mkdir -p "$PROJECT_DIR"
        cd "$PROJECT_DIR"
        # 尝试从 GitHub 克隆，如果失败则手动创建文件
        if command -v git >/dev/null && git clone https://github.com/ixix-info/iirose-bot.git . 2>/dev/null; then
            echo -e "${GREEN}从 GitHub 克隆成功${NC}"
        else
            echo -e "${YELLOW}无法克隆仓库，将创建默认文件（请手动放置 bot.js 和 webui/index.html）${NC}"
            mkdir -p data plugins webui logs
            # 创建空白的启动脚本，稍后填充
        fi
    fi
}

# 安装 npm 依赖
install_deps() {
    echo -e "${YELLOW}正在安装 Node.js 依赖...${NC}"
    npm install ws cron express lru-cache winston winston-daily-rotate-file express-session
    echo -e "${GREEN}依赖安装完成${NC}"
}

# 创建默认配置文件
create_default_config() {
    echo -e "${YELLOW}创建默认配置文件...${NC}"
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
    echo -e "${GREEN}配置文件已创建，请通过 Web 管理面板配置${NC}"
}

# 生成启动脚本
create_start_script() {
    cat > start.sh <<EOF
#!/bin/bash
cd "$PROJECT_DIR"
export WEBUI_PORT=8080
export WEB_USERNAME=admin
export WEB_PASSWORD=admin
node bot.js
EOF
    chmod +x start.sh
    echo -e "${GREEN}启动脚本已创建: $PROJECT_DIR/start.sh${NC}"
}

# 输出使用说明
show_usage() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}安装完成！${NC}"
    echo -e "${GREEN}启动命令：cd $PROJECT_DIR && ./start.sh${NC}"
    echo -e "${GREEN}Web 管理面板地址：http://localhost:8080${NC}"
    echo -e "${GREEN}默认登录账号：admin / admin${NC}"
    echo -e "${YELLOW}请务必修改默认密码！${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# 主流程
main() {
    detect_os
    if ! command -v node >/dev/null 2>&1; then
        install_node
    else
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            echo -e "${YELLOW}Node.js 版本过低（当前 $NODE_VERSION），正在升级...${NC}"
            install_node
        else
            echo -e "${GREEN}Node.js 版本满足要求${NC}"
        fi
    fi
    if ! command -v git >/dev/null 2>&1 && [ "$OS" != "termux" ]; then
        echo -e "${YELLOW}git 未安装，正在安装...${NC}"
        case "$OS" in
            ubuntu|debian) sudo apt-get install -y git ;;
            centos|rhel|fedora) sudo yum install -y git ;;
            arch) sudo pacman -S --noconfirm git ;;
        esac
    fi
    # Termux 下已通过 pkg 安装 git
    install_build_tools
    setup_project
    cd "$PROJECT_DIR"
    install_deps
    create_default_config
    create_start_script
    show_usage
}

main "$@"
