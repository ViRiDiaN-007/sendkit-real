module.exports = {
  // Base URL configuration
  // For local development: 'http://localhost:3000'
  // For production: 'https://sendkit.fun'
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  
  // Database configuration
  database: {
    type: process.env.DB_TYPE || 'sqlite',
    // PostgreSQL settings (for production)
    postgresql: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'sendkit_db',
      user: process.env.DB_USER || 'sendkit_user',
      password: process.env.DB_PASSWORD || 'ULouSCHRIeraTsECTU'
    },
    // SQLite settings (for local development)
    sqlite: {
      path: './data/sendkit.db'
    }
  },
  
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    sessionSecret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production'
  },
  
  // Admin configuration
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@pump.fun',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  }
};

