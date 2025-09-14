# SendKit

Professional streaming tools for content creators to manage TTS (Text-to-Speech), interactive polls, and automod features. This dashboard provides seamless integration with OBS through browser sources and connects to your existing TTS and poll services.

## 🚀 Features

### 🎤 Text-to-Speech (TTS)
- **Voice Configuration**: Customize voice, rate, volume, and pitch settings
- **Donation-Gated TTS**: Set minimum donation amounts for TTS requests
- **Real-time Audio**: Generate and play TTS audio in real-time
- **OBS Integration**: Browser source for seamless stream overlay
- **Queue Management**: Track and manage TTS request queue
- **Auto-TTS**: Automatic TTS for verified donations

### 📊 Interactive Polls
- **Live Poll Creation**: Create polls with custom questions and options
- **Real-time Voting**: Viewers can vote and see live results
- **Beautiful Overlays**: Stunning poll displays for OBS
- **Customizable Duration**: Set poll duration from 10 seconds to 5 minutes
- **Results Tracking**: View poll results and statistics
- **Multiple Options**: Support for up to 10 poll options

### 🛡️ Automod
- **Bot Promotion**: Promote your bot to mod status
- **Word Filtering**: Custom banned words list
- **User Management**: Ban/unban users
- **Auto-Moderation**: Automatic timeout and ban actions
- **Permission Control**: Configure mod permissions
- **Statistics**: Track moderation actions and effectiveness

### 🎯 OBS Integration
- **Browser Sources**: Individual URLs for each streamer
- **Real-time Updates**: Live updates via WebSocket
- **Customizable Overlays**: Beautiful, responsive designs
- **Easy Setup**: Simple copy-paste URLs into OBS

## 🛠️ Installation

### Prerequisites
- Node.js 16+ 
- npm or yarn
- SQLite3
- Access to your existing TTS and poll services

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd pump_website
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   PORT=3000
   NODE_ENV=development
   DB_PATH=./database/streamers.db
   SESSION_SECRET=your-super-secret-session-key-here
   TTS_SERVICE_URL=http://localhost:3001
   POLL_SERVICE_URL=http://localhost:4000
   CORS_ORIGIN=http://localhost:3000
   ```

4. **Build CSS**
   ```bash
   npm run build:css
   ```

5. **Start the application**
   ```bash
   npm start
   ```

   For development:
   ```bash
   npm run dev
   ```

## 📁 Project Structure

```
pump_website/
├── src/
│   ├── css/
│   │   └── input.css          # Tailwind CSS source
│   ├── routes/
│   │   ├── auth.js            # Authentication routes
│   │   ├── dashboard.js       # Dashboard routes
│   │   ├── tts.js            # TTS management routes
│   │   ├── poll.js           # Poll management routes
│   │   ├── automod.js        # Automod routes
│   │   └── api.js            # API endpoints
│   └── services/
│       ├── DatabaseService.js # Database operations
│       ├── TTSService.js     # TTS service integration
│       ├── PollService.js    # Poll service integration
│       └── AutomodService.js # Automod functionality
├── views/
│   ├── layout.ejs            # Main layout template
│   ├── index.ejs             # Home page
│   ├── auth/
│   │   ├── login.ejs         # Login page
│   │   └── register.ejs      # Registration page
│   ├── dashboard/
│   │   └── index.ejs         # Dashboard page
│   └── browser-sources/
│       ├── tts.ejs           # TTS browser source
│       └── poll.ejs          # Poll browser source
├── public/
│   ├── css/
│   │   └── style.css         # Compiled CSS
│   ├── js/                   # Client-side JavaScript
│   └── images/               # Static images
├── database/                 # SQLite database files
├── server.js                 # Main application file
├── package.json
└── tailwind.config.js
```

## 🔧 Configuration

### TTS Service Integration
The dashboard connects to your existing TTS service. Update the `TTS_SERVICE_URL` in your `.env` file to point to your TTS service endpoint.

### Poll Service Integration
Connect to your poll service by setting the `POLL_SERVICE_URL` in your `.env` file.

### Database
The application uses SQLite for data persistence. The database file will be created automatically at the path specified in `DB_PATH`.

## 🎮 Usage

### For Streamers

1. **Register/Login**: Create an account or sign in
2. **Add Streamer**: Connect your pump.fun wallet address
3. **Configure Settings**: Set up TTS, poll, and automod preferences
4. **Get Browser Sources**: Copy the provided URLs for OBS
5. **Start Streaming**: Add browser sources to OBS and start engaging your audience

### Browser Sources for OBS

Each streamer gets unique browser source URLs:
- **TTS Source**: `http://localhost:3000/browser-source/tts/{streamerId}`
- **Poll Source**: `http://localhost:3000/browser-source/poll/{streamerId}`

### API Endpoints

The application provides RESTful API endpoints for integration:

- `GET /api/health` - Service health check
- `GET /api/streamers` - Get user's streamers
- `POST /api/tts/{streamerId}/test` - Test TTS
- `POST /api/poll/{streamerId}/create` - Create poll
- `POST /api/poll/{streamerId}/vote` - Vote on poll
- `GET /api/browser-source/tts/{streamerId}/data` - TTS data for browser source
- `GET /api/browser-source/poll/{streamerId}/data` - Poll data for browser source

## 🔌 Service Integration

### TTS Service
The dashboard integrates with your existing TTS service by making HTTP requests to:
- `GET /api/streamer/{streamerId}` - Get TTS settings
- `PUT /api/streamer/{streamerId}` - Update TTS settings
- `POST /api/tts/test` - Test TTS
- `POST /api/tts` - Submit TTS request

### Poll Service
Poll functionality connects to your poll service:
- `GET /api/poll/{streamerId}/active` - Get active poll
- `POST /api/poll/create` - Create new poll
- `POST /api/poll/{pollId}/vote` - Vote on poll
- `POST /api/poll/{pollId}/end` - End poll

## 🎨 Customization

### Styling
The application uses Tailwind CSS with a custom pump.fun theme. Modify `src/css/input.css` and rebuild with:
```bash
npm run build:css
```

### Branding
Update the logo, colors, and branding in:
- `views/layout.ejs` - Main layout
- `tailwind.config.js` - Color scheme
- `public/images/` - Logo and assets

## 🚀 Deployment

### Quick Start

1. **Configure Environment**
   ```bash
   cp env.production.example .env.production
   # Edit .env.production with your domain and settings
   ```

2. **Deploy with Docker** (Recommended)
   ```bash
   # Update docker-compose.yml with your domain
   docker-compose up -d
   ```

3. **Deploy with PM2**
   ```bash
   # Update ecosystem.config.js with your domain
   pm2 start ecosystem.config.js --env production
   ```

### Browser Source URLs

After deployment, your browser source URLs will be:
- **TTS**: `https://yourdomain.com/browser-source/tts/{streamerId}`
- **Poll**: `https://yourdomain.com/browser-source/poll/{streamerId}`

### Full Deployment Guide

For detailed deployment instructions including Nginx configuration, SSL setup, and production optimization, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 🔒 Security

- **Session Management**: Secure session handling with configurable secrets
- **Input Validation**: Comprehensive input validation and sanitization
- **Rate Limiting**: API rate limiting to prevent abuse
- **CORS Protection**: Configurable CORS settings
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Content Security Policy headers

## 📊 Monitoring

### Health Checks
- `GET /health` - Application health status
- Service connectivity monitoring
- Database connection status

### Logging
- Structured logging for debugging
- Error tracking and reporting
- Performance monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs and feature requests via GitHub issues
- **Discord**: Join our Discord community for support
- **Email**: Contact support@pump.fun

## 🔄 Updates

### Version 1.0.0
- Initial release
- TTS management
- Poll system
- Automod features
- OBS integration
- User authentication
- Dashboard interface

---

**Built with ❤️ for the pump.fun streaming community**
