const express = require('express');
const router = express.Router();
const { getPollBrowserSourceUrl } = require('../utils/browserSource');

// Poll settings page
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
    
    // Ensure streamer exists in IntegratedPollService
    if (!req.integratedPollService.streamers.has(streamerId)) {
      const pollSettings = await req.databaseService.getPollSettings(streamerId);
      await req.integratedPollService.createStreamerPoll(streamerId, {
        tokenAddress: streamerConfig.token_address,
        walletAddress: streamerConfig.wallet_address,
        whitelist: pollSettings?.whitelist || []
      });
    }
    
    // Get poll settings
    const pollSettings = await req.databaseService.getPollSettings(streamerId);
    const activePoll = await req.integratedPollService.getActivePoll(streamerId);
    const pollStats = await req.integratedPollService.getPollStats(streamerId);
    
    res.render('poll/settings', {
      title: `Poll Settings - ${streamerConfig.username}`,
      user: user,
      streamer: streamerConfig,
      pollSettings: pollSettings || req.integratedPollService.getDefaultSettings(),
      activePoll: activePoll ? req.integratedPollService.formatPollForDisplay(activePoll) : null,
      pollStats,
      browserSourceUrl: getPollBrowserSourceUrl(req, streamerId)
    });
    
  } catch (error) {
    console.error('Poll settings error:', error);
    res.render('error', {
      title: 'Poll Settings Error',
      message: 'Failed to load poll settings',
      user: req.user
    });
  }
});

// Update poll settings
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
    
    // Validate settings
    const validation = req.integratedPollService.validateSettings(settings);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid settings', 
        details: validation.errors 
      });
    }
    
    // Update database
    await req.databaseService.updatePollSettings(streamerId, settings);
    
    // Update poll service
    try {
      await req.integratedPollService.updatePollSettings(streamerId, settings);
    } catch (error) {
      console.error('Failed to update poll service:', error);
    }
    
    res.json({ success: true, message: 'Poll settings updated successfully' });
    
  } catch (error) {
    console.error('Update poll settings error:', error);
    res.status(500).json({ error: 'Failed to update poll settings' });
  }
});

// Create poll
router.post('/:streamerId/create', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { question, options, duration } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Validate poll data
    const pollData = { question, options, duration: parseInt(duration) };
    const validation = req.integratedPollService.validatePollData(pollData);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid poll data', 
        details: validation.errors 
      });
    }
    
    // Check if there's already an active poll
    const activePoll = await req.integratedPollService.getActivePoll(streamerId);
    if (activePoll) {
      return res.status(400).json({ error: 'A poll is already active' });
    }
    
    // Create poll
    const result = await req.integratedPollService.createPoll(streamerId, pollData);
    
    res.json({ 
      success: true, 
      poll: result,
      message: 'Poll created successfully'
    });
    
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// End poll
router.post('/:streamerId/end', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { pollId } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // End poll
    const result = await req.integratedPollService.endPoll(streamerId, pollId);
    
    res.json({ 
      success: true, 
      message: 'Poll ended successfully',
      results: result
    });
    
  } catch (error) {
    console.error('End poll error:', error);
    res.status(500).json({ error: 'Failed to end poll' });
  }
});

// Get active poll
router.get('/:streamerId/active', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const activePoll = await req.integratedPollService.getActivePoll(streamerId);
    res.json({ 
      poll: activePoll ? req.integratedPollService.formatPollForDisplay(activePoll) : null
    });
    
  } catch (error) {
    console.error('Get active poll error:', error);
    res.status(500).json({ error: 'Failed to get active poll' });
  }
});

// Get poll results
router.get('/:streamerId/results/:pollId', async (req, res) => {
  try {
    const { streamerId, pollId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const results = await req.integratedPollService.getPollResults(streamerId, pollId);
    res.json({ results });
    
  } catch (error) {
    console.error('Get poll results error:', error);
    res.status(500).json({ error: 'Failed to get poll results' });
  }
});

// Vote on poll (public endpoint for viewers)
router.post('/:streamerId/vote', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { pollId, voterAddress, optionNumber } = req.body;
    
    // Basic validation
    if (!pollId || !voterAddress || !optionNumber) {
      return res.status(400).json({ error: 'Poll ID, voter address, and option number are required' });
    }
    
    // Vote on poll
    const result = await req.integratedPollService.votePoll(streamerId, pollId, voterAddress, parseInt(optionNumber));
    
    res.json({ 
      success: true, 
      message: 'Vote recorded successfully'
    });
    
  } catch (error) {
    console.error('Vote poll error:', error);
    res.status(500).json({ error: 'Failed to vote on poll' });
  }
});

// Get poll stats
router.get('/:streamerId/stats', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const stats = await req.integratedPollService.getPollStats(streamerId);
    res.json(stats);
    
  } catch (error) {
    console.error('Get poll stats error:', error);
    res.status(500).json({ error: 'Failed to get poll stats' });
  }
});

// Get whitelist
router.get('/:streamerId/whitelist', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Ensure streamer exists in IntegratedPollService
    if (!req.integratedPollService.streamers.has(streamerId)) {
      const pollSettings = await req.databaseService.getPollSettings(streamerId);
      await req.integratedPollService.createStreamerPoll(streamerId, {
        tokenAddress: streamerConfig.token_address,
        walletAddress: streamerConfig.wallet_address,
        whitelist: pollSettings?.whitelist || []
      });
    }
    
    const whitelist = await req.integratedPollService.getWhitelist(streamerId);
    res.json({ whitelist });
    
  } catch (error) {
    console.error('Get whitelist error:', error);
    res.status(500).json({ error: 'Failed to get whitelist' });
  }
});

// Add to whitelist
router.post('/:streamerId/whitelist/add', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { address } = req.body;
    const user = req.user;
    
    console.log(`🔍 Add to whitelist request: streamerId=${streamerId}, address=${address}, user=${user?.id}`);
    
    if (!address) {
      console.log('❌ No address provided');
      return res.status(400).json({ error: 'Address is required' });
    }
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      console.log('❌ Streamer not found or access denied');
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Ensure streamer exists in IntegratedPollService
    if (!req.integratedPollService.streamers.has(streamerId)) {
      console.log(`🔧 Creating streamer poll instance for ${streamerId}`);
      const pollSettings = await req.databaseService.getPollSettings(streamerId);
      await req.integratedPollService.createStreamerPoll(streamerId, {
        tokenAddress: streamerConfig.token_address,
        walletAddress: streamerConfig.wallet_address,
        whitelist: pollSettings?.whitelist || []
      });
    }
    
    console.log(`✅ Adding address ${address} to whitelist for streamer ${streamerId}`);
    const result = await req.integratedPollService.addToWhitelist(streamerId, address, req.databaseService);
    console.log(`✅ Add to whitelist result:`, result);
    res.json(result);
    
  } catch (error) {
    console.error('Add to whitelist error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Remove from whitelist
router.post('/:streamerId/whitelist/remove', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { address } = req.body;
    const user = req.user;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Ensure streamer exists in IntegratedPollService
    if (!req.integratedPollService.streamers.has(streamerId)) {
      const pollSettings = await req.databaseService.getPollSettings(streamerId);
      await req.integratedPollService.createStreamerPoll(streamerId, {
        tokenAddress: streamerConfig.token_address,
        walletAddress: streamerConfig.wallet_address,
        whitelist: pollSettings?.whitelist || []
      });
    }
    
    const result = await req.integratedPollService.removeFromWhitelist(streamerId, address, req.databaseService);
    res.json(result);
    
  } catch (error) {
    console.error('Remove from whitelist error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
