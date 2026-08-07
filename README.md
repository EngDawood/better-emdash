# modern-emdash-cms

Personal portfolio built with [Astro](https://astro.build/) and [EmDash CMS](https://github.com/emdash-cms/emdash), deployed as a Cloudflare Worker. Bilingual Arabic/English, with a built-in MCP server for AI agent access to content.

## Stack

| Layer | Technology |
|---|---|
| Framework | Astro SSR |
| CMS | EmDash (Cloudflare variant) |
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 |
| Media | Cloudflare R2 |
| Sessions | Cloudflare KV |
| Plugins | Worker Loaders (sandboxed, paid plan) |
| Email | Cloudflare Email Routing |
| UI | React + Vanilla CSS |

## Features

- **Bilingual i18n** — Arabic (default, RTL) and English (LTR). Default locale served at `/`, English at `/en/...`
- **EmDash CMS** — All content lives in D1, managed via EmDash. Pages fetch at request time via `getEmDashCollection()` / `getEmDashEntry()`
- **MCP server** — `/mcp` endpoint exposes 46 tools (36 EmDash content tools + 10 custom tools). Auth via `?token=` or `Authorization: Bearer`
- **Sandboxed plugins** — Marketplace plugins run in isolated Workers via the `LOADER` binding (paid plan)
- **RSS Aggregator** — Local native plugin (`src/plugins/rss-aggregator/`) that imports feeds into EmDash content, with AI summarization/rewriting/translation, image import to R2, custom field mapping, manual curation, and full-text RSS. See [`docs/plugins/rss-aggregator.md`](./docs/plugins/rss-aggregator.md)
- **Editorial design** — Oxblood `#6b1438` accent, bone `#f8f5ef` background, Playfair Display + Amiri + Thmanyah typefaces

## Branches

| Branch | Plan | Notes |
|---|---|---|
| `main` | Paid | `worker_loaders` enabled, Cloudflare Email Routing |
| `free-emdash` | Free | No `worker_loaders` in production, Resend email |

## Local Development

```bash
pnpm install

# Create .dev.vars
echo 'EMDASH_TOKEN=your-token' > .dev.vars

# First-time DB setup 
pnpm bootstrap # Not recommended 

# Start dev server
pnpm dev        # http://localhost:4321
```

## Commands

```bash
pnpm dev          # Dev server (Miniflare)
pnpm build        # Production build
pnpm run deploy   # Build + deploy to Cloudflare Workers
pnpm typecheck    # Astro type check
pnpm bootstrap    # Init EmDash DB schema + seed
```

## Project Structure

```
src/
├── components/       # Astro + React components
├── pages/            # File-based routing
│   └── [locale]/     # Locale-prefixed routes
├── i18n/             # ar.json + en.json translation strings
├── layouts/          # Base.astro (root layout, fonts, nav)
├── mcp/              # MCP proxy (index.ts)
├── plugins/          # EmDash plugin entrypoints
├── live.config.ts    # EmDash collection schema
└── worker.ts         # Cloudflare Worker entry + PluginBridge

wrangler.jsonc        # Dev config (includes worker_loaders)
wrangler.prod.jsonc   # Production deploy config
```

## MCP Server

```bash
# List available tools
curl -H "Authorization: Bearer $EMDASH_TOKEN" https://<Your-Domain>.com/mcp
```

The `/mcp` endpoint merges EmDash's built-in content tools with custom tools and forwards requests to the appropriate handler via `env.SELF` service binding.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `EMDASH_TOKEN` | Yes | Bearer token for MCP auth |
| `EMDASH_URL` | No | Override base URL (defaults to `https://Your-Domain.com`) |

The jobs Worker API base URL is a `jobs-board` plugin setting (Admin → Jobs → Settings), not an environment variable.

## Deployment

```bash
pnpm run deploy
# Runs: pnpm exec wrangler deploy --config wrangler.prod.jsonc
```

Cloudflare Workers Builds dashboard deploy commands must include `--config wrangler.prod.jsonc` — omitting it causes the build to use `wrangler.jsonc` (which has `worker_loaders`) and fail with error 10195 on the free plan.
