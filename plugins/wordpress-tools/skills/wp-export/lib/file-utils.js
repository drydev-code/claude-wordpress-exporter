import fs from 'fs-extra';
import { join, dirname } from 'path';

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path
 */
export async function ensureDir(dirPath) {
  await fs.ensureDir(dirPath);
}

/**
 * Write JSON data to a file with pretty formatting
 * @param {string} filePath - File path
 * @param {Object} data - Data to write
 */
export async function writeJson(filePath, data) {
  await fs.ensureDir(dirname(filePath));
  await fs.writeJson(filePath, data, { spaces: 2 });
}

/**
 * Read and parse JSON from a file
 * @param {string} filePath - File path
 * @returns {Object} Parsed JSON data
 */
export async function readJson(filePath) {
  return await fs.readJson(filePath);
}

/**
 * Check if a JSON file exists
 * @param {string} filePath - File path
 * @returns {boolean} True if file exists
 */
export async function jsonExists(filePath) {
  return await fs.pathExists(filePath);
}

/**
 * Write HTML content to a file
 * @param {string} filePath - File path
 * @param {string} content - HTML content
 */
export async function writeHtml(filePath, content) {
  await fs.ensureDir(dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Read HTML content from a file
 * @param {string} filePath - File path
 * @returns {string} HTML content
 */
export async function readHtml(filePath) {
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * List all subdirectories in a directory
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of subdirectory names
 */
export async function listSubdirs(dirPath) {
  if (!(await fs.pathExists(dirPath))) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * List all files in a directory matching a pattern
 * @param {string} dirPath - Directory path
 * @param {string} extension - File extension to filter (e.g., '.jpg')
 * @returns {string[]} Array of file names
 */
export async function listFiles(dirPath, extension = null) {
  if (!(await fs.pathExists(dirPath))) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  if (extension) {
    files = files.filter((file) => file.endsWith(extension));
  }

  return files;
}

/**
 * Create a slug-safe directory name
 * @param {string} slug - Post/page slug
 * @returns {string} Safe directory name
 */
export function safeDirName(slug) {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get content directory path for a post/page
 * @param {string} baseDir - Base export directory
 * @param {string} type - Content type ('posts' or 'pages')
 * @param {string} slug - Content slug
 * @returns {string} Full directory path
 */
export function getContentDir(baseDir, type, slug) {
  return join(baseDir, type, safeDirName(slug));
}

export default {
  ensureDir,
  writeJson,
  readJson,
  jsonExists,
  writeHtml,
  readHtml,
  listSubdirs,
  listFiles,
  safeDirName,
  getContentDir,
};
