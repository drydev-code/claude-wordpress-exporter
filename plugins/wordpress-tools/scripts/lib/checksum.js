import { createHash } from 'crypto';
import fs from 'fs-extra';
import { join } from 'path';

/**
 * Calculate SHA256 hash of a string
 * @param {string} content - Content to hash
 * @returns {string} SHA256 hash
 */
export function hashString(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Calculate SHA256 hash of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} SHA256 hash
 */
export async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Calculate SHA256 hash of a JSON object (normalized)
 * Excludes dynamic fields that change between exports
 * @param {Object} obj - Object to hash
 * @param {string[]} excludeKeys - Keys to exclude from hashing
 * @returns {string} SHA256 hash
 */
export function hashObject(obj, excludeKeys = []) {
  const filtered = { ...obj };

  // Always exclude dynamic fields
  const dynamicFields = ['id', 'date', 'modified', 'guid', 'link', ...excludeKeys];
  for (const key of dynamicFields) {
    delete filtered[key];
  }

  // Sort keys for consistent hashing
  const sorted = sortObjectKeys(filtered);
  return hashString(JSON.stringify(sorted));
}

/**
 * Recursively sort object keys for consistent hashing
 * @param {*} obj - Object to sort
 * @returns {*} Sorted object
 */
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

/**
 * Generate checksums for all files in a content directory
 * @param {string} contentDir - Directory containing content files
 * @returns {Promise<Object>} Checksums object
 */
export async function generateChecksums(contentDir) {
  const checksums = {
    version: 1,
    generated: new Date().toISOString(),
    files: {},
  };

  // Hash body.html
  const bodyPath = join(contentDir, 'body.html');
  if (await fs.pathExists(bodyPath)) {
    checksums.files['body.html'] = await hashFile(bodyPath);
  }

  // Hash metadata.json (excluding dynamic fields)
  const metadataPath = join(contentDir, 'metadata.json');
  if (await fs.pathExists(metadataPath)) {
    const metadata = await fs.readJson(metadataPath);
    checksums.files['metadata.json'] = hashObject(metadata);
  }

  // Hash extension files (SEO, etc.)
  const files = await fs.readdir(contentDir);
  for (const file of files) {
    if (file.endsWith('.json') && !['metadata.json', 'media-mapping.json', 'checksums.json'].includes(file)) {
      const filePath = join(contentDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        checksums.files[file] = await hashFile(filePath);
      }
    }
  }

  // Hash media files
  const mediaDir = join(contentDir, 'media');
  if (await fs.pathExists(mediaDir)) {
    const mediaFiles = await fs.readdir(mediaDir);
    checksums.media = {};
    for (const file of mediaFiles) {
      const filePath = join(mediaDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        checksums.media[file] = await hashFile(filePath);
      }
    }
  }

  // Generate combined hash for quick comparison
  checksums.combined = hashString(JSON.stringify(checksums.files) + JSON.stringify(checksums.media || {}));

  return checksums;
}

/**
 * Save checksums to file
 * @param {Object} checksums - Checksums object
 * @param {string} filePath - Output file path
 */
export async function saveChecksums(checksums, filePath) {
  await fs.writeJson(filePath, checksums, { spaces: 2 });
}

/**
 * Load checksums from file
 * @param {string} filePath - Input file path
 * @returns {Promise<Object|null>} Checksums object or null
 */
export async function loadChecksums(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  return await fs.readJson(filePath);
}

/**
 * Compare two checksum objects to detect changes
 * @param {Object} exportChecksums - Checksums from export
 * @param {Object} remoteChecksums - Checksums from WordPress
 * @returns {Object} Change detection result
 */
export function compareChecksums(exportChecksums, remoteChecksums) {
  if (!remoteChecksums) {
    return {
      changed: true,
      reason: 'no-remote-checksums',
      details: { files: [], media: [] },
    };
  }

  // Quick check using combined hash
  if (exportChecksums.combined === remoteChecksums.combined) {
    return {
      changed: false,
      reason: 'combined-match',
      details: { files: [], media: [] },
    };
  }

  // Detailed comparison
  const changedFiles = [];
  const changedMedia = [];

  // Compare files
  const exportFiles = exportChecksums.files || {};
  const remoteFiles = remoteChecksums.files || {};

  for (const [file, hash] of Object.entries(exportFiles)) {
    if (remoteFiles[file] !== hash) {
      changedFiles.push(file);
    }
  }

  // Compare media
  const exportMedia = exportChecksums.media || {};
  const remoteMedia = remoteChecksums.media || {};

  for (const [file, hash] of Object.entries(exportMedia)) {
    if (remoteMedia[file] !== hash) {
      changedMedia.push(file);
    }
  }

  // Check for new media files
  for (const file of Object.keys(exportMedia)) {
    if (!remoteMedia[file]) {
      if (!changedMedia.includes(file)) {
        changedMedia.push(file);
      }
    }
  }

  const changed = changedFiles.length > 0 || changedMedia.length > 0;

  return {
    changed,
    reason: changed ? 'content-changed' : 'match',
    details: {
      files: changedFiles,
      media: changedMedia,
    },
  };
}

export default {
  hashString,
  hashFile,
  hashObject,
  generateChecksums,
  saveChecksums,
  loadChecksums,
  compareChecksums,
};
