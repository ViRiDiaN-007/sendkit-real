#!/bin/bash

# SendKit Dashboard Deployment Script for sendkit.fun (ROOT VERSION)
# Run this script as root on your VPS to deploy the application

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

echo -e "${BLUE}🚀 SendKit Dashboard Deployment Script (Root Version)${NC}"
echo "=================================="
echo -e "${BLUE}Domain: ${DOMAIN}${NC}"
echo -e "${BLUE}IP: ${IP}${NC}"
echo ""

echo -e "${YELLOW}📋 Installing system dependencies...${NC}"

# Update system
apt update && apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install nginx
apt install -y nginx

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

echo -e "${YELLOW}📁 Setting up application directory...${NC}"

# Create application directory
mkdir -p $APP_DIR
chown -R www-data:www-data $APP_DIR

# Install dependencies
echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
cd $APP_DIR
npm ci

# Build CSS
echo -e "${YELLOW}🎨 Building CSS...${NC}"
npx tailwindcss -i ./src/css/input.css -o ./public/css/style.css

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
chown -R www-data:www-data data

echo -e "${YELLOW}🔧 Configuring nginx...${NC}"

# Copy nginx config
cp nginx.conf $NGINX_SITES/sendkit-dashboard
ln -sf $NGINX_SITES/sendkit-dashboard $NGINX_ENABLED/

# Remove default nginx site
rm -f $NGINX_ENABLED/default

# Test nginx config
nginx -t

echo -e "${YELLOW}🔒 Setting up SSL certificate...${NC}"

# Get SSL certificate
certbot --nginx -d sendkit.fun -d www.sendkit.fun --non-interactive --agree-tos --email admin@sendkit.fun

echo -e "${YELLOW}🔧 Setting up systemd service...${NC}"

# Copy service file
cp $SERVICE_FILE /etc/systemd/system/
systemctl daemon-reload
systemctl enable sendkit

echo -e "${YELLOW}🚀 Starting services...${NC}"

# Start the application
systemctl start sendkit

# Reload nginx
systemctl reload nginx

# Enable nginx
systemctl enable nginx

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
echo "• Check status: systemctl status sendkit"
echo "• View logs: journalctl -u sendkit -f"
echo "• Restart app: systemctl restart sendkit"
echo "• Check nginx: systemctl status nginx"
echo ""
echo -e "${GREEN}🎉 SendKit Dashboard is now live at https://sendkit.fun!${NC}"
