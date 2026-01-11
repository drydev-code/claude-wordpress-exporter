# wp-export

Export WordPress content from a WordPress site to local files for editing.

## Script Reference

The script `wp-export.js` is bundled in this skill folder.

## Quick Start

```bash
node wp-export.js
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-u, --url <url>` | WordPress site URL | `WP_REMOTE_URL` env |
| `--user <user>` | WordPress username | `WP_REMOTE_USER` env |
| `--password <pass>` | Application password | `WP_REMOTE_APP_PASSWORD` env |
| `-o, --output <dir>` | Output directory | `./export` |
| `-t, --type <type>` | `posts`, `pages`, or `all` | `all` |
| `-s, --status <status>` | `publish`, `draft`, or `all` | `publish` |
| `--no-media` | Skip downloading media files | - |
| `--no-plugins` | Skip exporting plugin data | - |
| `-v, --verbose` | Verbose output | - |

## Examples

```bash
# Export all published content
node wp-export.js

# Export only pages
node wp-export.js --type pages

# Export including drafts
node wp-export.js --status all

# Export without media (faster)
node wp-export.js --no-media
```

## Export Structure

```
export/
├── manifest.json               # Export summary with all content info
├── contact-form-7.json         # CF7 forms (if detected)
├── seo-by-rank-math.json       # Rank Math options (if detected)
├── _wordpress-plugin/
│   └── expose-all-meta.php     # MU-plugin for full meta access
├── posts/
│   └── {post-slug}/
│       ├── body.html           # Gutenberg block content
│       ├── metadata.json       # Post metadata (id, title, status, etc.)
│       ├── seo-by-rank-math.json  # Rank Math SEO fields
│       ├── wordpress-seo.json     # Yoast SEO fields
│       ├── media/              # Downloaded images
│       └── media-mapping.json  # Original URL → local file mapping
└── pages/
    └── {page-slug}/
        └── ... (same structure)
```

## Supported Plugins (Auto-detected)

| Plugin | Global File | Per-Content File |
|--------|-------------|------------------|
| Contact Form 7 | `contact-form-7.json` | - |
| Rank Math SEO | `seo-by-rank-math.json` | `seo-by-rank-math.json` |
| Yoast SEO | `wordpress-seo.json` | `wordpress-seo.json` |
| WooCommerce | `woocommerce.json` | `woocommerce.json` |
| ACF | `acf.json` | `acf.json` |

## Plugin Detection Logic

The script detects plugins via:
1. `/wp-json/wp/v2/plugins` endpoint (if accessible)
2. REST API namespaces fallback
3. Meta prefix matching:
   - `rank_math_*` → Rank Math
   - `_yoast_wpseo_*` → Yoast
   - `_wc_*`, `_product_*` → WooCommerce
   - `_acf_*` → ACF
   - `_elementor_*` → Elementor
   - `wpcf7_*` → Contact Form 7

## Full Meta Access Setup

For complete plugin meta export, install the MU-plugin on source WordPress:

```bash
cp export/_wordpress-plugin/expose-all-meta.php \
   /path/to/wordpress/wp-content/mu-plugins/
```

This adds the `all_meta` field to REST API responses with full post meta.

## Bundled Scripts

All scripts are bundled in this skills folder:
- `wp-export.js` - Main export script
- `lib/api-client.js` - WordPress REST API client
- `lib/file-utils.js` - File operations
- `lib/media-handler.js` - Media download/upload
- `config.js` - Configuration loading
