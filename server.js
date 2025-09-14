const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import routes
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const ttsRoutes = require('./src/routes/tts');
const pollRoutes = require('./src/routes/poll');
const automodRoutes = require('./src/routes/automod');
const apiRoutes = require('./src/routes/api');

// Import services
const DatabaseService = require('./src/services/DatabaseService');
const TTSService = require('./src/services/TTSService');
const IntegratedTTSService = require('./src/services/IntegratedTTSService');
const PollService = require('./src/services/PollService');
const IntegratedPollService = require('./src/services/IntegratedPollService');
const AutomodService = require('./src/services/AutomodService');

class SendKitApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.CORS_ORIGIN || 'https://sendkit.fun',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.port = process.env.PORT || 3000;
    this.db = null;

    // Initialize services
    this.databaseService = new DatabaseService();
    this.ttsService = new TTSService();
    this.integratedTTSService = new IntegratedTTSService();
    this.pollService = new PollService();
    this.integratedPollService = new IntegratedPollService();
    this.automodService = new AutomodService();

    this.setupMiddleware();
    this.setupPassport();
    this.setupGlobals();     // <- add locals like baseUrl/services/welcome
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  // Prefer env BASE_URL; otherwise derive from headers (works behind proxy)
  computeBaseUrl(req) {
    if (process.env.BASE_URL && process.env.BASE_URL.trim()) return process.env.BASE_URL.trim();

    const proto =
      (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'].split(',')[0]) ||
      req.protocol ||
      'https';

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    return `${proto}://${host}`;
  }

  async initialize() {
    try {
      // Initialize database
      await this.databaseService.initialize();
      console.log('✅ Database initialized');

      // Initialize other services
      await this.ttsService.initialize();
      await this.integratedTTSService.initialize(this.databaseService, this.io);
      await this.pollService.initialize();
      await this.integratedPollService.initialize();
      await this.automodService.initialize();

      // Set Socket.IO instance for IntegratedPollService
      this.integratedPollService.setSocketIO(this.io);

      // Load existing streamers and start their poll bots
      await this.integratedPollService.setDatabaseServiceAndLoadStreamers(this.databaseService);

      // Load existing streamers and start their TTS services
      await this.integratedTTSService.setDatabaseServiceAndLoadStreamers(this.databaseService);

      console.log('✅ All services initialized');
    } catch (error) {
      console.error('❌ Failed to initialize services:', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // We’re probably behind Nginx — trust proxy so rate-limit doesn’t complain
    this.app.set('trust proxy', 1);

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // CORS
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || 'https://sendkit.fun',
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Session configuration
    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'your-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
      }
    }));

    // Passport middleware
    this.app.use(passport.initialize());
    this.app.use(passport.session());

    // Static files
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.use('/css', express.static(path.join(__dirname, 'public/css')));
    this.app.use('/js', express.static(path.join(__dirname, 'public/js')));
    this.app.use('/images', express.static(path.join(__dirname, 'public/images')));

    // View engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));

    // Make services available to routes
    this.app.use((req, res, next) => {
      req.databaseService = this.databaseService;
      req.ttsService = this.ttsService;
      req.integratedTTSService = this.integratedTTSService;
      req.pollService = this.pollService;
      req.integratedPollService = this.integratedPollService;
      req.automodService = this.automodService;
      req.io = this.io;
      next();
    });

    // Safety net: ensure POSTs to /dashboard carry user_id for DB writes
    this.app.use((req, res, next) => {
      if (req.method === 'POST' && req.path.startsWith('/dashboard')) {
        if (!('user_id' in req.body) && req.user && req.user.id) {
          req.body.user_id = req.user.id;
        }
      }
      next();
    });
  }

  setupPassport() {
    // Local strategy for authentication
    passport.use(new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {
          const user = await this.databaseService.findUserByEmail(email);
          if (!user) return done(null, false, { message: 'Invalid email or password' });

          const isValidPassword = await bcrypt.compare(password, user.password);
          if (!isValidPassword) return done(null, false, { message: 'Invalid email or password' });

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    ));

    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.databaseService.findUserById(id);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });
  }

  // Provide safe defaults to every EJS template
  setupGlobals() {
    this.app.use((req, res, next) => {
      // Base URL for templates like add-streamer.ejs
      res.locals.baseUrl = process.env.BASE_URL && process.env.BASE_URL.trim()
        ? process.env.BASE_URL.trim()
        : this.computeBaseUrl(req);

      // Service “online/offline” indicators (never undefined)
      const ttsUp = typeof this.integratedTTSService?.isConnected === 'function'
        ? this.integratedTTSService.isConnected()
        : true;
      const pollUp = typeof this.integratedPollService?.isConnected === 'function'
        ? this.integratedPollService.isConnected()
        : true;
      const automodUp = typeof this.automodService?.isConnected === 'function'
        ? this.automodService.isConnected()
        : true;

      res.locals.services = {
        tts: !!ttsUp,
        poll: !!pollUp,
        automod: !!automodUp
      };

      // Commonly used locals
      res.locals.user = req.user || null;
      res.locals.welcome = false;

      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: !!this.databaseService.pool,
          tts: typeof this.integratedTTSService?.isConnected === 'function' ? this.integratedTTSService.isConnected() : true,
          poll: typeof this.integratedPollService?.isConnected === 'function' ? this.integratedPollService.isConnected() : true,
          automod: typeof this.automodService?.isConnected === 'function' ? this.automodService.isConnected() : true
        }
      });
    });

    // Home page
    this.app.get('/', (req, res) => {
      if (req.isAuthenticated()) {
        res.redirect('/dashboard');
      } else {
        res.render('index', {
          title: 'SendKit Dashboard',
          user: req.user
        });
      }
    });

    // Auth routes
    this.app.use('/auth', authRoutes);

    // Protected routes
    this.app.use('/dashboard', this.requireAuth, dashboardRoutes);
    this.app.use('/tts', this.requireAuth, ttsRoutes);
    this.app.use('/poll', this.requireAuth, pollRoutes);
    this.app.use('/integrated-poll', this.requireAuth, require('./src/routes/integrated-poll'));
    this.app.use('/automod', this.requireAuth, automodRoutes);
    this.app.use('/api', this.requireAuth, apiRoutes);

    // Browser source routes (public)
    this.app.get('/browser-source/tts/:streamerId', (req, res) => {
      res.render('browser-sources/tts', {
        streamerId: req.params.streamerId,
        title: 'TTS Browser Source'
      });
    });

    this.app.get('/browser-source/poll/:streamerId', (req, res) => {
      res.render('browser-sources/poll', {
        streamerId: req.params.streamerId,
        title: 'Poll Browser Source'
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        user: req.user
      });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'An unexpected error occurred.',
        user: req.user
      });
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('join-streamer', (streamerId) => {
        socket.join(`streamer-${streamerId}`);
        console.log(`Client ${socket.id} joined streamer ${streamerId}`);
      });

      socket.on('request-tts-stats', async (streamerId) => {
        try {
          const stats = await this.integratedTTSService.getTTSStats(streamerId);
          socket.emit('tts-stats', stats);
        } catch (error) {
          console.error('Error fetching TTS stats:', error);
        }
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }

  // Middleware to require authentication
  requireAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/auth/login');
  }

  async start() {
    try {
      await this.initialize();

      const shownBase =
        (process.env.BASE_URL && process.env.BASE_URL.trim()) ||
        `http://localhost:${this.port}`;

      this.server.listen(this.port, () => {
        console.log(`🚀 SendKit Dashboard running on port ${this.port}`);
        console.log(`📱 Web interface: ${shownBase}`);
        console.log(`🔗 API endpoint: ${shownBase}/api`);
        console.log(`🎯 Browser sources: ${shownBase}/browser-source/`);
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the application
const app = new SendKitApp();
app.start();

module.exports = SendKitApp;
