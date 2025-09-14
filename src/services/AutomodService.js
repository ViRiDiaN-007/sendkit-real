const axios = require('axios');

class AutomodService {
  constructor() {
    this.isConnectedFlag = false;
    this.botWalletAddress = process.env.AUTOMOD_BOT_WALLET || '';
  }

  async initialize() {
    try {
      // For now, we'll just mark as connected since automod logic will be built later
      this.isConnectedFlag = true;
      console.log('✅ Automod Service initialized (placeholder)');
    } catch (error) {
      console.log('⚠️ Automod Service initialization failed:', error.message);
      this.isConnectedFlag = false;
    }
  }

  async getAutomodSettings(streamerId) {
    // This would typically fetch from the database via the main app
    // For now, return default settings
    return this.getDefaultSettings();
  }

  async updateAutomodSettings(streamerId, settings) {
    // This would typically update the database via the main app
    // For now, just return success
    return { success: true, message: 'Automod settings updated' };
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
      // This would test the automod rules against a sample message
      const settings = await this.getAutomodSettings(streamerId);
      
      const results = {
        message: testMessage,
        violations: [],
        action: 'none',
        confidence: 0
      };
      
      // Check banned words
      if (settings.banned_words && settings.banned_words.length > 0) {
        const lowerMessage = testMessage.toLowerCase();
        const foundWords = settings.banned_words.filter(word => 
          lowerMessage.includes(word.toLowerCase())
        );
        
        if (foundWords.length > 0) {
          results.violations.push({
            type: 'banned_words',
            words: foundWords,
            severity: 'high'
          });
          results.action = 'timeout';
          results.confidence = 0.8;
        }
      }
      
      // Check for spam patterns
      if (this.detectSpam(testMessage)) {
        results.violations.push({
          type: 'spam',
          pattern: 'repeated_characters',
          severity: 'medium'
        });
        results.action = 'warning';
        results.confidence = 0.6;
      }
      
      // Check for excessive caps
      if (this.detectExcessiveCaps(testMessage)) {
        results.violations.push({
          type: 'excessive_caps',
          capsRatio: this.getCapsRatio(testMessage),
          severity: 'low'
        });
        results.action = 'warning';
        results.confidence = 0.4;
      }
      
      return results;
    } catch (error) {
      console.error('Error testing automod rules:', error.message);
      throw new Error('Failed to test automod rules');
    }
  }

  async getModerationStats(streamerId) {
    try {
      // This would fetch real stats from the database
      return {
        totalActions: 0,
        timeouts: 0,
        bans: 0,
        warnings: 0,
        todayActions: 0,
        topViolations: [],
        recentActions: []
      };
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

  getDefaultSettings() {
    return {
      enabled: true,
      botWalletAddress: this.botWalletAddress,
      modPermissions: ['timeout', 'warn', 'ban'],
      bannedWords: [],
      bannedUsers: [],
      timeoutDuration: 300, // 5 minutes
      maxWarnings: 3,
      autoTimeout: true,
      autoBan: false,
      spamDetection: true,
      capsDetection: true,
      linkDetection: false,
      emojiSpamDetection: true
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
