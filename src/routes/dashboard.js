// src/routes/dashboard.js
const express = require('express');
const router = express.Router();

/**
 * Compute the base URL used in browser-source links.
 * Prefer .env BASE_URL, otherwise derive from request.
 */
function computeBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

// Guard to ensure we have req.user (your server mounts this router behind requireAuth already)
function ensureUser(req, res, next) {
  if (req.user && req.user.id) return next();
  // If somehow unauthenticated, bounce to login
  return res.redirect('/auth/login');
}

// List dashboard (streamers for this user)
router.get('/', ensureUser, async (req, res) => {
  try {
    const baseUrl = computeBaseUrl(req);
    const configs = await req.databaseService.getStreamerConfigsByUserId(req.user.id);
    return res.render('dashboard/index', {
      title: 'Your Dashboard',
      user: req.user,
      streamerConfigs: configs || [],
      baseUrl,
      error: null,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).render('dashboard/index', {
      title: 'Your Dashboard',
      user: req.user,
      streamerConfigs: [],
      baseUrl: computeBaseUrl(req),
      error: 'Failed to load your streamers.',
    });
  }
});

// Show "Add streamer" form
router.get('/add-streamer', ensureUser, (req, res) => {
  const baseUrl = computeBaseUrl(req);
  return res.render('dashboard/add-streamer', {
    title: 'Add Streamer',
    user: req.user,
    baseUrl,
    errors: [],
    values: {},
    created: null,
  });
});

// Handle "Add streamer" submit
router.post('/add-streamer', ensureUser, async (req, res) => {
  const baseUrl = computeBaseUrl(req);
  try {
    const {
      streamer_id = '',
      username = '',
      wallet_address = '',
      token_address = '',
    } = req.body || {};

    const errors = [];
    if (!streamer_id.trim()) errors.push('Streamer ID is required.');
    if (!wallet_address.trim()) errors.push('Wallet address is required.');

    if (errors.length) {
      return res.status(400).render('dashboard/add-streamer', {
        title: 'Add Streamer',
        user: req.user,
        baseUrl,
        errors,
        values: { streamer_id, username, wallet_address, token_address },
        created: null,
      });
    }

    // IMPORTANT: always include the authenticated user's ID
    const created = await req.databaseService.createStreamerConfig({
      user_id: req.user.id,
      streamer_id: streamer_id.trim(),
      username: username.trim() || null,
      wallet_address: wallet_address.trim(),
      token_address: token_address.trim() || null,
    });

    return res.render('dashboard/add-streamer', {
      title: 'Add Streamer',
      user: req.user,
      baseUrl,
      errors: [],
      values: { streamer_id: '', username: '', wallet_address: '', token_address: '' },
      created,
    });
  } catch (err) {
    console.error('Add streamer error:', err);
    return res.status(500).render('dashboard/add-streamer', {
      title: 'Add Streamer',
      user: req.user,
      baseUrl,
      errors: ['Failed to add streamer.'],
      values: req.body || {},
      created: null,
    });
  }
});

module.exports = router;
