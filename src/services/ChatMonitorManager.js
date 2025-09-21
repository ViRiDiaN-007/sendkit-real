const SharedChatMonitor = require('./SharedChatMonitor');

class ChatMonitorManager {
  constructor() {
    this.monitors = new Map(); // streamerId -> SharedChatMonitor
    this.proxy = 'viridian007:FctXDTqOR43hyn7y@proxy.packetstream.io:31112';
  }

  async getOrCreateMonitor(streamerId, tokenAddress) {
    if (!this.monitors.has(streamerId)) {
      const monitor = new SharedChatMonitor(streamerId, tokenAddress, this.proxy);
      this.monitors.set(streamerId, monitor);
      
      // Add delay between connections to avoid rate limiting
      const existingMonitors = this.monitors.size - 1;
      const delay = existingMonitors * 2000; // 2 seconds between each connection
      
      if (delay > 0) {
        console.log(`⏳ Waiting ${delay}ms before connecting monitor for ${streamerId} (${existingMonitors} existing monitors)`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      monitor.connect();
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
}

module.exports = ChatMonitorManager;
