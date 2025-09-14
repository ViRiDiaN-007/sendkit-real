const express = require('express');
const router = express.Router();
const { getAllBrowserSourceUrls } = require('../utils/browserSource');

// API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: req.databaseService.isConnected(),
      tts: req.integratedTTSService.isConnected(),
      poll: req.integratedPollService.isConnected(),
      automod: req.automodService.isConnected()
    }
  });
});

// Get user's streamers
router.get('/streamers', async (req, res) => {
  try {
    const user = req.user;
    const streamers = await req.databaseService.getStreamerConfigsByUserId(user.id);
    
    res.json({
      success: true,
      streamers: streamers
    });
  } catch (error) {
    console.error('Get streamers error:', error);
    res.status(500).json({ error: 'Failed to get streamers' });
  }
});

// Update streamer wallet address
router.post('/streamer/:streamerId/update-wallet', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { wallet_address } = req.body;
    const user = req.user;
    
    if (!wallet_address) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Update wallet address in database
    await req.databaseService.updateStreamerConfig(streamerId, {
      wallet_address: wallet_address
    });
    
    // Restart TTS service with new wallet address
    try {
      await req.integratedTTSService.restartStreamerTTS(streamerId);
    } catch (ttsError) {
      console.error('Error restarting TTS service:', ttsError);
      // Don't fail the request if TTS restart fails
    }
    
    res.json({
      success: true,
      message: 'Wallet address updated successfully'
    });
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Failed to update wallet address' });
  }
});

// Get streamer details
router.get('/streamer/:streamerId', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Get all settings
    const ttsSettings = await req.databaseService.getTTSSettings(streamerId);
    const pollSettings = await req.databaseService.getPollSettings(streamerId);
    const automodSettings = await req.databaseService.getAutomodSettings(streamerId);
    
    res.json({
      success: true,
      streamer: {
        ...streamerConfig,
        ttsSettings,
        pollSettings,
        automodSettings,
        browserSourceUrls: {
          ...getAllBrowserSourceUrls(req, streamerId)
        }
      }
    });
  } catch (error) {
    console.error('Get streamer error:', error);
    res.status(500).json({ error: 'Failed to get streamer details' });
  }
});

// TTS API endpoints
router.post('/tts/:streamerId/test', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { message, settings } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const result = await req.integratedTTSService.testTTS(streamerId, message, settings);
    res.json({ success: result.success, message: result.message });
    
  } catch (error) {
    console.error('TTS test error:', error);
    res.status(500).json({ error: 'Failed to test TTS' });
  }
});

router.post('/tts/:streamerId/submit', async (req, res) => {
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
    console.error('TTS submit error:', error);
    res.status(500).json({ error: 'Failed to submit TTS request' });
  }
});

// Poll API endpoints
router.post('/poll/:streamerId/create', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { question, options, duration } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const pollData = { question, options, duration: parseInt(duration) };
    const validation = req.pollService.validatePollData(pollData);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid poll data', 
        details: validation.errors 
      });
    }
    
    const result = await req.pollService.createPoll(streamerId, pollData);
    res.json({ success: true, poll: result });
    
  } catch (error) {
    console.error('Poll create error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

router.post('/poll/:streamerId/vote', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { pollId, voterAddress, optionNumber } = req.body;
    
    if (!pollId || !voterAddress || !optionNumber) {
      return res.status(400).json({ error: 'Poll ID, voter address, and option number are required' });
    }
    
    const result = await req.pollService.votePoll(streamerId, pollId, voterAddress, parseInt(optionNumber));
    res.json({ success: true, message: 'Vote recorded successfully' });
    
  } catch (error) {
    console.error('Poll vote error:', error);
    res.status(500).json({ error: 'Failed to vote on poll' });
  }
});

// WebSocket connection for real-time updates
router.get('/ws/:streamerId', (req, res) => {
  // This would handle WebSocket upgrades for real-time updates
  res.json({ message: 'WebSocket endpoint - use Socket.IO client' });
});

// Browser source data endpoints (public)
router.get('/browser-source/tts/:streamerId/data', async (req, res) => {
  try {
    const { streamerId } = req.params;
    
    // Get streamer config (no auth required for browser sources)
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig) {
      return res.status(404).json({ error: 'Streamer not found' });
    }
    
    // Get TTS settings
    const ttsSettings = await req.databaseService.getTTSSettings(streamerId);
    
    res.json({
      streamerId: streamerId,
      streamerName: streamerConfig.username,
      ttsSettings: ttsSettings || req.integratedTTSService.getDefaultSettings(),
      isActive: streamerConfig.is_active
    });
    
  } catch (error) {
    console.error('Browser source TTS data error:', error);
    res.status(500).json({ error: 'Failed to get TTS data' });
  }
});

router.get('/browser-source/poll/:streamerId/data', async (req, res) => {
  try {
    const { streamerId } = req.params;
    
    // Get streamer config (no auth required for browser sources)
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig) {
      return res.status(404).json({ error: 'Streamer not found' });
    }
    
    // Get poll settings and active poll
    const pollSettings = await req.databaseService.getPollSettings(streamerId);
    const activePoll = await req.integratedPollService.getActivePoll(streamerId);
    
    res.json({
      streamerId: streamerId,
      streamerName: streamerConfig.username,
      pollSettings: pollSettings || req.integratedPollService.getDefaultSettings(),
      activePoll: activePoll ? req.integratedPollService.formatPollForDisplay(activePoll) : null,
      isActive: streamerConfig.is_active
    });
    
  } catch (error) {
    console.error('Browser source poll data error:', error);
    res.status(500).json({ error: 'Failed to get poll data' });
  }
});

module.exports = router;
