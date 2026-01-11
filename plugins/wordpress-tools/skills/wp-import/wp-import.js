#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import fs from 'fs-extra';
import { getConfig, validateConfig } from './config.js';
import { WPApiClient } from './lib/api-client.js';
import {
  readJson,
  readHtml,
  jsonExists,
  listSubdirs,
  listFiles,
  getContentDir,
} from './lib/file-utils.js';
import {
  uploadAllMedia,
  restoreMediaUrls,
  loadMediaMapping,
} from './lib/media-handler.js';

// CLI setup
program
  .name('wp-import')
  .description('Import WordPress posts, pages, and plugin data via REST API')
  .option('-u, --url <url>', 'WordPress site URL')
  .option('--user <user>', 'WordPress username')
  .option('--password <password>', 'WordPress Application Password')
  .option('-i, --input <dir>', 'Input directory', './export')
  .option('-t, --type <type>', 'Content type: posts, pages, or all', 'all')
  .option('-m, --mode <mode>', 'Import mode: create, update, or sync', 'sync')
  .option('--no-media', 'Skip uploading media files')
  .option('--no-plugins', 'Skip importing plugin data')
  .option('--dry-run', 'Show what would be imported without making changes')
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
  dryRun: (msg) => console.log(chalk.cyan('[DRY-RUN]'), msg),
};

/**
 * Import Contact Form 7 forms from plugin data file
 */
async function importContactForm7(client, pluginData, dryRun) {
  const forms = pluginData.forms || [];
  if (forms.length === 0) return { imported: 0, updated: 0 };

  const stats = { imported: 0, updated: 0 };

  for (const form of forms) {
    try {
      // Check if form exists
      let existingForm = null;
      try {
        const response = await fetch(
          `${client.baseUrl}/wp-json/contact-form-7/v1/contact-forms`,
          { headers: { Authorization: client.authHeader } }
        );
        if (response.ok) {
          const allForms = await response.json();
          const formsList = allForms.contact_forms || allForms || [];
          existingForm = formsList.find(f => f.slug === form.slug || f.id === form.id);
        }
      } catch {}

      if (dryRun) {
        if (existingForm) {
          log.dryRun(`Would update CF7 form: ${form.title}`);
          stats.updated++;
        } else {
          log.dryRun(`Would create CF7 form: ${form.title}`);
          stats.imported++;
        }
        continue;
      }

      const formData = {
        title: form.title,
        locale: form.locale || '',
        form: form.form,
        mail: form.mail,
        mail_2: form.mail_2 || {},
        messages: form.messages || {},
        additional_settings: form.additional_settings || '',
      };

      const endpoint = existingForm
        ? `${client.baseUrl}/wp-json/contact-form-7/v1/contact-forms/${existingForm.id}`
        : `${client.baseUrl}/wp-json/contact-form-7/v1/contact-forms`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: client.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        if (existingForm) {
          log.success(`Updated CF7 form: ${form.title}`);
          stats.updated++;
        } else {
          log.success(`Created CF7 form: ${form.title}`);
          stats.imported++;
        }
      } else {
        const error = await response.text();
        log.error(`Failed to import CF7 form ${form.title}: ${error}`);
      }
    } catch (error) {
      log.error(`Error importing CF7 form ${form.title}: ${error.message}`);
    }
  }

  return stats;
}

/**
 * Import plugin options via WordPress settings API
 */
async function importPluginOptions(client, pluginData, dryRun) {
  const pluginOptions = pluginData.options || {};
  if (Object.keys(pluginOptions).length === 0) return 0;

  if (dryRun) {
    log.dryRun(`Would import ${Object.keys(pluginOptions).length} options for ${pluginData.name}`);
    return Object.keys(pluginOptions).length;
  }

  try {
    const response = await fetch(`${client.baseUrl}/wp-json/wp/v2/settings`, {
      method: 'POST',
      headers: {
        Authorization: client.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pluginOptions),
    });

    if (response.ok) {
      log.success(`Imported ${Object.keys(pluginOptions).length} options for ${pluginData.name}`);
      return Object.keys(pluginOptions).length;
    } else {
      log.warning(`Could not import options for ${pluginData.name}`);
    }
  } catch (error) {
    log.verbose(`Settings API error for ${pluginData.name}: ${error.message}`);
  }

  return 0;
}

/**
 * Import all plugin data from export directory
 */
async function importAllPlugins(client, inputDir, manifest, dryRun) {
  const stats = {
    plugins: new Map(),
    totalOptions: 0,
    totalItems: 0,
  };

  // Get list of plugin files to process
  const pluginFiles = [];

  // Use manifest if available
  if (manifest?.exportedPlugins?.length > 0) {
    for (const plugin of manifest.exportedPlugins) {
      const filePath = join(inputDir, `${plugin.slug}.json`);
      if (await fs.pathExists(filePath)) {
        pluginFiles.push({ slug: plugin.slug, name: plugin.name, path: filePath });
      }
    }
  } else {
    // Scan directory for plugin files
    const jsonFiles = await listFiles(inputDir, '.json');
    for (const file of jsonFiles) {
      if (file === 'manifest.json') continue;
      const filePath = join(inputDir, file);
      try {
        const data = await fs.readJson(filePath);
        if (data.plugin) {
          pluginFiles.push({
            slug: data.plugin,
            name: data.name || data.plugin,
            path: filePath,
          });
        }
      } catch {}
    }
  }

  // Process each plugin
  for (const pluginFile of pluginFiles) {
    const pluginData = await fs.readJson(pluginFile.path);
    let optionsImported = 0;
    let itemsImported = 0;

    // Handle Contact Form 7 specially (has forms)
    if (pluginFile.slug === 'contact-form-7' && pluginData.forms) {
      const cf7Stats = await importContactForm7(client, pluginData, dryRun);
      itemsImported = cf7Stats.imported + cf7Stats.updated;
    }

    // Import options if present
    if (pluginData.options && Object.keys(pluginData.options).length > 0) {
      optionsImported = await importPluginOptions(client, pluginData, dryRun);
    }

    if (optionsImported > 0 || itemsImported > 0) {
      stats.plugins.set(pluginFile.slug, {
        name: pluginFile.name,
        options: optionsImported,
        items: itemsImported,
      });
      stats.totalOptions += optionsImported;
      stats.totalItems += itemsImported;
    }
  }

  return stats;
}

/**
 * Import extension meta for a post/page
 */
async function importExtensionMeta(client, contentDir, postId, type, dryRun) {
  const extensionFiles = await listFiles(contentDir, '.json');
  const metaToImport = {};
  const importedExtensions = [];

  for (const file of extensionFiles) {
    // Skip non-extension files
    if (['metadata.json', 'media-mapping.json', 'meta.json'].includes(file)) {
      continue;
    }

    const extName = file.replace('.json', '');
    const extData = await fs.readJson(join(contentDir, file));

    // Merge all extension data into one meta object
    Object.assign(metaToImport, extData);
    importedExtensions.push(extName);
  }

  // Also import remaining meta
  const metaFile = join(contentDir, 'meta.json');
  if (await fs.pathExists(metaFile)) {
    const metaData = await fs.readJson(metaFile);
    Object.assign(metaToImport, metaData);
  }

  if (Object.keys(metaToImport).length === 0) {
    return importedExtensions;
  }

  if (dryRun) {
    log.verbose(`  Would import ${Object.keys(metaToImport).length} meta fields`);
    return importedExtensions;
  }

  try {
    // Try using all_meta field if available (requires mu-plugin)
    const endpoint = type === 'posts' ? '/posts' : '/pages';
    await client.request(`${endpoint}/${postId}`, {
      method: 'PUT',
      body: JSON.stringify({ all_meta: metaToImport }),
    });
    log.verbose(`  Imported extension meta: ${importedExtensions.join(', ')}`);
  } catch {
    // Fall back to updating meta field by field
    try {
      const endpoint = type === 'posts' ? '/posts' : '/pages';
      await client.request(`${endpoint}/${postId}`, {
        method: 'PUT',
        body: JSON.stringify({ meta: metaToImport }),
      });
      log.verbose(`  Imported meta via standard API`);
    } catch (error) {
      log.warning(`  Could not import meta: ${error.message}`);
    }
  }

  return importedExtensions;
}

/**
 * Import a single post/page
 */
async function importItem(slug, type, config, client, stats) {
  const contentDir = getContentDir(config.importDir, type, slug);

  log.verbose(`Processing ${type}/${slug}`);

  // Read metadata
  const metadataPath = join(contentDir, 'metadata.json');
  if (!(await jsonExists(metadataPath))) {
    throw new Error(`metadata.json not found in ${contentDir}`);
  }

  const metadata = await readJson(metadataPath);

  // Read content
  const bodyPath = join(contentDir, 'body.html');
  let content = '';
  try {
    content = await readHtml(bodyPath);
  } catch {
    log.verbose(`  No body.html found, using empty content`);
  }

  // Upload media and update content URLs
  let mediaMapping = new Map();
  if (options.media !== false && !options.dryRun) {
    const mediaDir = join(contentDir, 'media');
    const originalMapping = await loadMediaMapping(join(contentDir, 'media-mapping.json'));

    if (originalMapping.size > 0) {
      log.verbose(`  Uploading ${originalMapping.size} media files...`);

      mediaMapping = await uploadAllMedia(mediaDir, client, (filename, success, error) => {
        if (success) {
          log.verbose(`    Uploaded: ${filename}`);
          stats.mediaUploaded++;
        } else {
          log.verbose(`    Failed: ${filename} - ${error}`);
        }
      });

      // Restore URLs in content
      if (mediaMapping.size > 0) {
        content = restoreMediaUrls(content, mediaMapping);
      }
    }
  }

  // Check if item exists
  let existingItem = null;
  try {
    if (type === 'posts') {
      existingItem = await client.getPostBySlug(metadata.slug);
    } else {
      existingItem = await client.getPageBySlug(metadata.slug);
    }
  } catch {
    // Item doesn't exist
  }

  // Determine action based on mode
  let action = 'skip';
  if (config.importMode === 'create' && !existingItem) {
    action = 'create';
  } else if (config.importMode === 'update' && existingItem) {
    action = 'update';
  } else if (config.importMode === 'sync') {
    action = existingItem ? 'update' : 'create';
  }

  if (action === 'skip') {
    return {
      slug,
      action: 'skipped',
      reason: existingItem ? 'exists (mode=create)' : 'not found (mode=update)',
    };
  }

  // Prepare post/page data
  const itemData = {
    title: metadata.title,
    content: content,
    status: metadata.status,
    slug: metadata.slug,
    excerpt: metadata.excerpt || '',
    template: metadata.template || '',
  };

  if (type === 'posts') {
    if (metadata.categories?.length > 0) {
      itemData.categories = metadata.categories;
    }
    if (metadata.tags?.length > 0) {
      itemData.tags = metadata.tags;
    }
    if (metadata.format) {
      itemData.format = metadata.format;
    }
    if (metadata.sticky !== undefined) {
      itemData.sticky = metadata.sticky;
    }
  }

  if (type === 'pages') {
    if (metadata.parent) {
      itemData.parent = metadata.parent;
    }
    if (metadata.menu_order) {
      itemData.menu_order = metadata.menu_order;
    }
  }

  // Dry run
  if (options.dryRun) {
    log.dryRun(`Would ${action} ${type}/${slug}`);
    return { slug, action: `would-${action}`, dryRun: true };
  }

  // Execute the action
  let result;
  if (action === 'create') {
    if (type === 'posts') {
      result = await client.createPost(itemData);
    } else {
      result = await client.createPage(itemData);
    }
    log.success(`Created ${type}/${slug} (ID: ${result.id})`);
  } else {
    if (type === 'posts') {
      result = await client.updatePost(existingItem.id, itemData);
    } else {
      result = await client.updatePage(existingItem.id, itemData);
    }
    log.success(`Updated ${type}/${slug} (ID: ${result.id})`);
  }

  // Import extension meta
  const importedExtensions = await importExtensionMeta(
    client,
    contentDir,
    result.id,
    type,
    options.dryRun
  );

  return { slug, action, id: result.id, extensions: importedExtensions };
}

/**
 * Main import function
 */
async function main() {
  console.log(chalk.bold('\n📥 WordPress Content Import\n'));

  if (options.dryRun) {
    log.info('DRY-RUN MODE - No changes will be made');
    console.log();
  }

  // Load and validate config
  const config = getConfig({
    ...options,
    input: options.input,
  });
  config.importDir = options.input || config.importDir;

  try {
    validateConfig(config);
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }

  log.info(`Target: ${config.url}`);
  log.info(`Input: ${config.importDir}`);
  log.info(`Type: ${config.contentType}`);
  log.info(`Mode: ${config.importMode}`);
  console.log();

  // Read manifest
  const manifestPath = join(config.importDir, 'manifest.json');
  let manifest = null;
  try {
    manifest = await readJson(manifestPath);
    log.info(`Export from: ${manifest.sourceUrl}`);
    log.info(`Export date: ${manifest.exportDate}`);
    if (manifest.installedPlugins?.length > 0) {
      log.info(`Plugins: ${manifest.installedPlugins.map(p => p.name).join(', ')}`);
    }
  } catch {
    log.warning('No manifest.json found, will scan directories');
  }

  // Create API client
  const client = new WPApiClient(config);

  // Test connection
  if (!options.dryRun) {
    try {
      log.info('Testing connection...');
      const siteInfo = await client.testConnection();
      log.success(`Connected to: ${siteInfo.name}`);
    } catch (error) {
      log.error(`Connection failed: ${error.message}`);
      process.exit(1);
    }
  }

  const stats = {
    posts: { created: 0, updated: 0, skipped: 0, failed: 0 },
    pages: { created: 0, updated: 0, skipped: 0, failed: 0 },
    pluginStats: null,
    mediaUploaded: 0,
    extensions: new Set(),
  };

  // ==================== Import Global Plugin Data ====================
  if (options.plugins !== false) {
    console.log();
    log.info('Importing global plugin data...');

    stats.pluginStats = await importAllPlugins(client, config.importDir, manifest, options.dryRun);

    if (stats.pluginStats.plugins.size > 0) {
      for (const [slug, info] of stats.pluginStats.plugins) {
        const details = [];
        if (info.options > 0) details.push(`${info.options} options`);
        if (info.items > 0) details.push(`${info.items} items`);
        log.success(`${info.name}: ${details.join(', ')}`);
      }
    } else {
      log.info('No global plugin data found');
    }
  }

  // ==================== Import Posts ====================
  if (config.contentType === 'posts' || config.contentType === 'all') {
    console.log();
    log.info('Processing posts...');

    const postsDir = join(config.importDir, 'posts');
    const postSlugs = await listSubdirs(postsDir);

    if (postSlugs.length === 0) {
      log.info('No posts found to import');
    } else {
      log.info(`Found ${postSlugs.length} posts`);

      for (const slug of postSlugs) {
        try {
          const result = await importItem(slug, 'posts', config, client, stats);

          if (result.extensions) {
            result.extensions.forEach(ext => stats.extensions.add(ext));
          }

          if (result.action === 'create' || result.action === 'would-create') {
            stats.posts.created++;
          } else if (result.action === 'update' || result.action === 'would-update') {
            stats.posts.updated++;
          } else {
            stats.posts.skipped++;
          }
        } catch (error) {
          log.error(`Failed to import post ${slug}: ${error.message}`);
          stats.posts.failed++;
        }
      }
    }
  }

  // ==================== Import Pages ====================
  if (config.contentType === 'pages' || config.contentType === 'all') {
    console.log();
    log.info('Processing pages...');

    const pagesDir = join(config.importDir, 'pages');
    const pageSlugs = await listSubdirs(pagesDir);

    if (pageSlugs.length === 0) {
      log.info('No pages found to import');
    } else {
      log.info(`Found ${pageSlugs.length} pages`);

      for (const slug of pageSlugs) {
        try {
          const result = await importItem(slug, 'pages', config, client, stats);

          if (result.extensions) {
            result.extensions.forEach(ext => stats.extensions.add(ext));
          }

          if (result.action === 'create' || result.action === 'would-create') {
            stats.pages.created++;
          } else if (result.action === 'update' || result.action === 'would-update') {
            stats.pages.updated++;
          } else {
            stats.pages.skipped++;
          }
        } catch (error) {
          log.error(`Failed to import page ${slug}: ${error.message}`);
          stats.pages.failed++;
        }
      }
    }
  }

  // ==================== Summary ====================
  console.log();
  console.log(chalk.bold('═══════════════════════════════════════'));
  console.log(chalk.bold('Import Summary'));
  console.log(chalk.bold('═══════════════════════════════════════'));

  console.log(chalk.bold('  Posts:'));
  console.log(`    Created: ${stats.posts.created}`);
  console.log(`    Updated: ${stats.posts.updated}`);
  console.log(`    Skipped: ${stats.posts.skipped}`);
  console.log(`    Failed:  ${stats.posts.failed}`);

  console.log(chalk.bold('  Pages:'));
  console.log(`    Created: ${stats.pages.created}`);
  console.log(`    Updated: ${stats.pages.updated}`);
  console.log(`    Skipped: ${stats.pages.skipped}`);
  console.log(`    Failed:  ${stats.pages.failed}`);

  if (stats.pluginStats?.plugins.size > 0) {
    console.log(chalk.bold('  Global Plugin Data:'));
    for (const [slug, info] of stats.pluginStats.plugins) {
      const details = [];
      if (info.options > 0) details.push(`${info.options} options`);
      if (info.items > 0) details.push(`${info.items} items`);
      console.log(`    ${chalk.magenta(info.name)}: ${details.join(', ')}`);
    }
  }

  if (stats.mediaUploaded > 0) {
    console.log(`  Media uploaded: ${stats.mediaUploaded}`);
  }

  if (stats.extensions.size > 0) {
    console.log();
    console.log(chalk.bold('  Per-Content Plugin Data:'));
    for (const ext of stats.extensions) {
      console.log(`    ${chalk.cyan(ext)}`);
    }
  }

  console.log(chalk.bold('═══════════════════════════════════════'));
  console.log();

  if (options.dryRun) {
    log.info('DRY-RUN complete - no changes were made');
  } else {
    log.success('Import complete!');
  }
}

// Run
main().catch((error) => {
  log.error(`Unexpected error: ${error.message}`);
  if (options.verbose) {
    console.error(error.stack);
  }
  process.exit(1);
});
