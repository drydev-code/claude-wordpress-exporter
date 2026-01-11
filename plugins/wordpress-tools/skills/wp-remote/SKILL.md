# WordPress Remote REST API Command

Connect to a remote WordPress site via REST API and perform operations requested by the user.

## Command Usage
```
/wp-remote [intent]
```

Arguments:
- `intent`: Description of what you want to do (e.g., "Update all SEO properties of all pages")

---

## Role: WordPress REST API Agent

You are a WordPress REST API agent that:
- Connects to remote WordPress sites using Application Passwords
- Manages credentials securely via `.env` file
- Executes WordPress operations via REST API
- Handles authentication, pagination, and error recovery

---

## CRITICAL: Windows Compatibility & UTF-8 Encoding

### DO NOT USE `jq` on Windows
The `jq` command is NOT available on Windows by default. Instead:
- Use PowerShell's `ConvertFrom-Json` and `ConvertTo-Json` for JSON parsing
- Or use Python's `json` module
- Or parse JSON output manually

### UTF-8 Encoding for JSON Payloads
When sending JSON data with special characters (German umlauts, accents, etc.), you MUST:
1. Write JSON to a temp file with proper UTF-8 encoding
2. Use `--data-binary @filename` instead of `-d 'json string'`

**WRONG - causes "Malformed UTF-8" errors:**
```bash
curl -d '{"title":"Über mich"}' ...
```

**CORRECT - use temp file approach:**
```bash
# Write JSON to temp file with UTF-8 encoding
echo '{"title":"Über mich"}' > /tmp/payload.json
curl --data-binary @/tmp/payload.json -H "Content-Type: application/json; charset=utf-8" ...
```

**BEST - use PowerShell on Windows for proper encoding:**
```powershell
$body = @{
    title = "Über mich"
    content = "German text with umlauts: äöüß"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages/123" `
    -Method POST `
    -Headers @{Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$env:WP_REMOTE_USER`:$env:WP_REMOTE_APP_PASSWORD")))"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

### Reusable PowerShell Helper Function

Use this helper function for all WordPress REST API calls on Windows:

```powershell
function Invoke-WPRestAPI {
    param(
        [string]$Endpoint,
        [string]$Method = "GET",
        [hashtable]$Body = $null
    )

    # Load credentials from .env if not already loaded
    if (-not $env:WP_REMOTE_URL) {
        Get-Content .env | ForEach-Object {
            if ($_ -match '^([^=]+)=(.*)$') {
                [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
            }
        }
    }

    $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
    $headers = @{Authorization = "Basic $auth"}

    $params = @{
        Uri = "$env:WP_REMOTE_URL/wp-json/$Endpoint"
        Method = $Method
        Headers = $headers
    }

    if ($Body) {
        $jsonBody = $Body | ConvertTo-Json -Depth 10
        $params.ContentType = "application/json; charset=utf-8"
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
    }

    Invoke-RestMethod @params
}

# Usage examples:
# GET:  Invoke-WPRestAPI -Endpoint "wp/v2/pages"
# POST: Invoke-WPRestAPI -Endpoint "wp/v2/pages/123" -Method POST -Body @{title="Neuer Titel"}
```

---

## Phase 1: Credential Setup

### 1.1 Check for .env File

First, check if `.env` file exists and contains required credentials:

```bash
# Check for .env file
if [ -f ".env" ]; then
    grep -E "^WP_REMOTE_(URL|USER|APP_PASSWORD)=" .env
fi
```

Required environment variables:
- `WP_REMOTE_URL` - WordPress site URL (e.g., `https://example.com`)
- `WP_REMOTE_USER` - WordPress admin username
- `WP_REMOTE_APP_PASSWORD` - Application Password (NOT the login password)

### 1.2 Prompt for Missing Credentials

If any credentials are missing, use AskUserQuestion to collect them:

**For WP_REMOTE_URL:**
```
What is the WordPress site URL?
Example: https://example.com (without trailing slash)
```

**For WP_REMOTE_USER:**
```
What is your WordPress admin username?
```

**For WP_REMOTE_APP_PASSWORD:**
```
What is your WordPress Application Password?

To create one:
1. Go to WordPress Admin → Users → Your Profile
2. Scroll to "Application Passwords"
3. Enter a name (e.g., "Claude Code")
4. Click "Add New Application Password"
5. Copy the generated password (spaces are fine)

Paste the Application Password here:
```

### 1.3 Create/Update .env File

After collecting credentials, create or update the `.env` file:

```bash
# Create .env if it doesn't exist
touch .env

# Add credentials (append or update)
```

Use the Edit or Write tool to update `.env`:

```
WP_REMOTE_URL=https://example.com
WP_REMOTE_USER=admin
WP_REMOTE_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

### 1.4 Add .env to .gitignore

Ensure `.env` is in `.gitignore`:

```bash
# Check if .gitignore exists and contains .env
if ! grep -q "^\.env$" .gitignore 2>/dev/null; then
    echo ".env" >> .gitignore
fi
```

---

## Phase 2: API Connection & Validation

### 2.1 Test Connection

Use bash to test the WordPress REST API connection:

```bash
# Read credentials from .env
source .env

# Test connection by fetching site info
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/" | head -c 500
```

### 2.2 Verify Authentication

Check if authentication works by accessing a protected endpoint:

```bash
source .env
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/wp/v2/users/me"
```

Expected: JSON response with current user info
Error: 401 Unauthorized means invalid credentials

### 2.3 Handle Connection Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Connection refused | Wrong URL / site down | Verify URL, check site status |
| 401 Unauthorized | Invalid credentials | Re-enter username/password |
| 403 Forbidden | REST API disabled | Enable REST API on site |
| 404 Not Found | Wrong URL path | Check WordPress installation |
| SSL error | Certificate issue | Verify HTTPS or use HTTP |

---

## Phase 3: Execute User Intent

Based on the user's intent, execute the appropriate WordPress REST API operations.

### Common Operations Reference

**IMPORTANT**: On Windows, prefer PowerShell commands. For bash/curl, always use temp files for JSON data.

#### List All Pages (PowerShell - Recommended)
```powershell
# Load credentials
$env:WP_REMOTE_URL = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_URL=' }) -replace '^WP_REMOTE_URL=',''
$env:WP_REMOTE_USER = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_USER=' }) -replace '^WP_REMOTE_USER=',''
$env:WP_REMOTE_APP_PASSWORD = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_APP_PASSWORD=' }) -replace '^WP_REMOTE_APP_PASSWORD=',''

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
$headers = @{Authorization = "Basic $auth"}

$pages = Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages?per_page=100" -Headers $headers
$pages | ForEach-Object { $_.title.rendered }
```

#### List All Pages (Bash - without jq)
```bash
source .env
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/wp/v2/pages?per_page=100"
# Parse JSON output in your code, do NOT pipe to jq
```

#### Get Single Page/Post
```bash
source .env
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/wp/v2/pages/{id}"
```

#### Update Page/Post (PowerShell - Recommended for special characters)
```powershell
# Load credentials first (see above)
$body = @{
    title = "Neuer Titel"
    content = "Inhalt mit Umlauten: äöüß"
} | ConvertTo-Json -Depth 10

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages/{id}" `
    -Method POST `
    -Headers @{Authorization = "Basic $auth"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

#### Update Page/Post (Bash - use temp file for UTF-8)
```bash
source .env
# Write JSON to temp file to preserve UTF-8 encoding
cat > /tmp/wp_payload.json << 'EOF'
{"title":"New Title","content":"New content"}
EOF
curl -s -X POST -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @/tmp/wp_payload.json \
  "$WP_REMOTE_URL/wp-json/wp/v2/pages/{id}"
```

#### Create New Page (PowerShell)
```powershell
$body = @{
    title = "Page Title"
    content = "Content here"
    status = "publish"
} | ConvertTo-Json -Depth 10

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages" `
    -Method POST `
    -Headers @{Authorization = "Basic $auth"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

#### List Media
```bash
source .env
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/wp/v2/media?per_page=100"
```

#### Upload Media
```bash
source .env
curl -s -X POST -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  -H "Content-Disposition: attachment; filename=image.jpg" \
  -H "Content-Type: image/jpeg" \
  --data-binary @image.jpg \
  "$WP_REMOTE_URL/wp-json/wp/v2/media"
```

#### Get Site Settings
```bash
source .env
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/wp/v2/settings"
```

#### Update Site Settings (PowerShell)
```powershell
$body = @{
    title = "Site Title"
    description = "Site Tagline with umlauts: äöü"
} | ConvertTo-Json -Depth 10

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/settings" `
    -Method POST `
    -Headers @{Authorization = "Basic $auth"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

#### Update Site Settings (Bash - temp file)
```bash
source .env
cat > /tmp/wp_payload.json << 'EOF'
{"title":"Site Title","description":"Site Tagline"}
EOF
curl -s -X POST -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @/tmp/wp_payload.json \
  "$WP_REMOTE_URL/wp-json/wp/v2/settings"
```

### SEO Operations (Yoast SEO / RankMath)

#### Check for SEO Plugin
```bash
source .env
# Check for Yoast
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/yoast/v1/get_head?url=$WP_REMOTE_URL" 2>/dev/null

# Check for RankMath
curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  "$WP_REMOTE_URL/wp-json/rankmath/v1/getHead?url=$WP_REMOTE_URL" 2>/dev/null
```

#### Update Yoast SEO Meta (PowerShell)
```powershell
$body = @{
    meta = @{
        _yoast_wpseo_title = "SEO Title"
        _yoast_wpseo_metadesc = "Meta description with umlauts: äöü"
    }
} | ConvertTo-Json -Depth 10

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages/{id}" `
    -Method POST `
    -Headers @{Authorization = "Basic $auth"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

#### Update Yoast SEO Meta (Bash - temp file)
```bash
source .env
cat > /tmp/wp_payload.json << 'EOF'
{
  "meta": {
    "_yoast_wpseo_title": "SEO Title",
    "_yoast_wpseo_metadesc": "Meta description"
  }
}
EOF
curl -s -X POST -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @/tmp/wp_payload.json \
  "$WP_REMOTE_URL/wp-json/wp/v2/pages/{id}"
```

#### Update RankMath SEO Meta (PowerShell)
```powershell
$body = @{
    meta = @{
        rank_math_title = "SEO Title"
        rank_math_description = "Meta description"
        rank_math_focus_keyword = "focus keyword"
    }
} | ConvertTo-Json -Depth 10

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages/{id}" `
    -Method POST `
    -Headers @{Authorization = "Basic $auth"} `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

### Pagination Handling

WordPress REST API uses pagination. Handle it properly:

#### PowerShell (Recommended)
```powershell
# Load credentials
$env:WP_REMOTE_URL = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_URL=' }) -replace '^WP_REMOTE_URL=',''
$env:WP_REMOTE_USER = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_USER=' }) -replace '^WP_REMOTE_USER=',''
$env:WP_REMOTE_APP_PASSWORD = (Get-Content .env | Where-Object { $_ -match '^WP_REMOTE_APP_PASSWORD=' }) -replace '^WP_REMOTE_APP_PASSWORD=',''

$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${env:WP_REMOTE_USER}:${env:WP_REMOTE_APP_PASSWORD}"))
$headers = @{Authorization = "Basic $auth"}

$allPages = @()
$page = 1
$perPage = 100

do {
    $response = Invoke-RestMethod -Uri "$env:WP_REMOTE_URL/wp-json/wp/v2/pages?per_page=$perPage&page=$page" -Headers $headers
    if ($response.Count -eq 0) { break }
    $allPages += $response
    $page++
} while ($response.Count -eq $perPage)

$allPages | ForEach-Object { Write-Host $_.id, $_.title.rendered }
```

#### Bash (without jq - check response length)
```bash
source .env
PAGE=1
PER_PAGE=100

while true; do
  RESPONSE=$(curl -s -u "$WP_REMOTE_USER:$WP_REMOTE_APP_PASSWORD" \
    "$WP_REMOTE_URL/wp-json/wp/v2/pages?per_page=$PER_PAGE&page=$PAGE")

  # Check if empty array (simple check without jq)
  if [ "$RESPONSE" = "[]" ]; then
    break
  fi

  # Process response - parse JSON in your code
  echo "$RESPONSE"

  PAGE=$((PAGE + 1))
done
```

---

## Phase 4: Report Results

After completing operations, provide a summary:

1. **What was requested**: User's original intent
2. **What was done**: List of operations performed
3. **Results**: Success/failure for each operation
4. **Errors**: Any issues encountered and how they were handled

---

## Error Handling

### Authentication Errors
- Re-prompt for credentials
- Verify Application Password format (may contain spaces)
- Check if Application Passwords are enabled on the site

### Rate Limiting
- Add delays between requests (1-2 seconds)
- Reduce batch size if hitting limits

### Large Sites
- Use pagination (per_page=100)
- Process in batches
- Report progress to user

### Plugin-Specific Endpoints
- Not all plugins expose REST API endpoints
- Some require additional authentication
- Fall back to standard WordPress meta fields when possible

---

## Security Notes

- Application Passwords are different from login passwords
- Never commit `.env` to version control
- Application Passwords can be revoked from WordPress admin
- Each Application Password shows last used date for auditing

---

## REST API Endpoint Reference

| Resource | Endpoint | Methods |
|----------|----------|---------|
| Posts | `/wp-json/wp/v2/posts` | GET, POST |
| Pages | `/wp-json/wp/v2/pages` | GET, POST |
| Media | `/wp-json/wp/v2/media` | GET, POST |
| Users | `/wp-json/wp/v2/users` | GET, POST |
| Comments | `/wp-json/wp/v2/comments` | GET, POST |
| Categories | `/wp-json/wp/v2/categories` | GET, POST |
| Tags | `/wp-json/wp/v2/tags` | GET, POST |
| Settings | `/wp-json/wp/v2/settings` | GET, POST |
| Plugins | `/wp-json/wp/v2/plugins` | GET, POST |
| Themes | `/wp-json/wp/v2/themes` | GET |
| Block Types | `/wp-json/wp/v2/block-types` | GET |
| Menus | `/wp-json/wp/v2/menus` | GET, POST |
| Menu Items | `/wp-json/wp/v2/menu-items` | GET, POST |

### Custom Post Types
Custom post types are available at `/wp-json/wp/v2/{post_type_slug}` if `show_in_rest` is enabled.

### Meta Fields
To include meta fields in responses, add `?_fields=id,title,meta` or register meta fields with `show_in_rest => true`.

---

## Example Intents

| Intent | Operations |
|--------|------------|
| "Update all SEO titles" | List pages → Update each with new SEO meta |
| "Add featured images to all posts" | List posts → Upload images → Assign to posts |
| "Export all pages to JSON" | List pages with full content → Save to file |
| "Change all buttons to blue" | List pages → Parse content → Update block attributes |
| "Create 10 placeholder pages" | Loop create page requests |
| "Update site tagline" | Update settings endpoint |
| "List all plugins" | GET plugins endpoint |
