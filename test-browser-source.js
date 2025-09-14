/**
 * Test script to verify browser source URL generation
 */

const { getAllBrowserSourceUrls, getBaseUrl } = require('./src/utils/browserSource');

// Mock request object for testing
const mockReq = {
  protocol: 'https',
  get: (header) => {
    if (header === 'host') return 'yourdomain.com';
    return null;
  }
};

// Test with environment variable set
process.env.BROWSER_SOURCE_BASE_URL = 'https://yourdomain.com';

console.log('🧪 Testing Browser Source URL Generation\n');

// Test 1: With custom base URL
console.log('1. With BROWSER_SOURCE_BASE_URL set:');
console.log('   Base URL:', getBaseUrl(mockReq));
console.log('   TTS URL:', getAllBrowserSourceUrls(mockReq, 'test-streamer-123').tts);
console.log('   Poll URL:', getAllBrowserSourceUrls(mockReq, 'test-streamer-123').poll);

// Test 2: Without environment variable (auto-detect)
delete process.env.BROWSER_SOURCE_BASE_URL;

console.log('\n2. Without BROWSER_SOURCE_BASE_URL (auto-detect):');
console.log('   Base URL:', getBaseUrl(mockReq));
console.log('   TTS URL:', getAllBrowserSourceUrls(mockReq, 'test-streamer-123').tts);
console.log('   Poll URL:', getAllBrowserSourceUrls(mockReq, 'test-streamer-123').poll);

// Test 3: HTTP request
const mockHttpReq = {
  protocol: 'http',
  get: (header) => {
    if (header === 'host') return 'localhost:3000';
    return null;
  }
};

console.log('\n3. HTTP localhost (development):');
console.log('   Base URL:', getBaseUrl(mockHttpReq));
console.log('   TTS URL:', getAllBrowserSourceUrls(mockHttpReq, 'test-streamer-123').tts);
console.log('   Poll URL:', getAllBrowserSourceUrls(mockHttpReq, 'test-streamer-123').poll);

console.log('\n✅ Browser source URL generation test completed!');
