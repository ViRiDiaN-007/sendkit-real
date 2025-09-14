module.exports = {
  apps: [{
    name: 'sendkit-dashboard',
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
      BROWSER_SOURCE_BASE_URL: 'https://sendkit.fun',
      CORS_ORIGIN: 'https://sendkit.fun',
      SESSION_SECRET: 'your-super-secure-production-secret-key-here',
      DB_PATH: '/var/www/sendkit-dashboard/data/database.sqlite'
    }
  }]
};
