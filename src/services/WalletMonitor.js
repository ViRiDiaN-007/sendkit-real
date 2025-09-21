const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');

class WalletMonitor extends EventEmitter {
  constructor() {
    super();
    
    // Use multiple RPC endpoints for better reliability
    this.rpcEndpoints = [
      'https://mainnet.helius-rpc.com/?api-key=1c17dfcf-e870-42b1-af2c-b834175b0adc',
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com'
    ];
    this.currentRpcIndex = 0;
    this.connection = new Connection(
      this.rpcEndpoints[this.currentRpcIndex],
      'confirmed'
    );
    
    this.monitoredWallets = new Map();
    this.monitoringInterval = null;
    this.checkInterval = 15000; // Check every 15 seconds per wallet
    this.requestDelay = 3000; // 3 seconds between requests
    this.lastRequestTime = 0;
  }

  // Start monitoring a wallet for incoming SOL donations
  startMonitoring(walletAddress, streamerAddress) {
    // Validate wallet address format
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < 32) {
      console.error(`❌ Invalid wallet address format: ${walletAddress}`);
      return;
    }

    // Check if already monitoring this wallet
    if (this.monitoredWallets.has(walletAddress)) {
      return;
    }

    console.log(`🔍 Starting wallet monitoring for: ${walletAddress}`);
    console.log(`   Streamer: ${streamerAddress}`);
    
    // Initialize with current time to only process new transactions
    const startTime = Date.now();
    
    this.monitoredWallets.set(walletAddress, {
      streamerAddress: streamerAddress,
      lastSignature: null,
      isMonitoring: true,
      startTime: startTime
    });

    // Start the monitoring loop if not already running
    if (!this.monitoringInterval) {
      this.startMonitoringLoop();
    }
  }

  // Stop monitoring a specific wallet
  stopMonitoring(walletAddress) {
    if (this.monitoredWallets.has(walletAddress)) {
      this.monitoredWallets.delete(walletAddress);
      console.log(`⏹️ Stopped monitoring wallet: ${walletAddress}`);
    }
    
    // Stop monitoring loop if no wallets left
    if (this.monitoredWallets.size === 0 && this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('⏹️ Wallet monitoring stopped - no wallets to monitor');
    }
  }

  // Start the monitoring loop
  startMonitoringLoop() {
    if (this.monitoringInterval) {
      console.log('⚠️ [WALLET MONITOR] Monitoring loop already running');
      return; // Already running
    }

    console.log(`🔄 [WALLET MONITOR] Starting wallet monitoring loop (checking every ${this.checkInterval}ms)...`);
    this.monitoringInterval = setInterval(async () => {
      await this.checkForNewTransactions();
    }, this.checkInterval);
    console.log(`✅ [WALLET MONITOR] Monitoring loop started with interval ${this.checkInterval}ms`);
  }

  // Check for new transactions on all monitored wallets
  async checkForNewTransactions() {
    for (const [walletAddress, walletData] of this.monitoredWallets.entries()) {
      if (!walletData.isMonitoring) {
        continue;
      }

      // Check if this wallet is in retry backoff
      if (walletData.nextRetryTime && Date.now() < walletData.nextRetryTime) {
        continue;
      }
      
      // Add delay between requests to avoid rate limiting
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        const delayNeeded = this.requestDelay - timeSinceLastRequest;
        console.log(`⏳ [WALLET MONITOR] Waiting ${delayNeeded}ms before next request to avoid rate limiting`);
        await new Promise(resolve => setTimeout(resolve, delayNeeded));
      }
      
      try {
        await this.checkWalletTransactions(walletAddress, walletData);
        this.lastRequestTime = Date.now();
      } catch (error) {
        console.error(`❌ [WALLET MONITOR] Error checking wallet ${walletAddress}:`, error);
      }
    }
  }

  // Switch to next RPC endpoint
  switchToNextRpc() {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcEndpoints.length;
    this.connection = new Connection(
      this.rpcEndpoints[this.currentRpcIndex],
      'confirmed'
    );
    console.log(`🔄 [WALLET MONITOR] Switched to RPC endpoint: ${this.rpcEndpoints[this.currentRpcIndex]}`);
  }

  // Check transactions for a specific wallet
  async checkWalletTransactions(walletAddress, walletData) {
    try {
      
      // Validate wallet address format
      if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < 32) {
        console.error(`❌ Invalid wallet address format: ${walletAddress}`);
        return;
      }

      const publicKey = new PublicKey(walletAddress);
      
      // Get only the most recent signature to check for new transactions
      const signatures = await this.connection.getSignaturesForAddress(publicKey, {
        limit: 1, // Only get the most recent signature
        commitment: 'confirmed'
      });

      if (signatures.length === 0) {
        return;
      }

      const latestSignature = signatures[0].signature;
      
      // If we don't have a last signature yet, just store this one and wait for next check
      if (!walletData.lastSignature) {
        walletData.lastSignature = latestSignature;
        return;
      }

      // If the latest signature is the same as our last one, no new transactions
      if (latestSignature === walletData.lastSignature) {
        return;
      }

      // We have a new transaction! Check if it's recent enough before processing
      const transactionTime = signatures[0].blockTime ? signatures[0].blockTime * 1000 : Date.now();
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // Only process transactions from the last 5 minutes
      
      console.log(`🆕 [WALLET MONITOR] New transaction detected for ${walletAddress}: ${latestSignature}`);
      console.log(`🕐 [WALLET MONITOR] Transaction time: ${new Date(transactionTime).toISOString()}, Age: ${Math.round((now - transactionTime) / 1000)}s`);
      
      // Only process very recent transactions to avoid storage issues
      if (transactionTime >= walletData.startTime && (now - transactionTime) <= maxAge) {
        console.log(`✅ [WALLET MONITOR] Transaction is recent enough, processing...`);
        await this.processTransaction(latestSignature, walletAddress, walletAddress);
      } else {
        console.log(`⏰ [WALLET MONITOR] Transaction too old (${Math.round((now - transactionTime) / 1000)}s), skipping to avoid storage issues...`);
      }

      // Update our last signature
      walletData.lastSignature = latestSignature;
      console.log(`🔍 [WALLET MONITOR] Updated last signature for ${walletAddress}: ${latestSignature}`);

    } catch (error) {
      // Handle connection errors by switching RPC endpoints
      if (error.message && (
        error.message.includes('ENOTFOUND') || 
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('timeout') ||
        error.message.includes('fetch failed')
      )) {
        console.log(`⚠️ Connection error for wallet ${walletAddress}, switching RPC endpoint`);
        this.switchToNextRpc();
        return;
      }
      
      // Handle rate limiting gracefully with exponential backoff
      if (error.message && error.message.includes('429')) {
        console.log(`⚠️ [WALLET MONITOR] Rate limited for wallet ${walletAddress}, will retry later`);
        console.log(`🔍 [WALLET MONITOR] Error details:`, error.message);
        
        // Implement exponential backoff
        walletData.retryCount = (walletData.retryCount || 0) + 1;
        const backoffDelay = Math.min(300000, 30000 * Math.pow(2, walletData.retryCount - 1)); // Max 5 minutes
        walletData.nextRetryTime = Date.now() + backoffDelay;
        
        console.log(`⏰ [WALLET MONITOR] Backing off for ${backoffDelay}ms (attempt ${walletData.retryCount})`);
        return;
      }
      
      // Handle RPC storage errors with exponential backoff
      if (error.code === -32019 || (error.message && error.message.includes('Failed to query long-term storage'))) {
        console.log(`⚠️ RPC storage error for wallet ${walletAddress}, switching RPC endpoint`);
        this.switchToNextRpc();
        return;
      }
      
      // Reset retry count on successful operations
      walletData.retryCount = 0;
      walletData.nextRetryTime = null;
      
      console.error(`Error checking transactions for ${walletAddress}:`, error);
    }
  }

  // Process a transaction to check for SOL donations
  async processTransaction(signature, walletAddress, streamerAddress) {
    try {
      console.log(`🔍 [WALLET MONITOR] Processing transaction ${signature} for wallet ${walletAddress} (streamer: ${streamerAddress})`);
      
      // Get transaction details with timeout and error handling
      const transaction = await Promise.race([
        this.connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction fetch timeout')), 10000)
        )
      ]);

      if (!transaction) {
        console.log(`❌ [WALLET MONITOR] Transaction not found for signature: ${signature}`);
        return;
      }

      console.log(`📋 [WALLET MONITOR] Transaction found, analyzing...`);
      const accountKeys = transaction.transaction.message.accountKeys;
      const instructions = transaction.transaction.message.instructions;

      // Use balance delta approach - much more robust
      const amount = this.calculateSOLAmount(transaction, null, walletAddress);
      console.log(`💰 [WALLET MONITOR] Calculated SOL amount: ${amount} SOL`);
      
      if (amount > 0) {
        // Find the sender by looking at balance decreases
        const { meta, transaction: tx } = transaction;
        const keys = tx.message.accountKeys.map(k => k.toBase58());
        const pre = meta.preBalances;
        const post = meta.postBalances;
        
        // Find accounts that lost SOL (potential senders)
        const potentialSenders = [];
        for (let i = 0; i < keys.length; i++) {
          const delta = (post[i] ?? 0) - (pre[i] ?? 0);
          if (delta < 0 && keys[i] !== streamerAddress) {
            potentialSenders.push({
              address: keys[i],
              amountLost: Math.abs(delta) / 1e9
            });
          }
        }
        
        // Use the sender who lost the most SOL as the likely donor
        const sender = potentialSenders.reduce((max, sender) => 
          sender.amountLost > max.amountLost ? sender : max, 
          { address: 'unknown', amountLost: 0 }
        );
        
        console.log(`👤 [WALLET MONITOR] Selected sender: ${sender.address} (lost ${sender.amountLost} SOL)`);
        
        console.log(`💰 SOL DONATION DETECTED!`);
        console.log(`   From: ${sender.address}`);
        console.log(`   To: ${streamerAddress}`);
        console.log(`   Amount: ${amount} SOL`);
        console.log(`   Transaction: ${signature}`);
        console.log(`   Timestamp: ${new Date().toISOString()}`);

        // Get minimum donation requirement from TTS settings
        const minDonation = 0.01; // Default minimum, should be fetched from streamer settings
        console.log(`🔍 [WALLET MONITOR] Checking donation amount: ${amount} SOL >= ${minDonation} SOL`);
        
        if (amount >= minDonation) {
          console.log(`✅ [WALLET MONITOR] Donation amount ${amount} SOL meets minimum requirement of ${minDonation} SOL`);
          
          // Emit donation event
          const donationData = {
            from: sender.address,
            to: streamerAddress,
            amount: amount,
            amountUnit: 'SOL',
            transactionHash: signature,
            timestamp: new Date().toISOString()
          };
          
          console.log(`📡 [WALLET MONITOR] Emitting donation event:`, donationData);
          this.emit('donation', donationData);
        } else {
          console.log(`❌ [WALLET MONITOR] Donation amount ${amount} SOL below minimum requirement of ${minDonation} SOL`);
        }
      } else {
        console.log(`❌ [WALLET MONITOR] No SOL amount detected in transaction (amount: ${amount})`);
      }

    } catch (error) {
      // Handle storage errors by skipping the transaction
      if (error.code === -32019 || (error.message && error.message.includes('Failed to query long-term storage'))) {
        console.log(`⚠️ Storage error processing transaction ${signature}, skipping (transaction too old)`);
        return;
      }
      
      // Handle timeout errors
      if (error.message && error.message.includes('timeout')) {
        console.log(`⚠️ Timeout processing transaction ${signature}, skipping`);
        return;
      }
      
      // Handle rate limiting gracefully with exponential backoff
      if (error.message && error.message.includes('429')) {
        console.log(`⚠️ [WALLET MONITOR] Rate limited processing transaction ${signature}, will retry later`);
        console.log(`🔍 [WALLET MONITOR] Transaction error details:`, error.message);
        
        // Switch to next RPC endpoint on rate limiting
        this.switchToNextRpc();
        return;
      }
      console.error(`❌ [WALLET MONITOR] Error processing transaction ${signature}:`, error);
    }
  }

  // Calculate SOL amount from transaction
  calculateSOLAmount(transaction, fromAddress, toAddress) {
    try {
      console.log(`🔍 [WALLET MONITOR] Calculating SOL amount for transaction`);
      console.log(`🔍 [WALLET MONITOR] Looking for recipient: ${toAddress}`);
      
      // Most robust approach: use balance deltas
      const { meta, transaction: tx } = transaction;
      if (!meta) {
        console.log(`❌ [WALLET MONITOR] No meta data in transaction`);
        return 0;
      }

      const keys = tx.message.accountKeys.map(k => k.toBase58());
      const pre = meta.preBalances;
      const post = meta.postBalances;

      const toIdx = keys.indexOf(toAddress);
      
      if (toIdx === -1) {
        console.log(`❌ [WALLET MONITOR] Recipient ${toAddress} not found in transaction accounts`);
        return 0;
      }

      const deltaLamports = (post[toIdx] ?? 0) - (pre[toIdx] ?? 0);
      const solAmount = deltaLamports > 0 ? deltaLamports / 1e9 : 0;
      
      console.log(`🔍 [WALLET MONITOR] Balance delta for recipient: ${deltaLamports} lamports (${solAmount} SOL)`);
      
      // Positive delta on recipient is the received SOL
      return solAmount;
    } catch (error) {
      console.error('Error calculating SOL amount:', error);
      return 0;
    }
  }

  // Get monitoring status
  getStatus() {
    return {
      isMonitoring: this.monitoredWallets.size > 0,
      monitoredWallets: Array.from(this.monitoredWallets.keys()),
      checkInterval: this.checkInterval
    };
  }

  // Stop all monitoring
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.monitoredWallets.clear();
    console.log('⏹️ Wallet monitoring stopped');
  }
}

module.exports = WalletMonitor;
