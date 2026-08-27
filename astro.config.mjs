import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { aiModerationPlugin } from "@emdash-cms/plugin-ai-moderation";
import { colorPlugin } from "@emdash-cms/plugin-color";
import { embedsPlugin } from "@emdash-cms/plugin-embeds";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import webhookNotifier from "@emdash-cms/plugin-webhook-notifier";

import { rssAggregatorPlugin } from "@dawod/emdash-rss-aggregator";
import { calloutPlugin } from "@plugdash/callout";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";
import { fileURLToPath } from "node:url";

const seoEntrypoint = fileURLToPath(
	new URL("./src/plugins/seo/index.ts", import.meta.url),
).replaceAll("\\", "/");

const seoAdminEntry = fileURLToPath(
	new URL("./src/plugins/seo/admin.tsx", import.meta.url),
).replaceAll("\\", "/");

const marketingBlocksEntrypoint = fileURLToPath(
	new URL("./src/plugins/marketing-blocks/index.ts", import.meta.url),
).replaceAll("\\", "/");

const emdashInboxEntrypoint = fileURLToPath(
	new URL("./src/plugins/emdash-inbox/index.ts", import.meta.url),
).replaceAll("\\", "/");

const emdashInboxAdminEntry = fileURLToPath(
	new URL("./src/plugins/emdash-inbox/admin.tsx", import.meta.url),
).replaceAll("\\", "/");

const jobsBoardEntrypoint = fileURLToPath(
	new URL("./src/plugins/jobs-board/index.ts", import.meta.url),
).replaceAll("\\", "/");

const jobsBoardAdminEntry = fileURLToPath(
	new URL("./src/plugins/jobs-board/admin.tsx", import.meta.url),
).replaceAll("\\", "/");

const mediaFromUrlEntrypoint = fileURLToPath(
	new URL("./src/plugins/media-from-url/runtime.ts", import.meta.url),
).replaceAll("\\", "/");


export default defineConfig({
	// EmDash reads this block for its locale list and default locale. Without it
	// EmDash runs as a single-language CMS: no locale column, no locale filter,
	// and no Translations panel in the editor.
	//
	// Deliberately no `fallback` — EmDash reads the same key for its *content*
	// fallback chain, which would serve one entry under both locale URLs and
	// recreate the duplicate-content problem the locale-scoped queries fixed.
	//
	// Never set `prefixDefaultLocale: true` / `routing: "prefix-always"`: every
	// injected page route then requires a locale prefix and /_emdash/admin 404s
	// (emdash-cms/emdash#369). Astro's default prefix-other-locales is required.
	// `routing: "manual"` disables Astro's built-in locale middleware. This site
	// routes locales itself via src/pages/[locale]/**, and Astro's automatic
	// prefix-other-locales handling 404s the default locale's own prefix
	// (/ar/blog), which every internal link and the sitemap depend on.
	i18n: {
		defaultLocale: "ar",
		locales: ["ar", "en"],
		routing: "manual",
	},
	output: "server",
	adapter: cloudflare({
		remoteBindings: false,
		inspectorPort: 9230,
	}),
	fonts: [
		{ provider: fontProviders.google(), name: "Playfair Display", cssVariable: "--font-playfair", weights: [400, 500, 700], styles: ["normal", "italic"] },
		{ provider: fontProviders.google(), name: "JetBrains Mono", cssVariable: "--font-jetbrains", weights: [400] },
		{ provider: fontProviders.google(), name: "Amiri", cssVariable: "--font-amiri", weights: [400, 700] },
		{ provider: fontProviders.google(), name: "Cairo", cssVariable: "--font-cairo", weights: [400, 500, 600] },
	],
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			mcp:true ,
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			// Adds a "From URL" tab to the media picker that downloads what you
			// paste into R2 and the media library, instead of hotlinking it the way
			// EmDash's built-in "Insert from URL" box does. Post URLs are resolved
			// to real media links by the download-media Worker (MEDIA_DL binding,
			// falling back to plain HTTPS when the binding is absent, e.g. in dev).
			// The built-in "local" provider is added automatically — do not list it.
			mediaProviders: [
				{
					id: "from-url",
					name: "From URL",
					icon: "⬇️",
					entrypoint: mediaFromUrlEntrypoint,
					capabilities: { browse: false, search: true, upload: false, delete: false },
					config: {},
				},
				// Same runtime in reference mode — the picker has no per-insert
				// checkbox to offer (a media provider cannot contribute UI), so the
				// save-or-link choice is surfaced as a second tab instead.
				{
					id: "from-url-link",
					name: "Link only",
					icon: "🔗",
					entrypoint: mediaFromUrlEntrypoint,
					capabilities: { browse: false, search: true, upload: false, delete: false },
					config: { linkOnly: true },
				},
			],
			plugins: [
				{
					id: "marketing-blocks",
					version: "0.1.0",
					format: "native",
					entrypoint: marketingBlocksEntrypoint,
				},
				formsPlugin(),
				colorPlugin(),
				embedsPlugin(),
				calloutPlugin(),
				{
					id: "custom-blocks",
					version: "0.2.0",
					format: "native",
					entrypoint: "@emdash.directory/plugin-custom-blocks",
					storage: {
						blocks: {
							indexes: ["status", "createdAt"],
							uniqueIndexes: ["slug"],
						},
					},
					adminPages: [
						{
							path: "/",
							label: "Blocks",
							icon: "list",
						},
					],
				},

				{
					id: "seo",
					version: "0.10.0",
					format: "native",
					entrypoint: seoEntrypoint,
					adminEntry: seoAdminEntry,
					adminPages: [
						{ path: "/settings", label: "SEO", icon: "settings" },
						{ path: "/fuzzy-redirects", label: "Fuzzy Redirects", icon: "arrow-right" },
					],
				},
				rssAggregatorPlugin(),
			aiModerationPlugin(),
				{
					id: "emdash-inbox",
					version: "0.7.0",
					format: "native",
					entrypoint: emdashInboxEntrypoint,
					adminEntry: emdashInboxAdminEntry,
					adminPages: [
						{ path: "/", label: "Inbox", icon: "envelope" },
						{ path: "/settings", label: "Settings", icon: "settings" },
					],
					capabilities: [
						"email:provide",
						"email:intercept",
						"hooks.email-transport:register",
						"hooks.email-events:register",
					],
				},
				{
					id: "jobs-board",
					version: "1.0.0",
					format: "native",
					entrypoint: jobsBoardEntrypoint,
					adminEntry: jobsBoardAdminEntry,
					adminPages: [
						{ path: "/", label: "Jobs", icon: "list" },
						{ path: "/settings", label: "Settings", icon: "settings" },
					],
					capabilities: ["network:fetch"],
					allowedHosts: ["*"],
					storage: {
						jobs: {
							indexes: ["status", "category", "source", "postedAt", "syncedAt"],
						},
					},
				},
			],
			// Perf test: audit-log + atproto removed from sandboxed[]. Their
			// content:read hooks were dispatched into Worker-Loader sandboxes on
			// every render and stalling SSR (~18s/page, admin hung). See PR.
			sandboxed: [...(process.env.NODE_ENV !== "production" ? [webhookNotifier] : [])],
			sandboxRunner: sandbox(),
			marketplace: "https://marketplace.emdashcms.com",
		}),
	],
	devToolbar: { enabled: false },
	vite: {
		ssr: {
			optimizeDeps: {
				include: ["schema-dts", "@jdevalk/astro-seo-graph", "@jdevalk/seo-graph-core", "@atproto/api"],
			},
		},
		optimizeDeps: {
			include: [
				"spark-emdash/middleware",
				"emdash/middleware",
				"emdash/middleware/redirect",
				"emdash/middleware/setup",
				"emdash/middleware/auth",
				"emdash/middleware/request-context",
				"@emdash-cms/cloudflare/db/d1",
				"emdash/media/local-runtime",
				"@emdash-cms/plugin-forms",
				"@emdash-cms/cloudflare/storage/r2",
				"emdash/ui",
				"@emdash-cms/plugin-forms/astro",
				"@emdash-cms/plugin-color",
				"@emdash-cms/plugin-embeds",
				"@emdash-cms/plugin-embeds/astro",
				"@plugdash/callout",
				"@plugdash/callout/astro",
				"astro/zod",
				"emdash/runtime",
				"@dawod/emdash-rss-aggregator",
				"@dawod/emdash-rss-aggregator/sandbox",
			],
		},
	},
});
