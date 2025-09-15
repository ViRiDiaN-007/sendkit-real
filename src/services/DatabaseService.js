const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.db = null;
    this.dbType = process.env.DB_TYPE || 'sqlite';
    
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
      const dbPath = path.join(__dirname, '../../data/sendkit.db');
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
    if (this.dbType === 'postgresql') {
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
        )`,
        `CREATE TABLE IF NOT EXISTS tts_messages (
          id SERIAL PRIMARY KEY,
          streamer_id VARCHAR(255) NOT NULL,
          message_text TEXT NOT NULL,
          sender VARCHAR(255) NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          message_type VARCHAR(50) DEFAULT 'regular',
          amount DECIMAL(18,8) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      for (const query of queries) {
        await this.query(query);
      }
    } else if (this.dbType === 'sqlite') {
      const queries = [
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
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS tts_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_id TEXT NOT NULL,
          message_text TEXT NOT NULL,
          sender TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          message_type TEXT DEFAULT 'regular',
          amount REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      for (const query of queries) {
        await this.query(query);
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
      
      // Get the inserted user
      const selectQuery = `SELECT * FROM users WHERE email = ?`;
      const result = await this.query(selectQuery, [email]);
      return result.rows[0];
    }
  }

  async findUserByEmail(email) {
    if (this.dbType === 'postgresql') {
      const query = 'SELECT * FROM users WHERE email = $1';
      const result = await this.query(query, [email]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = 'SELECT * FROM users WHERE email = ?';
      const result = await this.query(query, [email]);
      return result.rows[0];
    }
  }

  async findUserById(id) {
    if (this.dbType === 'postgresql') {
      const query = 'SELECT * FROM users WHERE id = $1';
      const result = await this.query(query, [id]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = 'SELECT * FROM users WHERE id = ?';
      const result = await this.query(query, [id]);
      return result.rows[0];
    }
  }

  async findUserByUsername(username) {
    if (this.dbType === 'postgresql') {
      const query = 'SELECT * FROM users WHERE username = $1';
      const result = await this.query(query, [username]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = 'SELECT * FROM users WHERE username = ?';
      const result = await this.query(query, [username]);
      return result.rows[0];
    }
  }

  async getStreamers() {
    const query = this.dbType === 'postgresql' 
      ? 'SELECT * FROM streamer_configs WHERE is_active = TRUE'
      : 'SELECT * FROM streamer_configs WHERE is_active = 1';
    const result = await this.query(query);
    return result.rows;
  }

  async getAllStreamerConfigs() {
    return this.getStreamers();
  }

  async getStreamerConfigsByUserId(userId) {
    if (this.dbType === 'postgresql') {
      const query = 'SELECT * FROM streamer_configs WHERE user_id = $1';
      const result = await this.query(query, [userId]);
      return result.rows;
    } else if (this.dbType === 'sqlite') {
      const query = 'SELECT * FROM streamer_configs WHERE user_id = ?';
      const result = await this.query(query, [userId]);
      return result.rows;
    }
  }

  async getTTSSettings(streamerId) {
    // Placeholder - return default settings for now
    return {
      enabled: false,
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0
    };
  }

  async getPollSettings(streamerId) {
    // Placeholder - return default settings for now
    return {
      enabled: false,
      duration: 30000,
      allowMultiple: false
    };
  }

  async getAutomodSettings(streamerId) {
    // Placeholder - return default settings for now
    return {
      enabled: false,
      sensitivity: 0.7,
      bannedWords: [],
      maxLength: 500
    };
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
      
      // Get the inserted config
      const selectQuery = `SELECT * FROM streamer_configs WHERE streamer_id = ?`;
      const result = await this.query(selectQuery, [streamer_id]);
      return result.rows[0];
    }
  }

  async getStreamerConfig(streamerId) {
    if (this.dbType === 'postgresql') {
      const query = 'SELECT * FROM streamer_configs WHERE streamer_id = $1';
      const result = await this.query(query, [streamerId]);
      return result.rows[0];
    } else if (this.dbType === 'sqlite') {
      const query = 'SELECT * FROM streamer_configs WHERE streamer_id = ?';
      const result = await this.query(query, [streamerId]);
      return result.rows[0];
    }
  }

  async updateTTSSettings(streamerId, settings) {
    // Placeholder - in a real implementation, you'd store these in a tts_settings table
    console.log(`TTS settings updated for ${streamerId}:`, settings);
    return true;
  }

  async updatePollSettings(streamerId, settings) {
    // Placeholder - in a real implementation, you'd store these in a poll_settings table
    console.log(`Poll settings updated for ${streamerId}:`, settings);
    return true;
  }

  async updateAutomodSettings(streamerId, settings) {
    // Placeholder - in a real implementation, you'd store these in an automod_settings table
    console.log(`Automod settings updated for ${streamerId}:`, settings);
    return true;
  }

  async getTTSMessages(streamerId, limit = 50) {
    console.log(`Getting TTS messages for ${streamerId}, limit: ${limit}`);
    
    if (this.dbType === 'postgresql') {
      const query = `SELECT * FROM tts_messages WHERE streamer_id = $1 ORDER BY timestamp DESC LIMIT $2`;
      const result = await this.query(query, [streamerId, limit]);
      return result.rows;
    } else if (this.dbType === 'sqlite') {
      const query = `SELECT * FROM tts_messages WHERE streamer_id = ? ORDER BY timestamp DESC LIMIT ?`;
      const result = await this.query(query, [streamerId, limit]);
      return result.rows;
    }
    return [];
  }

  async saveTTSMessage(streamerId, messageData) {
    console.log(`Saving TTS message for ${streamerId}:`, messageData);
    
    if (this.dbType === 'postgresql') {
      const query = `INSERT INTO tts_messages (streamer_id, message_text, sender, timestamp, message_type, amount) VALUES ($1, $2, $3, $4, $5, $6)`;
      await this.query(query, [streamerId, messageData.text, messageData.sender, messageData.timestamp, messageData.type, messageData.amount]);
    } else if (this.dbType === 'sqlite') {
      const query = `INSERT INTO tts_messages (streamer_id, message_text, sender, timestamp, message_type, amount) VALUES (?, ?, ?, ?, ?, ?)`;
      await this.query(query, [streamerId, messageData.text, messageData.sender, messageData.timestamp, messageData.type, messageData.amount]);
    }
    return true;
  }

  async cleanupOldTTSMessages(streamerId, keepCount = 50) {
    console.log(`Cleaning up old TTS messages for ${streamerId}, keeping ${keepCount} most recent`);
    
    if (this.dbType === 'postgresql') {
      const query = `DELETE FROM tts_messages WHERE streamer_id = $1 AND id NOT IN (SELECT id FROM tts_messages WHERE streamer_id = $1 ORDER BY timestamp DESC LIMIT $2)`;
      await this.query(query, [streamerId, keepCount]);
    } else if (this.dbType === 'sqlite') {
      const query = `DELETE FROM tts_messages WHERE streamer_id = ? AND id NOT IN (SELECT id FROM tts_messages WHERE streamer_id = ? ORDER BY timestamp DESC LIMIT ?)`;
      await this.query(query, [streamerId, streamerId, keepCount]);
    }
    return true;
  }

  async getPollMessages(streamerId, limit = 50) {
    // Placeholder - in a real implementation, you'd have a poll_messages table
    console.log(`Getting poll messages for ${streamerId}, limit: ${limit}`);
    return [];
  }

  async savePollMessage(streamerId, messageData) {
    // Placeholder - in a real implementation, you'd save to a poll_messages table
    console.log(`Saving poll message for ${streamerId}:`, messageData);
    return true;
  }

  isConnected() {
    return this.dbType === 'postgresql' ? this.pool !== null : this.db !== null;
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