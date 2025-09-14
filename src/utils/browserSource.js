/**
 * Browser Source URL Generator
 * 
 * This utility generates browser source URLs for OBS integration.
 * It supports both auto-detection from request headers and manual configuration
 * via environment variables for production deployment.
 */

/**
 * Generate a browser source URL for a given streamer and type
 * @param {Object} req - Express request object
 * @param {string} streamerId - The streamer ID
 * @param {string} type - The browser source type ('tts' or 'poll')
 * @returns {string} The complete browser source URL
 */
function generateBrowserSourceUrl(req, streamerId, type) {
  const baseUrl = getBaseUrl(req);
  return `${baseUrl}/browser-source/${type}/${streamerId}`;
}

/**
 * Get the base URL for browser sources
 * @param {Object} req - Express request object
 * @returns {string} The base URL
 */
function getBaseUrl(req) {
  // Check if a custom base URL is configured
  const customBaseUrl = process.env.BROWSER_SOURCE_BASE_URL;
  
  if (customBaseUrl) {
    // Use the configured base URL (remove trailing slash if present)
    return customBaseUrl.replace(/\/$/, '');
  }
  
  // Auto-detect from request headers
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  
  return `${protocol}://${host}`;
}

/**
 * Generate TTS browser source URL
 * @param {Object} req - Express request object
 * @param {string} streamerId - The streamer ID
 * @returns {string} The TTS browser source URL
 */
function getTTSBrowserSourceUrl(req, streamerId) {
  return generateBrowserSourceUrl(req, streamerId, 'tts');
}

/**
 * Generate Poll browser source URL
 * @param {Object} req - Express request object
 * @param {string} streamerId - The streamer ID
 * @returns {string} The Poll browser source URL
 */
function getPollBrowserSourceUrl(req, streamerId) {
  return generateBrowserSourceUrl(req, streamerId, 'poll');
}

/**
 * Generate all browser source URLs for a streamer
 * @param {Object} req - Express request object
 * @param {string} streamerId - The streamer ID
 * @returns {Object} Object containing all browser source URLs
 */
function getAllBrowserSourceUrls(req, streamerId) {
  return {
    tts: getTTSBrowserSourceUrl(req, streamerId),
    poll: getPollBrowserSourceUrl(req, streamerId)
  };
}

module.exports = {
  generateBrowserSourceUrl,
  getBaseUrl,
  getTTSBrowserSourceUrl,
  getPollBrowserSourceUrl,
  getAllBrowserSourceUrls
};
