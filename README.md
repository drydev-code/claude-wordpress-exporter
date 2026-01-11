# Claude WordPress Skills

A Claude Code skills marketplace for WordPress content management, SEO optimization, and Gutenberg editing.

## Installation

Add this marketplace to Claude Code:

```bash
/plugin marketplace add drydev-code/claude-wordpress-toolbox
```

Then install the plugin:

```bash
/plugin install wordpress-tools
```

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| WordPress Export | `/wp-export` | Export WordPress content via REST API |
| WordPress Import | `/wp-import` | Import content to WordPress |
| WordPress Remote | `/wp-remote` | Connect to remote WordPress via REST API |
| HTML to WordPress | `/wp-from-html` | Convert static HTML to WordPress with Docker |
| Gutenberg Editor | `/gutenberg-editor` | Edit content with Gutenberg blocks |
| Plugin Research | `/wp-plugin-research` | Research WordPress plugin APIs |
| SEO Expert | `/seo-expert` | Optimize SEO with comprehensive rules |

## Skills Overview

### `/wp-export`
Export WordPress posts, pages, and plugin data to local files for editing. Supports:
- Posts and pages with full metadata
- Media files with URL mapping
- Plugin data (Rank Math, Yoast, Contact Form 7, ACF, WooCommerce)
- Gutenberg block content

### `/wp-import`
Import edited content back to WordPress. Features:
- Create, update, or sync modes
- Media re-upload with URL replacement
- Plugin meta restoration
- Dry-run preview

### `/wp-remote`
Connect to remote WordPress sites via REST API:
- Secure Application Password authentication
- Execute WordPress operations remotely
- Pagination handling for large sites
- UTF-8 encoding support (PowerShell recommended on Windows)

### `/wp-from-html`
Convert static HTML websites to fully functional WordPress:
- Docker-based WordPress stack
- Custom theme generation from HTML structure
- Gutenberg block conversion
- Visual testing with auto-retry
- Smart resumption for interrupted conversions

### `/gutenberg-editor`
Expert knowledge for editing WordPress Gutenberg block content:
- Complete block syntax reference
- All core blocks (paragraph, heading, image, columns, cover, etc.)
- Block attributes and validation rules
- Best practices for block structure

### `/wp-plugin-research`
Research and document WordPress plugin APIs:
- Plugin detection patterns
- REST API endpoint discovery
- Data structure documentation
- Integration planning templates

### `/seo-expert`
Comprehensive SEO optimization with 14+ rule categories:
- Title and meta description optimization
- Heading structure (H1-H6)
- Image SEO and alt text
- Internal linking strategy
- Schema markup guidance
- Mobile and speed optimization
- Character limit quick reference

## Requirements

For full functionality, your WordPress site needs:

1. **REST API enabled** (default in WordPress)
2. **Application Password** configured for authentication
3. **MU-Plugin** (optional) for full meta access

## Configuration

Create `.env` in your project root:

```env
WP_REMOTE_URL=https://your-wordpress-site.com
WP_REMOTE_USER=admin
WP_REMOTE_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

## Usage Examples

### Export and edit content
```bash
# Export all content
cd scripts && node wp-export.js

# Edit files in export/pages/home/
# - body.html (Gutenberg content)
# - seo-by-rank-math.json (SEO settings)

# Import changes
node wp-import.js --mode update
```

### Optimize SEO
```
/seo-expert

Optimize the SEO for export/pages/home/
```

### Edit Gutenberg content
```
/gutenberg-editor

Add a hero section to export/pages/home/body.html
```

## Repository Structure

```
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── plugins/
│   └── wordpress-tools/
│       ├── .claude-plugin/
│       │   └── plugin.json       # Plugin manifest
│       ├── skills/
│       │   ├── wp-export/SKILL.md
│       │   ├── wp-import/SKILL.md
│       │   ├── wp-remote/SKILL.md
│       │   ├── wp-from-html/SKILL.md
│       │   ├── gutenberg-editor/SKILL.md
│       │   ├── wp-plugin-research/SKILL.md
│       │   └── seo-expert/SKILL.md
│       └── scripts/
│           ├── wp-export.js
│           ├── wp-import.js
│           ├── config.js
│           └── lib/
├── README.md
└── LICENSE
```

## License

MIT
