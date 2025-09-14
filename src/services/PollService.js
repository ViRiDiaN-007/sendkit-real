const axios = require('axios');
const WebSocket = require('ws');

class PollService {
  constructor() {
    this.serviceUrl = process.env.POLL_SERVICE_URL || 'http://localhost:4000';
    this.wsUrl = this.serviceUrl.replace('http', 'ws');
    this.isConnectedFlag = false;
    this.ws = null;
    this.subscribers = new Map(); // streamerId -> Set of callbacks
  }

  async initialize() {
    try {
      // Test connection to poll service
      const response = await axios.get(`${this.serviceUrl}/health`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        this.isConnectedFlag = true;
        console.log('✅ Poll Service connected');
        this.setupWebSocket();
      }
    } catch (error) {
      console.log('⚠️ Poll Service not available:', error.message);
      this.isConnectedFlag = false;
    }
  }

  setupWebSocket() {
    try {
      this.ws = new WebSocket(`${this.wsUrl}/overlay`);
      
      this.ws.on('open', () => {
        console.log('✅ Poll WebSocket connected');
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.broadcastToSubscribers(message);
        } catch (error) {
          console.error('Error parsing poll WebSocket message:', error);
        }
      });
      
      this.ws.on('close', () => {
        console.log('Poll WebSocket disconnected, attempting to reconnect...');
        setTimeout(() => this.setupWebSocket(), 5000);
      });
      
      this.ws.on('error', (error) => {
        console.error('Poll WebSocket error:', error);
      });
    } catch (error) {
      console.error('Failed to setup poll WebSocket:', error);
    }
  }

  subscribe(streamerId, callback) {
    if (!this.subscribers.has(streamerId)) {
      this.subscribers.set(streamerId, new Set());
    }
    this.subscribers.get(streamerId).add(callback);
  }

  unsubscribe(streamerId, callback) {
    if (this.subscribers.has(streamerId)) {
      this.subscribers.get(streamerId).delete(callback);
    }
  }

  broadcastToSubscribers(message) {
    this.subscribers.forEach((callbacks, streamerId) => {
      callbacks.forEach(callback => {
        try {
          callback(message);
        } catch (error) {
          console.error('Error in poll subscriber callback:', error);
        }
      });
    });
  }

  async createPoll(streamerId, pollData) {
    try {
      const { question, options, duration = 60 } = pollData;
      
      // Format options for the poll service
      const formattedOptions = {};
      Object.entries(options).forEach(([key, value], index) => {
        formattedOptions[index + 1] = value;
      });
      
      const response = await axios.post(`${this.serviceUrl}/api/poll/create`, {
        streamerId: streamerId,
        question: question,
        options: formattedOptions,
        duration: duration
      });
      
      return response.data;
    } catch (error) {
      console.error('Error creating poll:', error.message);
      throw new Error('Failed to create poll');
    }
  }

  async getActivePoll(streamerId) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/poll/${streamerId}/active`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return null; // No active poll
      }
      console.error('Error fetching active poll:', error.message);
      throw new Error('Failed to fetch active poll');
    }
  }

  async endPoll(streamerId, pollId) {
    try {
      const response = await axios.post(`${this.serviceUrl}/api/poll/${pollId}/end`);
      return response.data;
    } catch (error) {
      console.error('Error ending poll:', error.message);
      throw new Error('Failed to end poll');
    }
  }

  async getPollResults(streamerId, pollId) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/poll/${pollId}/results`);
      return response.data;
    } catch (error) {
      console.error('Error fetching poll results:', error.message);
      throw new Error('Failed to fetch poll results');
    }
  }

  async votePoll(streamerId, pollId, voterAddress, optionNumber) {
    try {
      const response = await axios.post(`${this.serviceUrl}/api/poll/${pollId}/vote`, {
        voterAddress: voterAddress,
        optionNumber: optionNumber
      });
      return response.data;
    } catch (error) {
      console.error('Error voting on poll:', error.message);
      throw new Error('Failed to vote on poll');
    }
  }

  async getPollSettings(streamerId) {
    try {
      const response = await axios.get(`${this.serviceUrl}/api/poll/${streamerId}/settings`);
      return response.data;
    } catch (error) {
      console.error('Error fetching poll settings:', error.message);
      return this.getDefaultSettings();
    }
  }

  async updatePollSettings(streamerId, settings) {
    try {
      const response = await axios.put(`${this.serviceUrl}/api/poll/${streamerId}/settings`, settings);
      return response.data;
    } catch (error) {
      console.error('Error updating poll settings:', error.message);
      throw new Error('Failed to update poll settings');
    }
  }

  async getBrowserSourceUrl(streamerId, baseUrl) {
    return `${baseUrl}/browser-source/poll/${streamerId}`;
  }

  async getPollStats(streamerId) {
    try {
      // This would fetch real stats from the database
      return {
        totalPolls: 0,
        activePolls: 0,
        completedPolls: 0,
        totalVotes: 0,
        averageVotesPerPoll: 0,
        mostPopularOption: null,
        recentPolls: []
      };
    } catch (error) {
      console.error('Error fetching poll stats:', error);
      return this.getDefaultStats();
    }
  }

  getDefaultStats() {
    return {
      totalPolls: 0,
      activePolls: 0,
      completedPolls: 0,
      totalVotes: 0,
      averageVotesPerPoll: 0,
      mostPopularOption: null,
      recentPolls: []
    };
  }

  getDefaultSettings() {
    return {
      enabled: true,
      defaultDuration: 60,
      allowViewerPolls: false,
      requireDonation: false,
      minDonation: 0.01,
      maxPollsPerHour: 10,
      cooldownBetweenPolls: 300
    };
  }

  // Validate poll data
  validatePollData(pollData) {
    const errors = [];
    
    if (!pollData.question || pollData.question.trim().length === 0) {
      errors.push('Question is required');
    }
    
    if (pollData.question && pollData.question.length > 200) {
      errors.push('Question must be 200 characters or less');
    }
    
    if (!pollData.options || Object.keys(pollData.options).length < 2) {
      errors.push('At least 2 options are required');
    }
    
    if (pollData.options && Object.keys(pollData.options).length > 10) {
      errors.push('Maximum 10 options allowed');
    }
    
    if (pollData.duration && (pollData.duration < 10 || pollData.duration > 300)) {
      errors.push('Duration must be between 10 and 300 seconds');
    }
    
    // Validate option text
    if (pollData.options) {
      Object.entries(pollData.options).forEach(([key, value]) => {
        if (!value || value.trim().length === 0) {
          errors.push(`Option ${key} cannot be empty`);
        }
        if (value && value.length > 100) {
          errors.push(`Option ${key} must be 100 characters or less`);
        }
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // Format poll for display
  formatPollForDisplay(poll) {
    if (!poll) return null;
    
    const options = poll.options || {};
    const formattedOptions = Object.entries(options).map(([key, value]) => ({
      number: parseInt(key),
      text: value,
      votes: poll.votes ? poll.votes[key] || 0 : 0
    }));
    
    return {
      id: poll.id,
      question: poll.question,
      options: formattedOptions,
      duration: poll.duration,
      status: poll.status,
      createdAt: poll.createdAt,
      endsAt: poll.endsAt,
      totalVotes: poll.totalVotes || 0
    };
  }

  isConnected() {
    return this.isConnectedFlag && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribers.clear();
  }
}

module.exports = PollService;
