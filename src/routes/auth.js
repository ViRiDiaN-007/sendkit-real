const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('auth/login', { 
    title: 'Login - Pump.fun Streamer Dashboard',
    error: req.query.error 
  });
});

// Register page
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('auth/register', { 
    title: 'Register - Pump.fun Streamer Dashboard',
    error: req.query.error 
  });
});

// Login handler
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Login error:', err);
      return res.redirect('/auth/login?error=server_error');
    }
    
    if (!user) {
      return res.redirect(`/auth/login?error=${encodeURIComponent(info.message)}`);
    }
    
    req.logIn(user, (err) => {
      if (err) {
        console.error('Session error:', err);
        return res.redirect('/auth/login?error=session_error');
      }
      
      return res.redirect('/dashboard');
    });
  })(req, res, next);
});

// Register handler
router.post('/register', async (req, res) => {
  try {
    const { email, password, confirmPassword, username, walletAddress } = req.body;
    
    // Validation
    const errors = [];
    
    if (!email || !password || !username) {
      errors.push('Email, password, and username are required');
    }
    
    if (password !== confirmPassword) {
      errors.push('Passwords do not match');
    }
    
    if (password && password.length < 6) {
      errors.push('Password must be at least 6 characters long');
    }
    
    if (email && !isValidEmail(email)) {
      errors.push('Invalid email format');
    }
    
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      errors.push('Invalid wallet address format');
    }
    
    if (errors.length > 0) {
      return res.redirect(`/auth/register?error=${encodeURIComponent(errors.join(', '))}`);
    }
    
    // Check if user already exists
    const existingUser = await req.databaseService.findUserByEmail(email);
    if (existingUser) {
      return res.redirect('/auth/register?error=email_already_exists');
    }
    
    // Check if username is taken
    const existingUsername = await req.databaseService.findUserByUsername(username);
    if (existingUsername) {
      return res.redirect('/auth/register?error=username_taken');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Generate streamer ID
    const streamerId = `streamer_${uuidv4().replace(/-/g, '')}`;
    
    // Create user
    const user = await req.databaseService.createUser({
      email,
      password: hashedPassword,
      username,
      wallet_address: walletAddress,
      streamer_id: streamerId
    });
    
    // Create streamer config
    await req.databaseService.createStreamerConfig(user.id, {
      streamer_id: streamerId,
      wallet_address: walletAddress || '',
      token_address: '',
      is_active: true
    });
    
    // Initialize default settings
    await initializeDefaultSettings(req.databaseService, streamerId);
    
    // Auto-login after registration
    req.logIn(user, (err) => {
      if (err) {
        console.error('Auto-login error:', err);
        return res.redirect('/auth/login?error=registration_success_login_required');
      }
      
      return res.redirect('/dashboard?welcome=true');
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.redirect('/auth/register?error=registration_failed');
  }
});

// Logout handler
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// Logout GET handler (for convenience)
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// Helper functions
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidWalletAddress(address) {
  // Basic Solana address validation
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
      minDonation: 0.01,
      cooldownSeconds: 30,
      maxMessageLength: 200,
      autoTTSEnabled: true,
      donationGateEnabled: true
    });
    
    // Initialize poll settings
    await databaseService.updatePollSettings(streamerId, {
      enabled: true,
      defaultDuration: 60,
      allowViewerPolls: false,
      requireDonation: false,
      minDonation: 0.01
    });
    
    // Initialize automod settings
    await databaseService.updateAutomodSettings(streamerId, {
      enabled: true,
      botWalletAddress: '',
      modPermissions: ['timeout', 'warn'],
      bannedWords: [],
      bannedUsers: [],
      timeoutDuration: 300,
      maxWarnings: 3,
      autoTimeout: true,
      autoBan: false
    });
    
    console.log(`✅ Default settings initialized for streamer ${streamerId}`);
  } catch (error) {
    console.error('Error initializing default settings:', error);
  }
}

module.exports = router;
