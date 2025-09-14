// src/services/DatabaseService.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

class DatabaseService {
  constructor() {
    this.pool = null;

    // DB envs (PostgreSQL)
    this.dbType = process.env.DB_TYPE || 'postgresql';
    this.dbHost = process.env.DB_HOST || 'localhost';
    this.dbPort = Number(process.env.DB_PORT || 5432);
    this.dbName = process.env.DB_NAME || 'sendkit_db';
    this.dbUser = process.env.DB_USER || 'sendkit_user';
    this.dbPassword = process.env.DB_PASSWORD || 'ULouSCHRIeraTsECTU';
  }

  isConnected() {
    return this.pool !== null;
  }

  async initialize() {
    if (this.dbType !== 'postgresql') {
      throw new Error(`Unsupported DB_TYPE: ${this.dbType}. Only 'postgresql' is supported in DatabaseService.`);
    }

    // Create pool lazily on first initialize()
    if (!this.pool) {
      this.pool = new Pool({
        host: this.dbHost,
        port: this.dbPort,
        database: this.dbName,
        user: this.dbUser,
        password: this.dbPassword,
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 2_000,
      });
    }

    try {
      const client = await this.pool.connect();
      console.log('✅ PostgreSQL connection established');
      client.release();

      await this.createTables();
      await this.createDefaultAdmin();
      console.log('✅ PostgreSQL database initialized successfully');
    } catch (err) {
      console.error('❌ Database initialization failed:', err);
      throw err;
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

    for (const q of queries) {
      await this.query(q);
    }
  }

  async createDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@pump.fun';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    const existing = await this.findUserByEmail(adminEmail);
    if (existing) {
      console.log('✅ Admin user already exists');
      return;
    }

    const hashed = await bcrypt.hash(adminPassword, 12);
    await this.createUser({
      email: adminEmail,
      password: hashed,
      username: 'admin',
      is_admin: true
    });

    console.log('✅ Default admin user created');
  }

  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  async createUser(userData) {
    const { email, password, username, wallet_address = null, streamer_id = null, is_admin = false } = userData;
    const sql = `
      INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`;
    const res = await this.query(sql, [email, password, username, wallet_address, streamer_id, is_admin]);
    return res.rows[0];
  }

  async findUserByEmail(email) {
    const res = await this.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0];
  }

  async findUserById(id) {
    const res = await this.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0];
  }

  async getStreamers() {
    const res = await this.query('SELECT * FROM streamer_configs WHERE is_active = TRUE');
    return res.rows;
  }

  // Used by IntegratedTTSService & IntegratedPollService
  async getAllStreamerConfigs() {
    return this.getStreamers();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = DatabaseService;
