# cloak-browser-mcp

A Model Context Protocol (MCP) server backed by [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) — a source-patched Chromium that passes Cloudflare Turnstile, reCAPTCHA v3, FingerprintJS, BrowserScan, and 30+ other bot detection services without runtime JS injection.

Drop-in replacement for `@playwright/mcp` with **80 tools**: full Playwright-MCP parity plus a Cloak-exclusive stealth/profile/audit layer.

> Works with Claude Code, Cursor, VS Code, Codex, Gemini CLI, Windsurf, or any MCP client.

---

## Table of contents

- [Why CloakBrowser over vanilla Playwright?](#why-cloakbrowser-over-vanilla-playwright)
- [Quick start](#quick-start)
- [Capabilities (`--caps`)](#capabilities---caps)
- [CloakBrowser-exclusive tools](#cloakbrowser-exclusive-tools-always-on)
- [CLI flags](#cli-flags)
- [Tool inventory](#tool-inventory)
- [Target syntax for interaction tools](#target-syntax-for-interaction-tools)
- [Example flows](#example-flows)
- [Security model](#security-model)
- [Changelog](#changelog)
- [License](#license)

---

## Why CloakBrowser over vanilla Playwright?

| | `@playwright/mcp` | `cloak-browser-mcp` |
|---|---|---|
| Chromium | Stock | Source-patched (58 C++ patches) |
| `navigator.webdriver` | `true` (leaks) | absent |
| Cloudflare Turnstile | Fails | Auto-pass |
| reCAPTCHA v3 score | ~0.1 | ~0.9 |
| Humanized mouse / keyboard | None | Bézier curves, typo correction |
| Persistent profiles | Manual | First-class CLI flag + management tools |
| GeoIP-aware emulation | None | Auto timezone/locale from proxy exit IP |
| Stealth audit / detection probe | None | Built-in `cloak_stealth_audit` + `cloak_detection_test` |

When you don't need stealth, `@playwright/mcp` is faster and lighter — use that. When the site has any bot detection (Cloudflare, DataDome, PerimeterX, FingerprintJS) — use this.

---

## Quick start

### 1. Install once

The wrapper installs from npm; the CloakBrowser Chromium binary (~200 MB) downloads on first use into `~/.cloakbrowser/`.

```bash
npm install -g @devinwangd/cloak-browser-mcp
```

Or run on demand without installing:

```bash
npx @devinwangd/cloak-browser-mcp --caps all
```

After install, the binary on `PATH` is `cloak-browser-mcp` (unscoped) — that's what you reference in MCP client configs below.

### 2. Wire into your MCP client

#### Claude Code (`~/.claude.json` or project `.mcp.json`)

```json
{
  "mcpServers": {
    "cloak-browser": {
      "command": "cloak-browser-mcp",
      "args": ["--caps", "all"]
    }
  }
}
```

#### Cursor / VS Code (`.cursor/mcp.json` or `.vscode/mcp.json`)

```json
{
  "servers": {
    "cloak-browser": {
      "command": "cloak-browser-mcp",
      "args": ["--caps", "all"]
    }
  }
}
```

#### Persistent profile + proxy + humanized inputs

```json
{
  "mcpServers": {
    "cloak-browser": {
      "command": "cloak-browser-mcp",
      "args": [
        "--caps", "all",
        "--profile-dir", "/Users/me/.cloak-browser-mcp/profiles/work",
        "--proxy", "http://user:pass@proxy.example.com:8080",
        "--timezone", "Europe/London",
        "--locale", "en-GB",
        "--geoip",
        "--humanize",
        "--viewport", "1920x1080",
        "--allowed-domains", "*.example.com,*.cloudflare.com"
      ]
    }
  }
}
```

### 3. Use it

In Claude Code:

> "Open example.com, click the search box, search for 'hello', take a screenshot."

The agent will call `browser_navigate` → `browser_snapshot` → `browser_click` → `browser_type` → `browser_take_screenshot`.

---

## Capabilities (`--caps`)

| Cap | Tools | Use when |
|---|---|---|
| (always) | navigation, interaction, page state | Standard browsing |
| `network` | request inspection, route mocking, offline simulation | Debugging APIs, testing failure modes |
| `storage` | cookies, localStorage, sessionStorage, storage state export/import | Auth state persistence, session replay |
| `vision` | pixel-coordinate mouse | Bypassing accessibility tree for canvas / SVG apps |
| `pdf` | `browser_pdf_save` | Snapshotting pages as PDF |
| `testing` | `verify_*` + `generate_locator` | Codegen for Playwright tests |
| `devtools` | highlight, tracing, video, resume | Debugging agent decisions |
| `config` | `get_config`, `close`, `run_code_unsafe` | Introspection + (with `--enable-unsafe-eval`) arbitrary JS |
| `humanize` | `cloak_humanize_set` | Tuning humanized input parameters |

`--caps all` enables everything (except `run_code_unsafe`, which additionally requires `--enable-unsafe-eval`).

---

## CloakBrowser-exclusive tools (always on)

| Tool | Purpose |
|---|---|
| `cloak_set_fingerprint` | Override canvas seed, GPU vendor/renderer, screen size, hardware concurrency, device memory, UA brand, platform, storage quota |
| `cloak_set_timezone` | Live timezone via CDP (no relaunch) |
| `cloak_set_locale` | Override `navigator.language` and `Accept-Language` |
| `cloak_set_geolocation` | Set coords, or auto-resolve from proxy exit IP |
| `cloak_set_proxy` | Switch proxy mid-session |
| `cloak_detection_test` | Load a known probe (CreepJS, FingerprintJS, BrowserScan, SannySoft, Cloudflare Turnstile) and dump results |
| `cloak_stealth_audit` | Programmatic check: `navigator.webdriver`, plugin count, WebGL vendor, languages, UA, chrome.runtime, canvas hash, `$cdc_*` CDP signals |
| `cloak_request_signal_inspect` | Capture per-request TLS / header signals for a single URL |
| `cloak_persistent_profile_create` / `list` / `delete` | Manage `~/.cloak-browser-mcp/profiles/` |
| `cloak_binary_info` / `cloak_binary_update` | Inspect / refresh the CloakBrowser Chromium binary |

---

## CLI flags

| Flag | Value | Default | Notes |
|---|---|---|---|
| `--caps <csv>` | `all` or any subset | (none) | Enables capability-gated tools |
| `--profile-dir <path>` | Absolute path | (ephemeral) | Persistent user-data dir |
| `--headless` / `--headed` | (boolean) | **headed (visible)** | Pass `--headless` for batch/CI runs. |
| `--proxy <url>` | http(s)/socks5 with inline auth | none | |
| `--timezone <tz>` | IANA tz | system | e.g. `America/New_York` |
| `--locale <bcp47>` | BCP-47 | system | e.g. `en-US` |
| `--user-agent <ua>` | string | (cloak default) | |
| `--viewport <WxH>` | e.g. `1920x1080` | 1280×720 | |
| `--geoip` | boolean | off | Auto resolve geolocation from proxy IP |
| `--humanize` | boolean | off | Enable Bézier mouse + typo-correcting keyboard |
| `--fingerprint-seed <int>` | int | random | Deterministic canvas/WebGL noise |
| `--allowed-domains <csv>` | host patterns | (open) | Whitelist for `browser_navigate` |
| `--blocked-domains <csv>` | host patterns | (none) | Blocklist for `browser_navigate` |
| `--enable-unsafe-eval` | boolean | off | Required for `browser_run_code_unsafe` |
| `--upload-allow-dir <path>` | path | (none) | Restrict file-upload source paths |
| `--download-dir <path>` | path | (cwd) | Where downloaded files land |
| `--max-pages <n>` | int | 20 | Concurrent tab cap |
| `--self-test` | boolean | off | Print the tool list and exit |

---

## Tool inventory

Tools are grouped by capability. The "always-on" sections are exposed regardless of `--caps`; capability-gated sections require the matching `--caps` entry.

### Always-on

#### Navigation

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `browser_navigate` | `url` | `waitUntil`, `timeoutMs` | Subject to `--allowed-domains` / `--blocked-domains`. Returns a fresh `[eN]` snapshot. |
| `browser_navigate_back` | — | — | History back in the active tab. |
| `browser_tabs` | `action` (`list`/`new`/`switch`/`close`) | `index`, `id`, `url` | Manage tabs by id (`t1`,…) or 0-based index. |

#### Interaction

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `browser_click` | `target` | `element`, `doubleClick`, `button`, `modifiers` | `target` is a `eN` ref or a Playwright selector. |
| `browser_type` | `target`, `text` | `element`, `submit`, `slowly` | `slowly:true` triggers per-character typing; combine with `--humanize`. |
| `browser_hover` | `target` | `element` | |
| `browser_drag` | `startTarget`, `endTarget` | `startElement`, `endElement` | |
| `browser_drop` | `target` | `paths`, `data` | File paths via `setInputFiles`; arbitrary MIME data via synthetic DataTransfer. |
| `browser_select_option` | `target`, `values` | `element` | |
| `browser_press_key` | `key` | — | Page-level key press (e.g. `Control+A`, `ArrowDown`). |
| `browser_handle_dialog` | `accept` | `promptText` | Responds to the most recently captured dialog. |
| `browser_file_upload` | `paths` | — | Paths constrained by `--upload-allow-dir` if set. |
| `browser_fill_form` | `fields` | — | Each field has `target` + `value` (+ optional `kind`). |
| `browser_scroll` | — | `target`, `direction`, `amount` | Element-scoped or page-level. |

#### Page state

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `browser_snapshot` | — | — | Accessibility tree with `[eN]` refs for interactable nodes. |
| `browser_take_screenshot` | — | `element`, `target`, `type`, `fullPage`, `quality`, `saveAs` | Image is returned inline; optionally saved to disk. |
| `browser_console_messages` | — | `level`, `limit` | Buffered console + pageerror. |
| `browser_wait_for` | — | `timeMs`, `text`, `textGone`, `selector`, `state`, `timeoutMs` | |
| `browser_resize` | `width`, `height` | — | |
| `browser_evaluate` | `function` | `element`, `target` | Function source must be an arrow or function expression. |

#### CloakBrowser-exclusive

| Tool | Required | Optional | Notes |
|---|---|---|---|
| `cloak_set_fingerprint` | — | `seed`, `gpuVendor`, `gpuRenderer`, `screenWidth`, `screenHeight`, `hardwareConcurrency`, `deviceMemoryGB`, `uaBrand`, `uaBrandVersion`, `platform`, `storageQuotaMB` | Some flags only take effect on next launch — call `browser_close` then any tool to relaunch. |
| `cloak_set_timezone` | `timezone` | — | Live via CDP. |
| `cloak_set_locale` | `locale` | — | Sets navigator.language + Accept-Language header. |
| `cloak_set_geolocation` | — | `latitude`, `longitude`, `accuracy`, `fromProxyIp` | `fromProxyIp` calls ipapi.co/json/ via current proxy. |
| `cloak_set_proxy` | `proxy` | — | Recreates the context. |
| `cloak_detection_test` | — | `suite`, `customUrl` | Suites: `creepjs`, `fingerprintjs`, `browserscan`, `sannysoft`, `cloudflare-turnstile`. |
| `cloak_stealth_audit` | — | — | Programmatic audit. |
| `cloak_request_signal_inspect` | `url` | — | Returns TLS details, response status, request headers, response headers. |
| `cloak_persistent_profile_create` | `name` | — | Creates `~/.cloak-browser-mcp/profiles/<name>`. |
| `cloak_persistent_profile_list` | — | — | |
| `cloak_persistent_profile_delete` | `name`, `confirm=true` | — | |
| `cloak_binary_info` | — | — | |
| `cloak_binary_update` | — | — | |

### Capability-gated

**`--caps network`** — `browser_network_requests`, `browser_network_request`, `browser_route`, `browser_route_list`, `browser_unroute`, `browser_network_state_set`.

**`--caps storage`** — `browser_cookie_set/get/list/delete/clear`, `browser_localstorage_*`, `browser_sessionstorage_*`, `browser_storage_state`, `browser_set_storage_state`.

**`--caps vision`** — `browser_mouse_click_xy`, `browser_mouse_move_xy`, `browser_mouse_drag_xy`, `browser_mouse_down`, `browser_mouse_up`, `browser_mouse_wheel`.

**`--caps pdf`** — `browser_pdf_save`.

**`--caps testing`** — `browser_verify_element_visible`, `browser_verify_text_visible`, `browser_verify_list_visible`, `browser_verify_value`, `browser_generate_locator`.

**`--caps devtools`** — `browser_highlight`, `browser_hide_highlight`, `browser_start_tracing`, `browser_stop_tracing`, `browser_start_video`, `browser_stop_video`, `browser_video_chapter`, `browser_resume`.

**`--caps config`** — `browser_get_config`, `browser_close`, `browser_run_code_unsafe` (also needs `--enable-unsafe-eval`).

**`--caps humanize`** — `cloak_humanize_set`.

---

## Target syntax for interaction tools

The `target` argument accepts:

- **`eN` ref** from a prior `browser_snapshot` — e.g. `e7`. Most reliable.
- **CSS selector** — e.g. `button.primary`.
- **`xpath=…`** — e.g. `xpath=//button[contains(., "Submit")]`.
- **`text=…`** — e.g. `text=Sign in`.
- **`role=…[name="…"]`** — e.g. `role=button[name="Submit"]`.

After any navigation or significant DOM mutation, call `browser_snapshot` again to refresh refs.

---

## Example flows

### 1. Take a screenshot of a Cloudflare-protected page

```
You: Open https://example-cloudflare-protected.com, wait for the page to settle, take a full-page screenshot.

Agent calls:
  browser_navigate(url="https://...")
  browser_wait_for(textGone="Checking your browser")
  browser_take_screenshot(fullPage=true)
```

Vanilla `@playwright/mcp` fails the Turnstile check; `cloak-browser-mcp` passes it automatically because the stealth patches are below the JS layer.

### 2. Sign into a SaaS dashboard, persist auth, reopen later

Phase 1 — initial sign-in with a fresh profile:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "cloak": {
      "command": "cloak-browser-mcp",
      "args": [
        "--caps", "all",
        "--profile-dir", "/Users/me/.cloak-browser-mcp/profiles/saas-prod",
        "--humanize"
      ]
    }
  }
}
```

```
You: Open https://saas.example.com, sign in as me@example.com / <password>, then confirm I'm on the dashboard.
```

Phase 2 — reopen later, all cookies still present:

```
You: Open https://saas.example.com — you should already be signed in from yesterday's session.
```

### 3. Probe how stealth is doing

```
You: Run a stealth audit and then load the SannySoft bot detection test.

Agent:
  cloak_stealth_audit()
  cloak_detection_test(suite="sannysoft")
```

You'll see all green if stealth is intact.

### 4. Switch geolocation/timezone mid-session via proxy

```
You: Switch to a UK proxy, align my timezone/locale/geo to match, then load a country-specific landing page.

Agent:
  cloak_set_proxy(proxy="http://uk-proxy.example.com:8080")
  cloak_set_timezone(timezone="Europe/London")
  cloak_set_locale(locale="en-GB")
  cloak_set_geolocation(fromProxyIp=true)
  browser_navigate(url="https://example.com/uk")
```

### 5. Mock an API response while testing a frontend

```
You: While loading example.com, return a fake 500 to /api/orders so I can verify the error state.

Agent:
  browser_route(pattern="**/api/orders", status=500, body='{"error":"simulated"}', contentType="application/json")
  browser_navigate(url="https://example.com")
  browser_take_screenshot()
  browser_unroute(pattern="**/api/orders")
```

### 6. Export storage state, replay in a fresh session

```
Agent:
  browser_storage_state(filename="/tmp/saas-state.json")
  # …later, in a new ephemeral session…
  browser_set_storage_state(filename="/tmp/saas-state.json")
  browser_navigate(url="https://saas.example.com")
```

### 7. Run a Playwright trace for human review

```
You: Trace this whole flow so I can replay it in Playwright Trace Viewer.

Agent:
  browser_start_tracing(filename="/tmp/trace.zip", screenshots=true, snapshots=true)
  # …agent runs the flow…
  browser_stop_tracing()

You: open /tmp/trace.zip in Playwright Trace Viewer (https://trace.playwright.dev)
```

---

## Security model

Read this before deploying on any machine that has production credentials.

### TL;DR

| Asset | Trust boundary |
|---|---|
| `cloak-browser-mcp` source (this repo) | MIT, public, audit by reading. |
| `cloakbrowser` npm package | Trust the [CloakHQ](https://github.com/CloakHQ) maintainers + npm registry. |
| CloakBrowser Chromium **binary** | Downloaded on first use from `cloakbrowser.dev`. SHA-256 verified by upstream wrapper. The binary is closed-source by license. |
| Your env vars / Keychain / shell history | The MCP server inherits your process env. **Do not run with prod credentials in scope unless you trust the supply chain.** |

### Threats this package introduces

#### 1. Supply-chain compromise

Three packages are pulled at install/run time: `@modelcontextprotocol/sdk`, `playwright-core`, and `cloakbrowser` + its downloaded Chromium binary. If CloakHQ's npm publish token or `cloakbrowser.dev` is compromised, an attacker could push a malicious binary that runs under your user account.

**Mitigations:**
- Pin a known-good `cloakbrowser` version.
- Set `CLOAKBROWSER_BINARY_PATH` to an audited binary.
- Leave `CLOAKBROWSER_SKIP_CHECKSUM` at default (`false`).
- Audit `~/.cloakbrowser/` and any `--profile-dir` you use.

#### 2. Agent-driven browser navigation

By default `browser_navigate` accepts any URL. An LLM agent can be prompt-injected into navigating somewhere malicious.

**Mitigations:**
- `--allowed-domains <csv>` (supports `*.example.com`).
- `--blocked-domains <csv>` (checked first).
- Use a dedicated ephemeral `--profile-dir`, not your real browser profile.
- `--max-pages <n>` caps tab explosion.

#### 3. Arbitrary JS execution

- `browser_evaluate` — runs JS in the page sandbox. Cannot read your local filesystem. Always available.
- `browser_run_code_unsafe` — runs JS *in this Node.js server process*. Can do anything Node can. **Double-opt-in**: needs `--caps config` AND `--enable-unsafe-eval`.

**Mitigation:** never combine `--enable-unsafe-eval` with a machine that has prod credentials in env vars.

#### 4. File system reach

`browser_file_upload` and `browser_drop` can attach any file you have read access to. Use `--upload-allow-dir <path>` to restrict.

Write-side: `browser_take_screenshot --saveAs`, `browser_pdf_save`, `browser_storage_state`, `browser_start_tracing` write files at agent-chosen paths. If you don't want this, omit `--caps pdf` / `storage` / `devtools`.

#### 5. Persistent profile leakage

A `--profile-dir` accumulates cookies/localStorage/IndexedDB. If synced to cloud storage, every site you've signed into via the agent becomes accessible to anyone with that sync token. Default path `~/.cloak-browser-mcp/profiles/<name>` lives outside common cloud-sync roots.

#### 6. Prompt-injection-driven exfil

A malicious page can prompt-inject the agent into navigating elsewhere with stolen state, or POST DOM secrets out. This is an LLM problem, not an MCP problem.

- Use a separate session per task — `browser_close` between unrelated jobs.
- Prefer ephemeral over persistent profiles for sensitive flows.
- Review agent tool calls when the task touches anything authenticated.

#### 7. Network egress

| Call | Destination | When |
|---|---|---|
| CloakBrowser binary download | `cloakbrowser.dev` (override via `CLOAKBROWSER_DOWNLOAD_URL`) | First use after install |
| Browser traffic | Whatever the agent navigates to | Always |
| `cloak_set_geolocation --fromProxyIp` | `ipapi.co/json/` | Only when explicitly invoked |

The wrapper does not phone home and does not collect telemetry.

### Recommended deployment profiles

**"Tight"** (sensitive machine — has prod credentials):

```
--caps network,storage,pdf
--profile-dir /Users/me/.cloak-browser-mcp/profiles/scoped
--allowed-domains *.target.com
--upload-allow-dir /tmp/cloak-uploads
--max-pages 5
```

No `--enable-unsafe-eval`. No `vision` cap (xy clicks bypass allow-listing).

**"Open"** (research / personal browsing):

```
--caps all
--humanize
--max-pages 20
```

**"Untrusted"** (you don't fully trust the upstream binary yet) — run inside a Docker container or a fresh macOS user account with no Keychain access and no `.env` files mounted.

### Reporting vulnerabilities

If you find a security issue in `cloak-browser-mcp` (not in the upstream `cloakbrowser` package or its binary): open a private security advisory at https://github.com/devinwang/cloak-browser-mcp/security/advisories/new.

For issues in upstream CloakBrowser: https://github.com/CloakHQ/CloakBrowser/security/advisories/new.

---

## Changelog

### [0.1.1] - 2026-05-24

- **BREAKING (UX)**: default is now **headed (visible browser)** instead of headless. An interactive MCP server should let the user watch the agent work. Pass `--headless` explicitly for batch/CI usage. Smithery default flipped to match.

### [0.1.0] - 2026-05-24

- Initial release. ~62 MCP tools backed by CloakHQ/CloakBrowser, covering full Playwright-MCP parity plus a Cloak-exclusive stealth/profile/audit/binary-management layer.
- CLI: `--caps`, `--profile-dir`, `--headless`/`--headed`, `--proxy`, `--timezone`, `--locale`, `--user-agent`, `--viewport`, `--geoip`, `--humanize`, `--fingerprint-seed`, `--allowed-domains`, `--blocked-domains`, `--enable-unsafe-eval`, `--upload-allow-dir`, `--download-dir`, `--max-pages`, `--self-test`.
- Smithery YAML for one-click integration.
- MIT-licensed wrapper; upstream CloakBrowser Chromium binary remains proprietary-free-redistribute-prohibited.

---

## License

- **Wrapper code**: MIT (this package).
- **CloakBrowser Chromium binary**: proprietary, free to use, no redistribution. See https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md.

---

## Acknowledgments

- [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) — the patched Chromium that does the real work.
- [@playwright/mcp](https://github.com/microsoft/playwright-mcp) — tool naming and accessibility-tree-first design inspired this server.
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — the MCP plumbing.
