const { spawn } = require('child_process');

console.log('🔍 Starting 429 error debugging...');
console.log('Monitoring server logs for 429 errors...\n');

// Start the server and monitor its output
const server = spawn('node', ['start.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

let errorCount = 0;
let walletMonitor429s = 0;
let pumpChat429s = 0;
let global429s = 0;

server.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Check for 429 errors in different services
  if (output.includes('429')) {
    errorCount++;
    
    if (output.includes('[WALLET MONITOR]') && output.includes('429')) {
      walletMonitor429s++;
      console.log(`🔍 [WALLET MONITOR] 429 detected (${walletMonitor429s} total):`);
      console.log(`   ${output.trim()}`);
    }
    
    if (output.includes('[PUMP CHAT CLIENT]') && output.includes('429')) {
      pumpChat429s++;
      console.log(`🔍 [PUMP CHAT CLIENT] 429 detected (${pumpChat429s} total):`);
      console.log(`   ${output.trim()}`);
    }
    
    if (output.includes('[GLOBAL]') && output.includes('429')) {
      global429s++;
      console.log(`🔍 [GLOBAL] 429 detected (${global429s} total):`);
      console.log(`   ${output.trim()}`);
    }
    
    if (output.includes('Server responded with 429')) {
      console.log(`🔍 [UNKNOWN SOURCE] 429 detected:`);
      console.log(`   ${output.trim()}`);
    }
  }
  
  // Show all output for debugging
  process.stdout.write(output);
});

server.stderr.on('data', (data) => {
  const output = data.toString();
  
  if (output.includes('429')) {
    console.log(`🔍 [STDERR] 429 detected:`);
    console.log(`   ${output.trim()}`);
  }
  
  process.stderr.write(output);
});

server.on('close', (code) => {
  console.log(`\n🔍 Server closed with code ${code}`);
  console.log(`📊 429 Error Summary:`);
  console.log(`   Total 429 errors: ${errorCount}`);
  console.log(`   Wallet Monitor: ${walletMonitor429s}`);
  console.log(`   Pump Chat Client: ${pumpChat429s}`);
  console.log(`   Global handlers: ${global429s}`);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🔍 Stopping debug session...');
  server.kill('SIGINT');
  process.exit(0);
});

console.log('Press Ctrl+C to stop debugging...');
