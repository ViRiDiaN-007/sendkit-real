# SendKit Dashboard - VPS Deployment Guide

This guide will help you deploy your SendKit Dashboard to a VPS with nginx, SSL, and PM2 process management.

## Prerequisites

- Ubuntu 20.04+ VPS
- Root or sudo access
- Domain name pointing to your VPS IP
- Basic knowledge of Linux commands

## Quick Deployment

1. **Upload your project files** to your VPS
2. **Run the deployment script**:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
3. **Follow the prompts** to enter your domain name
4. **Access your dashboard** at `https://yourdomain.com`

## Manual Deployment Steps

### 1. System Setup

```bash
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
```

### 2. Application Setup

```bash
# Create application directory
sudo mkdir -p /var/www/sendkit-dashboard
sudo chown $USER:$USER /var/www/sendkit-dashboard

# Copy your project files
cp -r . /var/www/sendkit-dashboard/
cd /var/www/sendkit-dashboard

# Install dependencies
npm ci --only=production

# Build CSS
npm run build:css

# Create production environment
cat > .env << EOF
NODE_ENV=production
PORT=3000
BROWSER_SOURCE_BASE_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
SESSION_SECRET=$(openssl rand -base64 32)
DB_PATH=/var/www/sendkit-dashboard/data/database.sqlite
EOF

# Create data directory
mkdir -p data
chmod 755 data
```

### 3. Nginx Configuration

```bash
# Update nginx config with your domain
sed -i "s/your-domain.com/yourdomain.com/g" nginx.conf

# Copy nginx config
sudo cp nginx.conf /etc/nginx/sites-available/sendkit-dashboard
sudo ln -sf /etc/nginx/sites-available/sendkit-dashboard /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4. SSL Certificate

```bash
# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com --non-interactive --agree-tos --email admin@yourdomain.com
```

### 5. PM2 Service Setup

```bash
# Copy service file
sudo cp sendkit.service /etc/systemd/system/

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable sendkit
sudo systemctl start sendkit
```

## Configuration Files

### nginx.conf
- Reverse proxy to Node.js app on port 3000
- SSL termination with Let's Encrypt
- Rate limiting for API and auth routes
- WebSocket support for Socket.IO
- Static file caching
- Security headers

### sendkit.service
- Systemd service for PM2
- Auto-restart on failure
- Runs as www-data user
- Production environment

### ecosystem.config.js
- PM2 process configuration
- Production environment variables
- Process management settings

## Environment Variables

Create a `.env` file with:

```env
NODE_ENV=production
PORT=3000
BROWSER_SOURCE_BASE_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
SESSION_SECRET=your-secret-key
DB_PATH=/var/www/sendkit-dashboard/data/database.sqlite
```

## Browser Source URLs

After deployment, your browser source URLs will be:

- **Poll Browser Source**: `https://yourdomain.com/browser-source/poll?streamer=STREAMER_ID`
- **TTS Browser Source**: `https://yourdomain.com/browser-source/tts?streamer=STREAMER_ID`

## Management Commands

```bash
# Check application status
sudo systemctl status sendkit

# View application logs
sudo journalctl -u sendkit -f

# Restart application
sudo systemctl restart sendkit

# Stop application
sudo systemctl stop sendkit

# Check PM2 processes
pm2 status

# View PM2 logs
pm2 logs

# Restart PM2 processes
pm2 restart all
```

## Updating the Application

1. **Upload new files** to `/var/www/sendkit-dashboard/`
2. **Install dependencies**: `npm ci --only=production`
3. **Build CSS**: `npm run build:css`
4. **Restart service**: `sudo systemctl restart sendkit`

## Security Considerations

- SSL certificates are automatically renewed
- Rate limiting prevents abuse
- Security headers protect against common attacks
- Application runs as non-root user
- Database is stored in a protected directory

## Troubleshooting

### Application won't start
```bash
# Check logs
sudo journalctl -u sendkit -f

# Check PM2 status
pm2 status

# Check nginx config
sudo nginx -t
```

### SSL issues
```bash
# Check certificate status
sudo certbot certificates

# Renew certificates
sudo certbot renew --dry-run
```

### Database issues
```bash
# Check database permissions
ls -la /var/www/sendkit-dashboard/data/

# Fix permissions if needed
sudo chown -R www-data:www-data /var/www/sendkit-dashboard/data/
```

## Monitoring

- **Application logs**: `sudo journalctl -u sendkit -f`
- **Nginx logs**: `sudo tail -f /var/log/nginx/sendkit_access.log`
- **Error logs**: `sudo tail -f /var/log/nginx/sendkit_error.log`
- **PM2 monitoring**: `pm2 monit`

## Backup

```bash
# Backup database
cp /var/www/sendkit-dashboard/data/database.sqlite /backup/database-$(date +%Y%m%d).sqlite

# Backup application
tar -czf /backup/sendkit-$(date +%Y%m%d).tar.gz /var/www/sendkit-dashboard/
```

## Support

If you encounter issues:
1. Check the logs using the commands above
2. Verify all configuration files are correct
3. Ensure your domain is properly configured
4. Check that all services are running

Your SendKit Dashboard should now be live and accessible at `https://yourdomain.com`! 🚀

