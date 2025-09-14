const express = require('express');
const router = express.Router();
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
    baseUrl: `${req.protocol}://${req.get('host')}`
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
        formData: req.body
      });
    }
    
    // Generate streamer ID
    const streamerId = `streamer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create streamer config
    await req.databaseService.createStreamerConfig(user.id, {
      streamer_id: streamerId,
      username: streamerName || null,
      wallet_address: walletAddress,
      token_address: tokenAddress || '',
      is_active: true
    });
    
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
      formData: req.body
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
      banned_words: [],
      banned_users: [],
      timeout_duration: 300,
      max_warnings: 3,
      auto_timeout: true,
      auto_ban: false
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

module.exports = router;
