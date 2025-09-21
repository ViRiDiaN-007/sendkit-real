const PumpChatClient = require('../lib/viri-pump-client.js').PumpChatClient;
const EventEmitter = require('events');

class SharedChatMonitor extends EventEmitter {
  constructor(streamerId, tokenAddress, proxy = null) {
    super();
    this.streamerId = streamerId;
    this.tokenAddress = tokenAddress;
    this.proxy = proxy;
    this.client = null;
    this.isConnected = false;
    this.subscribers = new Set(); // Track which services are subscribed
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  async connect() {
    try {
      // Create pump chat client with proxy support
      this.client = new PumpChatClient({
        roomId: this.tokenAddress,
        username: `monitor_${this.streamerId}`,
        messageHistoryLimit: 50,
        proxy: this.proxy
      });

      // Set up event handlers
      this.client.on('message', (message) => {
        this.emit('message', message);
      });

      this.client.on('connected', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log(`🎤 Shared chat monitor connected for streamer ${this.streamerId}`);
        this.emit('connected');
      });

      this.client.on('disconnected', () => {
        this.isConnected = false;
        console.log(`🔌 Shared chat monitor disconnected for streamer ${this.streamerId}`);
        this.emit('disconnected');
        this.attemptReconnect();
      });

      this.client.on('error', (error) => {
        console.error(`❌ Shared chat monitor error for ${this.streamerId}:`, error);
        this.emit('error', error);
        this.attemptReconnect();
      });

      // Connect with proxy
      console.log(`🔗 Creating shared chat monitor for ${this.streamerId} with proxy: ${this.proxy ? 'YES' : 'NO'}`);
      this.client.connect();
      
    } catch (error) {
      console.error(`❌ Failed to create shared chat monitor for ${this.streamerId}:`, error);
      this.emit('error', error);
    }
  }

  subscribe(serviceName) {
    this.subscribers.add(serviceName);
    console.log(`📝 ${serviceName} subscribed to shared chat monitor for ${this.streamerId}`);
  }

  unsubscribe(serviceName) {
    this.subscribers.delete(serviceName);
    console.log(`📝 ${serviceName} unsubscribed from shared chat monitor for ${this.streamerId}`);
    
    // If no subscribers, disconnect
    if (this.subscribers.size === 0) {
      this.disconnect();
    }
  }

  async attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      // Much longer delays to avoid rate limiting
      const delay = Math.min(this.reconnectDelay * Math.pow(3, this.reconnectAttempts - 1), 120000); // Max 2 minutes
      
      console.log(`🔄 Attempting to reconnect shared chat monitor for ${this.streamerId} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`❌ Max reconnection attempts reached for shared chat monitor ${this.streamerId}`);
      this.emit('maxReconnectAttemptsReached');
    }
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.isConnected = false;
    console.log(`🔌 Shared chat monitor disconnected for streamer ${this.streamerId}`);
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      subscribers: Array.from(this.subscribers),
      streamerId: this.streamerId
    };
  }
}

module.exports = SharedChatMonitor;
