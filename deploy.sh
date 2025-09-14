#!/bin/bash

# SendKit Dashboard Deployment Script
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
DOMAIN=""

echo -e "${BLUE}🚀 SendKit Dashboard Deployment Script${NC}"
echo "=================================="

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ This script should not be run as root. Please run as a regular user with sudo privileges.${NC}"
   exit 1
fi

# Get domain name
read -p "Enter your domain name (e.g., yourdomain.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}❌ Domain name is required${NC}"
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
BROWSER_SOURCE_BASE_URL=https://$DOMAIN
CORS_ORIGIN=https://$DOMAIN
SESSION_SECRET=$(openssl rand -base64 32)
DB_PATH=/var/www/sendkit-dashboard/data/database.sqlite
EOF

# Create data directory
mkdir -p data
chmod 755 data

echo -e "${YELLOW}🔧 Configuring nginx...${NC}"

# Update nginx config with domain
sed -i "s/your-domain.com/$DOMAIN/g" nginx.conf

# Copy nginx config
sudo cp nginx.conf $NGINX_SITES/sendkit-dashboard
sudo ln -sf $NGINX_SITES/sendkit-dashboard $NGINX_ENABLED/

# Remove default nginx site
sudo rm -f $NGINX_ENABLED/default

# Test nginx config
sudo nginx -t

echo -e "${YELLOW}🔒 Setting up SSL certificate...${NC}"

# Get SSL certificate
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

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
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Your application is running at: https://$DOMAIN"
echo "2. Check status: sudo systemctl status sendkit"
echo "3. View logs: sudo journalctl -u sendkit -f"
echo "4. Restart app: sudo systemctl restart sendkit"
echo "5. Update app: Run this script again after making changes"
echo ""
echo -e "${BLUE}🔗 Browser Source URLs:${NC}"
echo "• Poll Browser Source: https://$DOMAIN/browser-source/poll?streamer=YOUR_STREAMER_ID"
echo "• TTS Browser Source: https://$DOMAIN/browser-source/tts?streamer=YOUR_STREAMER_ID"
echo ""
echo -e "${GREEN}🎉 SendKit Dashboard is now live!${NC}"

