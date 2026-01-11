# HTML to WordPress Converter

Convert a static HTML website to a fully functional WordPress installation with Docker, custom theme, and Gutenberg pages.

## Command Usage
```
/wp-from-html [html-source-path] [wp-site.yml]
```

Arguments:
- `html-source-path`: Path to folder containing static HTML files (optional, defaults to `./src`)
- `wp-site.yml`: Path to configuration file (optional, will prompt interactively if missing)

---

## Role: WP Conversion Orchestrator

You are a lightweight orchestrator that:
- **ONLY** manages phase delegation and verification
- **NEVER** implements code directly (delegates to sub-agents)
- **MAINTAINS** minimal context by reading only status files
- **TRACKS** progress in `.wp-claude/` for smart resumption
- **DELEGATES** all implementation to specialized sub-agents

---

## Pre-Flight Check

Before starting any phase, perform these checks:

### 1. Check for Existing State
```bash
# Check if state file exists
if [ -f ".wp-claude/STATE.json" ]; then
    echo "Found existing state - checking for resumption point"
fi
```

Read `.wp-claude/STATE.json` if it exists:
- Find the first phase where `status != "completed"`
- If `in_progress`: Check sub-status for partial completion
- If `pending`: Start this phase
- Skip all completed phases

### 2. Validate Inputs

If starting fresh or at INITIALIZATION phase:
1. Check if `html-source-path` argument provided, otherwise use `./src`
2. Check if HTML source folder exists and contains `.html` files
3. Check if `wp-site.yml` exists, otherwise enter interactive config mode

---

## Phase Execution Sequence

Execute phases in order, skipping completed ones based on STATE.json:

| Phase | Name | Description |
|-------|------|-------------|
| 1 | INITIALIZATION | Create workspace, parse inputs, generate config |
| 2 | DOCKER_SETUP | Generate docker-compose.yml, start WordPress stack |
| 3 | WORDPRESS_INSTALL | Configure WordPress via WP-CLI |
| 4 | THEME_CREATION | Build custom theme from HTML structure |
| 5 | PAGE_CONVERSION | Convert HTML pages to Gutenberg (parallel) |
| 6 | VISUAL_TESTING | Chrome-based testing with auto-retry |
| 7 | COMPLETION | Generate final report |

---

## Phase 1: INITIALIZATION

**Executed by: Orchestrator (inline)**

### 1.1 Create Workspace Structure

```bash
mkdir -p .wp-claude/config
mkdir -p .wp-claude/status/phase_pages
mkdir -p .wp-claude/analysis
mkdir -p .wp-claude/logs
mkdir -p .wp-claude/archive
```

### 1.2 Initialize STATE.json

Create `.wp-claude/STATE.json`:
```json
{
  "version": "1.0",
  "started_at": "[CURRENT_TIMESTAMP]",
  "last_updated": "[CURRENT_TIMESTAMP]",
  "current_phase": "INITIALIZATION",
  "phases": {
    "INITIALIZATION": { "status": "in_progress" },
    "DOCKER_SETUP": { "status": "pending" },
    "WORDPRESS_INSTALL": { "status": "pending" },
    "THEME_CREATION": { "status": "pending" },
    "PAGE_CONVERSION": { "status": "pending", "pages_total": 0, "pages_completed": 0 },
    "VISUAL_TESTING": { "status": "pending", "iteration": 0 },
    "COMPLETION": { "status": "pending" }
  },
  "config": {}
}
```

### 1.3 Configuration Handling

**If `wp-site.yml` exists:** Read and validate the configuration file.

**If `wp-site.yml` does NOT exist:** Generate interactively using AskUserQuestion:

1. Scan HTML source folder for `.html` files
2. Ask user for:
   - Site name (default: folder name)
   - Site tagline (optional)
   - Admin email (required)
   - Admin username (default: admin)
   - Admin password (generate secure default)
   - Theme name (default: site name)
3. Auto-detect pages from HTML files
4. Confirm page list with user
5. Write generated config to `.wp-claude/config/wp-site.yml`

**wp-site.yml schema:**
```yaml
version: "1.0"
site:
  name: "My Website"
  tagline: "Welcome to my site"
  url: "http://localhost:8080"
  timezone: "Europe/Berlin"
  language: "en_US"
admin:
  username: "admin"
  password: "secure_password"
  email: "admin@example.com"
theme:
  name: "My Theme"
  slug: "my-theme"
  author: "Developer"
  version: "1.0.0"
source:
  html_path: "./src"
  homepage: "index.html"
pages:
  - file: "index.html"
    slug: "home"
    title: "Home"
    is_front_page: true
  - file: "about.html"
    slug: "about"
    title: "About"
assets:
  images: "upload"
  css: "theme"
  js: "theme"
  fonts: "cdn"
docker:
  wordpress_port: 8080
  mysql_port: 3306
  container_prefix: "wp"
```

### 1.4 Analyze HTML Structure

Spawn an analysis sub-agent:

```
You are an HTML Analysis Agent.

Instructions:
1. Read all HTML files from the source folder: [HTML_SOURCE_PATH]
2. For each HTML file, analyze:
   - Document structure (header, nav, main, footer, aside)
   - Navigation menu items and hierarchy
   - Common elements across pages (header, footer pattern)
   - CSS files referenced (external and inline)
   - JavaScript files referenced
   - Image assets used
   - Font references (local and CDN)
3. Identify:
   - Homepage (index.html or specified)
   - Page titles from <title> or <h1> tags
   - Content sections for Gutenberg conversion
4. Write analysis to:
   - .wp-claude/analysis/html_structure.json (structure per page)
   - .wp-claude/analysis/assets_inventory.json (all assets)
   - .wp-claude/analysis/navigation_map.json (nav structure)
5. Update STATE.json with pages_total count
```

### 1.5 Complete INITIALIZATION

Update STATE.json:
- Set `phases.INITIALIZATION.status` to `"completed"`
- Set `phases.INITIALIZATION.completed_at` to current timestamp
- Set `current_phase` to `"DOCKER_SETUP"`
- Populate `config` with values from wp-site.yml

Write status to `.wp-claude/status/phase_init.json`:
```json
{
  "status": "completed",
  "html_files_found": 4,
  "config_source": "generated|provided",
  "pages_detected": ["index.html", "about.html", "services.html", "contact.html"]
}
```

---

## Phase 2: DOCKER_SETUP

**Executed by: Docker Expert Sub-Agent**

Spawn a sub-agent with this prompt:

```
You are a Docker Setup Agent for WordPress conversion.

Read the configuration from .wp-claude/config/wp-site.yml

Instructions:
1. Generate docker-compose.yml in the project root with:

   services:
     db:
       image: mysql:8.0
       container_name: [PREFIX]-mysql
       restart: unless-stopped
       environment:
         MYSQL_DATABASE: wordpress
         MYSQL_USER: wordpress
         MYSQL_PASSWORD: wordpress_db_pass
         MYSQL_ROOT_PASSWORD: root_db_pass
       volumes:
         - db_data:/var/lib/mysql
       networks:
         - wp-network
       healthcheck:
         test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
         interval: 10s
         timeout: 5s
         retries: 10
         start_period: 30s

     wordpress:
       image: wordpress:latest
       container_name: [PREFIX]-site
       restart: unless-stopped
       depends_on:
         db:
           condition: service_healthy
       ports:
         - "[WORDPRESS_PORT]:80"
       environment:
         WORDPRESS_DB_HOST: db:3306
         WORDPRESS_DB_USER: wordpress
         WORDPRESS_DB_PASSWORD: wordpress_db_pass
         WORDPRESS_DB_NAME: wordpress
       volumes:
         - ./wp-data:/var/www/html
       networks:
         - wp-network
       healthcheck:
         test: ["CMD", "curl", "-f", "http://localhost:80"]
         interval: 30s
         timeout: 10s
         retries: 5
         start_period: 60s

     wpcli:
       image: wordpress:cli
       container_name: [PREFIX]-cli
       depends_on:
         wordpress:
           condition: service_healthy
       volumes:
         - ./wp-data:/var/www/html
       networks:
         - wp-network
       entrypoint: ["tail", "-f", "/dev/null"]
       user: "33:33"

   networks:
     wp-network:
       driver: bridge

   volumes:
     db_data:

2. Start the Docker stack:
   docker-compose up -d

3. Wait for all containers to be healthy:
   - Check db container health
   - Check wordpress container health
   - Verify wpcli container is running

4. Verify WordPress files are present:
   ls ./wp-data/wp-includes/version.php

5. Write status to .wp-claude/status/phase_docker.json:
   {
     "status": "completed|failed",
     "containers": {
       "db": "healthy",
       "wordpress": "healthy",
       "wpcli": "running"
     },
     "wordpress_url": "http://localhost:[PORT]",
     "docker_compose_path": "./docker-compose.yml",
     "errors": []
   }

Error handling:
- If port is in use: Report error with suggestion to change port in config
- If Docker not running: Report error with instruction to start Docker
- If container fails to start: Include container logs in error
```

After sub-agent completes, read `.wp-claude/status/phase_docker.json`:
- If `status` is `"completed"`: Update STATE.json and proceed to next phase
- If `status` is `"failed"`: Report errors to user and halt

---

## Phase 3: WORDPRESS_INSTALL

**Executed by: WP-CLI Sub-Agent**

Spawn a sub-agent with this prompt:

```
You are a WordPress Installation Agent.

Read configuration from .wp-claude/config/wp-site.yml
Read docker status from .wp-claude/status/phase_docker.json

Instructions:
1. Wait for WordPress to be fully ready:
   docker exec [PREFIX]-cli wp core is-installed 2>/dev/null

   If not installed, run installation:
   docker exec [PREFIX]-cli wp core install \
     --url="[SITE_URL]" \
     --title="[SITE_NAME]" \
     --admin_user="[ADMIN_USERNAME]" \
     --admin_password="[ADMIN_PASSWORD]" \
     --admin_email="[ADMIN_EMAIL]" \
     --skip-email

2. Configure basic settings:
   docker exec [PREFIX]-cli wp option update blogdescription "[SITE_TAGLINE]"
   docker exec [PREFIX]-cli wp option update timezone_string "[TIMEZONE]"
   docker exec [PREFIX]-cli wp option update date_format "F j, Y"
   docker exec [PREFIX]-cli wp option update time_format "g:i a"
   docker exec [PREFIX]-cli wp option update permalink_structure "/%postname%/"
   docker exec [PREFIX]-cli wp rewrite flush

3. Delete default WordPress content:
   docker exec [PREFIX]-cli wp post delete 1 --force 2>/dev/null || true
   docker exec [PREFIX]-cli wp post delete 2 --force 2>/dev/null || true
   docker exec [PREFIX]-cli wp comment delete 1 --force 2>/dev/null || true

4. Delete default plugins:
   docker exec [PREFIX]-cli wp plugin delete akismet --force 2>/dev/null || true
   docker exec [PREFIX]-cli wp plugin delete hello --force 2>/dev/null || true

5. Create navigation menus:
   docker exec [PREFIX]-cli wp menu create "Primary Navigation"
   docker exec [PREFIX]-cli wp menu create "Footer Navigation"

6. Install recommended Gutenberg plugins (optional):
   docker exec [PREFIX]-cli wp plugin install stackable-ultimate-gutenberg-blocks --activate 2>/dev/null || echo "Plugin install skipped"

7. Verify installation:
   docker exec [PREFIX]-cli wp core version
   docker exec [PREFIX]-cli wp option get siteurl

8. Write status to .wp-claude/status/phase_wordpress.json:
   {
     "status": "completed|failed",
     "wordpress_version": "6.x.x",
     "admin_url": "[SITE_URL]/wp-admin",
     "login_url": "[SITE_URL]/wp-login.php",
     "settings_configured": [
       "blogdescription",
       "timezone_string",
       "permalink_structure"
     ],
     "menus_created": ["Primary Navigation", "Footer Navigation"],
     "plugins_installed": ["stackable-ultimate-gutenberg-blocks"],
     "errors": []
   }

Error handling:
- If wp core install fails: Check database connection, include error message
- If plugin install fails: Continue without plugin, note in status
- Include container logs for any failures
```

---

## Phase 4: THEME_CREATION

**Executed by: Theme Builder Sub-Agent**

Spawn a sub-agent with this prompt:

```
You are a WordPress Theme Creation Agent.

Read configuration from .wp-claude/config/wp-site.yml
Read HTML analysis from:
- .wp-claude/analysis/html_structure.json
- .wp-claude/analysis/assets_inventory.json
- .wp-claude/analysis/navigation_map.json

CRITICAL: Create a PROPER WordPress theme that uses WordPress features.
Do NOT just wrap HTML in PHP. The theme must integrate with:
- WordPress navigation menus (wp_nav_menu)
- WordPress customizer (custom logo, colors)
- WordPress template hierarchy
- WordPress block editor styles
- WordPress widget areas

Instructions:

1. Create theme directory structure:
   ./wp-data/wp-content/themes/[THEME_SLUG]/
   ├── style.css
   ├── theme.json              ← CRITICAL: Required for Gutenberg colors
   ├── functions.php
   ├── index.php
   ├── header.php
   ├── footer.php
   ├── front-page.php
   ├── page.php
   ├── single.php
   ├── archive.php
   ├── 404.php
   ├── sidebar.php
   ├── searchform.php
   ├── template-parts/
   │   ├── header/
   │   │   ├── site-branding.php
   │   │   └── navigation.php
   │   ├── footer/
   │   │   ├── footer-widgets.php
   │   │   └── site-info.php
   │   └── content/
   │       ├── content.php
   │       └── content-page.php
   ├── assets/
   │   ├── css/
   │   │   ├── main.css        ← Must include Gutenberg block styles
   │   │   └── editor-style.css
   │   ├── js/
   │   │   └── main.js
   │   └── images/
   ├── inc/
   │   ├── theme-setup.php
   │   ├── enqueue-scripts.php
   │   ├── customizer.php
   │   └── template-functions.php
   └── block-patterns/

2. Create style.css with proper theme header:
   /*
   Theme Name: [THEME_NAME]
   Theme URI:
   Author: [THEME_AUTHOR]
   Author URI:
   Description: Custom theme converted from static HTML
   Version: [THEME_VERSION]
   Requires at least: 6.0
   Tested up to: 6.4
   Requires PHP: 7.4
   License: GNU General Public License v2 or later
   License URI: http://www.gnu.org/licenses/gpl-2.0.html
   Text Domain: [THEME_SLUG]
   */

3. **CRITICAL: Create theme.json for Gutenberg block support**

   WITHOUT theme.json, Gutenberg blocks using color classes (like
   `has-stone-100-background-color`) will NOT render properly.

   Extract colors from HTML source CSS and create theme.json:
   ```json
   {
     "$schema": "https://schemas.wp.org/trunk/theme.json",
     "version": 3,
     "settings": {
       "color": {
         "palette": [
           {
             "slug": "primary",
             "color": "#0f172a",
             "name": "Primary"
           },
           {
             "slug": "secondary",
             "color": "#fdfbf7",
             "name": "Secondary"
           },
           {
             "slug": "accent",
             "color": "#7c9a92",
             "name": "Accent"
           },
           {
             "slug": "button",
             "color": "#d4a373",
             "name": "Button"
           }
           // Add ALL colors used in the HTML source
         ]
       },
       "typography": {
         "fontFamilies": [
           {
             "fontFamily": "'Inter', -apple-system, sans-serif",
             "slug": "primary",
             "name": "Primary Font"
           }
         ]
       },
       "layout": {
         "contentSize": "1024px",
         "wideSize": "1280px"
       }
     },
     "styles": {
       "color": {
         "background": "#ffffff",
         "text": "#1e293b"
       },
       "elements": {
         "button": {
           "color": {
             "background": "#d4a373",
             "text": "#ffffff"
           },
           "border": {
             "radius": "9999px"
           }
         },
         "link": {
           "color": {
             "text": "#7c9a92"
           }
         }
       }
     }
   }
   ```

   IMPORTANT: Every color slug used in Gutenberg blocks MUST be defined here.
   Common slugs: primary, secondary, accent, button, white, black,
   stone-50, stone-100, text, text-light

4. Create functions.php with theme setup:
   - add_theme_support() for: title-tag, post-thumbnails, custom-logo,
     html5, editor-styles, wp-block-styles, responsive-embeds, align-wide
   - register_nav_menus() for: primary, footer
   - register_sidebar() for: footer-widgets, sidebar
   - Enqueue styles and scripts properly
   - Add editor styles for Gutenberg

4. Create header.php:
   - Include <!DOCTYPE html> and <html> with language_attributes()
   - Include wp_head() in <head>
   - Extract header structure from HTML analysis
   - Use wp_nav_menu() for navigation (NOT hardcoded links)
   - Use custom_logo() or site branding functions
   - Include proper body_class()

5. Create footer.php:
   - Extract footer structure from HTML analysis
   - Use wp_nav_menu() for footer navigation
   - Include dynamic_sidebar() for widget areas
   - Include wp_footer() before </body>

6. Create page templates:
   - front-page.php for homepage
   - page.php for generic pages
   - Use the_content() to output Gutenberg blocks

7. Handle assets:
   - Copy CSS files from source to assets/css/ (respect assets.css config)
   - Copy JS files from source to assets/js/ (respect assets.js config)
   - Create editor-style.css with matching styles for Gutenberg
   - Keep CDN references for fonts (respect assets.fonts config)

8. **CRITICAL: Add Gutenberg block styles to main.css**

   The CSS MUST include styles for WordPress block classes. Without these,
   blocks will not display correctly even with theme.json defined.

   Required CSS patterns:
   ```css
   /* CSS Custom Properties - match theme.json colors */
   :root {
     --color-primary: #0f172a;
     --color-secondary: #fdfbf7;
     --color-accent: #7c9a92;
     --color-button: #d4a373;
     --color-stone-50: #fafaf9;
     --color-stone-100: #f5f5f4;
   }

   /* Gutenberg Color Classes - REQUIRED for each color in theme.json */
   .has-primary-color { color: var(--color-primary) !important; }
   .has-primary-background-color { background-color: var(--color-primary) !important; }
   .has-secondary-color { color: var(--color-secondary) !important; }
   .has-secondary-background-color { background-color: var(--color-secondary) !important; }
   .has-accent-color { color: var(--color-accent) !important; }
   .has-accent-background-color { background-color: var(--color-accent) !important; }
   .has-button-color { color: var(--color-button) !important; }
   .has-button-background-color { background-color: var(--color-button) !important; }
   .has-stone-50-background-color { background-color: var(--color-stone-50) !important; }
   .has-stone-100-background-color { background-color: var(--color-stone-100) !important; }

   /* Core Block Styles */
   .wp-block-cover {
     position: relative;
     display: flex;
     align-items: center;
     justify-content: center;
     min-height: 400px;
     padding: 2rem;
   }

   .wp-block-group {
     padding: 3rem 1.5rem;
   }

   .wp-block-group.alignfull {
     width: 100vw;
     margin-left: calc(-50vw + 50%);
     margin-right: calc(-50vw + 50%);
   }

   .wp-block-columns {
     display: flex;
     flex-wrap: wrap;
     gap: 2rem;
   }

   .wp-block-column {
     flex: 1;
     min-width: 250px;
   }

   .wp-block-buttons {
     display: flex;
     flex-wrap: wrap;
     gap: 1rem;
   }

   .wp-block-button__link {
     display: inline-block;
     padding: 0.75rem 1.5rem;
     border-radius: 9999px;
     text-decoration: none;
     transition: all 0.2s;
   }

   /* Button variants */
   .wp-block-button.is-style-outline .wp-block-button__link {
     background: transparent;
     border: 2px solid currentColor;
   }
   ```

   Generate color classes for EVERY color defined in theme.json palette.

9. Create block patterns from common HTML sections:
   - Hero sections → block-patterns/hero-section.php
   - Feature grids → block-patterns/feature-grid.php
   - CTA sections → block-patterns/cta-section.php
   Register patterns using register_block_pattern()

10. Activate the theme:
    docker exec [PREFIX]-cli wp theme activate [THEME_SLUG]

11. Assign navigation menus:
    - Parse navigation from HTML analysis
    - Add menu items via wp-cli:
      docker exec [PREFIX]-cli wp menu item add-custom "Primary Navigation" "Home" "/"
    - Assign menu to location:
      docker exec [PREFIX]-cli wp menu location assign "Primary Navigation" primary

12. Write status to .wp-claude/status/phase_theme.json:
    {
      "status": "completed|failed",
      "theme_path": "./wp-data/wp-content/themes/[THEME_SLUG]",
      "files_created": ["style.css", "functions.php", ...],
      "features_registered": ["nav_menus", "sidebars", "block_patterns"],
      "assets_copied": {
        "css": ["main.css"],
        "js": ["main.js"],
        "images": ["logo.png"]
      },
      "menu_items_created": 5,
      "block_patterns_registered": 3,
      "errors": []
    }

IMPORTANT: Test the theme by checking:
- Theme is active: docker exec [PREFIX]-cli wp theme list --status=active
- No PHP errors: Check ./wp-data/wp-content/debug.log if exists
```

---

## Phase 5: PAGE_CONVERSION

**Executed by: Parallel Page Converter Sub-Agents**

For EACH page detected in INITIALIZATION, spawn a separate sub-agent:

```
You are a Page Conversion Agent for page: [PAGE_FILE]

Your ONLY job is to convert this single HTML page to a WordPress Gutenberg page.
Do NOT convert any other pages.

Read:
- Page HTML from: [HTML_SOURCE_PATH]/[PAGE_FILE]
- Page analysis from: .wp-claude/analysis/html_structure.json (section for this page)
- Asset inventory from: .wp-claude/analysis/assets_inventory.json

Instructions:

1. Read the HTML file and identify the MAIN CONTENT area only.
   - Skip header content (handled by theme's header.php)
   - Skip footer content (handled by theme's footer.php)
   - Skip navigation (handled by theme's wp_nav_menu)
   - Focus on <main>, <article>, or primary content container

2. Convert HTML elements to Gutenberg blocks:

   HTML Element              → Gutenberg Block
   ─────────────────────────────────────────────
   <h1> to <h6>              → core/heading (with level attribute)
   <p>                       → core/paragraph
   <img>                     → core/image (upload to media library first)
   <ul>, <ol>                → core/list
   <blockquote>              → core/quote
   <table>                   → core/table
   <video>                   → core/video
   <a class="button">        → core/button inside core/buttons
   <figure>                  → core/image with caption
   <section>, <div> wrapper  → core/group
   Column layouts            → core/columns with core/column children
   Hero/banner sections      → core/cover

3. Handle images:
   For each image in the content:
   a. Check if it's a local image or external URL
   b. For local images, upload to WordPress media library:
      docker exec [PREFIX]-cli wp media import "[IMAGE_PATH]" --title="[ALT_TEXT]" --porcelain
   c. Get the attachment URL:
      docker exec [PREFIX]-cli wp post list --post_type=attachment --field=url --post__in=[ATTACHMENT_ID]
   d. Use the WordPress URL in the image block

4. Generate Gutenberg block markup:
   Example format:
   <!-- wp:heading {"level":2} -->
   <h2 class="wp-block-heading">Section Title</h2>
   <!-- /wp:heading -->

   <!-- wp:paragraph -->
   <p>Paragraph content here.</p>
   <!-- /wp:paragraph -->

   <!-- wp:image {"id":123,"sizeSlug":"large"} -->
   <figure class="wp-block-image size-large">
     <img src="http://localhost:8080/wp-content/uploads/2024/01/image.jpg" alt="Description" class="wp-image-123"/>
   </figure>
   <!-- /wp:image -->

5. Preserve CSS classes where meaningful:
   - Add className attribute to blocks for custom styling
   - Example: <!-- wp:group {"className":"hero-section"} -->

6. Create the WordPress page:
   BLOCK_CONTENT="[ESCAPED_BLOCK_MARKUP]"

   docker exec [PREFIX]-cli wp post create \
     --post_type=page \
     --post_title="[PAGE_TITLE]" \
     --post_content="$BLOCK_CONTENT" \
     --post_status=publish \
     --post_name="[PAGE_SLUG]" \
     --porcelain

7. If this is the front page (is_front_page: true in config):
   PAGE_ID=$(docker exec [PREFIX]-cli wp post list --post_type=page --name="[PAGE_SLUG]" --field=ID)
   docker exec [PREFIX]-cli wp option update show_on_front page
   docker exec [PREFIX]-cli wp option update page_on_front $PAGE_ID

8. Add page to navigation menu if in navigation_map:
   docker exec [PREFIX]-cli wp menu item add-post "Primary Navigation" $PAGE_ID

9. Write status to .wp-claude/status/phase_pages/page_[PAGE_SLUG].json:
   {
     "status": "completed|failed",
     "source_file": "[PAGE_FILE]",
     "page_id": 123,
     "page_url": "http://localhost:8080/[PAGE_SLUG]/",
     "page_title": "[PAGE_TITLE]",
     "blocks_created": [
       {"type": "core/heading", "count": 3},
       {"type": "core/paragraph", "count": 8},
       {"type": "core/image", "count": 2}
     ],
     "images_uploaded": [
       {"file": "hero.jpg", "attachment_id": 45, "url": "..."}
     ],
     "is_front_page": true|false,
     "added_to_menu": true|false,
     "errors": []
   }

Exit after writing your status file. Do NOT process other pages.
```

**IMPORTANT: Spawn ALL page agents simultaneously for parallel execution.**

After spawning all agents, monitor `.wp-claude/status/phase_pages/` for completion:
- Poll every 5 seconds for new status files
- Track pages_completed vs pages_total
- Update STATE.json with progress
- Continue to next phase when all pages complete

---

## Phase 6: VISUAL_TESTING

**Executed by: Chrome Testing Sub-Agent**

**CRITICAL: Chrome is ONLY for testing. Do NOT configure, edit, or modify anything via Chrome.**

Spawn a testing sub-agent:

```
You are a Visual Testing Agent for WordPress conversion.

IMPORTANT: Use Chrome ONLY for visual verification. Do NOT:
- Click WordPress admin links
- Modify any settings
- Edit any content
- Install anything

Read completed pages from .wp-claude/status/phase_pages/*.json

Instructions:

1. Get browser context:
   Use mcp__claude-in-chrome__tabs_context_mcp to check existing tabs
   Use mcp__claude-in-chrome__tabs_create_mcp to create a new tab for testing

2. For each page with status "completed":

   a. Navigate to page URL:
      Use mcp__claude-in-chrome__navigate with the page URL

   b. Wait for page to fully load:
      Use mcp__claude-in-chrome__computer with action "wait" (2-3 seconds)

   c. Take a screenshot:
      Use mcp__claude-in-chrome__computer with action "screenshot"

   d. Verify page structure using mcp__claude-in-chrome__read_page:
      - Header element exists (logo/navigation visible)
      - Main content area has expected content
      - Footer element exists
      - No "404", "Error", or "Not Found" visible

   e. Check for broken images:
      Use mcp__claude-in-chrome__find with query "broken image" or "missing image"
      Look for images with error states

   f. Check browser console for JavaScript errors:
      Use mcp__claude-in-chrome__read_console_messages with onlyErrors: true
      Pattern: "error|Error|ERROR|exception|Exception"

   g. Record test result:
      PASS: All checks successful
      FAIL: Document specific issues found

3. Categorize any failures:
   - THEME_ISSUE: Header/footer/navigation not rendering correctly
   - CONTENT_ISSUE: Blocks not displaying properly
   - ASSET_ISSUE: Images, CSS, or JS not loading
   - JS_ISSUE: JavaScript console errors

4. Write test results to .wp-claude/status/phase_testing.json:
   {
     "status": "completed|failed",
     "iteration": 1,
     "pages_tested": 4,
     "pages_passed": 3,
     "pages_failed": 1,
     "results": [
       {
         "page": "about",
         "url": "http://localhost:8080/about/",
         "status": "PASS|FAIL",
         "screenshot_taken": true,
         "issues": []
       },
       {
         "page": "contact",
         "url": "http://localhost:8080/contact/",
         "status": "FAIL",
         "screenshot_taken": true,
         "issues": [
           {
             "type": "ASSET_ISSUE",
             "description": "Contact form image not loading",
             "element": "img.contact-hero"
           }
         ]
       }
     ]
   }
```

### Auto-Retry Logic (Maximum 3 iterations)

After testing completes, check results:

**If all pages passed:** Proceed to COMPLETION phase.

**If any pages failed:**

1. For each failure, spawn a Fix Agent:

```
You are a Fix Agent for [ISSUE_TYPE] on page [PAGE_NAME].

Issue details from testing:
- Type: [ISSUE_TYPE]
- Description: [ISSUE_DESCRIPTION]
- Element: [ELEMENT_INFO]

Instructions:
1. Analyze the specific issue
2. Identify root cause:
   - ASSET_ISSUE: Re-upload missing image, fix path, check media library
   - THEME_ISSUE: Check template files, fix PHP errors
   - CONTENT_ISSUE: Regenerate block content, fix markup
   - JS_ISSUE: Check enqueued scripts, fix console errors

3. Implement the fix:
   - Use wp-cli for content/media fixes
   - Edit theme files directly for template fixes
   - Re-import assets if missing

4. Write fix status to .wp-claude/status/fixes/fix_[PAGE]_[ITERATION].json:
   {
     "issue_type": "[TYPE]",
     "page": "[PAGE]",
     "fix_applied": "Description of what was fixed",
     "files_modified": ["path/to/file"],
     "status": "fixed|unable_to_fix",
     "notes": "Additional context"
   }
```

2. After all fix agents complete, re-run visual testing (increment iteration)

3. After 3 iterations, if still failing:
   - Mark phase as "partial_success"
   - Document remaining issues
   - Proceed to COMPLETION with warnings

---

## Phase 7: COMPLETION

**Executed by: Orchestrator (inline)**

Generate final report and clean up:

### 7.1 Generate CONVERSION_REPORT.md

Create `./CONVERSION_REPORT.md`:

```markdown
# WordPress Conversion Report

## Summary
- **Started**: [START_TIMESTAMP]
- **Completed**: [END_TIMESTAMP]
- **Duration**: [DURATION]
- **Status**: SUCCESS | PARTIAL_SUCCESS | FAILED

## Site Information
- **URL**: http://localhost:[PORT]
- **Admin URL**: http://localhost:[PORT]/wp-admin
- **Admin User**: [USERNAME]
- **Theme**: [THEME_NAME]

## Pages Created
| Page | URL | Status | Blocks |
|------|-----|--------|--------|
| Home | /home/ | OK | 12 |
| About | /about/ | OK | 8 |
| ... | ... | ... | ... |

## Media Uploaded
- [COUNT] images uploaded to Media Library
- Total size: [SIZE]

## Theme Features
- Primary Navigation Menu ([COUNT] items)
- Footer Navigation Menu
- [COUNT] Widget Areas
- [COUNT] Custom Block Patterns

## Visual Testing Results
- Iterations: [COUNT]
- All pages passed: YES/NO
- Issues resolved: [COUNT]

## Known Issues (if any)
[List any unresolved issues]

## Next Steps
1. Review and customize theme colors in Appearance > Customize
2. Add site logo via Appearance > Customize > Site Identity
3. Configure SEO plugin settings (if installed)
4. Review and edit page content as needed
5. Set up contact forms if applicable

## Credentials
- Admin Username: [USERNAME]
- Admin Password: [PASSWORD]
- Database: wordpress / wordpress / wordpress_db_pass

## Docker Commands
- Start: `docker-compose up -d`
- Stop: `docker-compose down`
- Logs: `docker-compose logs -f`
- WP-CLI: `docker exec [PREFIX]-cli wp [command]`
```

### 7.2 Update Final State

Update `.wp-claude/STATE.json`:
- Set all phases to `"completed"` (or `"partial_success"` / `"failed"`)
- Set `current_phase` to `"COMPLETED"`
- Add `completed_at` timestamp

### 7.3 Archive State Files (Optional)

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p .wp-claude/archive/$TIMESTAMP
cp -r .wp-claude/status/* .wp-claude/archive/$TIMESTAMP/
cp .wp-claude/STATE.json .wp-claude/archive/$TIMESTAMP/
```

### 7.4 Generate CLAUDE.md

Create `./CLAUDE.md` with instructions for future edits via CLI/API:

```markdown
# WordPress Site - Claude Code Instructions

This WordPress site was converted from static HTML using the wp-from-html command.

## Site Information
- **URL**: http://localhost:[PORT]
- **Admin**: http://localhost:[PORT]/wp-admin
- **Theme**: [THEME_SLUG]
- **Container Prefix**: [PREFIX]

## Making Changes via Claude Code CLI

### Edit Page Content
```bash
# Get page ID
docker exec [PREFIX]-cli wp post list --post_type=page --fields=ID,post_title

# Update page content (use Gutenberg block markup)
docker exec [PREFIX]-cli wp post update [PAGE_ID] --post_content="[BLOCK_CONTENT]"

# Edit page in WordPress admin
# Navigate to: http://localhost:[PORT]/wp-admin/post.php?post=[PAGE_ID]&action=edit
```

### Edit Theme Files
Theme files are located at: `./wp-data/wp-content/themes/[THEME_SLUG]/`

Key files:
- `style.css` - Theme metadata and base styles
- `theme.json` - Gutenberg color palette and typography
- `functions.php` - Theme setup and features
- `header.php` - Site header template
- `footer.php` - Site footer template
- `front-page.php` - Homepage template
- `page.php` - Generic page template
- `assets/css/main.css` - Main stylesheet (includes Gutenberg block styles)
- `assets/js/main.js` - Main JavaScript

### Modify Colors
1. Update `theme.json` color palette
2. Update CSS custom properties in `assets/css/main.css`
3. Update `.has-[slug]-background-color` classes in CSS

### Add New Pages
```bash
# Create new page
docker exec [PREFIX]-cli wp post create \
  --post_type=page \
  --post_title="New Page" \
  --post_content="<!-- wp:paragraph --><p>Content</p><!-- /wp:paragraph -->" \
  --post_status=publish \
  --post_name="new-page"

# Add to navigation menu
PAGE_ID=$(docker exec [PREFIX]-cli wp post list --post_type=page --name=new-page --field=ID)
docker exec [PREFIX]-cli wp menu item add-post "Primary Navigation" $PAGE_ID
```

### Upload Media
```bash
# Upload image to media library
docker exec [PREFIX]-cli wp media import "/path/to/image.jpg" --title="Image Title"
```

### WP-CLI Reference
```bash
# List all pages
docker exec [PREFIX]-cli wp post list --post_type=page

# Get site options
docker exec [PREFIX]-cli wp option get siteurl

# Flush cache
docker exec [PREFIX]-cli wp cache flush

# Flush permalinks
docker exec [PREFIX]-cli wp rewrite flush

# List menus
docker exec [PREFIX]-cli wp menu list

# Export database
docker exec [PREFIX]-cli wp db export /var/www/html/backup.sql
```

## Docker Commands
```bash
# Start site
docker-compose up -d

# Stop site
docker-compose down

# View logs
docker-compose logs -f

# Restart WordPress
docker-compose restart wordpress

# Access WordPress container shell
docker exec -it [PREFIX]-site bash
```

## Gutenberg Block Reference

When editing page content, use proper Gutenberg block markup:

### Heading
\`\`\`html
<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">Title</h2>
<!-- /wp:heading -->
\`\`\`

### Paragraph
\`\`\`html
<!-- wp:paragraph -->
<p>Text content here.</p>
<!-- /wp:paragraph -->
\`\`\`

### Group with Background
\`\`\`html
<!-- wp:group {"backgroundColor":"stone-100","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-stone-100-background-color has-background">
  <!-- nested blocks -->
</div>
<!-- /wp:group -->
\`\`\`

### Columns
\`\`\`html
<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column -->
  <div class="wp-block-column">Column 1</div>
  <!-- /wp:column -->
  <!-- wp:column -->
  <div class="wp-block-column">Column 2</div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
\`\`\`

### Button
\`\`\`html
<!-- wp:buttons -->
<div class="wp-block-buttons">
  <!-- wp:button {"backgroundColor":"button"} -->
  <div class="wp-block-button">
    <a class="wp-block-button__link has-button-background-color has-background">Click Me</a>
  </div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
\`\`\`

## Troubleshooting

### Blocks not rendering colors
- Ensure color slug is defined in `theme.json` palette
- Ensure `.has-[slug]-background-color` class exists in CSS

### Styles not loading
```bash
# Clear cache
docker exec [PREFIX]-cli wp cache flush

# Check if theme is active
docker exec [PREFIX]-cli wp theme list --status=active
```

### Database issues
```bash
# Check database connection
docker exec [PREFIX]-cli wp db check

# Repair database
docker exec [PREFIX]-cli wp db repair
```
```

### 7.5 Final Output

Display to user:
- Conversion complete message
- Site URL and admin URL
- Login credentials
- Path to full report
- Any warnings or issues to address

---

## Error Handling Reference

| Error | Detection | Recovery |
|-------|-----------|----------|
| Port in use | Docker startup fails | Suggest changing port in config, re-run |
| Docker not running | `docker ps` fails | Prompt user to start Docker Desktop |
| WP-CLI timeout | Command hangs | Retry with longer timeout |
| Image upload fails | wp media import fails | Log error, use placeholder, continue |
| Theme activation fails | wp theme activate fails | Check PHP errors in debug.log |
| Block parsing fails | Invalid HTML structure | Fall back to HTML block |
| Chrome connection fails | MCP tools error | Check Chrome extension is running |

## Graceful Degradation

For non-critical failures, continue with degraded functionality:
- Image upload fails → Use placeholder URL, log for manual fix
- Complex HTML pattern fails → Fall back to core/html block
- Optional plugin fails → Skip plugin, continue
- Single page fails → Complete other pages, note in report

---

## State File Reference

### STATE.json
Primary state tracking file for resumption logic.

### phase_*.json
Per-phase status with details and errors.

### page_*.json
Per-page conversion status with block counts and media.

### fix_*.json
Fix attempt records for testing retry loop.

---

## Critical Requirements Checklist

Before completing the conversion, verify these critical items that commonly cause issues:

### Theme Requirements

- [ ] **theme.json exists** - Without this, Gutenberg color classes won't work
- [ ] **All colors defined in theme.json** - Every color slug used in blocks must be in the palette
- [ ] **CSS custom properties defined** - `:root` variables matching theme.json colors
- [ ] **Gutenberg color classes in CSS** - `.has-[slug]-background-color` for each color
- [ ] **Block styles in CSS** - Styles for `.wp-block-cover`, `.wp-block-group`, `.wp-block-columns`, etc.

### Common Pitfalls

| Issue | Symptom | Fix |
|-------|---------|-----|
| Missing theme.json | Blocks have no background colors | Create theme.json with color palette |
| Missing color CSS classes | Background colors not applied | Add `.has-[slug]-background-color` rules |
| Wrong color slugs | Colors don't match design | Ensure slugs in blocks match theme.json |
| Missing block styles | Layouts broken (columns, groups) | Add CSS for `.wp-block-*` classes |
| Cache not flushed | Old styles showing | Run `wp cache flush && wp rewrite flush` |

### Theme Files Verification

After theme creation, verify these files exist and are correct:

```bash
# Check theme structure
ls -la ./wp-data/wp-content/themes/[THEME_SLUG]/

# Required files:
# - style.css (with theme header)
# - theme.json (with color palette!)
# - functions.php
# - header.php
# - footer.php
# - assets/css/main.css (with Gutenberg block styles!)

# Verify theme.json has color palette
grep -A 20 '"palette"' ./wp-data/wp-content/themes/[THEME_SLUG]/theme.json

# Verify CSS has color classes
grep 'has-.*-background-color' ./wp-data/wp-content/themes/[THEME_SLUG]/assets/css/main.css
```

### Color System Checklist

For each color in the design:

1. Define in `theme.json` → `settings.color.palette[]`
2. Define CSS variable → `:root { --color-[slug]: #hex; }`
3. Create color class → `.has-[slug]-color { color: var(--color-[slug]); }`
4. Create background class → `.has-[slug]-background-color { background-color: var(--color-[slug]); }`

Example for a color named "accent" (#7c9a92):

```json
// theme.json
{ "slug": "accent", "color": "#7c9a92", "name": "Accent" }
```

```css
/* main.css */
:root { --color-accent: #7c9a92; }
.has-accent-color { color: var(--color-accent) !important; }
.has-accent-background-color { background-color: var(--color-accent) !important; }
```
