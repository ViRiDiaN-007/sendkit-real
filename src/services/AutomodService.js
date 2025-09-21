const axios = require('axios');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs').promises;
const path = require('path');
const PumpChatClient = require('../lib/viri-pump-client.js').PumpChatClient;

class AutomodService {
  constructor() {
    this.isConnectedFlag = false;
    this.botWalletAddress = process.env.AUTOMOD_BOT_WALLET || '';
    this.activeStreamers = new Map(); // streamerId -> { client, settings, stats }
    this.databaseService = null;
    this.io = null;
  }

  async initialize() {
    try {
      this.isConnectedFlag = true;
      console.log('✅ Automod Service initialized');
    } catch (error) {
      console.log('⚠️ Automod Service initialization failed:', error.message);
      this.isConnectedFlag = false;
    }
  }

  setDatabaseService(databaseService) {
    this.databaseService = databaseService;
  }

  setSocketIO(io) {
    this.io = io;
  }

  async setDatabaseServiceAndLoadStreamers(databaseService, chatMonitorManager) {
    this.setDatabaseService(databaseService);
    this.chatMonitorManager = chatMonitorManager;
    
    try {
      const streamers = await this.databaseService.getAllStreamerConfigs();
      console.log(`📋 Found ${streamers.length} streamers for automod service`);
      
      for (const streamer of streamers) {
        await this.createStreamerAutomod(streamer.streamer_id);
      }
      
      console.log(`🚀 Loaded ${this.activeStreamers.size} active automod services`);
    } catch (error) {
      console.error('❌ Error loading streamers for automod:', error);
    }
  }

  async createStreamerAutomod(streamerId) {
    try {
      // Get automod settings
      let settings = await this.databaseService.getAutomodSettings(streamerId);
      if (!settings) {
        settings = this.getDefaultSettings();
        await this.databaseService.updateAutomodSettings(streamerId, settings);
        console.log(`🔧 Creating default automod settings for streamer ${streamerId}`);
      }

      // Get streamer config
      const streamerConfig = await this.databaseService.getStreamerConfig(streamerId);
      if (!streamerConfig) {
        console.error(`❌ Streamer config not found for ${streamerId}`);
        return;
      }

      // If we have an automod wallet, automatically summon it
      if (settings.automodWalletAddress) {
        console.log(`🔍 [AUTOMOD] Found existing wallet: ${settings.automodWalletAddress} - auto-summoning...`);
        try {
          await this.summonAutomodWallet(streamerId);
          console.log(`✅ [AUTOMOD] Automatically summoned wallet for streamer ${streamerId}`);
        } catch (error) {
          console.error(`❌ [AUTOMOD] Failed to auto-summon wallet for streamer ${streamerId}:`, error.message);
          // Don't throw error - just log it and continue
        }
      }

      // Subscribe to shared chat monitor
      if (this.chatMonitorManager) {
        await this.chatMonitorManager.subscribe(streamerId, streamerConfig.token_address, 'Automod', (message) => {
          this.handleChatMessage(streamerId, message);
        });
      }

      // Store streamer data
      this.activeStreamers.set(streamerId, {
        settings,
        stats: {
          totalActions: 0,
          timeouts: 0,
          bans: 0,
          warnings: 0,
          todayActions: 0
        }
      });

      console.log(`✅ Automod service created for streamer ${streamerId}`);
    } catch (error) {
      console.error(`❌ Error creating automod service for ${streamerId}:`, error);
    }
  }

  async handleChatMessage(streamerId, message) {
    try {
      const streamerData = this.activeStreamers.get(streamerId);
      if (!streamerData || !streamerData.settings.enabled) {
        return;
      }

      // Test message against automod rules
      const testResult = await this.testAutomodRules(streamerId, message.message);
      
      if (testResult.violations.length > 0) {
        console.log(`🚨 Automod violation detected for ${streamerId}:`, testResult);
        
        // Take action based on violation severity
        await this.takeModerationAction(streamerId, message, testResult);
        
        // Update stats
        this.updateStats(streamerId, testResult.action);
        
        // Notify via socket.io
        if (this.io) {
          this.io.to(`streamer-${streamerId}`).emit('automod-action', {
            streamerId,
            action: testResult.action,
            message: message.message,
            username: message.username,
            violations: testResult.violations
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error handling chat message for ${streamerId}:`, error);
    }
  }

  async takeModerationAction(streamerId, message, testResult) {
    const streamerData = this.activeStreamers.get(streamerId);
    if (!streamerData) return;

    const settings = streamerData.settings;
    
    // Check if user is already banned
    if (settings.bannedUsers && settings.bannedUsers.includes(message.username)) {
      return; // User already banned, no action needed
    }

    // Only handle bans - remove timeout and warning logic
    if (testResult.action === 'ban' && settings.autoBan) {
      const banResult = await this.banUser(streamerId, message.username);
      if (banResult.success) {
        // Add user to banned list to prevent future actions
        const bannedUsers = settings.bannedUsers || [];
        if (!bannedUsers.includes(message.username)) {
          bannedUsers.push(message.username);
          await this.updateAutomodSettings(streamerId, {
            bannedUsers: bannedUsers
          });
        }
      }
    }
  }

  async timeoutUser(streamerId, username, duration) {
    // This would integrate with pump.fun's mod system
    console.log(`⏰ Timing out user ${username} for ${duration} seconds in ${streamerId}`);
    // TODO: Implement actual timeout via pump.fun API
  }

  async banUser(streamerId, username) {
    try {
      console.log(`🚫 Banning user ${username} in ${streamerId}`);
      
      // Get streamer config and automod settings
      const streamerConfig = await this.databaseService.getStreamerConfig(streamerId);
      const automodSettings = await this.databaseService.getAutomodSettings(streamerId);
      
      if (!streamerConfig || !automodSettings || !automodSettings.automodWalletAddress) {
        console.error(`❌ Cannot ban user: No automod wallet found for streamer ${streamerId}`);
        return { success: false, message: 'No automod wallet found' };
      }
      
      // Get auth cookie for the automod wallet
      const authCookie = await this.getOrGenerateAuthCookie(streamerId, automodSettings.automodWalletAddress);
      if (!authCookie) {
        console.error(`❌ Cannot ban user: No auth cookie available for streamer ${streamerId}`);
        return { success: false, message: 'No auth cookie available' };
      }
      
      // Extract auth token from cookie
      const authToken = authCookie.split('auth_token=')[1];
      
      // Make ban request to pump.fun API
      const banResponse = await axios.post(
        `https://livechat.pump.fun/chat/moderation/rooms/${streamerConfig.token_address}/bans`,
        {
          userAddress: username,
          reason: 'AUTOMOD_BANNED_WORD'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://pump.fun',
            'Accept': 'application/json',
            'Cookie': authCookie
          },
          validateStatus: () => true // Don't throw on non-2xx status codes
        }
      );
      
      console.log(`🔍 [BAN] Response status: ${banResponse.status}`);
      console.log(`🔍 [BAN] Response data:`, banResponse.data);
      
      if (banResponse.status === 200 || banResponse.status === 201) {
        console.log(`✅ Successfully banned user ${username} in ${streamerId}`);
        return { success: true, message: 'User banned successfully' };
      } else if (banResponse.status === 401 || banResponse.status === 403) {
        console.log(`❌ Auth rejected. Automod wallet must have moderator permissions for this room.`);
        return { success: false, message: 'Automod wallet needs moderator permissions' };
      } else {
        console.log(`❌ Ban failed with status ${banResponse.status}:`, banResponse.data);
        return { success: false, message: `Ban failed: ${banResponse.status}` };
      }
    } catch (error) {
      console.error(`❌ Error banning user ${username} in ${streamerId}:`, error);
      return { success: false, message: 'Ban request failed' };
    }
  }

  async warnUser(streamerId, username) {
    // This would send a warning message
    console.log(`⚠️ Warning user ${username} in ${streamerId}`);
    // TODO: Implement warning system
  }

  updateStats(streamerId, action) {
    const streamerData = this.activeStreamers.get(streamerId);
    if (!streamerData) return;

    streamerData.stats.totalActions++;
    streamerData.stats.todayActions++;
    
    switch (action) {
      case 'timeout':
        streamerData.stats.timeouts++;
        break;
      case 'ban':
        streamerData.stats.bans++;
        break;
      case 'warning':
        streamerData.stats.warnings++;
        break;
    }
  }

  async getAutomodSettings(streamerId) {
    if (this.databaseService) {
      const settings = await this.databaseService.getAutomodSettings(streamerId);
      return settings || this.getDefaultSettings();
    }
    return this.getDefaultSettings();
  }

  async getAutomodWalletStatus(streamerId) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      const streamerData = this.activeStreamers.get(streamerId);
      
      if (!settings.automodWalletAddress) {
        return {
          hasWallet: false,
          walletAddress: null,
          isConnected: false,
          status: 'No wallet generated'
        };
      }
      
      const isConnected = streamerData?.automodClient?.isConnected() || false;
      
      return {
        hasWallet: true,
        walletAddress: settings.automodWalletAddress,
        isConnected: isConnected,
        status: isConnected ? 'Connected to chat' : 'Wallet generated but not connected'
      };
    } catch (error) {
      console.error('Error getting automod wallet status:', error);
      return {
        hasWallet: false,
        walletAddress: null,
        isConnected: false,
        status: 'Error checking status'
      };
    }
  }

  async updateAutomodSettings(streamerId, settings) {
    if (this.databaseService) {
      await this.databaseService.updateAutomodSettings(streamerId, settings);
      
      // Update in-memory settings if streamer is active
      const streamerData = this.activeStreamers.get(streamerId);
      if (streamerData) {
        streamerData.settings = settings;
      }
    }
    return { success: true, message: 'Automod settings updated' };
  }

  async generateAutomodWallet(streamerId) {
    try {
      // Generate a new Solana keypair
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toString();
      const privateKey = bs58.encode(keypair.secretKey);
      
      // Store wallet in database
      if (this.databaseService) {
        await this.databaseService.updateAutomodSettings(streamerId, {
          automodWalletAddress: publicKey,
          automodWalletPrivateKey: privateKey
        });
      }
      
      console.log(`🔑 Generated automod wallet for streamer ${streamerId}: ${publicKey}`);
      
      return {
        success: true,
        message: 'Automod wallet generated successfully',
        walletAddress: publicKey,
        streamerId: streamerId
      };
    } catch (error) {
      console.error('Error generating automod wallet:', error.message);
      throw new Error('Failed to generate automod wallet');
    }
  }

  async getOrGenerateAuthCookie(streamerId, walletAddress) {
    try {
      console.log(`🔍 [AUTOMOD WALLET] Starting real authentication flow for streamer ${streamerId}`);
      
      // Get the automod settings to access the private key
      const automodSettings = await this.databaseService.getAutomodSettings(streamerId);
      if (!automodSettings || !automodSettings.automodWalletPrivateKey) {
        throw new Error('No automod wallet private key found');
      }
      
      // Import required modules for signing
      const nacl = require('tweetnacl');
      const { base58 } = require('@scure/base');
      
      // Recreate the keypair from the stored private key
      const privateKeyBytes = base58.decode(automodSettings.automodWalletPrivateKey);
      const keypair = { secretKey: privateKeyBytes, publicKey: base58.decode(walletAddress) };
      
      // Sign the message exactly as shown in the reference
      const timestamp = Date.now();
      const message = `Sign in to pump.fun: ${timestamp}`;
      const signature = nacl.sign.detached(Buffer.from(message, 'utf8'), keypair.secretKey);
      const signatureBase58 = base58.encode(signature);
      
      console.log(`🔍 [AUTOMOD WALLET] Signing message: "${message}"`);
      console.log(`🔍 [AUTOMOD WALLET] Signature: ${signatureBase58.substring(0, 20)}...`);
      
      // Make the login request to pump.fun
      const loginResponse = await axios.post(
        'https://frontend-api-v3.pump.fun/auth/login',
        {
          address: walletAddress,
          signature: signatureBase58,
          timestamp: timestamp
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://pump.fun',
            'Accept': 'application/json',
          },
          validateStatus: () => true, // Don't throw on non-2xx status codes
        }
      );
      
      console.log(`🔍 [AUTOMOD WALLET] Login response status: ${loginResponse.status}`);
      console.log(`🔍 [AUTOMOD WALLET] Login response data:`, loginResponse.data);
      
      // Extract auth token from response
      let authToken = null;
      
      // Check if token is in JSON response
      if (loginResponse.data && (loginResponse.data.auth_token || loginResponse.data.token)) {
        authToken = loginResponse.data.auth_token || loginResponse.data.token;
        console.log(`🔍 [AUTOMOD WALLET] Found auth token in JSON response`);
      }
      
      // Check if token is in Set-Cookie header
      if (!authToken && loginResponse.headers && loginResponse.headers['set-cookie']) {
        const cookies = loginResponse.headers['set-cookie'];
        for (const cookieStr of cookies) {
          const parsed = cookieStr.split(';')[0];
          if (parsed.includes('auth_token=')) {
            authToken = parsed.split('auth_token=')[1];
            console.log(`🔍 [AUTOMOD WALLET] Found auth token in Set-Cookie header`);
            break;
          }
        }
      }
      
      if (!authToken) {
        console.error(`❌ [AUTOMOD WALLET] No auth token found in login response`);
        console.error(`❌ [AUTOMOD WALLET] Response status: ${loginResponse.status}`);
        console.error(`❌ [AUTOMOD WALLET] Response data:`, loginResponse.data);
        return null;
      }
      
      // Create the proper cookie string
      const cookieString = `auth_token=${authToken}`;
      console.log(`🔍 [AUTOMOD WALLET] Generated real auth cookie: ${cookieString.substring(0, 30)}...`);
      
      return cookieString;
    } catch (error) {
      console.error(`❌ Error generating auth cookie for ${streamerId}:`, error);
      return null;
    }
  }

  async summonAutomodWallet(streamerId) {
    try {
      // Get streamer config and automod settings
      const streamerConfig = await this.databaseService.getStreamerConfig(streamerId);
      const automodSettings = await this.databaseService.getAutomodSettings(streamerId);
      
      if (!streamerConfig || !automodSettings || !automodSettings.automodWalletAddress) {
        throw new Error('No automod wallet found. Please generate one first.');
      }
      
      console.log(`🔍 [AUTOMOD WALLET] Starting summon process for streamer ${streamerId}`);
      console.log(`🔍 [AUTOMOD WALLET] Wallet address: ${automodSettings.automodWalletAddress}`);
      console.log(`🔍 [AUTOMOD WALLET] Token address: ${streamerConfig.token_address}`);
      
      // Check if we already have an active client for this streamer
      const streamerData = this.activeStreamers.get(streamerId);
      let automodClient = streamerData?.automodClient;
      
      // If no existing client or it's disconnected, create a new one
      if (!automodClient || !automodClient.isConnected()) {
        console.log(`🔍 [AUTOMOD WALLET] Creating new client for streamer ${streamerId}`);
        automodClient = new PumpChatClient({
          roomId: streamerConfig.token_address,
          username: `AutomodBot_${streamerId.substring(0, 8)}`,
          messageHistoryLimit: 10
        });
      } else {
        console.log(`🔍 [AUTOMOD WALLET] Reusing existing client for streamer ${streamerId}`);
      }
      
      // Get or generate auth cookie for this streamer
      const authCookie = await this.getOrGenerateAuthCookie(streamerId, automodSettings.automodWalletAddress);
      if (authCookie) {
        automodClient.setAuthCookie(authCookie);
        console.log(`🔍 [AUTOMOD WALLET] Auth cookie set for streamer ${streamerId}`);
      } else {
        console.log(`🔍 [AUTOMOD WALLET] No auth cookie available - connecting without authentication`);
      }
      
      // Set up event handlers
      automodClient.on('connected', () => {
        console.log(`🤖 Automod wallet connected to chat for streamer ${streamerId}`);
        
        // Send "Its me!" message after connection
        setTimeout(() => {
          console.log(`🔍 [AUTOMOD WALLET] Attempting to send message "Its me!"`);
          automodClient.sendMessage("Its me!");
          console.log(`📢 Automod wallet announced itself in chat for streamer ${streamerId}`);
        }, 2000);
      });
      
      automodClient.on('error', (error) => {
        console.error(`❌ Automod wallet connection error for ${streamerId}:`, error);
        console.log(`🔍 [AUTOMOD WALLET] Error details:`, error.toString());
      });
      
      automodClient.on('serverError', (error) => {
        console.error(`❌ Automod wallet server error for ${streamerId}:`, error);
        console.log(`🔍 [AUTOMOD WALLET] Server error details:`, JSON.stringify(error, null, 2));
        if (error.error_code === 'AUTHENTICATION_REQUIRED') {
          console.log(`🔐 Authentication required for automod wallet. The wallet needs to be signed in to pump.fun to send messages.`);
        }
      });
      
      // Store the client for potential future use
      const streamerData = this.activeStreamers.get(streamerId);
      if (streamerData) {
        streamerData.automodClient = automodClient;
      }
      
      // Connect to the chat if not already connected
      if (!automodClient.isConnected()) {
        console.log(`🔍 [AUTOMOD WALLET] Connecting to chat...`);
        automodClient.connect();
      } else {
        console.log(`🔍 [AUTOMOD WALLET] Client already connected`);
      }
      
      return {
        success: true,
        message: 'Automod wallet summoned to chat successfully. Note: To send messages, the wallet needs to be authenticated with pump.fun.',
        walletAddress: automodSettings.automodWalletAddress,
        streamerId: streamerId
      };
    } catch (error) {
      console.error('Error summoning automod wallet:', error.message);
      throw new Error('Failed to summon automod wallet: ' + error.message);
    }
  }

  async promoteBotToMod(streamerId, botWalletAddress) {
    try {
      // This would integrate with the actual pump.fun mod system
      // For now, return a placeholder response
      console.log(`Promoting bot ${botWalletAddress} to mod for streamer ${streamerId}`);
      
      return {
        success: true,
        message: 'Bot promoted to mod successfully',
        botWalletAddress: botWalletAddress,
        streamerId: streamerId
      };
    } catch (error) {
      console.error('Error promoting bot to mod:', error.message);
      throw new Error('Failed to promote bot to mod');
    }
  }

  async testAutomodRules(streamerId, testMessage) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      
      const results = {
        message: testMessage,
        violations: [],
        action: 'none',
        confidence: 0
      };
      
      // Get all banned words including automatic filters
      let allBannedWords = [...(settings.bannedWords || [])];
      
      // Add automatic word filters if enabled
      if (settings.removeSlurs) {
        const slurs = await this.getSlurWords();
        allBannedWords = [...allBannedWords, ...slurs];
      }
      
      if (settings.removeCommonSpam) {
        const spamWords = await this.getSpamWords();
        allBannedWords = [...allBannedWords, ...spamWords];
      }
      
      // Check for banned words
      if (allBannedWords.length > 0) {
        const lowerMessage = testMessage.toLowerCase();
        const foundWords = allBannedWords.filter(word => 
          lowerMessage.includes(word.toLowerCase())
        );
        
        if (foundWords.length > 0) {
          results.violations.push({
            type: 'banned_words',
            words: foundWords,
            severity: 'high'
          });
          results.action = 'ban';
          results.confidence = 0.8;
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error testing automod rules:', error.message);
      throw new Error('Failed to test automod rules');
    }
  }

  async getModerationStats(streamerId) {
    try {
      const streamerData = this.activeStreamers.get(streamerId);
      if (streamerData) {
        return {
          ...streamerData.stats,
          topViolations: [],
          recentActions: []
        };
      }
      
      return this.getDefaultStats();
    } catch (error) {
      console.error('Error fetching moderation stats:', error.message);
      return this.getDefaultStats();
    }
  }

  async addBannedWord(streamerId, word) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      const bannedWords = settings.banned_words || [];
      
      if (!bannedWords.includes(word.toLowerCase())) {
        bannedWords.push(word.toLowerCase());
        await this.updateAutomodSettings(streamerId, {
          banned_words: bannedWords
        });
      }
      
      return { success: true, word: word };
    } catch (error) {
      console.error('Error adding banned word:', error.message);
      throw new Error('Failed to add banned word');
    }
  }

  async removeBannedWord(streamerId, word) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      const bannedWords = settings.banned_words || [];
      
      const filteredWords = bannedWords.filter(w => w !== word.toLowerCase());
      await this.updateAutomodSettings(streamerId, {
        banned_words: filteredWords
      });
      
      return { success: true, word: word };
    } catch (error) {
      console.error('Error removing banned word:', error.message);
      throw new Error('Failed to remove banned word');
    }
  }

  async addBannedUser(streamerId, userAddress) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      const bannedUsers = settings.banned_users || [];
      
      if (!bannedUsers.includes(userAddress)) {
        bannedUsers.push(userAddress);
        await this.updateAutomodSettings(streamerId, {
          banned_users: bannedUsers
        });
      }
      
      return { success: true, userAddress: userAddress };
    } catch (error) {
      console.error('Error adding banned user:', error.message);
      throw new Error('Failed to add banned user');
    }
  }

  async removeBannedUser(streamerId, userAddress) {
    try {
      const settings = await this.getAutomodSettings(streamerId);
      const bannedUsers = settings.banned_users || [];
      
      const filteredUsers = bannedUsers.filter(u => u !== userAddress);
      await this.updateAutomodSettings(streamerId, {
        banned_users: filteredUsers
      });
      
      return { success: true, userAddress: userAddress };
    } catch (error) {
      console.error('Error removing banned user:', error.message);
      throw new Error('Failed to remove banned user');
    }
  }

  // Helper methods for content analysis
  detectSpam(message) {
    // Check for repeated characters (e.g., "aaaaaa", "!!!!!!")
    const repeatedCharPattern = /(.)\1{4,}/;
    return repeatedCharPattern.test(message);
  }

  detectExcessiveCaps(message) {
    const capsRatio = this.getCapsRatio(message);
    return capsRatio > 0.7; // More than 70% caps
  }

  getCapsRatio(message) {
    if (message.length === 0) return 0;
    const capsCount = (message.match(/[A-Z]/g) || []).length;
    return capsCount / message.length;
  }

  // Admin-configured word lists
  async getSlurWords() {
    try {
      const filePath = path.join(__dirname, '../../data/slurs.txt');
      const content = await fs.readFile(filePath, 'utf8');
      
      // Parse the file content, filtering out comments and empty lines
      const words = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.toLowerCase());
      
      console.log(`📝 Loaded ${words.length} slur words from file`);
      return words;
    } catch (error) {
      console.error('Error reading slur words file:', error);
      // Return default slur words if file doesn't exist
      return [
        'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spic', 'chink',
        'kike', 'wetback', 'towelhead', 'sandnigger', 'tranny', 'dyke', 'lesbo'
      ];
    }
  }

  async getSpamWords() {
    try {
      const filePath = path.join(__dirname, '../../data/spam.txt');
      const content = await fs.readFile(filePath, 'utf8');
      
      // Parse the file content, filtering out comments and empty lines
      const words = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.toLowerCase());
      
      console.log(`📝 Loaded ${words.length} spam words from file`);
      return words;
    } catch (error) {
      console.error('Error reading spam words file:', error);
      // Return default spam words if file doesn't exist
      return [
        'click here', 'free money', 'make money fast', 'work from home',
        'get rich quick', 'crypto scam', 'pump and dump', 'rug pull',
        'telegram', 'discord', 'follow me', 'subscribe', 'like and share'
      ];
    }
  }

  async updateSlurWords(words) {
    try {
      const filePath = path.join(__dirname, '../../data/slurs.txt');
      
      // Create the file content with proper formatting
      const content = [
        '# Slur words list for automod',
        '# One word per line, case insensitive matching',
        '# Lines starting with # are comments and will be ignored',
        '',
        ...words.map(word => word.trim()).filter(word => word)
      ].join('\n');
      
      await fs.writeFile(filePath, content, 'utf8');
      console.log(`📝 Updated slur words file with ${words.length} words`);
      return { success: true, message: 'Slur words updated successfully' };
    } catch (error) {
      console.error('Error updating slur words file:', error);
      return { success: false, message: 'Failed to update slur words' };
    }
  }

  async updateSpamWords(words) {
    try {
      const filePath = path.join(__dirname, '../../data/spam.txt');
      
      // Create the file content with proper formatting
      const content = [
        '# Spam words list for automod',
        '# One word or phrase per line, case insensitive matching',
        '# Lines starting with # are comments and will be ignored',
        '',
        ...words.map(word => word.trim()).filter(word => word)
      ].join('\n');
      
      await fs.writeFile(filePath, content, 'utf8');
      console.log(`📝 Updated spam words file with ${words.length} words`);
      return { success: true, message: 'Spam words updated successfully' };
    } catch (error) {
      console.error('Error updating spam words file:', error);
      return { success: false, message: 'Failed to update spam words' };
    }
  }

  getDefaultSettings() {
    return {
      enabled: true,
      botWalletAddress: this.botWalletAddress,
      automodWalletAddress: null,
      automodWalletPrivateKey: null,
      modPermissions: ['ban'], // Only ban, no timeout
      bannedWords: [],
      bannedUsers: [],
      timeoutDuration: 30, // Keep for compatibility but not used
      maxWarnings: 3,
      autoTimeout: false, // Disabled since we only ban
      autoBan: true, // Always ban
      spamDetection: true, // Enable spam detection by default
      capsDetection: false, // Disabled - only check banned words
      linkDetection: false,
      emojiSpamDetection: false,
      removeSlurs: false, // New: automatic slur filtering
      removeCommonSpam: false // New: automatic spam word filtering
    };
  }

  getDefaultStats() {
    return {
      totalActions: 0,
      timeouts: 0,
      bans: 0,
      warnings: 0,
      todayActions: 0,
      topViolations: [],
      recentActions: []
    };
  }

  // Validate automod settings
  validateSettings(settings) {
    const errors = [];
    
    if (settings.timeoutDuration && (settings.timeoutDuration < 60 || settings.timeoutDuration > 3600)) {
      errors.push('Timeout duration must be between 60 and 3600 seconds');
    }
    
    if (settings.maxWarnings && (settings.maxWarnings < 1 || settings.maxWarnings > 10)) {
      errors.push('Max warnings must be between 1 and 10');
    }
    
    if (settings.botWalletAddress && !this.isValidWalletAddress(settings.botWalletAddress)) {
      errors.push('Invalid bot wallet address format');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  isValidWalletAddress(address) {
    // Basic Solana address validation
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  isConnected() {
    return this.isConnectedFlag;
  }
}

module.exports = AutomodService;
