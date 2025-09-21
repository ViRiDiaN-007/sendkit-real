const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.db = null;
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
    } else if (this.dbType === 'sqlite') {
      const dbPath = process.env.DB_PATH || './data/sendkit.db';
      this.db = new sqlite3.Database(dbPath);
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
      } else if (this.dbType === 'sqlite') {
        console.log('✅ SQLite connection established');
        await this.createTables();
        await this.createDefaultAdmin();
        console.log('✅ SQLite database initialized successfully');
      }
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async createTables() {
    let queries;
    
    if (this.dbType === 'postgresql') {
      queries = [
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
          tts_settings JSONB,
          poll_settings JSONB,
          automod_settings JSONB,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS tts_messages (
          id SERIAL PRIMARY KEY,
          streamer_id VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          username VARCHAR(255),
          amount DECIMAL(18,8),
          token_address VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS admin_settings (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) UNIQUE NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS automod_actions (
          id SERIAL PRIMARY KEY,
          streamer_id VARCHAR(255) NOT NULL,
          action_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
      ];
    } else if (this.dbType === 'sqlite') {
      queries = [
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          username TEXT UNIQUE NOT NULL,
          wallet_address TEXT UNIQUE,
          streamer_id TEXT UNIQUE,
          is_admin BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS streamer_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          streamer_id TEXT UNIQUE NOT NULL,
          username TEXT,
          wallet_address TEXT NOT NULL,
          token_address TEXT,
          tts_settings TEXT,
          poll_settings TEXT,
          automod_settings TEXT,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS tts_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_id TEXT NOT NULL,
          message TEXT NOT NULL,
          username TEXT,
          amount REAL,
          token_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS admin_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          value TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS automod_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_id TEXT NOT NULL,
          action_data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ];
    }

    for (const query of queries) {
      await this.query(query);
    }

    // Run migrations for existing databases
    await this.runMigrations();
  }

  async runMigrations() {
    if (this.dbType === 'sqlite') {
      try {
        // Check if tts_settings column exists
        const checkTtsSettings = await this.query("PRAGMA table_info(streamer_configs)");
        const hasTtsSettings = checkTtsSettings.rows.some(col => col.name === 'tts_settings');
        
        if (!hasTtsSettings) {
          console.log('🔄 Adding tts_settings column to streamer_configs table...');
          await this.query("ALTER TABLE streamer_configs ADD COLUMN tts_settings TEXT");
        }

        // Check if poll_settings column exists
        const checkPollSettings = await this.query("PRAGMA table_info(streamer_configs)");
        const hasPollSettings = checkPollSettings.rows.some(col => col.name === 'poll_settings');
        
        if (!hasPollSettings) {
          console.log('🔄 Adding poll_settings column to streamer_configs table...');
          await this.query("ALTER TABLE streamer_configs ADD COLUMN poll_settings TEXT");
        }

        // Check if automod_settings column exists
        const checkAutomodSettings = await this.query("PRAGMA table_info(streamer_configs)");
        const hasAutomodSettings = checkAutomodSettings.rows.some(col => col.name === 'automod_settings');
        
        if (!hasAutomodSettings) {
          console.log('🔄 Adding automod_settings column to streamer_configs table...');
          await this.query("ALTER TABLE streamer_configs ADD COLUMN automod_settings TEXT");
        }

        console.log('✅ Database migrations completed');
      } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
      }
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
    if (this.dbType === 'postgresql') {
      const client = await this.pool.connect();
      try {
        const result = await client.query(text, params);
        return result;
      } finally {
        client.release();
      }
    } else if (this.dbType === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.all(text, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve({ rows: rows || [] });
          }
        });
      });
    }
  }

  async createUser(userData) {
    const { email, password, username, wallet_address, streamer_id, is_admin = false } = userData;
    
    if (this.dbType === 'postgresql') {
      const query = `INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
      const result = await this.query(query, [email, password, username, wallet_address, streamer_id, is_admin]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = `INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin) VALUES (?, ?, ?, ?, ?, ?)`;
      await this.query(query, [email, password, username, wallet_address, streamer_id, is_admin]);
      // Get the last inserted row
      const result = await this.query('SELECT * FROM users WHERE id = last_insert_rowid()');
      return result.rows[0];
    }
  }

  async findUserByEmail(email) {
    const query = this.dbType === 'postgresql' ? 'SELECT * FROM users WHERE email = $1' : 'SELECT * FROM users WHERE email = ?';
    const result = await this.query(query, [email]);
    return result.rows[0];
  }

  async findUserById(id) {
    const query = this.dbType === 'postgresql' ? 'SELECT * FROM users WHERE id = $1' : 'SELECT * FROM users WHERE id = ?';
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

  async getStreamerConfig(streamerId) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT * FROM streamer_configs WHERE streamer_id = $1' : 
      'SELECT * FROM streamer_configs WHERE streamer_id = ?';
    const result = await this.query(query, [streamerId]);
    return result.rows[0];
  }

  async getStreamerConfigsByUserId(userId) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT * FROM streamer_configs WHERE user_id = $1' : 
      'SELECT * FROM streamer_configs WHERE user_id = ?';
    const result = await this.query(query, [userId]);
    return result.rows;
  }

  async getTTSSettings(streamerId) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT tts_settings FROM streamer_configs WHERE streamer_id = $1' : 
      'SELECT tts_settings FROM streamer_configs WHERE streamer_id = ?';
    const result = await this.query(query, [streamerId]);
    if (result.rows[0] && result.rows[0].tts_settings) {
      return typeof result.rows[0].tts_settings === 'string' ? 
        JSON.parse(result.rows[0].tts_settings) : 
        result.rows[0].tts_settings;
    }
    return null;
  }

  async updateTTSSettings(streamerId, settings) {
    const settingsJson = JSON.stringify(settings);
    const query = this.dbType === 'postgresql' ? 
      'UPDATE streamer_configs SET tts_settings = $1 WHERE streamer_id = $2' : 
      'UPDATE streamer_configs SET tts_settings = ? WHERE streamer_id = ?';
    await this.query(query, [settingsJson, streamerId]);
  }

  async getPollSettings(streamerId) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT poll_settings FROM streamer_configs WHERE streamer_id = $1' : 
      'SELECT poll_settings FROM streamer_configs WHERE streamer_id = ?';
    const result = await this.query(query, [streamerId]);
    if (result.rows[0] && result.rows[0].poll_settings) {
      return typeof result.rows[0].poll_settings === 'string' ? 
        JSON.parse(result.rows[0].poll_settings) : 
        result.rows[0].poll_settings;
    }
    return null;
  }

  async updatePollSettings(streamerId, settings) {
    const settingsJson = JSON.stringify(settings);
    const query = this.dbType === 'postgresql' ? 
      'UPDATE streamer_configs SET poll_settings = $1 WHERE streamer_id = $2' : 
      'UPDATE streamer_configs SET poll_settings = ? WHERE streamer_id = ?';
    await this.query(query, [settingsJson, streamerId]);
  }

  async getTTSMessages(streamerId, limit = 50) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT * FROM tts_messages WHERE streamer_id = $1 ORDER BY created_at DESC LIMIT $2' : 
      'SELECT * FROM tts_messages WHERE streamer_id = ? ORDER BY created_at DESC LIMIT ?';
    const result = await this.query(query, [streamerId, limit]);
    return result.rows;
  }

  async getAutomodSettings(streamerId) {
    const query = this.dbType === 'postgresql' ? 
      'SELECT automod_settings FROM streamer_configs WHERE streamer_id = $1' : 
      'SELECT automod_settings FROM streamer_configs WHERE streamer_id = ?';
    const result = await this.query(query, [streamerId]);
    if (result.rows[0] && result.rows[0].automod_settings) {
      return typeof result.rows[0].automod_settings === 'string' ? 
        JSON.parse(result.rows[0].automod_settings) : 
        result.rows[0].automod_settings;
    }
    return null;
  }

  async updateAutomodSettings(streamerId, settings) {
    const settingsJson = JSON.stringify(settings);
    const query = this.dbType === 'postgresql' ? 
      'UPDATE streamer_configs SET automod_settings = $1 WHERE streamer_id = $2' : 
      'UPDATE streamer_configs SET automod_settings = ? WHERE streamer_id = ?';
    await this.query(query, [settingsJson, streamerId]);
  }

  async logAutomodAction(streamerId, actionData) {
    try {
      const actionJson = JSON.stringify(actionData);
      const query = this.dbType === 'postgresql' ? 
        'INSERT INTO automod_actions (streamer_id, action_data, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)' : 
        'INSERT INTO automod_actions (streamer_id, action_data, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)';
      await this.query(query, [streamerId, actionJson]);
    } catch (error) {
      console.error('Error logging automod action:', error);
      // Don't throw error - just log it
    }
  }

  async createStreamerConfig(configData) {
    const { user_id, streamer_id, username, wallet_address, token_address } = configData;
    
    if (this.dbType === 'postgresql') {
      const query = `INSERT INTO streamer_configs (user_id, streamer_id, username, wallet_address, token_address) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
      const result = await this.query(query, [user_id, streamer_id, username, wallet_address, token_address]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = `INSERT INTO streamer_configs (user_id, streamer_id, username, wallet_address, token_address) VALUES (?, ?, ?, ?, ?)`;
      await this.query(query, [user_id, streamer_id, username, wallet_address, token_address]);
      // Get the last inserted row
      const result = await this.query('SELECT * FROM streamer_configs WHERE id = last_insert_rowid()');
      return result.rows[0];
    }
  }

  async deleteStreamer(streamerId) {
    try {
      if (this.dbType === 'postgresql') {
        const query = `DELETE FROM streamer_configs WHERE streamer_id = $1`;
        await this.query(query, [streamerId]);
      } else if (this.dbType === 'sqlite') {
        const query = `DELETE FROM streamer_configs WHERE streamer_id = ?`;
        await this.query(query, [streamerId]);
      }
      console.log(`🗑️ Deleted streamer ${streamerId} from database`);
      return { success: true, message: 'Streamer deleted successfully' };
    } catch (error) {
      console.error('Error deleting streamer:', error);
      throw error;
    }
  }

  isConnected() {
    if (this.dbType === 'postgresql') {
      return this.pool !== null;
    } else if (this.dbType === 'sqlite') {
      return this.db !== null;
    }
    return false;
  }

  async close() {
    if (this.dbType === 'postgresql' && this.pool) {
      await this.pool.end();
      this.pool = null;
    } else if (this.dbType === 'sqlite' && this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing SQLite database:', err);
          }
          this.db = null;
          resolve();
        });
      });
    }
  }
}

module.exports = DatabaseService;