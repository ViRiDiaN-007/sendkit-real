#!/bin/bash

# SendKit Dashboard Deployment Script from GitHub
# Run this script on your VPS to deploy the application from GitHub

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="sendkit-dashboard"
APP_DIR="/var/www/sendkit-dashboard"
NGINX_SITES="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
SERVICE_FILE="sendkit.service"
DOMAIN="sendkit.fun"
GITHUB_REPO="your-username/sendkit-dashboard"  # Replace with your actual GitHub repo
BRANCH="main"  # or "master" depending on your default branch

echo -e "${BLUE}🚀 SendKit Dashboard Deployment from GitHub${NC}"
echo "=================================="
echo -e "${BLUE}Repository: ${GITHUB_REPO}${NC}"
echo -e "${BLUE}Branch: ${BRANCH}${NC}"
echo -e "${BLUE}Domain: ${DOMAIN}${NC}"
echo ""

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ This script should not be run as root. Please run as a regular user with sudo privileges.${NC}"
   exit 1
fi

echo -e "${YELLOW}📋 Checking system dependencies...${NC}"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}📦 Installing git...${NC}"
    sudo apt update
    sudo apt install -y git
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}📦 Installing PM2...${NC}"
    sudo npm install -g pm2
fi

echo -e "${YELLOW}📁 Setting up application directory...${NC}"

# Create application directory if it doesn't exist
if [ ! -d "$APP_DIR" ]; then
    sudo mkdir -p $APP_DIR
    sudo chown $USER:$USER $APP_DIR
fi

# Navigate to app directory
cd $APP_DIR

# Check if it's a git repository
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}📦 Cloning repository...${NC}"
    git clone https://github.com/${GITHUB_REPO}.git .
else
    echo -e "${YELLOW}📦 Updating repository...${NC}"
    git fetch origin
    git reset --hard origin/${BRANCH}
fi

# Install/update dependencies
echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
npm ci --only=production

# Build CSS
echo -e "${YELLOW}🎨 Building CSS...${NC}"
npm run build:css

# Create production environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚙️ Creating production environment...${NC}"
    cat > .env << EOF
NODE_ENV=production
PORT=3000
BROWSER_SOURCE_BASE_URL=https://sendkit.fun
CORS_ORIGIN=https://sendkit.fun
SESSION_SECRET=$(openssl rand -base64 32)
DB_PATH=/var/www/sendkit-dashboard/data/database.sqlite
DB_TYPE=sqlite
EOF
fi

# Create data directory
mkdir -p data
chmod 755 data

echo -e "${YELLOW}🔧 Checking nginx configuration...${NC}"

# Check if nginx config exists
if [ ! -f "nginx.conf" ]; then
    echo -e "${RED}❌ nginx.conf not found in repository!${NC}"
    exit 1
fi

# Copy nginx config
sudo cp nginx.conf $NGINX_SITES/sendkit-dashboard
sudo ln -sf $NGINX_SITES/sendkit-dashboard $NGINX_ENABLED/

# Remove default nginx site
sudo rm -f $NGINX_ENABLED/default

# Test nginx config
sudo nginx -t

echo -e "${YELLOW}🔧 Checking systemd service...${NC}"

# Check if service file exists
if [ ! -f "$SERVICE_FILE" ]; then
    echo -e "${RED}❌ ${SERVICE_FILE} not found in repository!${NC}"
    exit 1
fi

# Copy service file
sudo cp $SERVICE_FILE /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable sendkit

echo -e "${YELLOW}🚀 Restarting services...${NC}"

# Restart the application
sudo systemctl restart sendkit

# Reload nginx
sudo systemctl reload nginx

# Check if services are running
echo -e "${YELLOW}🔍 Checking service status...${NC}"
sudo systemctl status sendkit --no-pager
sudo systemctl status nginx --no-pager

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Your SendKit Dashboard is now live!${NC}"
echo "🌐 Website: https://sendkit.fun"
echo ""
echo -e "${BLUE}🔗 Browser Source URLs:${NC}"
echo "• Poll Browser Source: https://sendkit.fun/browser-source/poll?streamer=YOUR_STREAMER_ID"
echo "• TTS Browser Source: https://sendkit.fun/browser-source/tts?streamer=YOUR_STREAMER_ID"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo "• Check status: sudo systemctl status sendkit"
echo "• View logs: sudo journalctl -u sendkit -f"
echo "• Restart app: sudo systemctl restart sendkit"
echo "• Check nginx: sudo systemctl status nginx"
echo ""
echo -e "${GREEN}🎉 SendKit Dashboard updated from GitHub!${NC}"


