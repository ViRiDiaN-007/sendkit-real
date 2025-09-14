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
        // Test connection
        const client = await this.pool.connect();
        console.log('✅ PostgreSQL connection established');
        client.release();
        
        // Create tables
        await this.createTables();
        
        // Create default admin user if none exists
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
      // Users table
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

      // Streamer configurations
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

      // TTS settings
      `CREATE TABLE IF NOT EXISTS tts_settings (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        voice VARCHAR(255) DEFAULT 'en-US-Standard-A',
        rate REAL DEFAULT 1.0,
        volume REAL DEFAULT 1.0,
        pitch REAL DEFAULT 1.0,
        enabled BOOLEAN DEFAULT TRUE,
        min_donation REAL DEFAULT 0.01,
        cooldown_seconds INTEGER DEFAULT 30,
        max_message_length INTEGER DEFAULT 200,
        auto_tts_enabled BOOLEAN DEFAULT TRUE,
        donation_gate_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS tts_messages (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        message_text TEXT NOT NULL,
        sender VARCHAR(255) NOT NULL,
        message_type VARCHAR(50) DEFAULT 'regular',
        amount REAL DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
      )`,

      // Poll settings
      `CREATE TABLE IF NOT EXISTS poll_settings (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        default_duration INTEGER DEFAULT 60,
        allow_viewer_polls BOOLEAN DEFAULT FALSE,
        require_donation BOOLEAN DEFAULT FALSE,
        min_donation REAL DEFAULT 0.01,
        whitelist TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
      )`,

      // Automod settings
      `CREATE TABLE IF NOT EXISTS automod_settings (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        bot_wallet_address VARCHAR(255),
        mod_permissions TEXT DEFAULT '[]',
        banned_words TEXT DEFAULT '[]',
        banned_users TEXT DEFAULT '[]',
        timeout_duration INTEGER DEFAULT 300,
        max_warnings INTEGER DEFAULT 3,
        auto_timeout BOOLEAN DEFAULT TRUE,
        auto_ban BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
      )`,

      // Polls
      `CREATE TABLE IF NOT EXISTS polls (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        duration INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
      )`,

      // Poll votes
      `CREATE TABLE IF NOT EXISTS poll_votes (
        id SERIAL PRIMARY KEY,
        poll_id INTEGER NOT NULL,
        voter_address VARCHAR(255) NOT NULL,
        option_number INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE,
        UNIQUE(poll_id, voter_address)
      )`,

      // TTS requests
      `CREATE TABLE IF NOT EXISTS tts_requests (
        id SERIAL PRIMARY KEY,
        streamer_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        transaction_hash VARCHAR(255),
        amount REAL DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamer_configs (streamer_id) ON DELETE CASCADE
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

  // Generic query method
  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  // User methods
  async createUser(userData) {
    const { email, password, username, wallet_address, streamer_id, is_admin = false } = userData;
    
    const query = `
      INSERT INTO users (email, password, username, wallet_address, streamer_id, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
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

  async getUserByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1';
    const result = await this.query(query, [username]);
    return result.rows[0];
  }

  async updateUser(id, userData) {
    const fields = Object.keys(userData).map((key, index) => `${key} = $${index + 1}`).join(', ');
    const values = Object.values(userData);
    values.push(id);
    
    const query = `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`;
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  // Streamer config methods
  async createStreamer(userId, configData) {
    const { streamer_id, username, wallet_address, token_address, is_active = true } = configData;
    
    const query = `
      INSERT INTO streamer_configs (user_id, streamer_id, username, wallet_address, token_address, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await this.query(query, [userId, streamer_id, username || null, wallet_address, token_address, is_active]);
    return result.rows[0];
  }

  async getStreamerById(streamerId) {
    const query = `
      SELECT sc.*, u.email, u.username 
      FROM streamer_configs sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.streamer_id = $1
    `;
    const result = await this.query(query, [streamerId]);
    return result.rows[0];
  }

  async getStreamers() {
    const query = 'SELECT * FROM streamer_configs WHERE is_active = TRUE';
    const result = await this.query(query);
    return result.rows;
  }

  async updateStreamer(streamerId, configData) {
    const fields = Object.keys(configData).map((key, index) => `${key} = $${index + 1}`).join(', ');
    const values = Object.values(configData);
    values.push(streamerId);
    
    const query = `UPDATE streamer_configs SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE streamer_id = $${values.length} RETURNING *`;
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  async deleteStreamer(streamerId) {
    // PostgreSQL will handle cascading deletes due to foreign key constraints
    const query = 'DELETE FROM streamer_configs WHERE streamer_id = $1';
    await this.query(query, [streamerId]);
  }

  // TTS settings methods
  async getTTSSettings(streamerId) {
    const query = 'SELECT * FROM tts_settings WHERE streamer_id = $1';
    const result = await this.query(query, [streamerId]);
    return result.rows[0];
  }

  async saveTTSSettings(streamerId, settings) {
    const fields = Object.keys(settings).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = Object.values(settings);
    
    const query = `
      INSERT INTO tts_settings (streamer_id, ${Object.keys(settings).join(', ')})
      VALUES ($1, ${Object.keys(settings).map((_, index) => `$${index + 2}`).join(', ')})
      ON CONFLICT (streamer_id) DO UPDATE SET
      ${Object.keys(settings).map((key, index) => `${key} = EXCLUDED.${key}`).join(', ')},
      updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await this.query(query, [streamerId, ...values]);
    return result.rows[0];
  }

  // TTS Messages methods
  async saveTTSMessage(streamerId, messageData) {
    const query = `
      INSERT INTO tts_messages (streamer_id, message_id, message_text, sender, message_type, amount)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await this.query(query, [
      streamerId,
      messageData.id,
      messageData.text,
      messageData.sender,
      messageData.type || 'regular',
      messageData.amount || 0
    ]);
    return result.rows[0];
  }

  async getTTSMessages(streamerId, limit = 20) {
    const query = `
      SELECT * FROM tts_messages 
      WHERE streamer_id = $1 
      ORDER BY timestamp DESC 
      LIMIT $2
    `;
    
    const result = await this.query(query, [streamerId, limit]);
    return result.rows;
  }

  async cleanupOldTTSMessages(streamerId, keepCount = 50) {
    const query = `
      DELETE FROM tts_messages 
      WHERE streamer_id = $1 
      AND id NOT IN (
        SELECT id FROM tts_messages 
        WHERE streamer_id = $1 
        ORDER BY timestamp DESC 
        LIMIT $2
      )
    `;
    
    const result = await this.query(query, [streamerId, keepCount]);
    return { deletedCount: result.rowCount };
  }

  // Poll settings methods
  async getPollSettings(streamerId) {
    const query = 'SELECT * FROM poll_settings WHERE streamer_id = $1';
    const result = await this.query(query, [streamerId]);
    return result.rows[0];
  }

  async savePollSettings(streamerId, settings) {
    const fields = Object.keys(settings).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = Object.values(settings);
    
    const query = `
      INSERT INTO poll_settings (streamer_id, ${Object.keys(settings).join(', ')})
      VALUES ($1, ${Object.keys(settings).map((_, index) => `$${index + 2}`).join(', ')})
      ON CONFLICT (streamer_id) DO UPDATE SET
      ${Object.keys(settings).map((key, index) => `${key} = EXCLUDED.${key}`).join(', ')},
      updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await this.query(query, [streamerId, ...values]);
    return result.rows[0];
  }

  // Automod settings methods
  async getAutomodSettings(streamerId) {
    const query = 'SELECT * FROM automod_settings WHERE streamer_id = $1';
    const result = await this.query(query, [streamerId]);
    
    if (result.rows[0]) {
      const row = result.rows[0];
      // Parse JSON fields
      row.mod_permissions = JSON.parse(row.mod_permissions || '[]');
      row.banned_words = JSON.parse(row.banned_words || '[]');
      row.banned_users = JSON.parse(row.banned_users || '[]');
      return row;
    }
    return null;
  }

  async updateAutomodSettings(streamerId, settings) {
    // Convert arrays to JSON strings
    const processedSettings = { ...settings };
    if (processedSettings.mod_permissions) {
      processedSettings.mod_permissions = JSON.stringify(processedSettings.mod_permissions);
    }
    if (processedSettings.banned_words) {
      processedSettings.banned_words = JSON.stringify(processedSettings.banned_words);
    }
    if (processedSettings.banned_users) {
      processedSettings.banned_users = JSON.stringify(processedSettings.banned_users);
    }

    const fields = Object.keys(processedSettings).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = Object.values(processedSettings);
    
    const query = `
      INSERT INTO automod_settings (streamer_id, ${Object.keys(processedSettings).join(', ')})
      VALUES ($1, ${Object.keys(processedSettings).map((_, index) => `$${index + 2}`).join(', ')})
      ON CONFLICT (streamer_id) DO UPDATE SET
      ${Object.keys(processedSettings).map((key, index) => `${key} = EXCLUDED.${key}`).join(', ')},
      updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await this.query(query, [streamerId, ...values]);
    return result.rows[0];
  }

  // Poll methods
  async createPoll(pollData) {
    const { streamer_id, question, options, duration, created_by } = pollData;
    
    const query = `
      INSERT INTO polls (streamer_id, question, options, duration, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const result = await this.query(query, [streamer_id, JSON.stringify(options), duration, created_by]);
    return result.rows[0];
  }

  async getActivePoll(streamerId) {
    const query = `
      SELECT * FROM polls 
      WHERE streamer_id = $1 AND status = 'active' 
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await this.query(query, [streamerId]);
    
    if (result.rows[0]) {
      result.rows[0].options = JSON.parse(result.rows[0].options);
    }
    return result.rows[0];
  }

  async votePoll(pollId, voterAddress, optionNumber) {
    const query = `
      INSERT INTO poll_votes (poll_id, voter_address, option_number)
      VALUES ($1, $2, $3)
      ON CONFLICT (poll_id, voter_address) DO UPDATE SET
      option_number = EXCLUDED.option_number
      RETURNING *
    `;
    
    const result = await this.query(query, [pollId, voterAddress, optionNumber]);
    return result.rows[0];
  }

  async getPollResults(pollId) {
    const query = `
      SELECT p.*, pv.option_number, COUNT(pv.option_number) as vote_count
      FROM polls p
      LEFT JOIN poll_votes pv ON p.id = pv.poll_id
      WHERE p.id = $1
      GROUP BY pv.option_number
      ORDER BY vote_count DESC
    `;
    const result = await this.query(query, [pollId]);
    return result.rows;
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