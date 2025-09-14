const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.dbType = process.env.DB_TYPE || 'postgresql';
    
    if (this.dbType === 'postgresql') {
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'sendkit_db',
        user: process.env.DB_USER || 'sendkit_user',
        password: process.env.DB_PASSWORD || 'ULouSCHRIeraTsECTU',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    }
  }

  async initialize() {
    try {
      if (this.dbType === 'postgresql') {
        const client = await this.pool.connect();
        console.log('✅ PostgreSQL connection established');
        client.release();
        await this.createTables();
        await this.createDefaultAdmin();
        console.log('✅ PostgreSQL database initialized successfully');
      }
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        wallet_address VARCHAR(255) UNIQUE,
        streamer_id VARCHAR(255) UNIQUE,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS streamer_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        streamer_id VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255),
        wallet_address VARCHAR(255) NOT NULL,
        token_address VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`
    ];

    for (const query of queries) {
      await this.query(query);
    }
  }

  async createDefaultAdmin() {
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@pump.fun';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
      
      const existingAdmin = await this.findUserByEmail(adminEmail);
      if (existingAdmin) {
        console.log('✅ Admin user already exists');
        return;
      }

      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await this.createUser({
        email: adminEmail,
        password: hashedPassword,
        username: 'admin',
        is_admin: true
      });

      console.log('✅ Default admin user created');
    } catch (error) {
      console.error('❌ Failed to create default admin:', error);
    }
  }

  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  async createUser(userData) {
    const { email, password, username, wallet_address, streamer_id, is_admin = false } = userData;
    const query = `INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
    const result = await this.query(query, [email, password, username, wallet_address, streamer_id, is_admin]);
    return result.rows[0];
  }

  async findUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await this.query(query, [email]);
    return result.rows[0];
  }

  async findUserById(id) {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await this.query(query, [id]);
    return result.rows[0];
  }

  async getStreamers() {
    const query = 'SELECT * FROM streamer_configs WHERE is_active = TRUE';
    const result = await this.query(query);
    return result.rows;
  }

  async getAllStreamerConfigs() {
    return this.getStreamers();
  }

  isConnected() {
    return this.pool !== null;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = DatabaseService;