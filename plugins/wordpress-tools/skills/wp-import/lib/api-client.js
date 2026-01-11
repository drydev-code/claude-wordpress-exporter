import fetch from 'node-fetch';
import fs from 'fs-extra';
import { basename } from 'path';

/**
 * WordPress REST API Client
 */
export class WPApiClient {
  /**
   * Create a new API client
   * @param {Object} config - Configuration object
   * @param {string} config.url - WordPress site URL
   * @param {string} config.user - WordPress username
   * @param {string} config.appPassword - Application password
   * @param {number} config.timeout - Request timeout in ms
   * @param {number} config.perPage - Items per page for pagination
   */
  constructor(config) {
    this.baseUrl = config.url;
    this.apiUrl = `${config.url}/wp-json/wp/v2`;
    this.timeout = config.timeout || 30000;
    this.perPage = config.perPage || 100;

    // Create Basic Auth header
    const credentials = `${config.user}:${config.appPassword}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (relative to /wp-json/wp/v2)
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   */
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }

    // Return headers along with data for pagination
    const data = await response.json();
    return {
      data,
      headers: {
        totalPages: parseInt(response.headers.get('X-WP-TotalPages') || '1'),
        total: parseInt(response.headers.get('X-WP-Total') || '0'),
      },
    };
  }

  /**
   * Fetch all items with pagination
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} All items
   */
  async fetchAll(endpoint, params = {}) {
    const items = [];
    let page = 1;
    let totalPages = 1;

    const queryParams = new URLSearchParams({
      per_page: this.perPage.toString(),
      ...params,
    });

    do {
      queryParams.set('page', page.toString());
      const { data, headers } = await this.request(`${endpoint}?${queryParams}`);

      items.push(...data);
      totalPages = headers.totalPages;
      page++;
    } while (page <= totalPages);

    return items;
  }

  /**
   * Test API connection
   * @returns {Promise<Object>} Site info
   */
  async testConnection() {
    const response = await fetch(`${this.baseUrl}/wp-json`, {
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Connection failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  // ==================== Posts ====================

  /**
   * Get all posts
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Posts
   */
  async getPosts(params = {}) {
    const queryParams = { status: 'publish', ...params };
    if (queryParams.status === 'all') {
      queryParams.status = 'publish,draft,pending,private';
    }
    return await this.fetchAll('/posts', queryParams);
  }

  /**
   * Get a single post by ID
   * @param {number} id - Post ID
   * @returns {Promise<Object>} Post data
   */
  async getPost(id) {
    const { data } = await this.request(`/posts/${id}`);
    return data;
  }

  /**
   * Get a post by slug
   * @param {string} slug - Post slug
   * @returns {Promise<Object|null>} Post data or null
   */
  async getPostBySlug(slug) {
    const { data } = await this.request(`/posts?slug=${encodeURIComponent(slug)}`);
    return data.length > 0 ? data[0] : null;
  }

  /**
   * Create a new post
   * @param {Object} postData - Post data
   * @returns {Promise<Object>} Created post
   */
  async createPost(postData) {
    const { data } = await this.request('/posts', {
      method: 'POST',
      body: JSON.stringify(postData),
    });
    return data;
  }

  /**
   * Update an existing post
   * @param {number} id - Post ID
   * @param {Object} postData - Post data
   * @returns {Promise<Object>} Updated post
   */
  async updatePost(id, postData) {
    const { data } = await this.request(`/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(postData),
    });
    return data;
  }

  /**
   * Delete a post
   * @param {number} id - Post ID
   * @param {boolean} force - Force delete (skip trash)
   * @returns {Promise<Object>} Deleted post
   */
  async deletePost(id, force = false) {
    const { data } = await this.request(`/posts/${id}?force=${force}`, {
      method: 'DELETE',
    });
    return data;
  }

  // ==================== Pages ====================

  /**
   * Get all pages
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Pages
   */
  async getPages(params = {}) {
    const queryParams = { status: 'publish', ...params };
    if (queryParams.status === 'all') {
      queryParams.status = 'publish,draft,pending,private';
    }
    return await this.fetchAll('/pages', queryParams);
  }

  /**
   * Get a single page by ID
   * @param {number} id - Page ID
   * @returns {Promise<Object>} Page data
   */
  async getPage(id) {
    const { data } = await this.request(`/pages/${id}`);
    return data;
  }

  /**
   * Get a page by slug
   * @param {string} slug - Page slug
   * @returns {Promise<Object|null>} Page data or null
   */
  async getPageBySlug(slug) {
    const { data } = await this.request(`/pages?slug=${encodeURIComponent(slug)}`);
    return data.length > 0 ? data[0] : null;
  }

  /**
   * Create a new page
   * @param {Object} pageData - Page data
   * @returns {Promise<Object>} Created page
   */
  async createPage(pageData) {
    const { data } = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify(pageData),
    });
    return data;
  }

  /**
   * Update an existing page
   * @param {number} id - Page ID
   * @param {Object} pageData - Page data
   * @returns {Promise<Object>} Updated page
   */
  async updatePage(id, pageData) {
    const { data } = await this.request(`/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(pageData),
    });
    return data;
  }

  /**
   * Delete a page
   * @param {number} id - Page ID
   * @param {boolean} force - Force delete (skip trash)
   * @returns {Promise<Object>} Deleted page
   */
  async deletePage(id, force = false) {
    const { data } = await this.request(`/pages/${id}?force=${force}`, {
      method: 'DELETE',
    });
    return data;
  }

  // ==================== Media ====================

  /**
   * Get media item by ID
   * @param {number} id - Media ID
   * @returns {Promise<Object>} Media data
   */
  async getMedia(id) {
    const { data } = await this.request(`/media/${id}`);
    return data;
  }

  /**
   * Upload a media file
   * @param {string} filePath - Local file path
   * @param {Object} metadata - Optional metadata (title, alt_text, caption)
   * @returns {Promise<Object>} Uploaded media data
   */
  async uploadMedia(filePath, metadata = {}) {
    const fileName = basename(filePath);
    const fileBuffer = await fs.readFile(filePath);

    // Determine content type from extension
    const ext = fileName.split('.').pop().toLowerCase();
    const contentTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    const response = await fetch(`${this.apiUrl}/media`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(this.timeout * 2), // Longer timeout for uploads
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Media upload failed: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // Update metadata if provided
    if (Object.keys(metadata).length > 0) {
      return await this.updateMedia(data.id, metadata);
    }

    return data;
  }

  /**
   * Update media metadata
   * @param {number} id - Media ID
   * @param {Object} metadata - Metadata to update
   * @returns {Promise<Object>} Updated media data
   */
  async updateMedia(id, metadata) {
    const { data } = await this.request(`/media/${id}`, {
      method: 'PUT',
      body: JSON.stringify(metadata),
    });
    return data;
  }

  // ==================== Post Meta ====================

  /**
   * Get post meta (including RankMath SEO data)
   * @param {number} postId - Post ID
   * @param {string} type - Content type ('posts' or 'pages')
   * @returns {Promise<Object>} Meta data
   */
  async getPostMeta(postId, type = 'posts') {
    try {
      // Try RankMath REST API first
      const { data } = await this.request(`/rankmath/v1/getHead?url=${this.baseUrl}/?p=${postId}`);
      return data;
    } catch {
      // Fall back to getting meta from post itself
      const endpoint = type === 'pages' ? '/pages' : '/posts';
      const { data } = await this.request(`${endpoint}/${postId}?context=edit`);
      return data.meta || {};
    }
  }

  /**
   * Update post meta
   * @param {number} postId - Post ID
   * @param {string} type - Content type ('posts' or 'pages')
   * @param {Object} meta - Meta data to update
   * @returns {Promise<Object>} Updated post
   */
  async updatePostMeta(postId, type = 'posts', meta) {
    const endpoint = type === 'pages' ? '/pages' : '/posts';
    const { data } = await this.request(`${endpoint}/${postId}`, {
      method: 'PUT',
      body: JSON.stringify({ meta }),
    });
    return data;
  }

  // ==================== Categories & Tags ====================

  /**
   * Get all categories
   * @returns {Promise<Array>} Categories
   */
  async getCategories() {
    return await this.fetchAll('/categories');
  }

  /**
   * Get all tags
   * @returns {Promise<Array>} Tags
   */
  async getTags() {
    return await this.fetchAll('/tags');
  }

  /**
   * Create a category
   * @param {Object} categoryData - Category data
   * @returns {Promise<Object>} Created category
   */
  async createCategory(categoryData) {
    const { data } = await this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
    return data;
  }

  /**
   * Create a tag
   * @param {Object} tagData - Tag data
   * @returns {Promise<Object>} Created tag
   */
  async createTag(tagData) {
    const { data } = await this.request('/tags', {
      method: 'POST',
      body: JSON.stringify(tagData),
    });
    return data;
  }

  // ==================== Users ====================

  /**
   * Get current user
   * @returns {Promise<Object>} User data
   */
  async getCurrentUser() {
    const { data } = await this.request('/users/me');
    return data;
  }

  /**
   * Get user by ID
   * @param {number} id - User ID
   * @returns {Promise<Object>} User data
   */
  async getUser(id) {
    const { data } = await this.request(`/users/${id}`);
    return data;
  }
}

export default WPApiClient;
