const WebSocket = require('ws');
const { PumpChatClient } = require('../lib/viri-pump-client');

class IntegratedPollService {
  constructor() {
    this.streamers = new Map(); // streamerId -> { pollManager, chatClient, whitelist, config }
    this.isConnectedFlag = false;
    this.subscribers = new Map(); // streamerId -> Set of WebSocket connections
    this.io = null; // Socket.IO instance
  }

  async initialize() {
    try {
      this.isConnectedFlag = true;
      console.log('✅ Integrated Poll Service initialized');
      
      // Load existing streamers from database and start their chat connections
      await this.loadAndStartStreamers();
      
    } catch (error) {
      console.log('⚠️ Integrated Poll Service initialization failed:', error.message);
      this.isConnectedFlag = false;
    }
  }

  // Load existing streamers from database and start their chat connections
  async loadAndStartStreamers() {
    try {
      // This will be called from server.js with database service
      console.log('🔄 Poll service ready to load streamers (database service will be provided)');
    } catch (error) {
      console.error('Error loading streamers:', error);
    }
  }

  // Set database service and load streamers
  async setDatabaseServiceAndLoadStreamers(databaseService) {
    try {
      this.databaseService = databaseService;
      
      // Get all streamers from database
      const streamers = await databaseService.getAllStreamerConfigs();
      console.log(`📋 Found ${streamers.length} streamers in database`);
      
      for (const streamer of streamers) {
        try {
          const streamerId = streamer.streamer_id; // Use the actual streamer_id field
          
          // Get poll settings for this streamer
          let pollSettings = await databaseService.getPollSettings(streamerId);
          
          // If no poll settings exist, create default ones
          if (!pollSettings) {
            console.log(`🔧 Creating default poll settings for streamer ${streamerId}`);
            const defaultSettings = this.getDefaultSettings();
            await databaseService.updatePollSettings(streamerId, defaultSettings);
            pollSettings = defaultSettings;
          }
          
          if (pollSettings && pollSettings.enabled) {
            console.log(`🤖 Loading poll bot for streamer ${streamerId} (token: ${streamer.token_address})`);
            
            // Create poll bot
            let whitelist = [];
            if (pollSettings.whitelist) {
              if (typeof pollSettings.whitelist === 'string') {
                try {
                  whitelist = JSON.parse(pollSettings.whitelist);
                } catch (e) {
                  console.log(`⚠️ Failed to parse whitelist JSON for ${streamerId}:`, e.message);
                  whitelist = [];
                }
              } else if (Array.isArray(pollSettings.whitelist)) {
                whitelist = pollSettings.whitelist;
              } else {
                console.log(`⚠️ Invalid whitelist format for ${streamerId}:`, typeof pollSettings.whitelist);
                whitelist = [];
              }
            }
            
            await this.createStreamerPoll(streamerId, {
              tokenAddress: streamer.token_address,
              walletAddress: streamer.wallet_address,
              whitelist: whitelist
            });
            
            // Start chat connection
            await this.startStreamer(streamerId);
            
            console.log(`✅ Poll bot started for streamer ${streamerId}`);
          } else {
            console.log(`⏸️ Poll bot disabled for streamer ${streamerId}`);
          }
        } catch (error) {
          console.error(`❌ Failed to load streamer ${streamer.streamer_id}:`, error.message);
        }
      }
      
      console.log(`🚀 Loaded ${this.streamers.size} active poll bots`);
      
    } catch (error) {
      console.error('Error loading streamers from database:', error);
    }
  }

  // Set Socket.IO instance
  setSocketIO(io) {
    this.io = io;
  }

  // Create a new streamer poll instance
  async createStreamerPoll(streamerId, config) {
    try {
      const { tokenAddress, walletAddress, whitelist = [] } = config;
      
      // Create poll manager for this streamer
      const pollManager = new PollManager(streamerId);
      
      // Create chat client for this streamer
      const chatClient = new PumpChatClient({
        roomId: tokenAddress,
        username: `poll_bot_${String(streamerId).substring(0, 8)}`,
        messageHistoryLimit: 50
      });
      
      // Set up whitelist
      const whitelistSet = new Set(whitelist);
      
      // Store streamer instance
      this.streamers.set(streamerId, {
        pollManager,
        chatClient,
        whitelist: whitelistSet,
        config,
        isActive: false
      });
      
      // Set up event handlers
      this.setupStreamerEventHandlers(streamerId);
      
      console.log(`✅ Poll service created for streamer ${streamerId} (token: ${config.tokenAddress})`);
      return { success: true, streamerId };
      
    } catch (error) {
      console.error(`Error creating poll service for streamer ${streamerId}:`, error);
      throw error;
    }
  }

  setupStreamerEventHandlers(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return;

    const { pollManager, chatClient, whitelist } = streamer;

    // Chat message handler
    chatClient.on('message', async (msg) => {
      try {
        const sender = msg?.username || '';
        const text = (msg?.message || '').trim();
        if (!sender || !text) return;

        console.log(`💬 [${streamerId}] Chat (${streamer.config.tokenAddress}): ${sender}: ${text}`);

        // Whitelist management
        if (text.startsWith('/whitelist')) {
          await this.handleWhitelistCommand(streamerId, sender, text);
          return;
        }

        // Poll creation (privileged)
        if (text.startsWith('/poll')) {
          if (!this.isSenderPrivileged(streamerId, sender)) {
            console.log(`❌ [${streamerId}] ${sender} not privileged, ignoring /poll`);
            return;
          }
          const parsed = this.parsePollCommand(text);
          if (!parsed) {
            this.sendChat(streamerId, `Usage: /poll "Question" 1:OptA 2:OptB [seconds]`);
            return;
          }
          if (pollManager.isActive()) {
            this.sendChat(streamerId, `⚠️ A poll is already running.`);
            return;
          }
          
          await this.createPoll(streamerId, {
            question: parsed.question,
            options: parsed.options,
            duration: parsed.duration
          });
          const pretty = Object.keys(parsed.options).map(n => `${n}:${parsed.options[n]}`).join('  ');
          this.sendChat(streamerId, `📊 Poll started: "${parsed.question}" — vote by typing the number! (${pretty}) Ends in ${parsed.duration}s`);
          return;
        }

        // Public voting
        this.handleViewerVote(streamerId, sender, text);

        // End announcement
        if (pollManager.current && pollManager.current.closed && !pollManager.current._announced) {
          pollManager.current._announced = true;
          const winner = pollManager.winner();
          this.sendChat(streamerId, winner ? `🏁 Poll ended! Winner: ${winner.num} — ${winner.label} (${winner.count} votes)` : `🏁 Poll ended! No votes.`);
        }
      } catch (e) {
        console.log(`Message handler error for ${streamerId}:`, e);
      }
    });

    chatClient.on('connect', () => {
      console.log(`✅ [${streamerId}] Connected to pump.fun chat for token: ${streamer.config.tokenAddress}`);
      streamer.isActive = true;
    });

    chatClient.on('disconnect', () => {
      console.log(`🔌 [${streamerId}] Disconnected from pump.fun chat`);
      streamer.isActive = false;
    });

    chatClient.on('error', (e) => {
      console.log(`❌ [${streamerId}] Pump chat error:`, e?.message || e);
    });
  }

  // Start chat connection for a streamer
  async startStreamer(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error(`Streamer ${streamerId} not found`);
    }

    try {
      console.log(`🔗 [${streamerId}] Connecting to Pump.fun chat for token: ${streamer.config.tokenAddress}`);
      await streamer.chatClient.connect(streamer.config.tokenAddress);
      console.log(`🚀 [${streamerId}] Poll service started for token: ${streamer.config.tokenAddress}`);
    } catch (error) {
      console.error(`Error starting poll service for ${streamerId} (token: ${streamer.config.tokenAddress}):`, error);
      throw error;
    }
  }

  // Stop chat connection for a streamer
  async stopStreamer(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return;

    try {
      await streamer.chatClient.disconnect();
      streamer.isActive = false;
      console.log(`🛑 [${streamerId}] Poll service stopped`);
    } catch (error) {
      console.error(`Error stopping poll service for ${streamerId}:`, error);
    }
  }


  // Vote on a poll
  async votePoll(streamerId, voterAddress, optionNumber) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error(`Streamer ${streamerId} not found`);
    }

    const success = streamer.pollManager.vote(voterAddress, optionNumber);
    if (success) {
      // Broadcast update
      this.broadcastToSubscribers(streamerId, {
        type: 'poll-update',
        poll: this.formatPollForDisplay(streamer.pollManager.current)
      });
    }

    return { success };
  }

  // End a poll
  async endPoll(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return null;

    const results = streamer.pollManager.winner();
    streamer.pollManager.stop();

    // Update database
    await this.updatePollInDatabase(streamerId, { status: 'ended' });

    // Broadcast end
    this.broadcastToSubscribers(streamerId, {
      type: 'poll-end',
      results
    });

    return results;
  }

  // Get active poll for a streamer
  getActivePoll(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return null;

    if (!streamer.pollManager.isActive()) return null;
    
    const poll = streamer.pollManager.current;
    if (!poll) return null;
    
    return {
      id: 'current',
      question: poll.question,
      options: poll.options,
      counts: poll.counts,
      endsAt: poll.endsAt,
      closed: poll.closed
    };
  }

  // Get poll statistics
  async getPollStats(streamerId) {
    // This would fetch from database
    return {
      totalPolls: 0,
      activePolls: this.streamers.get(streamerId)?.pollManager.isActive() ? 1 : 0,
      completedPolls: 0,
      totalVotes: 0,
      averageVotesPerPoll: 0,
      mostPopularOption: null,
      recentPolls: []
    };
  }

  // Subscribe to poll updates
  subscribe(streamerId, callback) {
    if (!this.subscribers.has(streamerId)) {
      this.subscribers.set(streamerId, new Set());
    }
    this.subscribers.get(streamerId).add(callback);
  }

  // Unsubscribe from poll updates
  unsubscribe(streamerId, callback) {
    if (this.subscribers.has(streamerId)) {
      this.subscribers.get(streamerId).delete(callback);
    }
  }

  // Broadcast to subscribers
  broadcastToSubscribers(streamerId, data) {
    // Use Socket.IO if available
    if (this.io) {
      const roomName = `streamer-${streamerId}`;
      console.log(`📡 [${streamerId}] Broadcasting to room: ${roomName}`);
      console.log(`📡 [${streamerId}] Data:`, JSON.stringify(data, null, 2));
      
      // Get the number of clients in the room
      const room = this.io.sockets.adapter.rooms.get(roomName);
      const clientCount = room ? room.size : 0;
      console.log(`📡 [${streamerId}] Room ${roomName} has ${clientCount} clients`);
      
      this.io.to(roomName).emit('browser-source-message', data);
      console.log(`📡 [${streamerId}] Broadcasting poll update via Socket.IO`);
    } else {
      console.log(`❌ [${streamerId}] Socket.IO not available for broadcasting`);
    }
    
    // Fallback to callback system
    if (this.subscribers.has(streamerId)) {
      this.subscribers.get(streamerId).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in poll subscriber callback:', error);
        }
      });
    }
  }

  // Helper methods
  isSenderPrivileged(streamerId, username) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return false;
    
    const isWhitelisted = streamer.whitelist.has(username);
    const isSolAddress = this.isSolAddress(username);
    return isSolAddress && isWhitelisted;
  }

  isSolAddress(str) {
    return typeof str === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str);
  }

  parsePollCommand(text) {
    const m = text.match(/^\/poll\s+"([^"]+)"\s+(.+)$/i);
    if (!m) return null;
    
    const question = m[1].trim();
    const rest = m[2];
    const parts = rest.trim().split(/\s+/);
    let duration = 60;
    let optStr = rest;
    
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      duration = Math.max(5, Math.min(300, parseInt(last, 10)));
      optStr = parts.slice(0, -1).join(' ');
    }
    
    const optionRegex = /(\d+)\s*:\s*([^0-9][^]*?)(?=(?:\s+\d+\s*:)|$)/g;
    const options = {};
    let hit = 0;
    let match;
    
    while ((match = optionRegex.exec(optStr)) !== null) {
      const num = parseInt(match[1], 10);
      const label = match[2].trim();
      if (label) {
        options[num] = label;
        hit++;
      }
    }
    
    if (hit < 2) return null;
    return { question, options, duration };
  }

  handleViewerVote(streamerId, username, message) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer || !streamer.pollManager.isActive()) return;

    const m = message.trim().match(/^(\d{1,2})$/);
    if (!m) return;

    const choice = parseInt(m[1], 10);
    console.log(`🗳️ [${streamerId}] Processing vote: ${username} voted ${choice} (token: ${streamer.config.tokenAddress})`);
    
    const success = streamer.pollManager.vote(username, choice);
    
    if (success) {
      console.log(`✅ [${streamerId}] Vote recorded: ${username} → ${choice} (token: ${streamer.config.tokenAddress})`);
      
      // Broadcast update to browser sources
      this.broadcastToSubscribers(streamerId, {
        type: 'poll-update',
        poll: this.formatPollForDisplay(streamer.pollManager.current)
      });
    } else {
      console.log(`❌ [${streamerId}] Vote failed: ${username} → ${choice} (token: ${streamer.config.tokenAddress})`);
    }
  }

  async handleWhitelistCommand(streamerId, sender, text) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return;

    const parts = text.trim().split(/\s+/);
    
    if (parts.length === 1 || /^\/whitelist\s+help$/i.test(text)) {
      this.sendChat(streamerId, `Whitelist commands:
  /whitelist list
  /whitelist add <SOL_ADDRESS>
  /whitelist remove <SOL_ADDRESS>
  /whitelist me`);
      return;
    }

    if (!this.isSenderPrivileged(streamerId, sender)) {
      console.log(`❌ [${streamerId}] ${sender} not privileged for whitelist command`);
      return;
    }

    if (/^\/whitelist\s+list$/i.test(text)) {
      const whitelistArray = Array.from(streamer.whitelist);
      if (whitelistArray.length === 0) {
        this.sendChat(streamerId, `Whitelist is empty.`);
      } else {
        this.sendChat(streamerId, `Whitelist (${whitelistArray.length}): ${whitelistArray.join(', ')}`);
      }
      return;
    }

    if (/^\/whitelist\s+me$/i.test(text)) {
      if (!this.isSolAddress(sender)) {
        this.sendChat(streamerId, `Your username is not a valid Solana address.`);
        return;
      }
      if (streamer.whitelist.has(sender)) {
        this.sendChat(streamerId, `Already whitelisted: ${sender}`);
        return;
      }
      streamer.whitelist.add(sender);
      this.sendChat(streamerId, `✅ Whitelisted: ${sender}`);
      return;
    }

    let m = text.match(/^\/whitelist\s+add\s+([A-Za-z0-9]+)$/i);
    if (m) {
      const addr = m[1];
      if (!this.isSolAddress(addr)) {
        this.sendChat(streamerId, `Invalid Solana address.`);
        return;
      }
      if (streamer.whitelist.has(addr)) {
        this.sendChat(streamerId, `Already whitelisted: ${addr}`);
        return;
      }
      streamer.whitelist.add(addr);
      this.sendChat(streamerId, `✅ Whitelisted: ${addr}`);
      return;
    }

    m = text.match(/^\/whitelist\s+remove\s+([A-Za-z0-9]+)$/i);
    if (m) {
      const addr = m[1];
      if (!streamer.whitelist.has(addr)) {
        this.sendChat(streamerId, `Not in whitelist: ${addr}`);
        return;
      }
      streamer.whitelist.delete(addr);
      this.sendChat(streamerId, `🗑️ Removed from whitelist: ${addr}`);
      return;
    }

    this.sendChat(streamerId, `Unknown whitelist command. Try "/whitelist help".`);
  }

  sendChat(streamerId, text) {
    const streamer = this.streamers.get(streamerId);
    if (streamer && streamer.isActive) {
      // In a real implementation, you would send this to the chat
      console.log(`💬 [${streamerId}] (no-op) ${text}`);
    }
  }

  // Database methods (placeholder)
  async savePollToDatabase(streamerId, pollData) {
    // This would save to the database
    console.log(`💾 Saving poll to database for ${streamerId}:`, pollData);
  }

  async updatePollInDatabase(streamerId, updates) {
    // This would update the database
    console.log(`💾 Updating poll in database for ${streamerId}:`, updates);
  }

  isConnected() {
    return this.isConnectedFlag;
  }

  // Get default poll settings
  getDefaultSettings() {
    return {
      enabled: true,
      default_duration: 60,
      allow_viewer_polls: false,
      require_donation: false,
      min_donation: 0.01
    };
  }

  // Validate poll settings
  validateSettings(settings) {
    const errors = [];
    
    if (typeof settings.enabled !== 'boolean') {
      errors.push('Enabled must be a boolean');
    }
    
    if (settings.default_duration && (typeof settings.default_duration !== 'number' || settings.default_duration < 10 || settings.default_duration > 300)) {
      errors.push('Default duration must be a number between 10 and 300 seconds');
    }
    
    if (typeof settings.allow_viewer_polls !== 'boolean') {
      errors.push('Allow viewer polls must be a boolean');
    }
    
    if (typeof settings.require_donation !== 'boolean') {
      errors.push('Require donation must be a boolean');
    }
    
    if (settings.min_donation && (typeof settings.min_donation !== 'number' || settings.min_donation < 0)) {
      errors.push('Minimum donation must be a positive number');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Validate poll data
  validatePollData(pollData) {
    const errors = [];
    
    if (!pollData.question || typeof pollData.question !== 'string' || pollData.question.trim().length === 0) {
      errors.push('Question is required');
    }
    
    if (!pollData.options || !Array.isArray(pollData.options) || pollData.options.length < 2) {
      errors.push('At least 2 options are required');
    }
    
    if (pollData.options && pollData.options.some(opt => !opt || typeof opt !== 'string' || opt.trim().length === 0)) {
      errors.push('All options must be non-empty strings');
    }
    
    if (typeof pollData.duration !== 'number' || pollData.duration < 10 || pollData.duration > 300) {
      errors.push('Duration must be between 10 and 300 seconds');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Update poll settings
  async updatePollSettings(streamerId, settings) {
    // This is a placeholder - in a real implementation, you'd update the database
    console.log(`Updating poll settings for streamer ${streamerId}:`, settings);
    return true;
  }

  // Get poll stats
  async getPollStats(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      return { activePolls: 0, totalPolls: 0, totalVotes: 0 };
    }
    
    return {
      activePolls: streamer.pollManager.isActive() ? 1 : 0,
      totalPolls: 0, // This would be tracked in a real implementation
      totalVotes: 0  // This would be tracked in a real implementation
    };
  }

  // Format poll for display
  formatPollForDisplay(poll) {
    if (!poll) return null;
    
    // Handle both old and new poll structures
    const options = poll.options || new Map();
    const counts = poll.counts || new Map();
    
    // Convert to the format expected by the browser source
    const formattedOptions = Array.from(options.entries()).map(([key, text]) => ({
      number: key,
      text: text,
      count: counts.get(key) || 0
    }));
    
    return {
      id: poll.id || 'current',
      question: poll.question,
      options: formattedOptions,
      totalVotes: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
      endsAt: poll.endsAt,
      closed: poll.closed || false
    };
  }

  // Create a new poll
  async createPoll(streamerId, pollData) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    if (streamer.pollManager.isActive()) {
      throw new Error('A poll is already active');
    }

    const { question, options, duration } = pollData;
    
    // Handle both array and object formats for options
    let optionsObj = {};
    if (Array.isArray(options)) {
      options.forEach((option, index) => {
        optionsObj[index + 1] = option;
      });
    } else if (typeof options === 'object' && options !== null) {
      optionsObj = options;
    } else {
      throw new Error('Invalid options format');
    }

    streamer.pollManager.start(question, optionsObj, duration);
    
    // Broadcast to subscribers
    this.broadcastToSubscribers(streamerId, {
      type: 'poll-start',
      poll: this.formatPollForDisplay(streamer.pollManager.current)
    });
    
    return {
      id: streamer.pollManager.current.id,
      question,
      options: Array.from(streamer.pollManager.current.options.values()),
      duration,
      status: 'active'
    };
  }

  // End a poll
  async endPoll(streamerId, pollId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    // Check if poll exists
    if (!streamer.pollManager.current) {
      throw new Error('No poll to end');
    }

    const poll = streamer.pollManager.current;
    if (poll.id !== pollId) {
      throw new Error('Poll ID mismatch');
    }

    // If poll is already closed, just return the results
    if (poll.closed) {
      const results = streamer.pollManager.getResults();
      return results;
    }

    // Close the poll and get results
    poll.closed = true;
    const results = streamer.pollManager.getResults();
    
    // Stop the poll manager
    streamer.pollManager.stop();
    
    // Broadcast poll end
    this.broadcastToSubscribers(streamerId, {
      type: 'poll-end',
      results: results
    });
    
    return results;
  }

  // Get poll results
  async getPollResults(streamerId, pollId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    // In a real implementation, you'd fetch from database
    // For now, return empty results
    return {
      id: pollId,
      question: 'Poll results not available',
      options: [],
      votes: [],
      totalVotes: 0
    };
  }

  // Vote on a poll
  async votePoll(streamerId, pollId, voterAddress, optionNumber) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    if (!streamer.pollManager.isActive()) {
      throw new Error('No active poll');
    }

    const poll = streamer.pollManager.current;
    if (poll.id !== pollId) {
      throw new Error('Poll ID mismatch');
    }

    const success = streamer.pollManager.vote(voterAddress, optionNumber);
    if (!success) {
      throw new Error('Invalid vote');
    }

    // Broadcast poll update
    this.broadcastToSubscribers(streamerId, {
      type: 'poll-update',
      poll: this.formatPollForDisplay(streamer.pollManager.current)
    });

    return { success: true };
  }

  // Whitelist management
  async getWhitelist(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    return Array.from(streamer.whitelist);
  }

  async addToWhitelist(streamerId, address, databaseService = null) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    if (!this.isSolAddress(address)) {
      throw new Error('Invalid Solana address');
    }

    if (streamer.whitelist.has(address)) {
      throw new Error('Address already whitelisted');
    }

    streamer.whitelist.add(address);
    
    // Update in database if database service is provided
    if (databaseService) {
      try {
        const pollSettings = await databaseService.getPollSettings(streamerId);
        const updatedSettings = {
          ...pollSettings,
          whitelist: Array.from(streamer.whitelist)
        };
        await databaseService.updatePollSettings(streamerId, updatedSettings);
        console.log(`💾 Whitelist saved to database for ${streamerId}`);
      } catch (error) {
        console.error(`❌ Failed to save whitelist to database:`, error);
      }
    }
    
    return { success: true, address };
  }

  async removeFromWhitelist(streamerId, address, databaseService = null) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) {
      throw new Error('Streamer not found');
    }

    if (!streamer.whitelist.has(address)) {
      throw new Error('Address not in whitelist');
    }

    streamer.whitelist.delete(address);
    
    // Update in database if database service is provided
    if (databaseService) {
      try {
        const pollSettings = await databaseService.getPollSettings(streamerId);
        const updatedSettings = {
          ...pollSettings,
          whitelist: Array.from(streamer.whitelist)
        };
        await databaseService.updatePollSettings(streamerId, updatedSettings);
        console.log(`💾 Whitelist saved to database for ${streamerId}`);
      } catch (error) {
        console.error(`❌ Failed to save whitelist to database:`, error);
      }
    }
    
    return { success: true, address };
  }

  async updateWhitelistInDatabase(streamerId, whitelist) {
    try {
      // Update poll settings with the new whitelist
      const pollSettings = {
        whitelist: Array.from(whitelist)
      };
      
      // This will be handled by the database service
      console.log(`💾 Updating whitelist in database for ${streamerId}:`, whitelist);
      
      // Note: The actual database update will be handled by the route handlers
      // that call this method, as they have access to req.databaseService
    } catch (error) {
      console.error(`❌ Failed to update whitelist in database for ${streamerId}:`, error);
    }
  }

  // Chat command parsing and handling
  parsePollCommand(text) {
    const m = text.match(/^\/poll\s+"([^"]+)"\s+(.+)$/i);
    if (!m) return null;
    const question = m[1].trim();
    const rest = m[2];
    const parts = rest.trim().split(/\s+/);
    let duration = 60; // Default duration
    let optStr = rest;
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) { 
      duration = Math.max(5, Math.min(300, parseInt(last, 10))); 
      optStr = parts.slice(0,-1).join(' '); 
    }
    const optionRegex = /(\d+)\s*:\s*([^0-9][^]*?)(?=(?:\s+\d+\s*:)|$)/g;
    const options = {}; 
    let hit = 0; 
    let match;
    while ((match = optionRegex.exec(optStr)) !== null) {
      const num = parseInt(match[1], 10); 
      const label = match[2].trim();
      if (label) { 
        options[num] = label; 
        hit++; 
      }
    }
    if (hit < 2) return null;
    return { question, options, duration };
  }


  async handleWhitelistCommand(streamerId, sender, text) {
    console.log(`⚙️ Handling whitelist command from ${sender} for streamer ${streamerId}: ${text}`);
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return;

    const parts = text.trim().split(/\s+/);
    
    // /whitelist, /whitelist help
    if (parts.length === 1 || /^\/whitelist\s+help$/i.test(text)) {
      this.sendChatMessage(streamerId, `Whitelist commands:
  /whitelist list
  /whitelist add <SOL_ADDRESS>
  /whitelist remove <SOL_ADDRESS>
  /whitelist me   (adds your username if it is a SOL address)`);
      return;
    }

    // Special: allow first-ever add if list empty
    const allowBootstrap = streamer.whitelist.size === 0;
    console.log('  allowBootstrap:', allowBootstrap, 'current size:', streamer.whitelist.size);

    // Require privilege for management unless bootstrapping
    if (!allowBootstrap && !this.isSenderPrivileged(streamerId, sender)) {
      console.log('  ❌ Not privileged; ignoring whitelist command.');
      return;
    }

    // /whitelist list
    if (/^\/whitelist\s+list$/i.test(text)) {
      if (streamer.whitelist.size === 0) {
        this.sendChatMessage(streamerId, `Whitelist is empty.`);
      } else {
        this.sendChatMessage(streamerId, `Whitelist (${streamer.whitelist.size}): ${Array.from(streamer.whitelist).join(', ')}`);
      }
      return;
    }

    // /whitelist me
    if (/^\/whitelist\s+me$/i.test(text)) {
      if (!this.isSolAddress(sender)) { 
        this.sendChatMessage(streamerId, `Your username is not a valid Solana address.`); 
        return; 
      }
      if (streamer.whitelist.has(sender)) { 
        this.sendChatMessage(streamerId, `Already whitelisted: ${sender}`); 
        return; 
      }
      streamer.whitelist.add(sender); 
      await this.updateWhitelistInDatabase(streamerId, Array.from(streamer.whitelist));
      this.sendChatMessage(streamerId, `✅ Whitelisted: ${sender}`);
      return;
    }

    // /whitelist add <addr>
    let m = text.match(/^\/whitelist\s+add\s+([A-Za-z0-9]+)$/i);
    if (m) {
      const addr = m[1];
      if (!this.isSolAddress(addr)) { 
        this.sendChatMessage(streamerId, `Invalid Solana address.`); 
        return; 
      }
      if (streamer.whitelist.has(addr)) { 
        this.sendChatMessage(streamerId, `Already whitelisted: ${addr}`); 
        return; 
      }
      streamer.whitelist.add(addr); 
      await this.updateWhitelistInDatabase(streamerId, Array.from(streamer.whitelist));
      this.sendChatMessage(streamerId, `✅ Whitelisted: ${addr}`);
      return;
    }

    // /whitelist remove <addr>
    m = text.match(/^\/whitelist\s+remove\s+([A-Za-z0-9]+)$/i);
    if (m) {
      const addr = m[1];
      if (!streamer.whitelist.has(addr)) { 
        this.sendChatMessage(streamerId, `Not in whitelist: ${addr}`); 
        return; 
      }
      streamer.whitelist.delete(addr); 
      await this.updateWhitelistInDatabase(streamerId, Array.from(streamer.whitelist));
      this.sendChatMessage(streamerId, `🗑️ Removed from whitelist: ${addr}`);
      return;
    }

    this.sendChatMessage(streamerId, `Unknown whitelist command. Try "/whitelist help".`);
  }

  isSenderPrivileged(streamerId, username) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return false;
    
    const ok = this.isSolAddress(username) && streamer.whitelist.has(username);
    console.log(`🔍 Privilege check for "${username}" in streamer ${streamerId} → ${ok}`);
    return ok;
  }

  sendChatMessage(streamerId, message) {
    // This would send a message to the chat
    // For now, just log it
    console.log(`💬 Chat message for ${streamerId}: ${message}`);
  }

  // Main chat message handler
  async handleChatMessage(streamerId, msg) {
    try {
      const sender = msg?.username || '';
      const text = (msg?.message || '').trim();
      if (!sender || !text) return;

      console.log(`💬 Chat: ${sender}: ${text} (streamer: ${streamerId})`);

      // Whitelist management
      if (text.startsWith('/whitelist')) {
        await this.handleWhitelistCommand(streamerId, sender, text);
        return;
      }

      // Privileged: /poll (only if sender username is a whitelisted SOL address)
      if (text.startsWith('/poll')) {
        console.log(`⚙️ Poll command from ${sender} for streamer ${streamerId}`);
        if (!this.isSenderPrivileged(streamerId, sender)) {
          console.log(`  ❌ ${sender} not privileged, ignoring /poll`);
          return;
        }
        const parsed = this.parsePollCommand(text);
        if (!parsed) { 
          this.sendChatMessage(streamerId, `Usage: /poll "Question" 1:OptA 2:OptB [seconds]`); 
          return; 
        }
        
        const streamer = this.streamers.get(streamerId);
        if (!streamer) return;
        
        if (streamer.pollManager.isActive()) { 
          this.sendChatMessage(streamerId, `⚠️ A poll is already running.`); 
          return; 
        }
        
        streamer.pollManager.start(parsed.question, parsed.options, parsed.duration);
        const pretty = Object.keys(parsed.options).map(n => `${n}:${parsed.options[n]}`).join('  ');
        this.sendChatMessage(streamerId, `📊 Poll started: "${parsed.question}" — vote by typing the number! (${pretty}) Ends in ${parsed.duration}s`);
        return;
      }

      // Public voting
      this.handleViewerVote(streamerId, sender, text);

      // End announcement
      const streamer = this.streamers.get(streamerId);
      if (streamer && streamer.pollManager.current && streamer.pollManager.current.closed && !streamer.pollManager.current._announced) {
        streamer.pollManager.current._announced = true;
        const w = streamer.pollManager.winner();
        this.sendChatMessage(streamerId, w ? `🏁 Poll ended! Winner: ${w.num} — ${w.label} (${w.count} votes)` : `🏁 Poll ended! No votes.`);
      }
    } catch (e) {
      console.log('Message handler error:', e);
    }
  }

  // Get all active streamers
  getActiveStreamers() {
    return Array.from(this.streamers.entries())
      .filter(([_, streamer]) => streamer.isActive)
      .map(([streamerId, _]) => streamerId);
  }
}

// Poll Manager class (adapted from original)
class PollManager {
  constructor(streamerId) {
    this.streamerId = streamerId;
    this.current = null;
    this.tickTimer = null;
  }

  start(question, optionsObj, durationSec) {
    const now = Date.now();
    const options = new Map();
    const counts = new Map();
    const votes = new Map();

    const sortedKeys = Object.keys(optionsObj).map(n => parseInt(n, 10)).filter(Number.isFinite).sort((a, b) => a - b);
    for (const k of sortedKeys) {
      const label = String(optionsObj[k]).trim();
      if (!label) continue;
      options.set(k, label);
      counts.set(k, 0);
    }
    if (options.size < 2) throw new Error('Need at least two options.');

    this.current = {
      question: String(question || 'Poll'),
      options,
      counts,
      votes,
      endsAt: now + (durationSec * 1000),
      createdAt: now,
      closed: false
    };
    
    console.log(`🟢 [${this.streamerId}] Poll started:`, this.current.question, 'options=', [...options.entries()], 'durationSec=', durationSec);
    this.startTick();
  }

  startTick() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      if (!this.current) return;
      if (Date.now() >= this.current.endsAt && !this.current.closed) {
        this.current.closed = true;
        console.log(`🔴 [${this.streamerId}] Poll closed`);
        
        // Note: Broadcasting will be handled by the IntegratedPollService
        // when it detects the poll is closed
      }
    }, 500);
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.current = null;
  }

  isActive() {
    return !!(this.current && !this.current.closed && Date.now() < this.current.endsAt);
  }

  getResults() {
    if (!this.current) return null;
    
    const poll = this.current;
    const options = Array.from(poll.options.entries()).map(([num, text]) => ({
      number: num,
      text: text,
      count: poll.counts.get(num) || 0
    }));
    
    const maxVotes = Math.max(...options.map(opt => opt.count));
    const winners = options.filter(opt => opt.count === maxVotes && maxVotes > 0);
    const isTie = winners.length > 1;
    
    return {
      id: poll.id,
      question: poll.question,
      options: options,
      totalVotes: options.reduce((sum, opt) => sum + opt.count, 0),
      winner: isTie ? null : (winners[0] || null),
      isTie: isTie,
      winners: winners
    };
  }

  vote(user, choiceNum) {
    if (!this.isActive()) return false;
    const poll = this.current;
    if (!poll.options.has(choiceNum)) return false;
    
    const prev = poll.votes.get(user);
    if (prev === choiceNum) return true;
    
    if (Number.isFinite(prev) && poll.counts.has(prev)) {
      poll.counts.set(prev, Math.max(0, (poll.counts.get(prev) || 0) - 1));
    }
    
    poll.votes.set(user, choiceNum);
    poll.counts.set(choiceNum, (poll.counts.get(choiceNum) || 0) + 1);
    console.log(`✅ [${this.streamerId}] Vote recorded: ${user} → ${choiceNum}`);
    return true;
  }

  winner() {
    const poll = this.current;
    if (!poll) return null;
    
    let best = null;
    for (const [num, label] of poll.options.entries()) {
      const c = poll.counts.get(num) || 0;
      if (!best || c > best.count) best = { num, label, count: c };
    }
    return best;
  }

  state() {
    const poll = this.current;
    if (!poll) return { active: false };
    
    const timeLeftMs = Math.max(0, poll.endsAt - Date.now());
    const options = [...poll.options.entries()].map(([num, label]) => ({
      num,
      label,
      count: poll.counts.get(num) || 0
    }));
    const total = options.reduce((s, o) => s + o.count, 0);
    
    return {
      active: !poll.closed && timeLeftMs > 0,
      closed: poll.closed || timeLeftMs <= 0,
      question: poll.question,
      options,
      totalVotes: total,
      endsAt: poll.endsAt,
      now: Date.now()
    };
  }
}

module.exports = IntegratedPollService;
