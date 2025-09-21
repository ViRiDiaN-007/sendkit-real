const EventEmitter = require('events');
const { PumpChatClient } = require('../lib/viri-pump-client');
const WalletMonitor = require('./WalletMonitor');
const fs = require('fs').promises;
const path = require('path');

class IntegratedTTSService extends EventEmitter {
  constructor() {
    super();
    this.streamers = new Map(); // streamerId -> { config, settings, queue, stats, walletMonitor }
    this.databaseService = null;
    this.io = null;
    this.isInitialized = false;
    this.messageQueue = new Map(); // streamerId -> array of messages
    this.cooldowns = new Map(); // streamerId -> lastTTS time
    this.recentDonors = new Map(); // streamerId -> Map(walletAddress -> { timestamp, amount, streamerAddress })
    this.donorTimeout = 300000; // 5 minutes to use TTS after donation
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      queueLength: 0
    };
  }

  async initialize(databaseService, io) {
    this.databaseService = databaseService;
    this.io = io;
    this.isInitialized = true;
    console.log('✅ Integrated TTS Service initialized');
  }

  async setDatabaseServiceAndLoadStreamers(databaseService, chatMonitorManager) {
    this.databaseService = databaseService;
    this.chatMonitorManager = chatMonitorManager;
    await this.loadAllStreamers();
  }

  async loadAllStreamers() {
    try {
      const streamers = await this.databaseService.getAllStreamerConfigs();
      console.log(`📋 Found ${streamers.length} streamers for TTS service`);

      for (const streamer of streamers) {
        if (streamer.is_active) {
          await this.createStreamerTTS(streamer);
        }
      }

      console.log(`🚀 Loaded ${this.streamers.size} active TTS services`);
    } catch (error) {
      console.error('❌ Error loading streamers for TTS:', error);
    }
  }

  async createStreamerTTS(streamer) {
    const streamerId = streamer.streamer_id;
    
    try {
      // Get or create TTS settings
      let ttsSettings = await this.databaseService.getTTSSettings(streamerId);
      if (!ttsSettings) {
        console.log(`🔧 Creating default TTS settings for streamer ${streamerId}`);
        const defaultSettings = this.getDefaultSettings();
        await this.databaseService.updateTTSSettings(streamerId, defaultSettings);
        ttsSettings = defaultSettings;
      } else {
        // Fix existing settings if auto_tts_enabled is false or cooldown is too high
        console.log(`🔍 [TTS] Checking settings for ${streamerId}: auto_tts_enabled = ${ttsSettings.auto_tts_enabled}, cooldown_seconds = ${ttsSettings.cooldown_seconds}`);
        let needsUpdate = false;
        
        if (ttsSettings.auto_tts_enabled === false) {
          console.log(`🔧 Fixing TTS settings for streamer ${streamerId} - enabling auto_tts_enabled`);
          ttsSettings.auto_tts_enabled = true;
          needsUpdate = true;
        }
        
        if (ttsSettings.cooldown_seconds > 5) {
          console.log(`🔧 Fixing TTS settings for streamer ${streamerId} - reducing cooldown from ${ttsSettings.cooldown_seconds}s to 3s`);
          ttsSettings.cooldown_seconds = 3;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          await this.databaseService.updateTTSSettings(streamerId, ttsSettings);
          console.log(`✅ [TTS] Fixed settings for ${streamerId}: auto_tts_enabled = ${ttsSettings.auto_tts_enabled}, cooldown_seconds = ${ttsSettings.cooldown_seconds}`);
        }
      }

      // Subscribe to shared chat monitor
      if (this.chatMonitorManager) {
        await this.chatMonitorManager.subscribe(streamerId, streamer.token_address, 'TTS', (message) => {
          // console.log(`🎤 TTS received raw message for ${streamerId}:`, JSON.stringify(message, null, 2));
          this.handleChatMessage(streamerId, message);
        });
      }
      
      // Create wallet monitor for this streamer
      const walletMonitor = new WalletMonitor();
      
      // Set up wallet monitoring event handlers
      walletMonitor.on('donation', (donation) => {
        this.handleDonation(streamerId, donation);
      });

      // Store streamer configuration
      this.streamers.set(streamerId, {
        config: streamer,
        settings: ttsSettings,
        walletMonitor: walletMonitor,
        queue: [],
        recentMessages: [], // Store recent TTS messages
        stats: {
          processed: 0,
          errors: 0,
          lastProcessed: null
        }
      });

      // Initialize recent donors map for this streamer
      this.recentDonors.set(streamerId, new Map());

      // Connect to chat if token address is available
      if (streamer.token_address) {
        // Chat connection is now handled by shared chat monitor
      }

      // Start wallet monitoring if wallet address is available
      if (streamer.wallet_address) {
        walletMonitor.startMonitoring(streamer.wallet_address, streamerId);
        console.log(`💰 Started wallet monitoring for streamer ${streamerId} (wallet: ${streamer.wallet_address})`);
        
        // Set up donation event listener for this streamer
        walletMonitor.on('donation', (donation) => {
          console.log(`💰 [TTS] Donation event received for streamer ${streamerId}:`, donation);
          this.handleStreamerDonation(streamerId, donation);
        });
      }

      console.log(`✅ TTS service created for streamer ${streamerId}`);
    } catch (error) {
      console.error(`❌ Error creating TTS service for streamer ${streamerId}:`, error);
    }
  }

  async restartStreamerTTS(streamerId) {
    try {
      console.log(`🔄 Restarting TTS service for streamer ${streamerId}`);
      
      // Stop existing service
      await this.stopStreamerTTS(streamerId);
      
      // Get updated streamer config from database
      const streamerConfig = await this.databaseService.getStreamerConfig(streamerId);
      if (!streamerConfig) {
        throw new Error('Streamer not found');
      }
      
      // Create new service with updated config
      await this.createStreamerTTS(streamerConfig);
      
      console.log(`✅ TTS service restarted for streamer ${streamerId}`);
    } catch (error) {
      console.error(`❌ Error restarting TTS service for streamer ${streamerId}:`, error);
      throw error;
    }
  }

  async stopStreamerTTS(streamerId) {
    try {
      const streamer = this.streamers.get(streamerId);
      if (!streamer) {
        return; // Already stopped
      }

      // Stop wallet monitoring
      if (streamer.walletMonitor) {
        streamer.walletMonitor.stopMonitoring();
      }

      // Disconnect chat client
      // Unsubscribe from shared chat monitor
      if (this.chatMonitorManager) {
        this.chatMonitorManager.unsubscribe(streamerId, 'TTS');
      }

      // Remove from streamers map
      this.streamers.delete(streamerId);
      this.recentDonors.delete(streamerId);

      console.log(`🛑 TTS service stopped for streamer ${streamerId}`);
    } catch (error) {
      console.error(`❌ Error stopping TTS service for streamer ${streamerId}:`, error);
    }
  }

  handleStreamerDonation(streamerId, donation) {
    console.log(`💰 [TTS] Donation for streamer ${streamerId}:`, donation);
    
    // Register donation directly with our TTS service (like the original code)
    const streamer = this.streamers.get(streamerId);
    if (streamer) {
      // Register the donor in our recent donors map
      this.registerDonation(streamerId, donation.from, donation.amount);
      console.log(`✅ [TTS] Donation registered for auto-TTS: ${donation.from} donated ${donation.amount} SOL`);
    }
  }

  async handleDonation(streamerId, donation) {
    try {
      console.log(`💰 [TTS] Donation detected for streamer ${streamerId}:`, donation);
      
      // Check if donation meets minimum requirement
      const streamer = this.streamers.get(streamerId);
      if (!streamer) {
        console.log(`❌ [TTS] Streamer not found: ${streamerId}`);
        return;
      }
      
      console.log(`🔍 [TTS] Checking donation amount: ${donation.amount} SOL >= ${streamer.settings.min_donation} SOL`);
      if (donation.amount < streamer.settings.min_donation) {
        console.log(`❌ [TTS] Donation amount too low: ${donation.amount} SOL < ${streamer.settings.min_donation} SOL`);
        return;
      }
      
      // Register the donor
      console.log(`✅ [TTS] Registering donation from ${donation.from} for ${donation.amount} SOL`);
      this.registerDonation(streamerId, donation.from, donation.amount);
      
    } catch (error) {
      console.error(`❌ [TTS] Error handling donation for ${streamerId}:`, error);
    }
  }

  registerDonation(streamerId, walletAddress, amount) {
    const now = Date.now();
    const streamerDonors = this.recentDonors.get(streamerId);
    
    if (streamerDonors) {
      const donorData = {
        timestamp: now,
        amount: amount,
        streamerAddress: streamerId
      };
      
      streamerDonors.set(walletAddress, donorData);
      
      console.log(`💰 [TTS] Donation registered for auto-TTS: ${walletAddress} donated ${amount} SOL to ${streamerId}`);
      console.log(`📝 [TTS] Donor data:`, donorData);
      console.log(`📊 [TTS] Current recent donors for ${streamerId}:`, Array.from(streamerDonors.keys()));
      
      // Clean up old donors periodically
      this.cleanupOldDonors(streamerId);
    }
  }

  cleanupOldDonors(streamerId) {
    const streamerDonors = this.recentDonors.get(streamerId);
    if (!streamerDonors) return;
    
    const now = Date.now();
    for (const [walletAddress, donorData] of streamerDonors.entries()) {
      if (now - donorData.timestamp > this.donorTimeout) {
        streamerDonors.delete(walletAddress);
      }
    }
  }

  // Check if message contains banned words (slurs, spam, or custom banned words)
  async isMessageBanned(streamerId, message) {
    try {
      // Get automod settings for this streamer
      const automodSettings = await this.databaseService.getAutomodSettings(streamerId);
      if (!automodSettings) return false;

      // Get all banned words including automatic filters
      let allBannedWords = [...(automodSettings.bannedWords || [])];
      
      // Add automatic word filters if enabled
      if (automodSettings.removeSlurs) {
        const slurs = await this.getSlurWords();
        allBannedWords = [...allBannedWords, ...slurs];
      }
      
      if (automodSettings.removeCommonSpam) {
        const spamWords = await this.getSpamWords();
        allBannedWords = [...allBannedWords, ...spamWords];
      }
      
      // Check for banned words
      if (allBannedWords.length > 0) {
        const lowerMessage = message.toLowerCase();
        const foundWords = allBannedWords.filter(word => 
          lowerMessage.includes(word.toLowerCase())
        );
        
        if (foundWords.length > 0) {
          console.log(`🚫 [TTS] Banned words detected in message for ${streamerId}: ${foundWords.join(', ')}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking banned words for TTS:', error);
      return false; // Allow message through if there's an error
    }
  }

  // Get slur words from file
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
      
      return words;
    } catch (error) {
      console.error('Error reading slur words file:', error);
      return [];
    }
  }

  // Get spam words from file
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
      
      return words;
    } catch (error) {
      console.error('Error reading spam words file:', error);
      return [];
    }
  }

  async handleChatMessage(streamerId, message) {
    try {
      const streamer = this.streamers.get(streamerId);
      if (!streamer || !streamer.settings.enabled) return;

      // console.log(`🎤 TTS received message for ${streamerId}:`, message);

      // If donation gate is disabled, TTS all messages (no donation required)
      if (!streamer.settings.donation_gate_enabled) {
        console.log(`🔧 [TTS] Donation gate disabled - reading all messages: ${message.username || message.user}: ${message.text || message.content || message.message}`);
        
        const messageData = this.parseRegularMessage(message);
        if (messageData) {
          await this.processRegularTTS(streamerId, messageData);
        }
        return;
      }

      // If donation gate is enabled, check for recent donors first
      const userAddress = message.userAddress || message.user || message.sender;
      if (userAddress && this.isRecentDonor(streamerId, userAddress)) {
        console.log(`🎤 Auto-TTS triggered for recent donor: ${message.username || message.user}: ${message.text || message.content || message.message}`);
        
        const messageData = this.parseRegularMessage(message);
        if (messageData) {
          // Remove from recent donors to prevent multiple TTS from same donation
          this.removeRecentDonor(streamerId, userAddress);
          console.log(`🗑️ [TTS] Removed ${userAddress} from recent donors after TTS use`);
          
          // Process as regular TTS since they were a recent donor
          await this.processRegularTTS(streamerId, messageData);
        }
        return;
      }

      // If donation gate is enabled, check for donation messages
      if (this.isDonationMessage(message)) {
        const donationData = this.parseDonationMessage(message);
        if (donationData) {
          await this.processDonationTTS(streamerId, donationData);
        }
      }
    } catch (error) {
      console.error(`❌ Error handling chat message for TTS ${streamerId}:`, error);
    }
  }

  isRecentDonor(streamerId, walletAddress) {
    const streamerDonors = this.recentDonors.get(streamerId);
    if (!streamerDonors) {
      console.log(`🔍 [TTS] No recent donors map for streamer ${streamerId}`);
      return false;
    }
    
    const donorData = streamerDonors.get(walletAddress);
    if (!donorData) {
      return false;
    }
    
    const now = Date.now();
    const isValid = (now - donorData.timestamp) <= this.donorTimeout;
    
    
    if (!isValid) {
      streamerDonors.delete(walletAddress);
      console.log(`🗑️ [TTS] Removed expired donor ${walletAddress}`);
    }
    
    return isValid;
  }

  removeRecentDonor(streamerId, walletAddress) {
    const streamerDonors = this.recentDonors.get(streamerId);
    if (streamerDonors) {
      streamerDonors.delete(walletAddress);
    }
  }

  isDonationMessage(message) {
    // Look for donation patterns in the message
    const text = message.text || message.content || '';
    const donationPatterns = [
      /donated/i,
      /sent.*sol/i,
      /purchased/i,
      /bought/i,
      /\d+\.?\d*\s*sol/i, // Any SOL amount
      /bought.*tokens/i,
      /purchased.*tokens/i
    ];
    
    return donationPatterns.some(pattern => pattern.test(text));
  }

  isRegularMessage(message) {
    // Check if this is a regular chat message (not a donation)
    const text = message.text || message.content || message.message || '';
    return text.length > 0 && !this.isDonationMessage(message);
  }

  parseRegularMessage(message) {
    try {
      const text = message.text || message.content || message.message || '';
      const walletAddress = message.walletAddress || message.userAddress || message.user || message.sender;
      
      console.log(`🔍 [TTS] Parsing message - text: "${text}", walletAddress: "${walletAddress}"`);
      
      if (text && walletAddress) {
        console.log(`✅ [TTS] Message parsed successfully: ${walletAddress}: ${text}`);
        return {
          walletAddress,
          amount: 0, // Regular messages have no amount
          message: text,
          originalMessage: text,
          timestamp: new Date()
        };
      }
      
      console.log(`❌ [TTS] Message parsing failed - missing text or walletAddress`);
      return null;
    } catch (error) {
      console.error('❌ Error parsing regular message:', error);
      return null;
    }
  }

  async processRegularTTS(streamerId, messageData) {
    try {
      const streamer = this.streamers.get(streamerId);
      if (!streamer) return;

      const settings = streamer.settings;
      
      console.log(`🔍 [TTS] Processing regular TTS for ${streamerId} - auto_tts_enabled: ${settings.auto_tts_enabled}, enabled: ${settings.enabled}`);
      
      // Check if auto TTS is enabled for regular messages
      if (!settings.auto_tts_enabled) {
        console.log(`❌ [TTS] Auto TTS disabled for ${streamerId}`);
        return;
      }

      // Check for banned words
      const isBanned = await this.isMessageBanned(streamerId, messageData.message);
      if (isBanned) {
        console.log(`🚫 [TTS] Message blocked due to banned words for ${streamerId}: ${messageData.message}`);
        return;
      }

      // Check cooldown
      if (this.isInCooldown(streamerId)) {
        const lastTTS = this.cooldowns.get(streamerId);
        const cooldownMs = streamer.settings.cooldown_seconds * 1000;
        const remainingMs = cooldownMs - (Date.now() - lastTTS);
        console.log(`⏰ [TTS] Cooldown active for ${streamerId} - ${Math.ceil(remainingMs/1000)}s remaining`);
        return;
      }

      // Check message length
      if (messageData.message.length > settings.max_message_length) {
        return;
      }

      // Format TTS message
      const ttsMessage = this.formatRegularTTSMessage(messageData.walletAddress, messageData.message);
      
      // Add to queue
      const ttsRequest = {
        id: this.generateId(),
        streamerId,
        message: ttsMessage,
        originalMessage: messageData.message,
        walletAddress: messageData.walletAddress,
        sender: messageData.username || messageData.walletAddress?.substring(0, 8) || 'Anonymous',
        amount: 0,
        type: 'regular',
        timestamp: new Date(),
        settings: settings
      };

      streamer.queue.push(ttsRequest);
      this.stats.queueLength++;

      // Update cooldown
      this.cooldowns.set(streamerId, Date.now());

      // Emit TTS event
      this.emit('tts-request', ttsRequest);
      
      // Broadcast to browser sources
      this.broadcastToSubscribers(streamerId, 'tts-request', ttsRequest);

      console.log(`🎤 Regular TTS queued for ${streamerId}: ${ttsMessage}`);

      // Process queue
      this.processQueue(streamerId);
    } catch (error) {
      console.error(`❌ Error processing regular TTS for ${streamerId}:`, error);
    }
  }

  formatRegularTTSMessage(walletAddress, message) {
    // Just return the message content directly without "username says"
    return message;
  }

  parseDonationMessage(message) {
    try {
      const text = message.text || message.content || '';
      const walletAddress = message.walletAddress || message.user || message.sender;
      
      // Extract amount from message (look for SOL amounts)
      const amountMatch = text.match(/(\d+\.?\d*)\s*sol/i);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
      
      // Extract the actual message content (remove donation info)
      let cleanMessage = text.replace(/(donated|sent|purchased|bought).*?sol/i, '').trim();
      cleanMessage = cleanMessage.replace(/^\d+\.?\d*\s*sol/i, '').trim();
      
      if (cleanMessage && walletAddress) {
        return {
          walletAddress,
          amount,
          message: cleanMessage,
          originalMessage: text,
          timestamp: new Date()
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error parsing donation message:', error);
      return null;
    }
  }

  async processDonationTTS(streamerId, messageData) {
    try {
      const streamer = this.streamers.get(streamerId);
      if (!streamer) return;

      const settings = streamer.settings;
      
      // Get donation amount from recent donors if available
      const userAddress = messageData.walletAddress;
      const streamerDonors = this.recentDonors.get(streamerId);
      let donationAmount = 0;
      
      if (streamerDonors && streamerDonors.has(userAddress)) {
        const donorData = streamerDonors.get(userAddress);
        donationAmount = donorData.amount;
      }

      // Check minimum donation requirement - if user is in recent donors, they already met the requirement
      if (settings.donation_gate_enabled && !streamerDonors?.has(userAddress)) {
        return;
      }

      // Check for banned words
      const isBanned = await this.isMessageBanned(streamerId, messageData.message);
      if (isBanned) {
        console.log(`🚫 [TTS] Donation message blocked due to banned words for ${streamerId}: ${messageData.message}`);
        return;
      }

      // Check cooldown
      if (this.isInCooldown(streamerId)) {
        return;
      }

      // Check message length
      if (messageData.message.length > settings.max_message_length) {
        return;
      }

      // Format TTS message
      const ttsMessage = this.formatTTSMessage(messageData.walletAddress, donationAmount, messageData.message);
      
      // Add to queue
      const ttsRequest = {
        id: this.generateId(),
        streamerId,
        message: ttsMessage,
        originalMessage: messageData.message,
        walletAddress: messageData.walletAddress,
        sender: messageData.username || messageData.walletAddress?.substring(0, 8) || 'Anonymous',
        amount: donationAmount,
        type: 'donation',
        timestamp: new Date(),
        settings: settings
      };

      streamer.queue.push(ttsRequest);
      this.stats.queueLength++;

      // Update cooldown
      this.cooldowns.set(streamerId, Date.now());

      // Emit TTS event
      this.emit('tts-request', ttsRequest);
      
      // Broadcast to browser sources
      this.broadcastToSubscribers(streamerId, 'tts-request', ttsRequest);

      console.log(`🎤 TTS queued for ${streamerId}: ${ttsMessage}`);

      // Process queue
      this.processQueue(streamerId);
    } catch (error) {
      console.error(`❌ Error processing donation TTS for ${streamerId}:`, error);
    }
  }

  isInCooldown(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return true;

    const lastTTS = this.cooldowns.get(streamerId);
    if (!lastTTS) return false;

    const cooldownMs = streamer.settings.cooldown_seconds * 1000;
    return (Date.now() - lastTTS) < cooldownMs;
  }

  async processQueue(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer || streamer.queue.length === 0) return;

    const ttsRequest = streamer.queue.shift();
    this.stats.queueLength--;

    try {
      // Simulate TTS processing (in a real implementation, this would call a TTS API)
      await this.simulateTTSProcessing(ttsRequest);
      
      // Update stats
      streamer.stats.processed++;
      streamer.stats.lastProcessed = new Date();
      this.stats.totalProcessed++;

      // Broadcast completion
      this.broadcastToSubscribers(streamerId, 'tts-completed', {
        id: ttsRequest.id,
        message: ttsRequest.message
      });

      console.log(`✅ TTS processed for ${streamerId}: ${ttsRequest.message}`);
    } catch (error) {
      console.error(`❌ Error processing TTS for ${streamerId}:`, error);
      streamer.stats.errors++;
      this.stats.totalErrors++;
    }
  }

  async simulateTTSProcessing(ttsRequest) {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create message object
    const message = {
      id: ttsRequest.id,
      text: ttsRequest.message,
      sender: ttsRequest.sender || 'Anonymous',
      timestamp: new Date(),
      type: ttsRequest.type || 'regular',
      amount: ttsRequest.amount || 0
    };
    
    try {
      // Save to database
      await this.databaseService.saveTTSMessage(ttsRequest.streamerId, message);
      
      // Clean up old messages (keep only last 50)
      await this.databaseService.cleanupOldTTSMessages(ttsRequest.streamerId, 50);
      
      // Also keep in memory for immediate access
      const streamer = this.streamers.get(ttsRequest.streamerId);
      if (streamer) {
        streamer.recentMessages.unshift(message);
        if (streamer.recentMessages.length > 50) {
          streamer.recentMessages = streamer.recentMessages.slice(0, 50);
        }
      }
      
      // Broadcast to browser source
      this.broadcastTTSMessage(ttsRequest.streamerId, message);
      
    } catch (error) {
      console.error(`❌ Error saving TTS message to database:`, error);
      // Still broadcast even if database save fails
      this.broadcastTTSMessage(ttsRequest.streamerId, message);
    }
    
    // In a real implementation, this would:
    // 1. Call a TTS API (Google Cloud TTS, Azure, etc.)
    // 2. Generate audio file
    // 3. Play audio or send to audio system
    // 4. Update browser source with current message
  }

  formatTTSMessage(walletAddress, amount, message) {
    if (amount === 0) {
      return message;
    }
    
    // Extract username from wallet address (first 4 characters)
    let username = walletAddress;
    if (walletAddress && walletAddress.length > 4) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
        username = walletAddress.substring(0, 4);
      }
    }
    
    const formattedAmount = amount > 0 ? `${amount} SOL` : 'unknown amount';
    return `${username} donated ${formattedAmount}. ${message}`;
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  broadcastToSubscribers(streamerId, event, data) {
    if (this.io) {
      this.io.to(`streamer-${streamerId}`).emit(event, data);
    }
  }

  // API Methods
  async getTTSSettings(streamerId) {
    const streamer = this.streamers.get(streamerId);
    return streamer ? streamer.settings : this.getDefaultSettings();
  }

  async updateTTSSettings(streamerId, settings) {
    try {
      // Validate settings
      const validation = this.validateSettings(settings);
      if (!validation.isValid) {
        throw new Error(`Invalid settings: ${validation.errors.join(', ')}`);
      }

      // Update in database
      await this.databaseService.updateTTSSettings(streamerId, settings);

      // Update in memory
      const streamer = this.streamers.get(streamerId);
      if (streamer) {
        streamer.settings = { ...streamer.settings, ...settings };
      }

      return { success: true, settings };
    } catch (error) {
      console.error(`❌ Error updating TTS settings for ${streamerId}:`, error);
      throw error;
    }
  }

  async testTTS(streamerId, message, settings = {}) {
    try {
      const streamer = this.streamers.get(streamerId);
      const ttsSettings = streamer ? streamer.settings : this.getDefaultSettings();
      const finalSettings = { ...ttsSettings, ...settings };

      const ttsRequest = {
        id: this.generateId(),
        streamerId,
        message: message,
        timestamp: new Date(),
        settings: finalSettings,
        isTest: true,
        walletAddress: 'Test User',
        amount: 0
      };

      // Broadcast TTS request to browser source
      this.broadcastToSubscribers(streamerId, 'tts-request', ttsRequest);
      console.log(`🎤 TTS test sent to browser source: ${message}`);

      // Simulate TTS processing
      await this.simulateTTSProcessing(ttsRequest);

      return { success: true, message: 'TTS test completed' };
    } catch (error) {
      console.error(`❌ Error testing TTS for ${streamerId}:`, error);
      throw error;
    }
  }

  async getTTSStats(streamerId) {
    try {
      console.log(`TTS Stats: Looking for streamer ${streamerId}`);
      console.log(`TTS Stats: Available streamers:`, Array.from(this.streamers.keys()));
      
      const streamer = this.streamers.get(streamerId);
      if (!streamer) {
        console.log(`TTS Stats: Streamer ${streamerId} not found in TTS service`);
        return {
          queueLength: 0,
          processedToday: 0,
          errors: 0
        };
      }

      const stats = {
        queueLength: streamer.queue.length,
        processedToday: streamer.stats.processed,
        errors: streamer.stats.errors
      };
      
      console.log(`TTS Stats: Returning stats for ${streamerId}:`, stats);
      return stats;
    } catch (error) {
      console.error(`Error getting TTS stats for ${streamerId}:`, error);
      throw error;
    }
  }

  async getRecentMessages(streamerId, limit = 20) {
    try {
      // Get messages from database instead of memory
      const messages = await this.databaseService.getTTSMessages(streamerId, limit);
      
      // Convert database format to expected format
      return messages.map(msg => ({
        id: msg.message_id,
        text: msg.message_text,
        sender: msg.sender,
        timestamp: new Date(msg.timestamp),
        type: msg.message_type,
        amount: msg.amount
      }));
    } catch (error) {
      console.error(`❌ Error getting recent messages for ${streamerId}:`, error);
      return [];
    }
  }

  broadcastTTSMessage(streamerId, message) {
    if (this.io) {
      this.io.to(`streamer-${streamerId}`).emit('tts-message', {
        type: 'tts-message',
        message: message
      });
    }
  }

  async getBrowserSourceUrl(streamerId, baseUrl) {
    return `${baseUrl}/browser-source/tts/${streamerId}`;
  }

  getDefaultSettings() {
    return {
      voice: 'en-US-Standard-A',
      rate: 1.0,
      volume: 1.0,
      pitch: 1.0,
      enabled: true,
      min_donation: 0.01,
      cooldown_seconds: 3, // Reduced from 30 to 3 seconds
      max_message_length: 200,
      auto_tts_enabled: true,
      donation_gate_enabled: true
    };
  }

  validateSettings(settings) {
    const errors = [];
    
    if (settings.rate && (settings.rate < 0.1 || settings.rate > 3.0)) {
      errors.push('Rate must be between 0.1 and 3.0');
    }
    
    if (settings.volume && (settings.volume < 0.1 || settings.volume > 2.0)) {
      errors.push('Volume must be between 0.1 and 2.0');
    }
    
    if (settings.pitch && (settings.pitch < 0.1 || settings.pitch > 3.0)) {
      errors.push('Pitch must be between 0.1 and 3.0');
    }
    
    if (settings.min_donation && settings.min_donation < 0) {
      errors.push('Minimum donation must be positive');
    }
    
    if (settings.cooldown_seconds && (settings.cooldown_seconds < 0 || settings.cooldown_seconds > 3600)) {
      errors.push('Cooldown must be between 0 and 3600 seconds');
    }
    
    if (settings.max_message_length && (settings.max_message_length < 10 || settings.max_message_length > 500)) {
      errors.push('Max message length must be between 10 and 500 characters');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  isConnected() {
    return this.isInitialized;
  }

  // Get all streamers for admin view
  getAllStreamers() {
    return Array.from(this.streamers.values()).map(streamer => ({
      streamerId: streamer.config.streamer_id,
      username: streamer.config.username,
      isActive: streamer.settings.enabled,
      queueLength: streamer.queue.length,
      stats: streamer.stats
    }));
  }
}

module.exports = IntegratedTTSService;
