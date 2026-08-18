# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start local dev server at http://localhost:4321
pnpm build        # Build for production (Astro + Cloudflare adapter)
pnpm run deploy   # Build then deploy to Cloudflare Workers via Wrangler (pnpm deploy is reserved)
pnpm typecheck    # Run astro check (TypeScript type validation)
pnpm bootstrap    # Initialize EmDash DB schema and seed content (first-time setup)
```

## Architecture Overview

This is an **Astro SSR site** deployed as a **Cloudflare Worker**, with **EmDash** as the CMS. All pages are server-rendered — there is no static output.

### Request Flow

```
Cloudflare Worker (src/worker.ts)
  ├── /mcp  → EmDashMCP Durable Object (src/mcp/index.ts)
  └── /*    → Astro SSR handler (@astrojs/cloudflare)
```

`src/worker.ts` is the Worker entry point. It routes `/mcp` requests to `handleMcp(request, env)` (stateless proxy in `src/mcp/index.ts`). All other requests fall through to Astro's server handler.

### i18n Routing

Two locales: **`ar`** (default, RTL) and **`en`** (LTR). Default locale routes are served without a prefix (`/`), non-default locale routes are prefixed (`/en/...`).

- `src/i18n/utils.ts` — locale helpers: `t()`, `getDir()`, `localizedPath()`, `getLocaleFromPath()`
- `src/i18n/ar.json` / `en.json` — translation strings
- `src/pages/[locale]/` — locale-prefixed pages
- `src/pages/` root files — default locale (Arabic) pages

When adding translated UI strings, add keys to both JSON files.

Key i18n namespaces: `nav`, `hero` (includes `location`, `role`, `metrics`), `writing`, `projects` (includes `kicker`), `about` (includes `kicker`), `skills`, `contact`, `footer` (includes `tagline`).

### EmDash CMS Integration

Content lives in a Cloudflare D1 database, managed by EmDash. Collections are declared in `src/live.config.ts` via a single `_emdash` live collection. Pages use `getEmDashCollection()` and `getEmDashEntry()` from `emdash` to fetch content at request time.

Key EmDash bindings (declared in `wrangler.jsonc`):
- `DB` → D1 database (content storage)
- `MEDIA` → R2 bucket (media uploads)
- `SESSION` → KV namespace (auth sessions)
- `MCP_OBJECT` → Durable Object namespace (`EmDashMCP` class)
- `AI` → Cloudflare Workers AI (used by `plugin-ai-moderation`)

### MCP Server

A single public endpoint at `/mcp` acts as a **stateless proxy** that merges both tool sets:

- **EmDash content tools (36)** — forwarded internally to `/_emdash/api/mcp` via `env.SELF` Service Binding. Covers content, schema, media, search, taxonomies, menus, revisions.

Auth: `?token=<ec_pat_*>` query param OR `Authorization: Bearer <token>` header. The token is forwarded upstream as a Bearer to authenticate against the built-in.

`src/mcp/index.ts` exports `handleMcp(request, env)` (the proxy) and a stub `EmDashMCP` class kept only for the wrangler DO binding (`MCP_OBJECT`). `McpAgent` is no longer used.

`wrangler.jsonc` / `wrangler.prod.jsonc` both declare a `SELF` service binding (`dawood-emdash`) to allow same-worker subrequests without 522 errors.

### Plugins

All plugins are configured in `astro.config.mjs`. A plugin's type is set by its descriptor's `format` field:

- **`format: "native"`** — imported into the main Worker, runs in-process, unrestricted. Declared in `plugins: []`.
- **`format: "standard"`** — sandboxed. Its `entrypoint` is loaded as a separate isolate via the Cloudflare **Worker Loader** binding (`LOADER`, declared in both wrangler configs), with `capabilities` + `allowedHosts` mediating access. Declared in `sandboxed: []`, dispatched by `sandbox()` from `@emdash-cms/cloudflare` (`sandboxRunner`).

**Native plugins** (`plugins: []`):

| Plugin | Source | Notes |
|--------|--------|-------|
| `marketing-blocks` inline descriptor | `src/plugins/marketing-blocks/` (local) | Hero, features, testimonials, pricing, FAQ blocks |
| `formsPlugin()` | `@emdash-cms/plugin-forms` | Contact form submissions |
| `colorPlugin()` | `@emdash-cms/plugin-color` | Color picker field widget |
| `embedsPlugin()` | `@emdash-cms/plugin-embeds` | YouTube, Vimeo, Bluesky, Mastodon, Twitter, Gist blocks |
| `calloutPlugin()` | `@plugdash/callout` | Info/warning/tip callout blocks |
| `custom-blocks` inline descriptor | `@emdash.directory/plugin-custom-blocks` | Reusable HTML snippets. Package ships a `standard` descriptor too, but we wire the `/sandbox` entrypoint as `native` for full features |
| SEO inline descriptor | `src/plugins/seo/` (copied from `@jdevalk/emdash-plugin-seo`) | Meta, OG, JSON-LD, IndexNow, llms.txt |
| `rssAggregatorPlugin()` | `src/plugins/rss-aggregator/` (local) | RSS/Atom feed aggregator; uses EmDash plugin storage (no extra D1 needed) |
| `aiModerationPlugin()` | `@emdash-cms/plugin-ai-moderation` | AI comment moderation (requires `AI` binding) |
| `emdash-inbox` inline descriptor | `src/plugins/emdash-inbox/` (local) | Email inbox + transport (`email:provide`, `email:intercept`, email-transport/email-events hooks) |
| `jobs-board` inline descriptor | `src/plugins/jobs-board/` (local) | Syncs the external jobs Worker API into plugin storage hourly; serves `/jobs` and `/en/jobs` |

**Sandboxed plugins** (`sandboxed: []`):

| Plugin | Package | Notes |
|--------|---------|-------|
| `webhookNotifier` | `@emdash-cms/plugin-webhook-notifier` | Dev-only — excluded from production via `process.env.NODE_ENV !== "production"`. The **only** sandboxed plugin; in prod the array is empty |

**Installed but not registered:** `@emdash-cms/plugin-audit-log` and `@emdash-cms/plugin-atproto` are still in `package.json` but are **not** wired into `astro.config.mjs`. Both are `format: "standard"` with a `content:read` capability, which meant every page render dispatched into a Worker-Loader isolate — the cause of the ~18s SSR stall and hung admin. Do not re-add them to `sandboxed: []` without re-testing render latency.

**Orphaned:** `src/plugins/email-cf-worker.ts` is no longer referenced; email transport now comes from `emdash-inbox`.

**Local plugins with type stubs:** `src/plugins/rss-aggregator/src/types/` contains `declare module "..."` stubs for peer deps. These shadow the real package types when the root `tsconfig.json` includes `**/*`. Always exclude such stub directories in the root `tsconfig.json`: `"exclude": ["dist", "src/plugins/rss-aggregator/src/types"]`.

**Important:** The SEO plugin (`@jdevalk/emdash-plugin-seo`) ships TypeScript source without a compiled dist. Its source is copied to `src/plugins/seo/` and wired with an inline descriptor using `fileURLToPath().replaceAll("\\", "/")` — same pattern as other local native plugins. Do **not** use `seoPlugin()` from the npm package directly (its entrypoint uses `URL.pathname` which breaks on Windows).

### Design System

The site uses a warm editorial palette (oxblood `#6b1438` accent, bone `#f8f5ef` background). Fonts: **Playfair Display** (Latin serif headings), **JetBrains Mono** (kickers/metadata), **Thmanyah** Serif Text / Serif Display / Sans (Arabic body + headings, self-hosted from `cdn.engdawood.com`), **Amiri** (Arabic hero lockup), with **Al Jazeera** / **Cairo** as fallbacks. CSS variables (incl. `--font-arabic`, `--font-arabic-heading`, `--font-arabic-sans`) are in `src/layouts/Base.astro` under `:root`. The Thmanyah fonts load cross-origin and depend on a CORS policy on the `cdn-assets` R2 bucket — see @.claude/CLAUDE.CLOUDFLARE.md.

Homepage sections follow an editorial numbered structure: Hero (bilingual lockup + ticker), §01 Work (project rows), §02 Writing (magazine grid), §03 About (with skills matrix), §04 Contact.

### Base Layout

`src/layouts/Base.astro` is the root layout. It fetches site settings, primary menu, and pages from EmDash on every request. It uses EmDash UI primitives (`EmDashHead`, `EmDashBodyStart`, `EmDashBodyEnd`, `WidgetArea`) alongside custom components.

Header uses an Editorial Monogram mark (`Ds·` SVG) + wordmark. Footer includes the same mark with tagline.

## Environment Variables

Local dev uses `.dev.vars` (not committed). Required vars:
- `EMDASH_TOKEN` — Bearer token for MCP endpoint auth
- `EMDASH_URL` — (optional) override base URL for EmDashClient (defaults to `https://engdawood.com`)

The jobs Worker API base URL is **not** an env var — it is a `jobs-board` plugin setting (KV `settings:apiBaseUrl`), editable at `/_emdash/admin` → Jobs → Settings.


## Reference Files (`.claude/`)

Detailed subsystem docs live in `.claude/`. Claude Code loads these on-demand via `@` references:

| File | Contents |
|------|----------|
| `.claude/CLAUDE.md` | Behavioral guidelines (think-before-coding, simplicity, surgical changes) |
| `.claude/CLAUDE.EMDASH.md` | EmDash CMS — collections, plugins, patches, page structure, common gotchas |
| `.claude/CLAUDE.CLOUDFLARE.md` | Cloudflare / Wrangler — dual-config setup, sandbox behavior, adapter gotchas |
| `.claude/CLAUDE-mcp.md` | MCP server — tool structure, runtime constraints, tool inventory, how to add tools |
| `.claude/rules/dep-pinning.md` | Dependency pinning — Cloudflare adapter/vite-plugin/wrangler triad, upgrade rules, failure signatures |

## EmDash CMS

See @CLAUDE.EMDASH.md for collections, plugins, patches, page structure, and common gotchas.

## MCP Server

See @CLAUDE-mcp.md for tool structure, runtime constraints, and how to add tools. For content management tools, use the built-in EmDash MCP (`emdash-admin` in `.mcp.json`).

## Cloudflare / Wrangler

See @CLAUDE.CLOUDFLARE.md for the dual-config setup, sandbox plugin behavior, and known gotchas with the Cloudflare adapter.

## Patches

One package is patched via `pnpm patch`:
- `emdash@0.31.1` — `patches/emdash@0.31.1.patch`

Declared in `package.json` under `pnpm.patchedDependencies`. Applied automatically after `pnpm install`. If you upgrade emdash, re-apply or update the patch against the new version.

## Dependency Pinning

The Cloudflare adapter stack has a peer-dependency chain that must stay in sync. See @rules/dep-pinning.md for upgrade rules and failure signatures.
 