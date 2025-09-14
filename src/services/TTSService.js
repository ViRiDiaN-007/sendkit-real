const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class TTSService {
  constructor() {
    this.serviceUrl = process.env.TTS_SERVICE_URL || 'http://localhost:3001';
    this.apiKey = process.env.TTS_API_KEY || '';
    this.isConnectedFlag = false;
  }

  async initialize() {
    try {
      // Test connection to TTS service
      const response = await axios.get(`${this.serviceUrl}/health`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        this.isConnectedFlag = true;
        console.log('✅ TTS Service connected');
      }
    } catch (error) {
      console.log('⚠️ TTS Service not available:', error.message);
      this.isConnectedFlag = false;
    }
  }

  async getStreamerTTSSettings(streamerId) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/streamer/${streamerId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching TTS settings:', error.message);
      return this.getDefaultSettings();
    }
  }

  async updateStreamerTTSSettings(streamerId, settings) {
    try {
      const response = await axios.put(`${this.serviceUrl}/api/streamer/${streamerId}`, {
        settings: settings
      }, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error updating TTS settings:', error.message);
      throw new Error('Failed to update TTS settings');
    }
  }

  async testTTS(streamerId, message, settings = {}) {
    try {
      const response = await axios.post(`${this.serviceUrl}/api/tts/test`, {
        message: message,
        voice: settings.voice || 'en-US-Standard-A',
        rate: settings.rate || 1.0,
        volume: settings.volume || 1.0
      }, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error testing TTS:', error.message);
      throw new Error('Failed to test TTS');
    }
  }

  async submitTTSRequest(streamerId, requestData) {
    try {
      const response = await axios.post(`${this.serviceUrl}/api/tts`, {
        message: requestData.message,
        transactionHash: requestData.transactionHash,
        walletAddress: requestData.walletAddress,
        streamerAddress: streamerId,
        isAutoTTS: requestData.isAutoTTS || false
      }, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error submitting TTS request:', error.message);
      throw new Error('Failed to submit TTS request');
    }
  }

  async getTTSStats(streamerId) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/stats`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching TTS stats:', error.message);
      return { queueLength: 0, processedToday: 0, errors: 0 };
    }
  }

  async getRecentMessages(streamerId, limit = 20) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/messages/${streamerId}?limit=${limit}`, {
        headers: this.getHeaders()
      });
      return response.data.messages || [];
    } catch (error) {
      console.error('Error fetching recent messages:', error.message);
      return [];
    }
  }

  async registerStreamer(streamerId, config) {
    try {
      const response = await axios.post(`${this.serviceUrl}/api/streamer/register`, {
        streamerId: streamerId,
        config: config
      }, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error registering streamer:', error.message);
      throw new Error('Failed to register streamer with TTS service');
    }
  }

  async getBrowserSourceUrl(streamerId, baseUrl) {
    return `${baseUrl}/browser-source/tts/${streamerId}`;
  }

  getDefaultSettings() {
    return {
      voice: 'en-US-Standard-A',
      rate: 1.0,
      volume: 1.0,
      pitch: 1.0,
      enabled: true,
      min_donation: 0.01,
      cooldown_seconds: 30,
      max_message_length: 200,
      auto_tts_enabled: true,
      donation_gate_enabled: true
    };
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  isConnected() {
    return this.isConnectedFlag;
  }

  // Format TTS message with donation info
  formatTTSMessage(walletAddress, amount, message) {
    if (amount === 0) {
      return message;
    }
    
    // Extract username from wallet address (first 4 characters)
    let username = walletAddress;
    if (walletAddress && walletAddress.length > 4) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
        username = walletAddress.substring(0, 4);
      }
    }
    
    const formattedAmount = amount > 0 ? `${amount} SOL` : 'unknown amount';
    return `${username} donated ${formattedAmount}. ${message}`;
  }

  // Validate TTS settings
  validateSettings(settings) {
    const errors = [];
    
    if (settings.rate && (settings.rate < 0.1 || settings.rate > 3.0)) {
      errors.push('Rate must be between 0.1 and 3.0');
    }
    
    if (settings.volume && (settings.volume < 0.1 || settings.volume > 2.0)) {
      errors.push('Volume must be between 0.1 and 2.0');
    }
    
    if (settings.pitch && (settings.pitch < 0.1 || settings.pitch > 3.0)) {
      errors.push('Pitch must be between 0.1 and 3.0');
    }
    
    if (settings.min_donation && settings.min_donation < 0) {
      errors.push('Minimum donation must be positive');
    }
    
    if (settings.cooldown_seconds && (settings.cooldown_seconds < 0 || settings.cooldown_seconds > 3600)) {
      errors.push('Cooldown must be between 0 and 3600 seconds');
    }
    
    if (settings.max_message_length && (settings.max_message_length < 10 || settings.max_message_length > 500)) {
      errors.push('Max message length must be between 10 and 500 characters');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }
}

module.exports = TTSService;
