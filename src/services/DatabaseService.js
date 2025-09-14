// src/services/DatabaseService.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.dbType = process.env.DB_TYPE || 'postgresql';

    if (this.dbType === 'postgresql') {
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'sendkit_db',
        user: process.env.DB_USER || 'sendkit_user',
        password: process.env.DB_PASSWORD || 'ULouSCHRIeraTsECTU',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    }
  }

  /* ---------------------------- lifecycle & utils --------------------------- */

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

  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
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

  /* --------------------------------- schema -------------------------------- */

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
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@pump.fun';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

      const existingAdmin = await this.getUserByEmail(adminEmail);
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

  /* ---------------------------------- users --------------------------------- */

  async createUser(userData) {
    const {
      email,
      password,
      username,
      wallet_address = null,
      streamer_id = null,
      is_admin = false
    } = userData;

    const sql = `
      INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *`;
    const res = await this.query(sql, [email, password, username, wallet_address, streamer_id, is_admin]);
    return res.rows[0];
  }

  // alias to align with routes
  async getUserByEmail(email) {
    const res = await this.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] || null;
  }

  async getUserById(id) {
    const res = await this.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async getUserByUsername(username) {
    const res = await this.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0] || null;
  }

  /* ------------------------------ streamer cfgs ----------------------------- */

  async createStreamerConfig(data) {
    // Expecting routes to pass user_id; guard to make failures obvious
    const {
      user_id,
      streamer_id,
      username = null,
      wallet_address,
      token_address = null,
      is_active = true
    } = data || {};

    if (!user_id) throw new Error('createStreamerConfig requires user_id');
    if (!streamer_id) throw new Error('createStreamerConfig requires streamer_id');
    if (!wallet_address) throw new Error('createStreamerConfig requires wallet_address');

    const sql = `
      INSERT INTO streamer_configs
        (user_id, streamer_id, username, wallet_address, token_address, is_active)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *`;
    const res = await this.query(sql, [
      user_id, streamer_id, username, wallet_address, token_address, is_active
    ]);
    return res.rows[0];
  }

  async getStreamerConfigsByUserId(userId) {
    const res = await this.query(
      'SELECT * FROM streamer_configs WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.rows;
  }

  async getStreamers() {
    const res = await this.query('SELECT * FROM streamer_configs WHERE is_active = TRUE');
    return res.rows;
  }

  async getAllStreamerConfigs() {
    // Keep compatibility with Integrated* services
    return this.getStreamers();
  }
}

module.exports = DatabaseService;
