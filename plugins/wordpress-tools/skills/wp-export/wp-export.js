#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { getConfig, validateConfig } from './config.js';
import { WPApiClient } from './lib/api-client.js';
import {
  ensureDir,
  writeJson,
  writeHtml,
  getContentDir,
} from './lib/file-utils.js';
import {
  downloadAllMedia,
  replaceMediaUrls,
  saveMediaMapping,
} from './lib/media-handler.js';

// CLI setup
program
  .name('wp-export')
  .description('Export WordPress posts and pages via REST API')
  .option('-u, --url <url>', 'WordPress site URL')
  .option('--user <user>', 'WordPress username')
  .option('--password <password>', 'WordPress Application Password')
  .option('-o, --output <dir>', 'Output directory', './export')
  .option('-t, --type <type>', 'Content type: posts, pages, or all', 'all')
  .option('-s, --status <status>', 'Post status: publish, draft, or all', 'publish')
  .option('--no-media', 'Skip downloading media files')
  .option('--no-plugins', 'Skip exporting plugin data')
  .option('-v, --verbose', 'Verbose output')
  .parse();

const options = program.opts();

// Logging helpers
const log = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✓'), msg),
  warning: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.log(chalk.red('✗'), msg),
  verbose: (msg) => options.verbose && console.log(chalk.gray('  '), msg),
};

/**
 * Check if a value is empty/meaningless
 */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (value === '') return true;
  if (value === 0) return false;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
}

/**
 * Check if an object has any meaningful (non-empty) values
 */
function hasMeaningfulContent(obj) {
  return Object.values(obj).some(value => !isEmpty(value));
}

/**
 * Generate possible prefixes from a plugin slug
 * e.g., "contact-form-7" -> ["wpcf7", "contact_form_7", "cf7", "contact-form-7"]
 */
function generatePrefixesFromSlug(slug, textDomain = null) {
  const prefixes = new Set();

  // Original slug with underscores
  prefixes.add(slug.replace(/-/g, '_'));

  // Original slug as-is
  prefixes.add(slug);

  // Text domain if different from slug
  if (textDomain && textDomain !== slug) {
    prefixes.add(textDomain);
    prefixes.add(textDomain.replace(/-/g, '_'));
  }

  // Remove common suffixes like -pro, -premium, -lite
  const cleanSlug = slug.replace(/-(pro|premium|lite|free|plus)$/i, '');
  prefixes.add(cleanSlug.replace(/-/g, '_'));

  // Remove common prefixes like seo-by-, wordpress-
  const withoutCommonPrefixes = slug
    .replace(/^(seo-by-|wordpress-|wp-|simple-|easy-|advanced-|ultimate-)/, '');
  if (withoutCommonPrefixes !== slug) {
    prefixes.add(withoutCommonPrefixes);
    prefixes.add(withoutCommonPrefixes.replace(/-/g, '_'));
  }

  // Extract initials (e.g., "contact-form-7" -> "cf7")
  const parts = cleanSlug.split('-').filter(p => p && !/^\d+$/.test(p));
  if (parts.length > 1) {
    const initials = parts.map(p => p[0]).join('');
    if (initials.length >= 2) {
      prefixes.add(initials);
    }
  }

  // First word only
  if (parts.length > 0) {
    prefixes.add(parts[0]);
  }

  // Last two words combined (common for plugins like "rank-math")
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2).join('_');
    prefixes.add(lastTwo);
    prefixes.add(parts.slice(-2).join('-'));
  }

  // Handle known plugin variations (common patterns)
  const knownVariations = {
    'seo-by-rank-math': ['rank_math', 'rankmath'],
    'wordpress-seo': ['wpseo', 'yoast_wpseo', '_yoast'],
    'all-in-one-seo-pack': ['aioseo', '_aioseo'],
    'contact-form-7': ['wpcf7'],
    'wpforms-lite': ['wpforms'],
    'advanced-custom-fields': ['acf', '_acf'],
    'elementor': ['_elementor'],
    'woocommerce': ['wc_', '_wc'],
    'jetpack': ['_jetpack'],
    'updraftplus': ['updraft_'],
    'wordfence': ['wf_', 'wordfence_'],
    'all-in-one-wp-migration': ['ai1wm_'],
  };

  if (knownVariations[slug]) {
    for (const variation of knownVariations[slug]) {
      prefixes.add(variation);
    }
  }

  return Array.from(prefixes);
}

/**
 * Fetch list of installed plugins from WordPress
 */
async function fetchInstalledPlugins(client) {
  const plugins = [];

  try {
    // Try the plugins endpoint (requires authentication)
    const response = await fetch(`${client.baseUrl}/wp-json/wp/v2/plugins`, {
      headers: { Authorization: client.authHeader },
    });

    if (response.ok) {
      const data = await response.json();
      for (const plugin of data) {
        if (plugin.status === 'active') {
          // Extract plugin slug from the plugin file path
          const pluginFile = plugin.plugin || '';
          const slug = pluginFile.split('/')[0] || pluginFile.replace('.php', '');

          const textDomain = plugin.textdomain || slug;
          plugins.push({
            slug,
            name: plugin.name?.raw || plugin.name || slug,
            version: plugin.version,
            textDomain,
            prefixes: generatePrefixesFromSlug(slug, textDomain),
          });
        }
      }
      return { plugins, source: 'api' };
    }
  } catch (error) {
    log.verbose(`Could not fetch plugins via API: ${error.message}`);
  }

  // Fallback: detect from REST API namespaces
  try {
    const response = await fetch(`${client.baseUrl}/wp-json/`, {
      headers: { Authorization: client.authHeader },
    });
    const apiIndex = await response.json();
    const namespaces = apiIndex.namespaces || [];

    // Map common namespaces to plugin info
    const namespaceMap = {
      'contact-form-7/v1': { slug: 'contact-form-7', name: 'Contact Form 7' },
      'rankmath/v1': { slug: 'seo-by-rank-math', name: 'Rank Math SEO' },
      'yoast/v1': { slug: 'wordpress-seo', name: 'Yoast SEO' },
      'wc/v3': { slug: 'woocommerce', name: 'WooCommerce' },
      'wpforms/v1': { slug: 'wpforms-lite', name: 'WPForms' },
      'gf/v2': { slug: 'gravityforms', name: 'Gravity Forms' },
      'elementor/v1': { slug: 'elementor', name: 'Elementor' },
      'acf/v1': { slug: 'advanced-custom-fields', name: 'Advanced Custom Fields' },
      'jetpack/v4': { slug: 'jetpack', name: 'Jetpack' },
      'updraftplus/v1': { slug: 'updraftplus', name: 'UpdraftPlus' },
      'wordfence/v1': { slug: 'wordfence', name: 'Wordfence Security' },
    };

    for (const ns of namespaces) {
      // Skip core WordPress namespaces
      if (ns.startsWith('wp/') || ns === 'oembed/1.0') continue;

      const mapped = Object.entries(namespaceMap).find(([key]) => ns.startsWith(key.split('/')[0]));
      if (mapped) {
        const [, info] = mapped;
        plugins.push({
          slug: info.slug,
          name: info.name,
          namespace: ns,
          prefixes: generatePrefixesFromSlug(info.slug),
        });
      } else {
        // Extract plugin slug from namespace
        const slug = ns.split('/')[0];
        plugins.push({
          slug,
          name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          namespace: ns,
          prefixes: generatePrefixesFromSlug(slug),
        });
      }
    }

    return { plugins, source: 'namespaces' };
  } catch (error) {
    log.verbose(`Could not detect plugins from namespaces: ${error.message}`);
  }

  return { plugins: [], source: 'none' };
}

/**
 * Fetch all options from WordPress and group by plugin
 */
async function fetchAllOptions(client) {
  try {
    const response = await fetch(`${client.baseUrl}/wp-json/wp/v2/settings`, {
      headers: { Authorization: client.authHeader },
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    log.verbose(`Could not fetch settings: ${error.message}`);
  }

  return {};
}

/**
 * Group options by plugin based on prefixes
 */
function groupOptionsByPlugin(allOptions, plugins) {
  const grouped = new Map();
  const assignedKeys = new Set();

  // Sort plugins by prefix length (longer first) to match more specific prefixes first
  const sortedPlugins = [...plugins].sort((a, b) => {
    const maxA = Math.max(...a.prefixes.map(p => p.length));
    const maxB = Math.max(...b.prefixes.map(p => p.length));
    return maxB - maxA;
  });

  for (const [key, value] of Object.entries(allOptions)) {
    if (isEmpty(value)) continue;

    for (const plugin of sortedPlugins) {
      for (const prefix of plugin.prefixes) {
        if (key.startsWith(prefix + '_') || key.startsWith(prefix + '-') || key === prefix) {
          if (!grouped.has(plugin.slug)) {
            grouped.set(plugin.slug, { plugin, options: {} });
          }
          grouped.get(plugin.slug).options[key] = value;
          assignedKeys.add(key);
          break;
        }
      }
      if (assignedKeys.has(key)) break;
    }
  }

  return grouped;
}

/**
 * Group post meta by plugin based on prefixes
 */
function groupMetaByPlugin(meta, plugins) {
  const grouped = new Map();
  const assignedKeys = new Set();

  // WordPress internal meta keys to skip
  const skipPrefixes = ['_edit_', '_wp_', '_oembed_', '_menu_item_', '_customize_'];
  const skipKeys = ['_thumbnail_id', '_encloseme', '_pingme'];

  // Sort plugins by prefix length (longer first)
  const sortedPlugins = [...plugins].sort((a, b) => {
    const maxA = Math.max(...a.prefixes.map(p => p.length));
    const maxB = Math.max(...b.prefixes.map(p => p.length));
    return maxB - maxA;
  });

  for (const [key, value] of Object.entries(meta)) {
    if (isEmpty(value)) continue;
    if (skipKeys.includes(key)) continue;
    if (skipPrefixes.some(p => key.startsWith(p))) continue;

    // Try to match against known plugins
    for (const plugin of sortedPlugins) {
      for (const prefix of plugin.prefixes) {
        // Match with underscore or hyphen separator, or exact match
        const patterns = [
          prefix + '_',
          prefix + '-',
          '_' + prefix + '_',
          '_' + prefix,
        ];

        if (patterns.some(p => key.startsWith(p)) || key === prefix) {
          if (!grouped.has(plugin.slug)) {
            grouped.set(plugin.slug, { plugin, meta: {} });
          }
          grouped.get(plugin.slug).meta[key] = value;
          assignedKeys.add(key);
          break;
        }
      }
      if (assignedKeys.has(key)) break;
    }
  }

  // Auto-detect unknown plugins from remaining meta keys
  const unknownGroups = new Map();

  for (const [key, value] of Object.entries(meta)) {
    if (assignedKeys.has(key) || isEmpty(value)) continue;
    if (skipKeys.includes(key)) continue;
    if (skipPrefixes.some(p => key.startsWith(p))) continue;

    // Extract prefix from key
    let prefix = null;
    if (key.startsWith('_')) {
      const match = key.match(/^(_[a-z0-9]+)_/i);
      if (match) prefix = match[1];
    } else {
      const match = key.match(/^([a-z0-9]+)_/i);
      if (match) prefix = match[1];
    }

    if (prefix && prefix.length >= 2) {
      if (!unknownGroups.has(prefix)) {
        unknownGroups.set(prefix, {});
      }
      unknownGroups.get(prefix)[key] = value;
      assignedKeys.add(key);
    }
  }

  // Add unknown groups that have enough keys to be meaningful
  for (const [prefix, data] of unknownGroups) {
    if (Object.keys(data).length >= 1 && hasMeaningfulContent(data)) {
      const slug = prefix.replace(/^_/, '').toLowerCase().replace(/_/g, '-');
      if (!grouped.has(slug)) {
        grouped.set(slug, {
          plugin: { slug, name: slug, autoDetected: true },
          meta: data,
        });
      } else {
        Object.assign(grouped.get(slug).meta, data);
      }
    }
  }

  // Collect remaining ungrouped meta
  const remaining = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!assignedKeys.has(key) && !isEmpty(value)) {
      if (!skipKeys.includes(key) && !skipPrefixes.some(p => key.startsWith(p))) {
        // Only include if it looks like plugin meta (has underscore structure)
        if (key.includes('_') && !key.startsWith('_')) {
          remaining[key] = value;
        }
      }
    }
  }

  return { grouped, remaining: hasMeaningfulContent(remaining) ? remaining : null };
}

/**
 * Check if the WordPress site has the all_meta field available
 */
async function checkMetaSupport(client) {
  try {
    const { data: pages } = await client.request('/pages?per_page=1&context=edit');
    if (pages.length > 0) {
      return {
        hasAllMeta: 'all_meta' in pages[0],
        hasStandardMeta: 'meta' in pages[0],
      };
    }
    return { hasAllMeta: false, hasStandardMeta: false };
  } catch {
    return { hasAllMeta: false, hasStandardMeta: false };
  }
}

/**
 * Export plugin-specific data via its REST API
 */
async function exportPluginRestData(client, plugin, exportDir) {
  const results = { items: 0, data: null };

  // Special handling for known plugins with REST APIs
  if (plugin.slug === 'contact-form-7' || plugin.namespace?.startsWith('contact-form-7')) {
    try {
      const response = await fetch(`${client.baseUrl}/wp-json/contact-form-7/v1/contact-forms`, {
        headers: { Authorization: client.authHeader },
      });

      if (response.ok) {
        const data = await response.json();
        const forms = data.contact_forms || data || [];
        const exportedForms = [];

        for (const form of forms) {
          const detailResponse = await fetch(
            `${client.baseUrl}/wp-json/contact-form-7/v1/contact-forms/${form.id}`,
            { headers: { Authorization: client.authHeader } }
          );

          if (detailResponse.ok) {
            const fullForm = await detailResponse.json();
            exportedForms.push({
              id: fullForm.id,
              slug: fullForm.slug,
              title: fullForm.title,
              locale: fullForm.locale,
              form: fullForm.properties?.form?.content || fullForm.form,
              mail: fullForm.properties?.mail || fullForm.mail,
              mail_2: fullForm.properties?.mail_2 || fullForm.mail_2,
              messages: fullForm.properties?.messages || fullForm.messages,
              additional_settings: fullForm.properties?.additional_settings || fullForm.additional_settings,
            });
          }
        }

        if (exportedForms.length > 0) {
          results.items = exportedForms.length;
          results.data = { forms: exportedForms };
        }
      }
    } catch (error) {
      log.verbose(`CF7 REST API error: ${error.message}`);
    }
  }

  // Add more plugin-specific REST API handlers here as needed
  // Example: WPForms, Gravity Forms, etc.

  return results;
}

/**
 * Export global plugin data (options + REST API data)
 */
async function exportGlobalPluginData(client, plugins, allOptions, exportDir) {
  const exported = new Map();

  // Group options by plugin
  const groupedOptions = groupOptionsByPlugin(allOptions, plugins);

  // Export each plugin's data
  for (const plugin of plugins) {
    const pluginData = {
      plugin: plugin.slug,
      name: plugin.name,
      version: plugin.version,
      exportDate: new Date().toISOString(),
    };

    let hasData = false;

    // Add options if available
    const optionsData = groupedOptions.get(plugin.slug);
    if (optionsData && Object.keys(optionsData.options).length > 0) {
      pluginData.options = optionsData.options;
      hasData = true;
    }

    // Try to get plugin-specific REST API data
    const restData = await exportPluginRestData(client, plugin, exportDir);
    if (restData.items > 0) {
      Object.assign(pluginData, restData.data);
      hasData = true;
    }

    if (hasData) {
      const filename = `${plugin.slug}.json`;
      await writeJson(join(exportDir, filename), pluginData);
      exported.set(plugin.slug, {
        name: plugin.name,
        optionsCount: Object.keys(pluginData.options || {}).length,
        itemsCount: restData.items,
      });
    }
  }

  return exported;
}

/**
 * Export a single post/page
 */
async function exportItem(item, type, config, client, plugins, stats) {
  const slug = item.slug || `id-${item.id}`;
  const contentDir = getContentDir(config.exportDir, type, slug);

  log.verbose(`Exporting ${type}/${slug} (ID: ${item.id})`);

  await ensureDir(contentDir);

  let fullItem;
  try {
    const endpoint = type === 'posts' ? '/posts' : '/pages';
    const { data } = await client.request(`${endpoint}/${item.id}?context=edit`);
    fullItem = data;
  } catch (error) {
    log.warning(`Could not fetch full data for ${slug}: ${error.message}`);
    fullItem = item;
  }

  let content = fullItem.content?.raw || fullItem.content?.rendered || '';

  // Download media
  if (options.media !== false && content) {
    const mediaDir = join(contentDir, 'media');
    const mapping = await downloadAllMedia(
      content,
      mediaDir,
      config.url,
      (url, success) => {
        if (success) {
          log.verbose(`  Downloaded: ${url}`);
          stats.mediaDownloaded++;
        }
      }
    );

    if (mapping.size > 0) {
      content = replaceMediaUrls(content, mapping);
      await saveMediaMapping(mapping, join(contentDir, 'media-mapping.json'));
    }
  }

  await writeHtml(join(contentDir, 'body.html'), content);

  // Prepare metadata
  const metadata = {
    id: fullItem.id,
    slug: fullItem.slug,
    title: fullItem.title?.raw || fullItem.title?.rendered || '',
    status: fullItem.status,
    date: fullItem.date,
    date_gmt: fullItem.date_gmt,
    modified: fullItem.modified,
    modified_gmt: fullItem.modified_gmt,
    author: fullItem.author,
    excerpt: fullItem.excerpt?.raw || fullItem.excerpt?.rendered || '',
    featured_media: fullItem.featured_media,
    template: fullItem.template || '',
    type: fullItem.type,
    link: fullItem.link,
  };

  if (type === 'posts') {
    metadata.categories = fullItem.categories || [];
    metadata.tags = fullItem.tags || [];
    metadata.format = fullItem.format || 'standard';
    metadata.sticky = fullItem.sticky || false;
  }

  if (type === 'pages') {
    metadata.parent = fullItem.parent || 0;
    metadata.menu_order = fullItem.menu_order || 0;
  }

  await writeJson(join(contentDir, 'metadata.json'), metadata);

  // Get all available meta and group by plugin
  const allMeta = fullItem.all_meta || fullItem.meta || {};
  const { grouped, remaining } = groupMetaByPlugin(allMeta, plugins);
  const detectedExtensions = [];

  // Write one file per plugin
  for (const [pluginSlug, data] of grouped) {
    if (Object.keys(data.meta).length > 0) {
      const filename = `${pluginSlug}.json`;
      await writeJson(join(contentDir, filename), data.meta);
      detectedExtensions.push(pluginSlug);
      log.verbose(`  Saved ${pluginSlug} data (${Object.keys(data.meta).length} fields)`);

      if (!stats.extensions.has(pluginSlug)) {
        stats.extensions.set(pluginSlug, 0);
      }
      stats.extensions.set(pluginSlug, stats.extensions.get(pluginSlug) + 1);
    }
  }

  if (remaining) {
    await writeJson(join(contentDir, 'meta.json'), remaining);
    log.verbose(`  Saved additional meta (${Object.keys(remaining).length} fields)`);
  }

  return { slug, id: item.id, extensions: detectedExtensions };
}

/**
 * Generate the mu-plugin code for exposing all meta and options
 */
function getMuPluginCode() {
  return `<?php
/**
 * Plugin Name: Expose All Meta and Options to REST API
 * Description: Exposes all post meta and plugin options to the REST API for wp-content-sync export
 * Version: 1.1.0
 */

add_action('rest_api_init', function() {
    // Expose all meta for posts and pages
    register_rest_field(
        ['post', 'page'],
        'all_meta',
        [
            'get_callback' => function($post) {
                $meta = get_post_meta($post['id']);
                $result = [];
                foreach ($meta as $key => $values) {
                    if (strpos($key, '_edit_') === 0 || strpos($key, '_wp_') === 0) {
                        continue;
                    }
                    $result[$key] = count($values) === 1 ? maybe_unserialize($values[0]) : array_map('maybe_unserialize', $values);
                }
                return $result;
            },
            'update_callback' => function($value, $post) {
                if (!is_array($value)) return;
                foreach ($value as $key => $val) {
                    update_post_meta($post->ID, $key, $val);
                }
            },
            'schema' => ['type' => 'object']
        ]
    );

    // Expose all meta for custom post types (CF7, ACF, etc.)
    $custom_post_types = ['wpcf7_contact_form', 'acf-field-group', 'wpforms', 'frm_form'];
    foreach ($custom_post_types as $post_type) {
        if (post_type_exists($post_type)) {
            register_rest_field(
                $post_type,
                'all_meta',
                [
                    'get_callback' => function($post) {
                        $meta = get_post_meta($post['id']);
                        $result = [];
                        foreach ($meta as $key => $values) {
                            $result[$key] = count($values) === 1 ? maybe_unserialize($values[0]) : array_map('maybe_unserialize', $values);
                        }
                        return $result;
                    },
                    'schema' => ['type' => 'object']
                ]
            );
        }
    }
});

// Enable Application Passwords on non-SSL (for local development)
add_filter('wp_is_application_passwords_available', '__return_true');
`;
}

/**
 * Main export function
 */
async function main() {
  console.log(chalk.bold('\n📦 WordPress Content Export\n'));

  const config = getConfig(options);

  try {
    validateConfig(config);
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }

  log.info(`Target: ${config.url}`);
  log.info(`Output: ${config.exportDir}`);
  log.info(`Type: ${config.contentType}`);
  log.info(`Status: ${config.postStatus}`);
  console.log();

  const client = new WPApiClient(config);

  // Test connection
  try {
    log.info('Testing connection...');
    const siteInfo = await client.testConnection();
    log.success(`Connected to: ${siteInfo.name}`);
  } catch (error) {
    log.error(`Connection failed: ${error.message}`);
    process.exit(1);
  }

  // Check meta support
  log.info('Checking extension meta support...');
  const metaSupport = await checkMetaSupport(client);

  if (metaSupport.hasAllMeta) {
    log.success('Full meta export available (all_meta field detected)');
  } else if (metaSupport.hasStandardMeta) {
    log.warning('Limited meta export (standard meta only)');
    log.info('For full extension data, install the mu-plugin from _wordpress-plugin/');
  } else {
    log.warning('No meta access - extension data will not be exported');
  }

  // Fetch installed plugins dynamically
  log.info('Detecting installed plugins...');
  const { plugins, source: pluginSource } = await fetchInstalledPlugins(client);

  if (plugins.length > 0) {
    log.success(`Found ${plugins.length} plugin(s) (via ${pluginSource})`);
    for (const plugin of plugins) {
      log.verbose(`  - ${plugin.name} (${plugin.slug})`);
    }
  } else {
    log.warning('No plugins detected');
  }

  // Fetch all options for plugin grouping
  const allOptions = await fetchAllOptions(client);
  log.verbose(`Fetched ${Object.keys(allOptions).length} settings`);

  // Prepare export directory
  await ensureDir(config.exportDir);

  // Write mu-plugin for reference
  const pluginDir = join(config.exportDir, '_wordpress-plugin');
  await ensureDir(pluginDir);
  await writeHtml(join(pluginDir, 'expose-all-meta.php'), getMuPluginCode());

  const stats = {
    posts: 0,
    pages: 0,
    mediaDownloaded: 0,
    extensions: new Map(),
    plugins: new Map(),
  };

  const manifest = {
    exportDate: new Date().toISOString(),
    sourceUrl: config.url,
    contentType: config.contentType,
    postStatus: config.postStatus,
    metaSupport: metaSupport.hasAllMeta ? 'full' : (metaSupport.hasStandardMeta ? 'limited' : 'none'),
    installedPlugins: plugins.map(p => ({ slug: p.slug, name: p.name })),
    posts: [],
    pages: [],
    detectedExtensions: [],
    exportedPlugins: [],
  };

  // ==================== Export Global Plugin Data ====================
  if (options.plugins !== false && plugins.length > 0) {
    console.log();
    log.info('Exporting global plugin data...');

    const exportedPlugins = await exportGlobalPluginData(client, plugins, allOptions, config.exportDir);

    for (const [slug, info] of exportedPlugins) {
      const details = [];
      if (info.optionsCount > 0) details.push(`${info.optionsCount} options`);
      if (info.itemsCount > 0) details.push(`${info.itemsCount} items`);

      log.success(`Exported ${info.name}: ${details.join(', ')}`);
      stats.plugins.set(slug, info);
      manifest.exportedPlugins.push({
        slug,
        name: info.name,
        optionsCount: info.optionsCount,
        itemsCount: info.itemsCount,
      });
    }

    if (exportedPlugins.size === 0) {
      log.info('No global plugin data found');
    }
  }

  // ==================== Export Posts ====================
  if (config.contentType === 'posts' || config.contentType === 'all') {
    console.log();
    log.info('Fetching posts...');

    try {
      const statusParam = config.postStatus === 'all' ? 'publish,draft,pending,private' : config.postStatus;
      const posts = await client.getPosts({ status: statusParam });
      log.success(`Found ${posts.length} posts`);

      for (const post of posts) {
        try {
          const result = await exportItem(post, 'posts', config, client, plugins, stats);
          manifest.posts.push(result);
          stats.posts++;
          log.success(`Exported post: ${result.slug}${result.extensions.length ? ` [${result.extensions.join(', ')}]` : ''}`);
        } catch (error) {
          log.error(`Failed to export post ${post.slug}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`Failed to fetch posts: ${error.message}`);
    }
  }

  // ==================== Export Pages ====================
  if (config.contentType === 'pages' || config.contentType === 'all') {
    console.log();
    log.info('Fetching pages...');

    try {
      const statusParam = config.postStatus === 'all' ? 'publish,draft,pending,private' : config.postStatus;
      const pages = await client.getPages({ status: statusParam });
      log.success(`Found ${pages.length} pages`);

      for (const page of pages) {
        try {
          const result = await exportItem(page, 'pages', config, client, plugins, stats);
          manifest.pages.push(result);
          stats.pages++;
          log.success(`Exported page: ${result.slug}${result.extensions.length ? ` [${result.extensions.join(', ')}]` : ''}`);
        } catch (error) {
          log.error(`Failed to export page ${page.slug}: ${error.message}`);
        }
      }
    } catch (error) {
      log.error(`Failed to fetch pages: ${error.message}`);
    }
  }

  // Update manifest
  manifest.detectedExtensions = Array.from(stats.extensions.keys());

  await writeJson(join(config.exportDir, 'manifest.json'), manifest);

  // ==================== Summary ====================
  console.log();
  console.log(chalk.bold('═══════════════════════════════════════'));
  console.log(chalk.bold('Export Summary'));
  console.log(chalk.bold('═══════════════════════════════════════'));
  console.log(`  Posts exported:    ${stats.posts}`);
  console.log(`  Pages exported:    ${stats.pages}`);
  console.log(`  Media downloaded:  ${stats.mediaDownloaded}`);
  console.log(`  Output directory:  ${config.exportDir}`);

  if (stats.plugins.size > 0) {
    console.log();
    console.log(chalk.bold('Global Plugin Data:'));
    for (const [slug, info] of stats.plugins) {
      const details = [];
      if (info.optionsCount > 0) details.push(`${info.optionsCount} options`);
      if (info.itemsCount > 0) details.push(`${info.itemsCount} items`);
      console.log(`  ${chalk.magenta(info.name)}: ${details.join(', ')}`);
    }
  }

  if (stats.extensions.size > 0) {
    console.log();
    console.log(chalk.bold('Per-Content Plugin Data:'));
    for (const [ext, count] of stats.extensions) {
      console.log(`  ${chalk.cyan(ext)}: ${count} item(s)`);
    }
  }

  console.log(chalk.bold('═══════════════════════════════════════'));
  console.log();
  log.success('Export complete!');
}

main().catch((error) => {
  log.error(`Unexpected error: ${error.message}`);
  if (options.verbose) {
    console.error(error.stack);
  }
  process.exit(1);
});
