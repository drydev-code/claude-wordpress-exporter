import fetch from 'node-fetch';
import fs from 'fs-extra';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';

/**
 * Extract all image URLs from HTML content
 * @param {string} content - HTML content
 * @param {string} siteUrl - WordPress site URL (to filter only site images)
 * @returns {string[]} Array of image URLs
 */
export function extractMediaUrls(content, siteUrl = null) {
  const urls = new Set();

  // Match src attributes in img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    urls.add(match[1]);
  }

  // Match srcset attributes
  const srcsetRegex = /srcset=["']([^"']+)["']/gi;
  while ((match = srcsetRegex.exec(content)) !== null) {
    const srcset = match[1];
    // Parse srcset format: "url1 1x, url2 2x" or "url1 100w, url2 200w"
    srcset.split(',').forEach((entry) => {
      const url = entry.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    });
  }

  // Match WordPress figure/image block URLs
  const wpImageRegex = /wp-image-\d+[^>]*src=["']([^"']+)["']/gi;
  while ((match = wpImageRegex.exec(content)) !== null) {
    urls.add(match[1]);
  }

  // Match background-image URLs in style attributes
  const bgRegex = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi;
  while ((match = bgRegex.exec(content)) !== null) {
    urls.add(match[1]);
  }

  // Filter to only include site URLs if specified
  let result = Array.from(urls);
  if (siteUrl) {
    const siteHost = new URL(siteUrl).host;
    result = result.filter((url) => {
      try {
        const urlHost = new URL(url).host;
        return urlHost === siteHost;
      } catch {
        // Relative URL - include it
        return true;
      }
    });
  }

  return result;
}

/**
 * Generate a unique filename for a URL
 * @param {string} url - Image URL
 * @returns {string} Safe filename
 */
export function generateFilename(url) {
  try {
    const urlObj = new URL(url);
    const originalName = basename(urlObj.pathname);
    const ext = extname(originalName) || '.jpg';
    const nameWithoutExt = originalName.replace(ext, '');

    // Create a short hash from the full URL to ensure uniqueness
    const hash = createHash('md5').update(url).digest('hex').substring(0, 8);

    // Clean the filename
    const safeName = nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    return `${safeName}-${hash}${ext}`;
  } catch {
    // If URL parsing fails, use a hash-based name
    const hash = createHash('md5').update(url).digest('hex');
    return `image-${hash.substring(0, 12)}.jpg`;
  }
}

/**
 * Download a media file to local storage
 * @param {string} url - Media URL
 * @param {string} destDir - Destination directory
 * @param {number} timeout - Download timeout in ms
 * @returns {Promise<{localPath: string, filename: string}>} Local file info
 */
export async function downloadMedia(url, destDir, timeout = 30000) {
  await fs.ensureDir(destDir);

  const filename = generateFilename(url);
  const localPath = join(destDir, filename);

  // Skip if already downloaded
  if (await fs.pathExists(localPath)) {
    return { localPath, filename };
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'WP-Content-Sync/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(localPath, Buffer.from(arrayBuffer));

    return { localPath, filename };
  } catch (error) {
    throw new Error(`Failed to download ${url}: ${error.message}`);
  }
}

/**
 * Download all media from content
 * @param {string} content - HTML content
 * @param {string} destDir - Destination directory
 * @param {string} siteUrl - WordPress site URL
 * @param {Function} onProgress - Progress callback (url, success, error)
 * @returns {Promise<Map<string, string>>} URL to local filename mapping
 */
export async function downloadAllMedia(content, destDir, siteUrl = null, onProgress = null) {
  const urls = extractMediaUrls(content, siteUrl);
  const mapping = new Map();

  for (const url of urls) {
    try {
      const { filename } = await downloadMedia(url, destDir);
      mapping.set(url, filename);
      if (onProgress) onProgress(url, true);
    } catch (error) {
      if (onProgress) onProgress(url, false, error.message);
      // Continue with other downloads
    }
  }

  return mapping;
}

/**
 * Replace media URLs in content with local paths
 * @param {string} content - HTML content
 * @param {Map<string, string>} mapping - URL to local filename mapping
 * @returns {string} Updated content
 */
export function replaceMediaUrls(content, mapping) {
  let result = content;

  for (const [url, filename] of mapping) {
    // Escape special regex characters in URL
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedUrl, 'g');
    result = result.replace(regex, `./media/${filename}`);
  }

  return result;
}

/**
 * Replace local media paths with WordPress URLs
 * @param {string} content - HTML content
 * @param {Map<string, string>} mapping - Local filename to new URL mapping
 * @returns {string} Updated content
 */
export function restoreMediaUrls(content, mapping) {
  let result = content;

  for (const [filename, url] of mapping) {
    // Match both ./media/filename and media/filename
    const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\.?\\/media\\/${escapedFilename}`, 'g');
    result = result.replace(regex, url);
  }

  return result;
}

/**
 * Upload all media files from a directory
 * @param {string} mediaDir - Directory containing media files
 * @param {Object} apiClient - WPApiClient instance
 * @param {Function} onProgress - Progress callback (filename, success, error)
 * @returns {Promise<Map<string, string>>} Local filename to WordPress URL mapping
 */
export async function uploadAllMedia(mediaDir, apiClient, onProgress = null) {
  const mapping = new Map();

  if (!(await fs.pathExists(mediaDir))) {
    return mapping;
  }

  const files = await fs.readdir(mediaDir);
  const mediaFiles = files.filter((f) => /\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(f));

  for (const filename of mediaFiles) {
    const filePath = join(mediaDir, filename);

    try {
      const media = await apiClient.uploadMedia(filePath);
      mapping.set(filename, media.source_url);
      if (onProgress) onProgress(filename, true);
    } catch (error) {
      if (onProgress) onProgress(filename, false, error.message);
      // Continue with other uploads
    }
  }

  return mapping;
}

/**
 * Save URL mapping to a JSON file
 * @param {Map<string, string>} mapping - URL mapping
 * @param {string} filePath - Output file path
 */
export async function saveMediaMapping(mapping, filePath) {
  const obj = Object.fromEntries(mapping);
  await fs.writeJson(filePath, obj, { spaces: 2 });
}

/**
 * Load URL mapping from a JSON file
 * @param {string} filePath - Input file path
 * @returns {Promise<Map<string, string>>} URL mapping
 */
export async function loadMediaMapping(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return new Map();
  }
  const obj = await fs.readJson(filePath);
  return new Map(Object.entries(obj));
}

export default {
  extractMediaUrls,
  generateFilename,
  downloadMedia,
  downloadAllMedia,
  replaceMediaUrls,
  restoreMediaUrls,
  uploadAllMedia,
  saveMediaMapping,
  loadMediaMapping,
};
