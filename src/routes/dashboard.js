// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const DatabaseService = require('../services/DatabaseService');

// Dashboard home
router.get('/', async (req, res) => {
  try {
    const db = new DatabaseService();
    const streamers = await db.getStreamerConfigsByUserId(req.user.id);

    res.render('dashboard/index', {
      title: 'Your Dashboard',
      user: req.user,
      streamers,
      baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
      welcome: req.query.welcome || null, // always defined
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
});

// Add streamer form
router.get('/add', (req, res) => {
  res.render('dashboard/add-streamer', {
    title: 'Add Streamer',
    user: req.user,
    baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
    welcome: null,
  });
});

// Handle add streamer submission
router.post('/add', async (req, res) => {
  try {
    const db = new DatabaseService();
    const data = {
      user_id: req.user.id, // ensure not null
      twitch_username: req.body.twitch_username || null,
      youtube_channel: req.body.youtube_channel || null,
      kick_username: req.body.kick_username || null,
      tts_enabled: req.body.tts_enabled ? true : false,
    };

    await db.createStreamerConfig(data);
    res.redirect('/dashboard?welcome=1');
  } catch (err) {
    console.error('Add streamer error:', err);
    res.status(500).send('Error adding streamer');
  }
});

// Edit streamer config
router.get('/edit/:id', async (req, res) => {
  try {
    const db = new DatabaseService();
    const streamer = await db.getStreamerConfigById(req.params.id);

    if (!streamer || streamer.user_id !== req.user.id) {
      return res.status(403).send('Forbidden');
    }

    res.render('dashboard/edit-streamer', {
      title: 'Edit Streamer',
      user: req.user,
      streamer,
      baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
      welcome: null,
    });
  } catch (err) {
    console.error('Edit streamer error:', err);
    res.status(500).send('Error loading streamer config');
  }
});

router.post('/edit/:id', async (req, res) => {
  try {
    const db = new DatabaseService();
    const data = {
      id: req.params.id,
      user_id: req.user.id,
      twitch_username: req.body.twitch_username || null,
      youtube_channel: req.body.youtube_channel || null,
      kick_username: req.body.kick_username || null,
      tts_enabled: req.body.tts_enabled ? true : false,
    };

    await db.updateStreamerConfig(data);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Update streamer error:', err);
    res.status(500).send('Error updating streamer');
  }
});

// Delete streamer
router.post('/delete/:id', async (req, res) => {
  try {
    const db = new DatabaseService();
    const streamer = await db.getStreamerConfigById(req.params.id);

    if (!streamer || streamer.user_id !== req.user.id) {
      return res.status(403).send('Forbidden');
    }

    await db.deleteStreamerConfig(req.params.id);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete streamer error:', err);
    res.status(500).send('Error deleting streamer');
  }
});

module.exports = router;
