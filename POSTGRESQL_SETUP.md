# PostgreSQL Setup for SendKit Dashboard

## VPS Setup Instructions

### 1. Install PostgreSQL on Ubuntu/Debian

```bash
# Update package list
sudo apt update

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Check status
sudo systemctl status postgresql
```

### 2. Create Database and User

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database
CREATE DATABASE sendkit_db;

# Create user
CREATE USER sendkit_user WITH PASSWORD 'ULouSCHRIeraTsECTU';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE sendkit_db TO sendkit_user;

# Grant schema privileges
\c sendkit_db
GRANT ALL ON SCHEMA public TO sendkit_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sendkit_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO sendkit_user;

# Exit psql
\q
```

### 3. Configure PostgreSQL for Remote Connections (Optional)

```bash
# Edit postgresql.conf
sudo nano /etc/postgresql/*/main/postgresql.conf

# Find and uncomment/modify:
listen_addresses = 'localhost'

# Edit pg_hba.conf
sudo nano /etc/postgresql/*/main/pg_hba.conf

# Add this line for local connections:
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### 4. Test Connection

```bash
# Test connection as the new user
psql -h localhost -U sendkit_user -d sendkit_db

# You should be prompted for password: ULouSCHRIeraTsECTU
# If successful, you'll see the psql prompt
# Type \q to exit
```

### 5. Deploy Updated Application

```bash
# Navigate to your app directory
cd /var/www/sendkit-dashboard

# Install new dependencies
npm install

# Copy the updated environment file
cp env.production .env

# Test the connection
node test-postgres.js

# If test passes, restart your application
pm2 restart sendkit
```

### 6. Verify Application

```bash
# Check application logs
pm2 logs sendkit --lines 20

# Check health endpoint
curl http://localhost:3000/health

# Should return database: true in the services object
```

## Environment Variables

Make sure your `env.production` file contains:

```env
NODE_ENV=production
PORT=3000
BROWSER_SOURCE_BASE_URL=https://sendkit.fun
CORS_ORIGIN=https://sendkit.fun
SESSION_SECRET=your-super-secure-production-secret-key-here

# Database Configuration
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sendkit_db
DB_USER=sendkit_user
DB_PASSWORD=ULouSCHRIeraTsECTU

# Admin Configuration
ADMIN_EMAIL=admin@sendkit.fun
ADMIN_PASSWORD=admin123
```

## Troubleshooting

### Connection Issues
- Verify PostgreSQL is running: `sudo systemctl status postgresql`
- Check if user exists: `sudo -u postgres psql -c "\du"`
- Test connection: `psql -h localhost -U sendkit_user -d sendkit_db`

### Permission Issues
- Ensure user has correct privileges: `sudo -u postgres psql -c "\l"`
- Grant additional privileges if needed

### Application Issues
- Check logs: `pm2 logs sendkit`
- Verify environment variables are loaded
- Test database connection with the test script

## Migration from SQLite

The application will automatically create all necessary tables when it starts with PostgreSQL. No manual data migration is needed as this is a fresh deployment.

## Security Notes

- Change the default admin password after first login
- Consider using environment variables for sensitive data
- Ensure PostgreSQL is only accessible from localhost
- Regularly update PostgreSQL for security patches
