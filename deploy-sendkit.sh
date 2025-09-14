#!/bin/bash

# SendKit Dashboard Deployment Script for sendkit.fun
# Run this script on your VPS to deploy the application

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
IP="198.187.28.93"

echo -e "${BLUE}🚀 SendKit Dashboard Deployment Script${NC}"
echo "=================================="
echo -e "${BLUE}Domain: ${DOMAIN}${NC}"
echo -e "${BLUE}IP: ${IP}${NC}"
echo ""

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ This script should not be run as root. Please run as a regular user with sudo privileges.${NC}"
   exit 1
fi

echo -e "${YELLOW}📋 Installing system dependencies...${NC}"

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install nginx
sudo apt install -y nginx

# Install certbot for SSL
sudo apt install -y certbot python3-certbot-nginx

echo -e "${YELLOW}📁 Setting up application directory...${NC}"

# Create application directory
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Copy application files (assuming you're running this from the project directory)
echo -e "${YELLOW}📦 Copying application files...${NC}"
cp -r . $APP_DIR/
cd $APP_DIR

# Install dependencies
echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
npm ci --only=production

# Build CSS
echo -e "${YELLOW}🎨 Building CSS...${NC}"
npm run build:css

# Create production environment file
echo -e "${YELLOW}⚙️ Creating production environment...${NC}"
cat > .env << EOF
NODE_ENV=production
PORT=3000
BROWSER_SOURCE_BASE_URL=https://sendkit.fun
CORS_ORIGIN=https://sendkit.fun
SESSION_SECRET=$(openssl rand -base64 32)
DB_PATH=/var/www/sendkit-dashboard/data/database.sqlite
EOF

# Create data directory
mkdir -p data
chmod 755 data

echo -e "${YELLOW}🔧 Configuring nginx...${NC}"

# Copy nginx config
sudo cp nginx.conf $NGINX_SITES/sendkit-dashboard
sudo ln -sf $NGINX_SITES/sendkit-dashboard $NGINX_ENABLED/

# Remove default nginx site
sudo rm -f $NGINX_ENABLED/default

# Test nginx config
sudo nginx -t

echo -e "${YELLOW}🔒 Setting up SSL certificate...${NC}"

# Get SSL certificate
sudo certbot --nginx -d sendkit.fun -d www.sendkit.fun --non-interactive --agree-tos --email admin@sendkit.fun

echo -e "${YELLOW}🔧 Setting up systemd service...${NC}"

# Copy service file
sudo cp $SERVICE_FILE /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable sendkit

echo -e "${YELLOW}🚀 Starting services...${NC}"

# Start the application
sudo systemctl start sendkit

# Reload nginx
sudo systemctl reload nginx

# Enable nginx
sudo systemctl enable nginx

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Your SendKit Dashboard is now live!${NC}"
echo "🌐 Website: https://sendkit.fun"
echo "🔗 IP Address: 198.187.28.93"
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
echo -e "${GREEN}🎉 SendKit Dashboard is now live at https://sendkit.fun!${NC}"

