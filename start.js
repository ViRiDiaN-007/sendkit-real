#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting SendKit Dashboard...\n');

// Build CSS first
console.log('📦 Building CSS...');
const buildProcess = spawn('npx', ['tailwindcss', '-i', './src/css/input.css', '-o', './public/css/style.css'], {
  stdio: 'inherit',
  shell: true
});

buildProcess.on('close', (code) => {
  if (code === 0) {
    console.log('✅ CSS built successfully\n');
    
    // Start the server
    console.log('🌐 Starting server...');
    const serverProcess = spawn('node', ['server.js'], {
      stdio: 'inherit',
      shell: true
    });
    
    serverProcess.on('close', (code) => {
      console.log(`\n🛑 Server stopped with code ${code}`);
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down gracefully...');
      serverProcess.kill('SIGINT');
      process.exit(0);
    });
    
  } else {
    console.error('❌ CSS build failed');
    process.exit(1);
  }
});

buildProcess.on('error', (error) => {
  console.error('❌ Error building CSS:', error);
  process.exit(1);
});
