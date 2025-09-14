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
    
    // Get poll settings and active poll
    const pollSettings = await req.databaseService.getPollSettings(streamerId);
    const activePoll = req.integratedPollService.getActivePoll(streamerId);
    const pollStats = await req.integratedPollService.getPollStats(streamerId);
    
    res.render('poll/settings', {
      title: `Poll Settings - ${streamerConfig.username}`,
      user: user,
      streamer: streamerConfig,
      pollSettings: pollSettings || {
        enabled: false,
        defaultDuration: 60,
        allowViewerVotes: true,
        requireWhitelist: false,
        whitelist: []
      },
      activePoll: activePoll,
      pollStats: pollStats,
      browserSourceUrl: getPollBrowserSourceUrl(req, streamerId)
    });
  } catch (error) {
    console.error('Error loading poll settings:', error);
    res.status(500).render('error', {
      title: 'Server Error',
      message: 'Failed to load poll settings',
      user: req.user
    });
  }
});

// Update poll settings
router.post('/:streamerId/settings', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    const { enabled, defaultDuration, allowViewerVotes, requireWhitelist, whitelist } = req.body;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Update poll settings
    const pollSettings = {
      enabled: enabled === 'on',
      defaultDuration: parseInt(defaultDuration) || 60,
      allowViewerVotes: allowViewerVotes === 'on',
      requireWhitelist: requireWhitelist === 'on',
      whitelist: Array.isArray(whitelist) ? whitelist : (whitelist ? [whitelist] : [])
    };
    
    await req.databaseService.updatePollSettings(streamerId, pollSettings);
    
    // If poll service is being enabled, create the streamer instance
    if (pollSettings.enabled && !req.integratedPollService.streamers.has(streamerId)) {
      await req.integratedPollService.createStreamerPoll(streamerId, {
        tokenAddress: streamerConfig.token_address,
        walletAddress: streamerConfig.wallet_address,
        whitelist: pollSettings.whitelist
      });
      
      // Start the streamer if not already active
      if (!req.integratedPollService.streamers.get(streamerId)?.isActive) {
        console.log(`🚀 Starting poll bot for streamer ${streamerId}`);
        await req.integratedPollService.startStreamer(streamerId);
      }
    }
    
    req.flash('success', 'Poll settings updated successfully');
    res.redirect(`/poll/${streamerId}`);
  } catch (error) {
    console.error('Error updating poll settings:', error);
    req.flash('error', 'Failed to update poll settings');
    res.redirect(`/poll/${streamerId}`);
  }
});

// Create a new poll
router.post('/:streamerId/create', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    const { question, options, duration } = req.body;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // Parse options
    const optionsObj = {};
    if (Array.isArray(options)) {
      options.forEach((option, index) => {
        if (option.trim()) {
          optionsObj[index + 1] = option.trim();
        }
      });
    }
    
    // Create poll
    const result = await req.integratedPollService.createPoll(
      streamerId,
      question,
      optionsObj,
      parseInt(duration) || 60
    );
    
    if (result.success) {
      res.json({ success: true, poll: result.poll });
    } else {
      res.status(400).json({ error: 'Failed to create poll' });
    }
  } catch (error) {
    console.error('Error creating poll:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Vote on a poll
router.post('/:streamerId/vote', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { voterAddress, optionNumber } = req.body;
    
    const result = await req.integratedPollService.votePoll(streamerId, voterAddress, optionNumber);
    res.json(result);
  } catch (error) {
    console.error('Error voting on poll:', error);
    res.status(500).json({ error: 'Failed to vote on poll' });
  }
});

// End a poll
router.post('/:streamerId/end', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const results = await req.integratedPollService.endPoll(streamerId);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error ending poll:', error);
    res.status(500).json({ error: 'Failed to end poll' });
  }
});

// Get active poll
router.get('/:streamerId/active', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const activePoll = req.integratedPollService.getActivePoll(streamerId);
    res.json({ poll: activePoll });
  } catch (error) {
    console.error('Error getting active poll:', error);
    res.status(500).json({ error: 'Failed to get active poll' });
  }
});

// Get poll results
router.get('/:streamerId/results', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    // This would typically fetch from database
    const results = {
      polls: [],
      totalPolls: 0,
      totalVotes: 0
    };
    
    res.json(results);
  } catch (error) {
    console.error('Error getting poll results:', error);
    res.status(500).json({ error: 'Failed to get poll results' });
  }
});

// Get poll stats
router.get('/:streamerId/stats', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const stats = await req.integratedPollService.getPollStats(streamerId);
    res.json(stats);
  } catch (error) {
    console.error('Error getting poll stats:', error);
    res.status(500).json({ error: 'Failed to get poll stats' });
  }
});

// Start/Stop poll service for streamer
router.post('/:streamerId/toggle', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    const { action } = req.body; // 'start' or 'stop'
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (action === 'start') {
      // Create streamer poll instance if it doesn't exist
      if (!req.integratedPollService.streamers.has(streamerId)) {
        const pollSettings = await req.databaseService.getPollSettings(streamerId);
        await req.integratedPollService.createStreamerPoll(streamerId, {
          tokenAddress: streamerConfig.token_address,
          walletAddress: streamerConfig.wallet_address,
          whitelist: pollSettings?.whitelist || []
        });
      }
      
      console.log(`🚀 Starting poll bot for streamer ${streamerId}`);
      await req.integratedPollService.startStreamer(streamerId);
      res.json({ success: true, message: 'Poll service started' });
    } else if (action === 'stop') {
      await req.integratedPollService.stopStreamer(streamerId);
      res.json({ success: true, message: 'Poll service stopped' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "start" or "stop"' });
    }
  } catch (error) {
    console.error('Error toggling poll service:', error);
    res.status(500).json({ error: 'Failed to toggle poll service' });
  }
});

module.exports = router;
