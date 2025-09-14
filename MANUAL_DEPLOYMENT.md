# Manual Deployment Guide for sendkit.fun

Since the ZIP file extracts to `pump_website` folder, here's the corrected deployment process:

## Step 1: Upload and Extract

```bash
# Upload the ZIP file to your VPS
scp sendkit-dashboard.zip root@198.187.28.93:/root/

# SSH into your VPS
ssh root@198.187.28.93

# Extract the ZIP file
unzip sendkit-dashboard.zip

# The files will be in a folder called "pump_website"
ls -la pump_website/
```

## Step 2: Move Files to Correct Location

```bash
# Create the application directory
mkdir -p /var/www/sendkit-dashboard

# Copy all files from pump_website to the correct location
cp -r pump_website/* /var/www/sendkit-dashboard/

# Set correct ownership
chown -R www-data:www-data /var/www/sendkit-dashboard

# Go to the application directory
cd /var/www/sendkit-dashboard
```

## Step 3: Install Dependencies

```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install nginx
apt install -y nginx

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

# Install project dependencies
npm ci --only=production

# Build CSS
npm run build:css
```

## Step 4: Configure Environment

```bash
# Create production environment file
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
```

## Step 5: Configure Nginx

```bash
# Copy nginx config
cp nginx.conf /etc/nginx/sites-available/sendkit-dashboard
ln -sf /etc/nginx/sites-available/sendkit-dashboard /etc/nginx/sites-enabled/

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test nginx config
nginx -t

# Reload nginx
systemctl reload nginx
```

## Step 6: Get SSL Certificate

```bash
# Get SSL certificate
certbot --nginx -d sendkit.fun -d www.sendkit.fun --non-interactive --agree-tos --email admin@sendkit.fun
```

## Step 7: Setup PM2 Service

```bash
# Copy service file
cp sendkit.service /etc/systemd/system/

# Enable and start service
systemctl daemon-reload
systemctl enable sendkit
systemctl start sendkit
```

## Step 8: Verify Deployment

```bash
# Check application status
systemctl status sendkit

# Check nginx status
systemctl status nginx

# View application logs
journalctl -u sendkit -f
```

## Your URLs

- **Main Dashboard**: https://sendkit.fun
- **Poll Browser Source**: https://sendkit.fun/browser-source/poll?streamer=YOUR_STREAMER_ID
- **TTS Browser Source**: https://sendkit.fun/browser-source/tts?streamer=YOUR_STREAMER_ID

## Management Commands

```bash
# Restart application
systemctl restart sendkit

# View logs
journalctl -u sendkit -f

# Check PM2 processes
pm2 status

# Restart nginx
systemctl restart nginx
```

That's it! Your SendKit Dashboard should now be live at https://sendkit.fun! 🚀

