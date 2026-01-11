import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

/**
 * Get configuration from environment variables and CLI options
 * @param {Object} cliOptions - Options passed from CLI
 * @returns {Object} Configuration object
 */
export function getConfig(cliOptions = {}) {
  const config = {
    // WordPress connection
    url: cliOptions.url || process.env.WP_REMOTE_URL || 'http://localhost:8080',
    user: cliOptions.user || process.env.WP_REMOTE_USER || 'admin',
    appPassword: cliOptions.password || process.env.WP_REMOTE_APP_PASSWORD || '',

    // Export/Import paths
    exportDir: cliOptions.output || resolve(__dirname, '..', 'export'),
    importDir: cliOptions.input || resolve(__dirname, '..', 'export'),

    // Content options
    contentType: cliOptions.type || 'all', // 'posts', 'pages', or 'all'
    postStatus: cliOptions.status || 'publish', // 'publish', 'draft', or 'all'

    // Import options
    importMode: cliOptions.mode || 'sync', // 'create', 'update', or 'sync'
    dryRun: cliOptions.dryRun || false,

    // API settings
    perPage: 100, // Posts per API request
    timeout: 30000, // Request timeout in ms
  };

  // Normalize URL (remove trailing slash)
  config.url = config.url.replace(/\/$/, '');

  return config;
}

/**
 * Validate configuration
 * @param {Object} config - Configuration object
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  if (!config.url) {
    throw new Error('WordPress URL is required. Set WP_REMOTE_URL in .env or use --url option.');
  }

  if (!config.user || !config.appPassword) {
    throw new Error(
      'WordPress credentials are required. Set WP_REMOTE_USER and WP_REMOTE_APP_PASSWORD in .env.'
    );
  }

  const validTypes = ['posts', 'pages', 'all'];
  if (!validTypes.includes(config.contentType)) {
    throw new Error(`Invalid content type: ${config.contentType}. Use: ${validTypes.join(', ')}`);
  }

  const validStatuses = ['publish', 'draft', 'all'];
  if (!validStatuses.includes(config.postStatus)) {
    throw new Error(`Invalid status: ${config.postStatus}. Use: ${validStatuses.join(', ')}`);
  }

  const validModes = ['create', 'update', 'sync'];
  if (!validModes.includes(config.importMode)) {
    throw new Error(`Invalid import mode: ${config.importMode}. Use: ${validModes.join(', ')}`);
  }
}

export default { getConfig, validateConfig };
