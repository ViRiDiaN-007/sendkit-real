const express = require('express');
const router = express.Router();

// Automod settings page
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
    
    // Get automod settings
    const automodSettings = await req.databaseService.getAutomodSettings(streamerId);
    const moderationStats = await req.automodService.getModerationStats(streamerId);
    
    res.render('automod/settings', {
      title: `Automod Settings - ${streamerConfig.username}`,
      user: user,
      streamer: streamerConfig,
      automodSettings: automodSettings || req.automodService.getDefaultSettings(),
      moderationStats
    });
    
  } catch (error) {
    console.error('Automod settings error:', error);
    res.render('error', {
      title: 'Automod Settings Error',
      message: 'Failed to load automod settings',
      user: req.user
    });
  }
});

// Update automod settings
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
    const validation = req.automodService.validateSettings(settings);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid settings', 
        details: validation.errors 
      });
    }
    
    // Update database
    await req.databaseService.updateAutomodSettings(streamerId, settings);
    
    // Update automod service
    try {
      await req.automodService.updateAutomodSettings(streamerId, settings);
    } catch (error) {
      console.error('Failed to update automod service:', error);
    }
    
    res.json({ success: true, message: 'Automod settings updated successfully' });
    
  } catch (error) {
    console.error('Update automod settings error:', error);
    res.status(500).json({ error: 'Failed to update automod settings' });
  }
});

// Promote bot to mod
router.post('/:streamerId/promote-bot', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { botWalletAddress } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!botWalletAddress) {
      return res.status(400).json({ error: 'Bot wallet address is required' });
    }
    
    // Promote bot to mod
    const result = await req.automodService.promoteBotToMod(streamerId, botWalletAddress);
    
    res.json({ 
      success: true, 
      message: 'Bot promoted to mod successfully',
      botWalletAddress: result.botWalletAddress
    });
    
  } catch (error) {
    console.error('Promote bot error:', error);
    res.status(500).json({ error: 'Failed to promote bot to mod' });
  }
});

// Test automod rules
router.post('/:streamerId/test', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { testMessage } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!testMessage) {
      return res.status(400).json({ error: 'Test message is required' });
    }
    
    // Test automod rules
    const result = await req.automodService.testAutomodRules(streamerId, testMessage);
    
    res.json({ 
      success: true, 
      result: result
    });
    
  } catch (error) {
    console.error('Test automod rules error:', error);
    res.status(500).json({ error: 'Failed to test automod rules' });
  }
});

// Add banned word
router.post('/:streamerId/banned-words/add', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { word } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!word || word.trim().length === 0) {
      return res.status(400).json({ error: 'Word is required' });
    }
    
    // Add banned word
    const result = await req.automodService.addBannedWord(streamerId, word.trim());
    
    res.json({ 
      success: true, 
      message: 'Banned word added successfully',
      word: result.word
    });
    
  } catch (error) {
    console.error('Add banned word error:', error);
    res.status(500).json({ error: 'Failed to add banned word' });
  }
});

// Remove banned word
router.post('/:streamerId/banned-words/remove', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { word } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!word) {
      return res.status(400).json({ error: 'Word is required' });
    }
    
    // Remove banned word
    const result = await req.automodService.removeBannedWord(streamerId, word);
    
    res.json({ 
      success: true, 
      message: 'Banned word removed successfully',
      word: result.word
    });
    
  } catch (error) {
    console.error('Remove banned word error:', error);
    res.status(500).json({ error: 'Failed to remove banned word' });
  }
});

// Add banned user
router.post('/:streamerId/banned-users/add', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { userAddress } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!userAddress) {
      return res.status(400).json({ error: 'User address is required' });
    }
    
    // Add banned user
    const result = await req.automodService.addBannedUser(streamerId, userAddress);
    
    res.json({ 
      success: true, 
      message: 'User banned successfully',
      userAddress: result.userAddress
    });
    
  } catch (error) {
    console.error('Add banned user error:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// Remove banned user
router.post('/:streamerId/banned-users/remove', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const { userAddress } = req.body;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    if (!userAddress) {
      return res.status(400).json({ error: 'User address is required' });
    }
    
    // Remove banned user
    const result = await req.automodService.removeBannedUser(streamerId, userAddress);
    
    res.json({ 
      success: true, 
      message: 'User unbanned successfully',
      userAddress: result.userAddress
    });
    
  } catch (error) {
    console.error('Remove banned user error:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Get moderation stats
router.get('/:streamerId/stats', async (req, res) => {
  try {
    const { streamerId } = req.params;
    const user = req.user;
    
    // Verify user owns this streamer
    const streamerConfig = await req.databaseService.getStreamerConfig(streamerId);
    if (!streamerConfig || streamerConfig.user_id !== user.id) {
      return res.status(404).json({ error: 'Streamer not found or access denied' });
    }
    
    const stats = await req.automodService.getModerationStats(streamerId);
    res.json(stats);
    
  } catch (error) {
    console.error('Get moderation stats error:', error);
    res.status(500).json({ error: 'Failed to get moderation stats' });
  }
});

module.exports = router;
