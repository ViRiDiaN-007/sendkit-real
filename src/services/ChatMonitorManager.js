const SharedChatMonitor = require('./SharedChatMonitor');

class ChatMonitorManager {
  constructor() {
    this.monitors = new Map(); // streamerId -> SharedChatMonitor
  }

  async getOrCreateMonitor(streamerId, tokenAddress) {
    if (!this.monitors.has(streamerId)) {
      console.log(`🔍 [CHAT MONITOR] Creating new monitor for streamer ${streamerId}`);
      const monitor = new SharedChatMonitor(streamerId, tokenAddress);
      this.monitors.set(streamerId, monitor);
      
      // Add delay between connections to avoid rate limiting
      const existingMonitors = this.monitors.size - 1;
      const delay = existingMonitors * 2000; // 2 seconds between each connection
      
      if (delay > 0) {
        console.log(`⏳ Waiting ${delay}ms before connecting monitor for ${streamerId} (${existingMonitors} existing monitors)`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      monitor.connect();
    } else {
      const existingMonitor = this.monitors.get(streamerId);
      if (existingMonitor && !existingMonitor.isConnected) {
        console.log(`🔍 [CHAT MONITOR] Existing monitor found but disconnected for ${streamerId}, reconnecting...`);
        existingMonitor.connect();
      } else {
        console.log(`🔍 [CHAT MONITOR] Reusing existing active monitor for ${streamerId}`);
      }
    }
    return this.monitors.get(streamerId);
  }

  async subscribe(streamerId, tokenAddress, serviceName, messageHandler) {
    const monitor = await this.getOrCreateMonitor(streamerId, tokenAddress);
    
    // Check if service is already subscribed
    if (monitor.subscribers.has(serviceName)) {
      console.log(`⚠️ ${serviceName} already subscribed to shared chat monitor for ${streamerId}`);
      return monitor;
    }
    
    monitor.subscribe(serviceName);
    
    // Set up message handler for this service (only if not already set up)
    if (!monitor._messageHandlers) {
      monitor._messageHandlers = new Map();
    }
    
    if (!monitor._messageHandlers.has(serviceName)) {
      monitor._messageHandlers.set(serviceName, messageHandler);
      
      // Only add the message listener once
      if (!monitor._messageListenerAdded) {
        monitor.on('message', (message) => {
          // Broadcast to all subscribed services
          for (const [service, handler] of monitor._messageHandlers) {
            try {
              handler(message);
            } catch (error) {
              console.error(`❌ Error in ${service} message handler:`, error);
            }
          }
        });
        monitor._messageListenerAdded = true;
      }
    }

    console.log(`📝 ${serviceName} subscribed to shared chat monitor for ${streamerId}`);
    return monitor;
  }

  unsubscribe(streamerId, serviceName) {
    const monitor = this.monitors.get(streamerId);
    if (monitor) {
      monitor.unsubscribe(serviceName);
    }
  }

  disconnect(streamerId) {
    const monitor = this.monitors.get(streamerId);
    if (monitor) {
      monitor.disconnect();
      this.monitors.delete(streamerId);
    }
  }

  getStatus() {
    const status = {};
    for (const [streamerId, monitor] of this.monitors) {
      status[streamerId] = monitor.getConnectionStatus();
    }
    return status;
  }

  getAllMonitors() {
    return this.monitors;
  }

  // Method to ensure only one active connection per streamer
  ensureSingleConnection(streamerId) {
    const monitor = this.monitors.get(streamerId);
    if (monitor && !monitor.isConnected) {
      console.log(`🔍 [CHAT MONITOR] Ensuring single connection for ${streamerId}`);
      monitor.connect();
    }
    return monitor;
  }

  // Get all connection statuses for debugging
  getAllConnectionStatuses() {
    const statuses = {};
    for (const [streamerId, monitor] of this.monitors) {
      statuses[streamerId] = monitor.getConnectionStatus();
    }
    return statuses;
  }
}

module.exports = ChatMonitorManager;
