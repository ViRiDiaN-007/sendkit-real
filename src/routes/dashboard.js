const express = require('express');
const router = express.Router();
const config = require('../../config');
const { getAllBrowserSourceUrls } = require('../utils/browserSource');

// Main dashboard
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    
    // Get user's streamer configs
    const streamerConfigs = await req.databaseService.getStreamerConfigsByUserId(user.id);
    
    // Get stats for each streamer
    const streamerStats = [];
    for (const config of streamerConfigs) {
      const ttsSettings = await req.databaseService.getTTSSettings(config.streamer_id);
      const pollSettings = await req.databaseService.getPollSettings(config.streamer_id);
      const automodSettings = await req.databaseService.getAutomodSettings(config.streamer_id);
      
      // Get TTS stats
      let ttsStats = { queueLength: 0, processedToday: 0, errors: 0 };
      try {
        ttsStats = await req.integratedTTSService.getTTSStats(config.streamer_id);
      } catch (error) {
        console.error('Error fetching TTS stats:', error);
      }
      
      // Get poll stats
      let pollStats = { activePolls: 0, totalPolls: 0 };
      try {
        const activePoll = await req.integratedPollService.getActivePoll(config.streamer_id);
        pollStats.activePolls = activePoll ? 1 : 0;
      } catch (error) {
        console.error('Error fetching poll stats:', error);
      }
      
      // Get automod stats
      let automodStats = { totalActions: 0, timeouts: 0, bans: 0 };
      try {
        automodStats = await req.automodService.getModerationStats(config.streamer_id);
      } catch (error) {
        console.error('Error fetching automod stats:', error);
      }
      
      streamerStats.push({
        ...config,
        ttsSettings,
        pollSettings,
        automodSettings,
        ttsStats,
        pollStats,
        automodStats,
        browserSourceUrls: {
          ...getAllBrowserSourceUrls(req, config.streamer_id)
        }
      });
    }
    
    res.render('dashboard/index', {
      title: 'Dashboard - Pump.fun Streamer Dashboard',
      user: user,
      streamers: streamerStats,
      services: {
        tts: req.integratedTTSService.isConnected(),
        poll: req.integratedPollService.isConnected(),
        automod: req.automodService.isConnected()
      },
      welcome: req.query.welcome === 'true'
    });
    
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('error', {
      title: 'Dashboard Error',
      message: 'Failed to load dashboard',
      user: req.user
    });
  }
});

// Streamer settings
router.get('/streamer/:streamerId', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).render('error', {
        title: 'Streamer Not Found',
        message: 'Streamer not found or access denied',
        user: user
      });
    }
    
    // Get all settings
    const ttsSettings = await req.databaseService.getTTSSettings(streamerId);
    const pollSettings = await req.databaseService.getPollSettings(streamerId);
    const automodSettings = await req.databaseService.getAutomodSettings(streamerId);
    
    res.render('dashboard/streamer', {
      title: `Streamer Settings - ${streamerConfig.username}`,
      user: user,
      streamer: streamerConfig,
      ttsSettings,
      pollSettings,
      automodSettings,
      created: req.query.created === 'true',
      browserSourceUrls: {
        ...getAllBrowserSourceUrls(req, streamerId)
      }
    });
    
  } catch (error) {
    console.error('Streamer settings error:', error);
    res.render('error', {
      title: 'Streamer Settings Error',
      message: 'Failed to load streamer settings',
      user: req.user
    });
  }
});

// Add new streamer
router.get('/add-streamer', (req, res) => {
  res.render('dashboard/add-streamer', {
    title: 'Add New Streamer',
    user: req.user,
    baseUrl: config.baseUrl
  });
});

router.post('/add-streamer', async (req, res) => {
  try {
    const { walletAddress, tokenAddress, streamerName } = req.body;
    const user = req.user;
    
    // Validation
    const errors = [];
    
    if (!walletAddress) {
      errors.push('Wallet address is required');
    }
    
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      errors.push('Invalid wallet address format');
    }
    
    if (tokenAddress && !isValidWalletAddress(tokenAddress)) {
      errors.push('Invalid token address format');
    }
    
    if (errors.length > 0) {
      return res.render('dashboard/add-streamer', {
        title: 'Add New Streamer',
        user: user,
        error: errors.join(', '),
        formData: req.body,
        baseUrl: config.baseUrl
      });
    }
    
    // Generate streamer ID
    const streamerId = `streamer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('Generated streamer ID:', streamerId);
    
    // Create streamer config
    const configData = {
      user_id: user.id,
      streamer_id: streamerId,
      username: streamerName || null,
      wallet_address: walletAddress,
      token_address: tokenAddress || ''
    };
    console.log('Config data:', configData);
    
    await req.databaseService.createStreamerConfig(configData);
    
    // Initialize default settings
    await initializeDefaultSettings(req.databaseService, streamerId);
    
    // Register with TTS service
    try {
      await req.integratedTTSService.createStreamerTTS({
        streamer_id: streamerId,
        username: streamerName,
        wallet_address: walletAddress,
        token_address: tokenAddress || '',
        is_active: true
      });
    } catch (error) {
      console.error('Failed to register with TTS service:', error);
    }
    
    res.redirect(`/dashboard/streamer/${streamerId}?created=true`);
    
  } catch (error) {
    console.error('Add streamer error:', error);
    res.render('dashboard/add-streamer', {
      title: 'Add New Streamer',
      user: req.user,
      error: 'Failed to create streamer',
      formData: req.body,
      baseUrl: `${req.protocol}://${req.get('host')}`
    });
  }
});

// Update streamer config
router.post('/streamer/:streamerId/update', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { walletAddress, tokenAddress, isActive } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Update streamer config
    await req.databaseService.updateStreamerConfig(streamerId, {
      wallet_address: walletAddress,
      token_address: tokenAddress,
      is_active: isActive === 'true'
    });
    
    res.json({ success: true, message: 'Streamer configuration updated' });
    
  } catch (error) {
    console.error('Update streamer error:', error);
    res.status(500).json({ error: 'Failed to update streamer configuration' });
  }
});

// Delete streamer
router.post('/streamer/:streamerId/delete', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Stop all services for this streamer
    try {
      // Stop TTS service
      if (req.integratedTTSService) {
        await req.integratedTTSService.stopStreamer(streamerId);
      }
      
      // Stop Poll service
      if (req.integratedPollService) {
        await req.integratedPollService.stopStreamer(streamerId);
      }
      
      // Stop Automod service
      if (req.automodService) {
        // Remove from active streamers
        req.automodService.activeStreamers.delete(streamerId);
      }
      
      // Unsubscribe from chat monitor
      if (req.chatMonitorManager) {
        req.chatMonitorManager.unsubscribe(streamerId, 'TTS');
        req.chatMonitorManager.unsubscribe(streamerId, 'Poll');
        req.chatMonitorManager.unsubscribe(streamerId, 'Automod');
      }
      
      console.log(`🛑 Stopped all services for streamer ${streamerId}`);
    } catch (serviceError) {
      console.error('Error stopping services for streamer:', serviceError);
      // Continue with deletion even if service stopping fails
    }
    
    // Delete streamer and all related data
    await req.databaseService.deleteStreamer(streamerId);
    
    res.json({ success: true, message: 'Streamer deleted successfully' });
    
  } catch (error) {
    console.error('Delete streamer error:', error);
    res.status(500).json({ error: 'Failed to delete streamer' });
  }
});

// Helper functions
function isValidWalletAddress(address) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

async function initializeDefaultSettings(databaseService, streamerId) {
  try {
    // Initialize TTS settings
    await databaseService.updateTTSSettings(streamerId, {
      voice: 'en-US-Standard-A',
      rate: 1.0,
      volume: 1.0,
      pitch: 1.0,
      enabled: true,
      min_donation: 0.01,
      cooldown_seconds: 30,
      max_message_length: 200,
      auto_tts_enabled: true,
      donation_gate_enabled: true
    });
    
    // Initialize poll settings
    await databaseService.updatePollSettings(streamerId, {
      enabled: true,
      default_duration: 60,
      allow_viewer_polls: false,
      require_donation: false,
      min_donation: 0.01
    });
    
    // Initialize automod settings
    await databaseService.updateAutomodSettings(streamerId, {
      enabled: true,
      bot_wallet_address: '',
      mod_permissions: ['timeout', 'warn'],
      bannedWords: [],
      banned_users: [],
      timeoutDuration: 30,
      max_warnings: 3,
      auto_timeout: true,
      auto_ban: false,
      spamDetection: true,
      capsDetection: true
    });
    
    console.log(`✅ Default settings initialized for streamer ${streamerId}`);
  } catch (error) {
    console.error('Error initializing default settings:', error);
  }
}

// Delete streamer
router.delete('/streamer/:streamerId/delete', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Stop poll bot if running
    try {
      if (req.integratedPollService.streamers.has(streamerId)) {
        await req.integratedPollService.stopStreamer(streamerId);
        console.log(`🛑 Stopped poll bot for streamer ${streamerId}`);
      }
    } catch (error) {
      console.error('Error stopping poll bot:', error);
    }
    
    // Actually delete streamer and all related data
    await req.databaseService.deleteStreamer(streamerId);
    console.log(`🗑️ Deleted streamer ${streamerId} and all related data`);
    
    res.json({ 
      success: true, 
      message: 'Streamer deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete streamer error:', error);
    res.status(500).json({ error: 'Failed to delete streamer' });
  }
});

// Toggle streamer status (active/inactive)
router.post('/streamer/:streamerId/toggle-status', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { is_active } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Update streamer status
    await req.databaseService.updateStreamerConfig(streamerId, { is_active: is_active });
    console.log(`🔄 ${is_active ? 'Activated' : 'Deactivated'} streamer ${streamerId}`);
    
    // Start or stop poll bot based on status
    try {
      if (is_active) {
        // Start poll bot if it doesn't exist
        if (!req.integratedPollService.streamers.has(streamerId)) {
          const pollSettings = await req.databaseService.getPollSettings(streamerId);
          await req.integratedPollService.createStreamerPoll(streamerId, {
            tokenAddress: streamerConfig.token_address,
            walletAddress: streamerConfig.wallet_address,
            whitelist: pollSettings?.whitelist || []
          });
        }
        await req.integratedPollService.startStreamer(streamerId);
        console.log(`🚀 Started poll bot for streamer ${streamerId}`);
      } else {
        // Stop poll bot
        if (req.integratedPollService.streamers.has(streamerId)) {
          await req.integratedPollService.stopStreamer(streamerId);
          console.log(`🛑 Stopped poll bot for streamer ${streamerId}`);
        }
      }
    } catch (error) {
      console.error('Error managing poll bot:', error);
      // Don't fail the request if poll bot management fails
    }
    
    res.json({ 
      success: true, 
      message: `Streamer ${is_active ? 'activated' : 'deactivated'} successfully`,
      is_active: is_active
    });
    
  } catch (error) {
    console.error('Toggle streamer status error:', error);
    res.status(500).json({ error: 'Failed to toggle streamer status' });
  }
});

// Update streamer username
router.post('/streamer/:streamerId/update-username', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { username } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Update username
    await req.databaseService.updateStreamerUsername(streamerId, username);
    console.log(`📝 Updated username for streamer ${streamerId}: ${username}`);
    
    res.json({ 
      success: true, 
      message: 'Username updated successfully',
      username: username
    });
    
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// Get automod settings page
router.get('/streamer/:streamerId/automod', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).render('error', { 
        title: 'Streamer Not Found',
        message: 'Streamer not found or access denied.',
        user: req.user
      });
    }
    
    res.render('automod/settings', { 
      title: 'Automod Settings',
      user: req.user,
      streamer: streamerConfig
    });
    
  } catch (error) {
    console.error('Get automod settings page error:', error);
    res.status(500).render('error', { 
      title: 'Server Error',
      message: 'An unexpected error occurred.',
      user: req.user
    });
  }
});

// Get automod stats for a streamer
router.get('/streamer/:streamerId/automod-stats', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Get automod stats from the service
    const stats = req.automodService ? req.automodService.getModerationStats(streamerId) : {
      totalActions: 0,
      timeouts: 0,
      bans: 0
    };
    
    res.json({ 
      success: true, 
      stats: stats
    });
    
  } catch (error) {
    console.error('Get automod stats error:', error);
    res.status(500).json({ error: 'Failed to get automod stats' });
  }
});

// Get automod settings for a streamer (API)
router.get('/streamer/:streamerId/automod-settings', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Get automod settings
    const automodSettings = await req.databaseService.getAutomodSettings(streamerId);
    
    // If no settings exist, return default settings
    if (!automodSettings) {
      const defaultSettings = {
        enabled: true,
        bannedWords: [],
        spamDetection: true,
        removeSlurs: true,
        removeCommonSpam: true
        // All actions are now just ban - no action selection needed
      };
      return res.json({ 
        success: true, 
        settings: defaultSettings
      });
    }
    
    res.json({ 
      success: true, 
      settings: automodSettings
    });
    
  } catch (error) {
    console.error('Get automod settings error:', error);
    res.status(500).json({ error: 'Failed to get automod settings' });
  }
});

// Update automod settings for a streamer
router.post('/streamer/:streamerId/automod-settings', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { bannedWords, spamDetection, removeSlurs, removeCommonSpam } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Get existing settings first
    const existingSettings = await req.databaseService.getAutomodSettings(streamerId) || {};
    
    // Update automod settings - merge with existing settings
    const updatedSettings = {
      ...existingSettings,
      bannedWords: bannedWords || [],
      spamDetection: spamDetection || false,
      removeSlurs: removeSlurs || false,
      removeCommonSpam: removeCommonSpam || false
      // All actions are now just ban - no action selection needed
    };
    
    console.log(`🔍 [DASHBOARD DEBUG] Updating settings for ${streamerId}:`, updatedSettings);
    await req.databaseService.updateAutomodSettings(streamerId, updatedSettings);
    console.log(`🔧 Updated automod settings for streamer ${streamerId}`);
    
    res.json({ 
      success: true, 
      message: 'Automod settings updated successfully',
      settings: updatedSettings
    });
    
  } catch (error) {
    console.error('Update automod settings error:', error);
    res.status(500).json({ error: 'Failed to update automod settings' });
  }
});

// Generate automod wallet
router.post('/streamer/:streamerId/generate-automod-wallet', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ 
        success: false, 
        error: 'Streamer not found or access denied.' 
      });
    }
    
    // Generate automod wallet
    const result = await req.automodService.generateAutomodWallet(streamerId);
    
    res.json(result);
    
  } catch (error) {
    console.error('Generate automod wallet error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to generate automod wallet.' 
    });
  }
});

// Summon automod wallet
router.post('/streamer/:streamerId/summon-automod-wallet', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ 
        success: false, 
        error: 'Streamer not found or access denied.' 
      });
    }
    
    // Summon automod wallet
    const result = await req.automodService.summonAutomodWallet(streamerId);
    
    res.json(result);
    
  } catch (error) {
    console.error('Summon automod wallet error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to summon automod wallet.' 
    });
  }
});

// Get automod wallet status
router.get('/streamer/:streamerId/automod-wallet-status', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ 
        success: false, 
        error: 'Streamer not found or access denied.' 
      });
    }
    
    // Get automod wallet status
    const status = await req.automodService.getAutomodWalletStatus(streamerId);
    
    res.json({
      success: true,
      ...status
    });
    
  } catch (error) {
    console.error('Get automod wallet status error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get automod wallet status.' 
    });
  }
});

// Admin routes for word list management
router.get('/admin/word-lists', async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user is admin
    if (!user.is_admin) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'Admin access required',
        user: user
      });
    }
    
    // Get current word lists
    const slurWords = await req.automodService.getSlurWords();
    const spamWords = await req.automodService.getSpamWords();
    
    res.render('admin/word-lists', {
      title: 'Word List Management',
      user: user,
      slurWords: slurWords,
      spamWords: spamWords
    });
    
  } catch (error) {
    console.error('Get word lists error:', error);
    res.status(500).render('error', {
      title: 'Server Error',
      message: 'Failed to load word lists',
      user: req.user
    });
  }
});

// Update slur words
router.post('/admin/word-lists/slurs', async (req, res) => {
  try {
    const user = req.user;
    const { words } = req.body;
    
    // Check if user is admin
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Update slur words
    const result = await req.automodService.updateSlurWords(words);
    
    res.json(result);
    
  } catch (error) {
    console.error('Update slur words error:', error);
    res.status(500).json({ error: 'Failed to update slur words' });
  }
});

// Update spam words
router.post('/admin/word-lists/spam', async (req, res) => {
  try {
    const user = req.user;
    const { words } = req.body;
    
    // Check if user is admin
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Update spam words
    const result = await req.automodService.updateSpamWords(words);
    
    res.json(result);
    
  } catch (error) {
    console.error('Update spam words error:', error);
    res.status(500).json({ error: 'Failed to update spam words' });
  }
});

module.exports = router;
