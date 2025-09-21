const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const flash = require('express-flash');
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
const ChatMonitorManager = require('./src/services/ChatMonitorManager');

class SendKitApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    
    this.port = process.env.PORT || 3000;
    this.baseUrl = process.env.BASE_URL || `http://localhost:${this.port}`;
    this.db = null;
    
    // Initialize services
    this.databaseService = new DatabaseService();
    this.chatMonitorManager = new ChatMonitorManager();
    this.ttsService = new TTSService();
    this.integratedTTSService = new IntegratedTTSService();
    this.pollService = new PollService();
    this.integratedPollService = new IntegratedPollService();
    this.automodService = new AutomodService();
    
    this.setupMiddleware();
    this.setupPassport();
    this.setupRoutes();
    this.setupSocketHandlers();
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
      
      // Set up automod service
      this.automodService.setSocketIO(this.io);
      await this.automodService.setDatabaseServiceAndLoadStreamers(this.databaseService, this.chatMonitorManager);
      
      // Set Socket.IO instance for IntegratedPollService
      this.integratedPollService.setSocketIO(this.io);
      
      // Load existing streamers and start their poll bots
      await this.integratedPollService.setDatabaseServiceAndLoadStreamers(this.databaseService, this.chatMonitorManager);
      
      // Load existing streamers and start their TTS services
      await this.integratedTTSService.setDatabaseServiceAndLoadStreamers(this.databaseService, this.chatMonitorManager);
      
      console.log('✅ All services initialized');
    } catch (error) {
      console.error('❌ Failed to initialize services:', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
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
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use('/api/', limiter);

    // CORS
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:3000",
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
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));

    // Passport middleware
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    
    // Flash messages
    this.app.use(flash());

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
      req.chatMonitorManager = this.chatMonitorManager;
      req.ttsService = this.ttsService;
      req.integratedTTSService = this.integratedTTSService;
      req.pollService = this.pollService;
      req.integratedPollService = this.integratedPollService;
      req.automodService = this.automodService;
      req.io = this.io;
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
          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const isValidPassword = await bcrypt.compare(password, user.password);
          if (!isValidPassword) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    ));

    // Serialize user for session
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.databaseService.findUserById(id);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        services: {
          database: this.databaseService.pool ? true : false,
          tts: this.integratedTTSService.isConnected(),
          poll: this.integratedPollService.isConnected(),
          automod: this.automodService.isConnected()
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

    // Global error handler for 429 errors
    process.on('uncaughtException', (error) => {
      if (error.message && error.message.includes('429')) {
        console.log(`🔍 [GLOBAL] 429 error detected:`, error.message);
        console.log(`🔍 [GLOBAL] Stack trace:`, error.stack);
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      if (reason && reason.message && reason.message.includes('429')) {
        console.log(`🔍 [GLOBAL] 429 rejection detected:`, reason.message);
        console.log(`🔍 [GLOBAL] Promise:`, promise);
      }
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      if (err.message && err.message.includes('429')) {
        console.log(`🔍 [EXPRESS] 429 error in route ${req.path}:`, err.message);
      }
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
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/auth/login');
  }

  async start() {
    try {
      await this.initialize();
      
      this.server.listen(this.port, () => {
        console.log(`🚀 SendKit Dashboard running on port ${this.port}`);
        console.log(`📱 Web interface: ${this.baseUrl}`);
        console.log(`🔗 API endpoint: ${this.baseUrl}/api`);
        console.log(`🎯 Browser sources: ${this.baseUrl}/browser-source/`);
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
