// src/routes/dashboard.js
const express = require('express');
const router = express.Router();

/**
 * Helper to compute the base URL for browser sources and links
 */
function computeBaseUrl(req) {
  if (process.env.BASE_URL && process.env.BASE_URL.trim()) {
    return process.env.BASE_URL.trim();
  }
  const proto =
    (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'].split(',')[0]) ||
    req.protocol ||
    'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * Helper to surface service status flags to the dashboard
 * Falls back safely if app.locals isn’t populated.
 */
function getServiceStatus(app) {
  const locals = (app && app.locals) || {};
  const status = locals.serviceStatus || {};
  return {
    tts: Boolean(status.tts ?? locals.ttsService),
    poll: Boolean(status.poll ?? locals.pollService),
    automod: Boolean(status.automod ?? locals.automodService),
  };
}

/**
 * GET /dashboard
 * Renders the main dashboard view.
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user || null;

    // Optional welcome banner logic (e.g., after registration ?welcome=1)
    const welcome =
      req.query.welcome === '1' ||
      req.query.welcome === 'true' ||
      Boolean(req.session && req.session.justRegistered);

    // Clear the one-time flag if we used it
    if (req.session && req.session.justRegistered) {
      delete req.session.justRegistered;
    }

    const baseUrl = computeBaseUrl(req);
    const services = getServiceStatus(req.app);

    // Load streamer configs for the logged-in user (empty list if not logged in)
    let streamerConfigs = [];
    if (user && req.databaseService && typeof req.databaseService.getStreamerConfigsByUserId === 'function') {
      try {
        streamerConfigs = await req.databaseService.getStreamerConfigsByUserId(user.id);
      } catch (e) {
        console.error('Dashboard: failed to load streamer configs:', e);
      }
    }

    // Backward-compat for templates that expect `streamers`
    const streamers = Array.isArray(streamerConfigs) ? streamerConfigs : [];

    return res.render('dashboard/index', {
      title: 'Dashboard',
      user,
      baseUrl,
      services,
      welcome,
      streamerConfigs,
      streamers, // <- important for your EJS
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard', error: err, user: req.user || null });
  }
});

/**
 * GET /dashboard/add-streamer
 * Renders the add-streamer form and provides baseUrl used by the EJS template.
 */
router.get('/add-streamer', (req, res) => {
  try {
    const baseUrl = computeBaseUrl(req);
    return res.render('dashboard/add-streamer', {
      title: 'Add Streamer',
      baseUrl,
      user: req.user || null,
    });
  } catch (err) {
    console.error('Add streamer page error:', err);
    return res.status(500).render('error', { title: 'Error', message: 'Failed to load form', error: err, user: req.user || null });
  }
});

/**
 * POST /dashboard/add-streamer
 * Creates a streamer configuration for the logged-in user.
 */
router.post('/add-streamer', async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).render('error', { title: 'Unauthorized', message: 'Please log in first.', user: req.user || null });
    }
    if (!req.databaseService || typeof req.databaseService.createStreamerConfig !== 'function') {
      return res.status(500).render('error', { title: 'Error', message: 'Database service not available', user: req.user || null });
    }

    const {
      streamer_id,
      username,
      wallet_address,
      token_address,
      is_active,
    } = req.body || {};

    // Minimal validation — adjust as needed
    if (!wallet_address) {
      return res.status(400).render('error', { title: 'Invalid data', message: 'wallet_address is required', user: req.user || null });
    }

    const payload = {
      user_id: req.user.id, // satisfies NOT NULL constraint
      streamer_id: streamer_id || null,
      username: username || null,
      wallet_address,
      token_address: token_address || null,
      is_active: typeof is_active === 'boolean' ? is_active : true,
    };

    await req.databaseService.createStreamerConfig(payload);

    // After successful creation, redirect back to dashboard
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Add streamer error:', err);
    return res.status(500).render('error', { title: 'Error', message: 'Failed to add streamer', error: err, user: req.user || null });
  }
});

module.exports = router;
