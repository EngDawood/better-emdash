# EmDash CMS Setup

## Skills

When working on EmDash-related tasks, load the relevant skill first:

- `building-emdash-site` — Querying content, rendering, schema, seed, site features
- `creating-plugins` — Plugin anatomy, hooks, storage, admin UI, API routes, capabilities
- `emdash-cli` — CLI commands (`emdash dev`, `emdash seed`, `emdash types`, `emdash init`)

## What EmDash Is

EmDash is a CMS that runs inside the Astro site. It stores schema and content in a Cloudflare D1 database and exposes a full admin UI at `/_emdash/admin`. There is no separate CMS server — it's all part of the same Cloudflare Worker.

## Bindings (declared in `wrangler.jsonc`)

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 | Content + schema storage |
| `MEDIA` | R2 | Media uploads |
| `SESSION` | KV | Auth sessions |
| `MCP_OBJECT` | Durable Object | EmDash MCP server (`EmDashMCP`) |

## Collections

Defined in `seed/seed.json`, queried via `getEmDashCollection()` / `getEmDashEntry()`:

| Slug | Label | Notes |
|------|-------|-------|
| `projects` | Projects | Portfolio work items |
| `posts` | Posts | Blog posts |
| `pages` | Pages | Static CMS pages |

All content is live (server-rendered at request time via `emdash/runtime` loader in `src/live.config.ts`). No `getStaticPaths` — the site is `output: "server"`.

## Plugins

Configured in `astro.config.mjs`. See also `CLAUDE.md` § Plugins for the full inventory.

### Native plugins (`plugins: []`)

- **`formsPlugin()`** — `@emdash-cms/plugin-forms`; public submit at `/_emdash/api/plugins/emdash-forms/submit`; contact form at `src/pages/[locale]/index.astro` posts here
- **`colorPlugin()`** — `@emdash-cms/plugin-color`; adds `color:picker` widget to `string` fields
- **`embedsPlugin()`** — `@emdash-cms/plugin-embeds`; YouTube/Vimeo/Bluesky/Mastodon/Twitter/Gist blocks auto-registered into `<PortableText>`
- **`calloutPlugin()`** — `@plugdash/callout`; info/warning/tip/danger blocks auto-registered into `<PortableText>`
- **SEO** (inline descriptor) — source at `src/plugins/seo/` (copied from `@jdevalk/emdash-plugin-seo`); injects metadata via `<EmDashHead>`; admin at `/settings` and `/fuzzy-redirects`
- **`aiModerationPlugin()`** — `@emdash-cms/plugin-ai-moderation`; hooks `comment:beforeCreate` + `comment:moderate`; requires `AI` Workers AI binding
- **`email-cf-provider`** — `src/plugins/email-cf-worker.ts`; Cloudflare Email transport

### Sandboxed plugins (`sandboxed: []`)

- **`webhookNotifier`** — `@emdash-cms/plugin-webhook-notifier`; dev-only (stripped from production)
- **`auditLog`** — `@emdash-cms/plugin-audit-log`; content change audit trail
- **`atproto`** — `@emdash-cms/plugin-atproto`; Bluesky post syndication; configure credentials via admin UI
- **`customBlocksPlugin()`** — `@emdash.directory/plugin-custom-blocks`; reusable HTML snippets; admin page to manage blocks + `/customBlock` slash command in editor

### Adding new native plugins

Use `fileURLToPath(new URL("./src/plugins/xxx.ts", import.meta.url)).replaceAll("\\", "/")` for entrypoints — never `URL.pathname` directly (breaks on Windows with `/C:/...` prefix). If a community npm plugin ships TypeScript source without a `dist/`, copy `src/` to `src/plugins/<name>/` and create an inline descriptor.

## Key Source Files

| File | Purpose |
|------|---------|
| `src/live.config.ts` | Registers `_emdash` live collection (boilerplate, don't change) |
| `src/layouts/Base.astro` | Root layout; fetches site settings, menu, pages on every request |
| `src/mcp/index.ts` | `EmDashMCP` Durable Object — exposes EmDash CRUD as MCP tools |
| `src/plugins/email-worker.ts` | Native email plugin (Resend) |
| `src/worker.ts` | Worker entry; exports `PluginBridge` and `EmDashMCP` |
| `seed/seed.json` | Schema + demo content seed |

## Pages Structure

```
src/pages/
  index.astro                     # Redirects to /ar/
  about.astro                     # Redirects to /ar/#about
  contact.astro                   # Redirects to /ar/#contact
  posts/[slug].astro              # Blog post detail
  posts/index.astro               # Blog list
  work/[slug].astro               # Project detail
  work/index.astro                # Work list (missing — only in [locale]/)
  pages/[slug].astro              # CMS pages
  [locale]/index.astro            # Homepage (main — see below)
  [locale]/posts/                 # Blog list + detail
  [locale]/work/                  # Work list + detail
  search.astro                    # Search
  rss.xml.ts                      # RSS feed
  sitemap.xml.ts                  # Sitemap
```

### Homepage sections (`src/pages/[locale]/index.astro`)

The homepage follows a numbered editorial structure:

| Section | ID | Content |
|---------|-----|---------|
| Hero | `#hero` | Masthead bar + Bilingual Lockup (Playfair + Amiri) + body (lede/CTAs/stack/metrics) + ticker |
| §01 Work | `#work` | Numbered project rows from `projects` collection |
| §02 Writing | `#writing` | Magazine grid (feature + side cards) from `posts` collection (4 most recent) |
| §03 About | `#about` | Info list + drop-cap bio + skills matrix |
| §04 Contact | `#contact` | Two-column: contact links + contact form |

## Patches

One package is patched via `pnpm patch` (applied automatically after `pnpm install`):

| Package | Patch | What it fixes |
|---------|-------|---------------|
| `emdash@0.31.1` | `patches/emdash@0.31.1.patch` | `createContentAccessWithWrite` in `src/plugins/context.ts` puts the whole payload into `data`. The patch promotes reserved columns (`slug`, `status`, `publishedAt`, `scheduledAt`, `authorId`, `primaryBylineId`, `locale`, `translationOf`, `createdAt`) to real columns on `create`/`update` — required by the RSS aggregator's publish flow. Still unfixed upstream as of 0.31.1 |

Declared in `package.json` under `pnpm.patchedDependencies`. If you upgrade emdash, re-apply or update the patch against the new version.

## Social Links & Site Settings

`getSiteSettings()` returns `settings.social?.{ twitter, github, facebook, instagram, linkedin, youtube }`. The homepage uses these with fallbacks:

```ts
const github = settings.social?.github ?? "https://github.com/EngDawood";
const linkedin = settings.social?.linkedin ?? "https://www.linkedin.com/in/dawood3";
const twitter = settings.social?.twitter ?? "https://x.com/dawo5d";
// telegram + email are hardcoded (not in EmDash social settings)
```

Set the actual values in EmDash admin → Settings → Social.

## Common Gotchas

1. **Image fields are objects** — `entry.data.featured_image` is `{ id, src, alt }`, not a string. Use `<Image image={...} />` from `emdash/ui`.
2. **`entry.id` vs `entry.data.id`** — `entry.id` is the slug (use in URLs). `entry.data.id` is the DB ULID (use for `getEntryTerms`, `Comments`, etc.).
3. **Always call `Astro.cache.set(cacheHint)`** — every content query returns a `cacheHint`. Without it, cache invalidation won't fire when editors publish.
4. **No static paths** — never use `getStaticPaths` for EmDash content. All pages are server-rendered.
5. **`emdash-env.d.ts` is auto-generated** — regenerate with `npx emdash types` after schema changes.

## Bootstrap (First-Time Setup)

```bash
pnpm bootstrap   # runs: npx emdash init && npx emdash seed seed/seed.json
```

This initializes the D1 schema and seeds demo content. Only needed once per environment.
