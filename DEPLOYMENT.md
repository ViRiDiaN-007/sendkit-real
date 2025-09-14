# 🚀 Deployment Guide

This guide will help you deploy the Pump.fun Streamer Dashboard to a web server with configurable browser source URLs.

## 📋 Prerequisites

- Node.js 18+ installed on your server
- A domain name pointing to your server
- SSL certificate (recommended for production)
- Reverse proxy (Nginx/Apache) configured

## 🔧 Environment Configuration

### 1. Create Production Environment File

Copy the example environment file and configure it for production:

```bash
cp env.example .env.production
```

### 2. Configure Environment Variables

Edit `.env.production` with your production settings:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DB_PATH=/var/lib/pump-dashboard/streamers.db

# Session Secret (generate a strong random string)
SESSION_SECRET=your-super-secure-production-secret-key-here

# Pump.fun Configuration
PUMP_API_URL=https://frontend-api.pump.fun
PUMP_CHAT_URL=wss://pump.fun/ws

# TTS Configuration
TTS_SERVICE_URL=http://localhost:3001
TTS_API_KEY=your-tts-api-key

# Poll Configuration
POLL_SERVICE_URL=http://localhost:4000

# CORS Configuration
CORS_ORIGIN=https://yourdomain.com

# Browser Source Configuration
# IMPORTANT: Set this to your production domain
BROWSER_SOURCE_BASE_URL=https://yourdomain.com

# Admin Configuration
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your-secure-admin-password
```

### 3. Key Configuration Notes

- **BROWSER_SOURCE_BASE_URL**: This is the most important setting for deployment. Set it to your production domain (e.g., `https://yourdomain.com`)
- **CORS_ORIGIN**: Should match your domain
- **SESSION_SECRET**: Generate a strong, random secret key
- **DB_PATH**: Use an absolute path for production

## 🐳 Docker Deployment (Recommended)

### 1. Create Dockerfile

```dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build CSS
RUN npm run build:css

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Create database directory
RUN mkdir -p /var/lib/pump-dashboard
RUN chown -R nextjs:nodejs /var/lib/pump-dashboard

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["npm", "start"]
```

### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  pump-dashboard:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - BROWSER_SOURCE_BASE_URL=https://yourdomain.com
      - CORS_ORIGIN=https://yourdomain.com
      - SESSION_SECRET=your-super-secure-production-secret-key-here
      - DB_PATH=/var/lib/pump-dashboard/streamers.db
    volumes:
      - pump-db:/var/lib/pump-dashboard
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  pump-db:
```

### 3. Deploy with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 🌐 Nginx Configuration

### 1. Install Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 2. Create Nginx Configuration

Create `/etc/nginx/sites-available/pump-dashboard`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket support for real-time features
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/pump-dashboard /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## 🔒 SSL Certificate Setup

### Using Let's Encrypt (Free)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 🚀 PM2 Process Management

### 1. Install PM2

```bash
npm install -g pm2
```

### 2. Create PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'pump-dashboard',
    script: 'start.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      BROWSER_SOURCE_BASE_URL: 'https://yourdomain.com',
      CORS_ORIGIN: 'https://yourdomain.com',
      SESSION_SECRET: 'your-super-secure-production-secret-key-here',
      DB_PATH: '/var/lib/pump-dashboard/streamers.db'
    }
  }]
};
```

### 3. Deploy with PM2

```bash
# Start in production mode
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## 📊 Monitoring and Logs

### 1. View Application Logs

```bash
# PM2 logs
pm2 logs pump-dashboard

# Docker logs
docker-compose logs -f pump-dashboard

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. Monitor Performance

```bash
# PM2 monitoring
pm2 monit

# System resources
htop
df -h
```

## 🔧 Browser Source URLs

After deployment, your browser source URLs will be:

- **TTS Browser Source**: `https://yourdomain.com/browser-source/tts/{streamerId}`
- **Poll Browser Source**: `https://yourdomain.com/browser-source/poll/{streamerId}`

These URLs are automatically generated based on your `BROWSER_SOURCE_BASE_URL` environment variable.

## 🛠️ Troubleshooting

### Common Issues

1. **Browser sources not loading**
   - Check that `BROWSER_SOURCE_BASE_URL` is set correctly
   - Verify SSL certificate is valid
   - Check CORS configuration

2. **WebSocket connections failing**
   - Ensure Nginx is configured for WebSocket proxying
   - Check firewall settings

3. **Database permissions**
   - Ensure the application has write access to the database directory
   - Check file permissions: `chmod 755 /var/lib/pump-dashboard`

### Health Checks

```bash
# Application health
curl https://yourdomain.com/api/health

# Browser source test
curl https://yourdomain.com/browser-source/tts/test-streamer-id
```

## 🔄 Updates and Maintenance

### 1. Update Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Or with PM2
pm2 restart pump-dashboard
```

### 2. Backup Database

```bash
# Create backup
cp /var/lib/pump-dashboard/streamers.db /backup/streamers-$(date +%Y%m%d).db

# Restore from backup
cp /backup/streamers-20240101.db /var/lib/pump-dashboard/streamers.db
```

## 📝 Production Checklist

- [ ] Domain name configured and pointing to server
- [ ] SSL certificate installed and working
- [ ] Environment variables configured
- [ ] Database directory created with proper permissions
- [ ] Nginx/Apache reverse proxy configured
- [ ] Firewall rules configured
- [ ] Process manager (PM2/Docker) configured
- [ ] Monitoring and logging setup
- [ ] Backup strategy implemented
- [ ] Browser source URLs tested in OBS

## 🆘 Support

If you encounter issues during deployment:

1. Check the application logs
2. Verify all environment variables are set correctly
3. Test the health endpoint
4. Ensure all services are running
5. Check network connectivity and firewall rules

For additional help, refer to the main README.md or create an issue in the repository.
