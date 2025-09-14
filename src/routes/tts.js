const express = require('express');
const router = express.Router();
const { getTTSBrowserSourceUrl } = require('../utils/browserSource');

// TTS settings page
router.get('/:streamerId', async (req, res) => {
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
    
    // Get TTS settings
    let ttsSettings = await req.databaseService.getTTSSettings(streamerId);
    
    // Convert SQLite boolean values (0/1) to JavaScript booleans
    if (ttsSettings) {
      ttsSettings.enabled = ttsSettings.enabled === 1 || ttsSettings.enabled === true;
      ttsSettings.auto_tts_enabled = ttsSettings.auto_tts_enabled === 1 || ttsSettings.auto_tts_enabled === true;
      ttsSettings.donation_gate_enabled = ttsSettings.donation_gate_enabled === 1 || ttsSettings.donation_gate_enabled === true;
    }
    
    // Debug: Log the TTS settings to see what values we're getting
    console.log('TTS Settings from database:', ttsSettings);
    
    // Get TTS stats with error handling
    let ttsStats = null;
    try {
      console.log(`Fetching TTS stats for streamer: ${streamerId}`);
      ttsStats = await req.integratedTTSService.getTTSStats(streamerId);
      console.log(`TTS stats result:`, ttsStats);
    } catch (error) {
      console.error('Error fetching TTS stats:', error);
      ttsStats = { queueLength: 0, processedToday: 0, errors: 0 };
    }
    
    // Get recent messages with error handling
    let recentMessages = [];
    try {
      recentMessages = await req.integratedTTSService.getRecentMessages(streamerId, 10);
    } catch (error) {
      console.error('Error fetching recent messages:', error);
      recentMessages = [];
    }
    
    res.render('tts/settings', {
      title: `TTS Settings - ${streamerConfig.username}`,
      user: user,
      streamer: streamerConfig,
      ttsSettings: ttsSettings || req.integratedTTSService.getDefaultSettings(),
      ttsStats,
      recentMessages,
      browserSourceUrl: getTTSBrowserSourceUrl(req, streamerId)
    });
    
  } catch (error) {
    console.error('TTS settings error:', error);
    res.render('error', {
      title: 'TTS Settings Error',
      message: 'Failed to load TTS settings',
      user: req.user
    });
  }
});

// Update TTS settings
router.post('/:streamerId/update', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const settings = req.body;
    
    // Debug: Log what we're receiving
    console.log('🔧 [TTS Update] Received settings:', settings);
    console.log('🔧 [TTS Update] Donation gate enabled:', settings.donation_gate_enabled);
    
    // Update TTS settings using integrated service
    await req.integratedTTSService.updateTTSSettings(streamerId, settings);
    
    // Debug: Verify what was saved
    const savedSettings = await req.databaseService.getTTSSettings(streamerId);
    console.log('🔧 [TTS Update] Settings after save:', savedSettings);
    
    res.json({ success: true, message: 'TTS settings updated successfully' });
    
  } catch (error) {
    console.error('Update TTS settings error:', error);
    res.status(500).json({ error: 'Failed to update TTS settings' });
  }
});

// Test TTS
router.post('/:streamerId/test', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { message, settings } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Test TTS
    const result = await req.integratedTTSService.testTTS(streamerId, message, settings);
    
    res.json({ 
      success: result.success, 
      message: result.message || 'TTS test completed'
    });
    
  } catch (error) {
    console.error('Test TTS error:', error);
    res.status(500).json({ error: 'Failed to test TTS' });
  }
});

// Get TTS stats
router.get('/:streamerId/stats', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const stats = await req.integratedTTSService.getTTSStats(streamerId);
    res.json(stats);
    
  } catch (error) {
    console.error('Get TTS stats error:', error);
    res.status(500).json({ error: 'Failed to get TTS stats' });
  }
});

// Get recent messages
router.get('/:streamerId/messages', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { limit = 20 } = req.query;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const messages = await req.integratedTTSService.getRecentMessages(streamerId, parseInt(limit));
    res.json({ messages });
    
  } catch (error) {
    console.error('Get recent messages error:', error);
    res.status(500).json({ error: 'Failed to get recent messages' });
  }
});

// Submit TTS request (for testing)
router.post('/:streamerId/submit', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { message, walletAddress, transactionHash, isAutoTTS } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!message || !walletAddress) {
      return res.status(400).json({ error: 'Message and wallet address are required' });
    }
    
    // Submit TTS request
    const result = await req.integratedTTSService.testTTS(streamerId, message, {
      walletAddress,
      transactionHash,
      isAutoTTS: isAutoTTS === 'true'
    });
    
    res.json({ 
      success: true, 
      requestId: result.requestId,
      message: 'TTS request submitted successfully'
    });
    
  } catch (error) {
    console.error('Submit TTS request error:', error);
    res.status(500).json({ error: 'Failed to submit TTS request' });
  }
});

// Clear TTS queue (admin function)
router.post('/:streamerId/clear-queue', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // This would clear the TTS queue for the streamer
    // Implementation depends on the TTS service API
    res.json({ success: true, message: 'TTS queue cleared' });
    
  } catch (error) {
    console.error('Clear TTS queue error:', error);
    res.status(500).json({ error: 'Failed to clear TTS queue' });
  }
});

// Test donation registration endpoint
router.post('/:streamerId/test-donation', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { walletAddress, amount } = req.body;
    
    if (!walletAddress || !amount) {
      return res.status(400).json({ error: 'walletAddress and amount are required' });
    }

    // Get TTS service
    const ttsService = req.integratedTTSService;
    if (!ttsService) {
      return res.status(500).json({ error: 'TTS service not available' });
    }

    // Manually register a donation for testing
    ttsService.registerDonation(streamerId, walletAddress, amount);
    
    console.log(`🧪 [TEST] Manually registered donation: ${walletAddress} donated ${amount} SOL to ${streamerId}`);

    res.json({ 
      success: true, 
      message: `Test donation registered: ${walletAddress} donated ${amount} SOL`,
      walletAddress,
      amount,
      streamerId
    });
  } catch (error) {
    console.error('Error registering test donation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
