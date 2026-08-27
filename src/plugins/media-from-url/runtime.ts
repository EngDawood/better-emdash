/**
 * "From URL" media provider — the entrypoint EmDash loads.
 *
 * Registered twice in `astro.config.mjs` as two picker tabs sharing this module:
 * "From URL" (saves into the library) and "Link only" (`linkOnly: true`, which
 * references the remote URL instead). A media provider cannot contribute UI to
 * the picker, so the save-or-link choice is surfaced as tabs rather than the
 * checkbox it would otherwise be.
 *
 * Two kinds of input are accepted:
 *
 *   - a direct file URL (`.../photo.jpg`) — used as-is
 *   - a social post URL (TikTok, Instagram, X, YouTube, ...) — resolved to its
 *     underlying media links by the download-media Worker, which returns a
 *     `media[]` array, so galleries and albums arrive as several items
 *
 * The provider is driven through the media picker's search field — whatever the
 * editor pastes arrives here as `list({ query })`.
 *
 * Layout:
 *   constants.ts   defaults and lookup tables
 *   normalize.ts   pure URL / MIME / text helpers
 *   downloader.ts  the download-media API client
 *   library.ts     everything that writes a media row
 *   link.ts        reference-only mode
 *   types.ts       shared types
 */

import { MediaRepository } from "emdash";
import type {
	CreateMediaProviderFn,
	EmbedOptions,
	EmbedResult,
	MediaListOptions,
	MediaProvider,
	MediaProviderItem,
	MediaValue,
} from "emdash/media";

import { DEFAULTS, MEDIA_FILE_PREFIX } from "./constants";
import { resolveViaApi } from "./downloader";
import { linkItem } from "./link";
import { sideload, saveArticle, toProviderItem } from "./library";
import { looksLikeFileUrl, parseHttpUrl, toStem } from "./normalize";
import type { FromUrlConfig, ResolvedConfig, ResolvedPost } from "./types";

/**
 * Results already resolved in this isolate, keyed by the pasted URL and field
 * filter.
 *
 * The picker debounces its search box by 300ms, so a paste normally produces a
 * single call — but re-opening the tab would otherwise repeat the work.
 * Content-hash dedupe already collapses repeats for buffered files; this also
 * covers streamed ones, which have no hash.
 */
const resolvedCache = new Map<string, MediaProviderItem[]>();

export const createMediaProvider: CreateMediaProviderFn<FromUrlConfig> = (config) => {
	const cfg: ResolvedConfig = { ...DEFAULTS, ...config };
	const { db, storage } = config;

	if (!db) throw new Error("media-from-url requires a database connection");

	// Resolve the connection per operation so connection-backed adapters use the
	// current request-scoped one, matching EmDash's local provider.
	const resolveDb = config.getDb ?? (() => db);

	/** Save every link from a post, keeping whatever succeeds. */
	async function saveAll(
		post: ResolvedPost,
		baseStem: string,
		mimeFilter: string | undefined,
	): Promise<MediaProviderItem[]> {
		const items: MediaProviderItem[] = [];
		const failures: string[] = [];

		for (const [index, link] of post.links.entries()) {
			// A gallery returns several files, so each needs its own stem.
			const stem = post.links.length > 1 ? `${baseStem}-${index + 1}` : baseStem;
			const context = { caption: post.caption, title: post.title, stem, mimeFilter };

			try {
				// `storage` is non-null here: list() throws before calling saveAll when
				// saving is required but storage is missing, and link mode never writes.
				const item = cfg.linkOnly
					? await linkItem(link, cfg, context)
					: await sideload(link, { db: resolveDb(), storage: storage! }, cfg, context);
				if (item) items.push(item);
			} catch (error) {
				failures.push(error instanceof Error ? error.message : String(error));
			}
		}

		// Surface the reason only when nothing at all landed — a gallery with one
		// bad item should still hand back the items that worked.
		if (items.length === 0) {
			throw new Error(failures[0] ?? "Nothing at that link matched this field.");
		}
		return items;
	}

	/**
	 * A post with body text but no media is an X Article or thread. Saving it as a
	 * document beats reporting "nothing found" for a link that plainly has
	 * content — but there is nothing to reference in link-only mode.
	 */
	async function saveTextOnly(
		post: ResolvedPost,
		baseStem: string,
		mimeFilter: string | undefined,
	): Promise<MediaProviderItem[]> {
		if (cfg.linkOnly || !cfg.saveArticles || !post.fullText?.trim() || !storage) {
			throw new Error("No downloadable media found at that link.");
		}

		const article = await saveArticle({ db: resolveDb(), storage }, cfg, {
			fullText: post.fullText,
			title: post.title,
			caption: post.caption,
			stem: baseStem,
			mimeFilter,
		});
		if (!article) throw new Error("That link is an article, which this field does not accept.");
		return [article];
	}

	const provider: MediaProvider = {
		async list(options: MediaListOptions) {
			const query = options.query?.trim();
			// No query means the tab was merely opened — never download on that.
			if (!query) return { items: [] };

			const source = parseHttpUrl(query);
			if (!source) return { items: [] };

			const cacheKey = `${source.href}|${options.mimeType ?? ""}`;
			const cached = resolvedCache.get(cacheKey);
			if (cached) return { items: cached };

			// Link-only mode never writes, so storage is only required for saving.
			if (!cfg.linkOnly && !storage) {
				throw new Error("media-from-url requires storage to be configured");
			}

			// A URL that already names a file is used directly; anything else goes to
			// download-media to be resolved into real media links first.
			const post: ResolvedPost = looksLikeFileUrl(source)
				? { links: [source.href] }
				: await resolveViaApi(source.href, cfg);

			const baseStem =
				toStem(post.title) ?? toStem(post.caption) ?? source.hostname.replace(/^www\./, "");

			const items =
				post.links.length === 0
					? await saveTextOnly(post, baseStem, options.mimeType)
					: await saveAll(post, baseStem, options.mimeType);

			resolvedCache.set(cacheKey, items);
			return { items };
		},

		async get(id: string) {
			// Link-only ids are URLs, not library ids, so this simply misses for them.
			const item = await new MediaRepository(resolveDb()).findById(id);
			return item ? toProviderItem(item) : null;
		},

		getEmbed(value: MediaValue, _options?: EmbedOptions): EmbedResult {
			// Link-only picks carry the remote URL in `meta.src` and have no storage
			// key, so that takes precedence over the library path.
			const external = typeof value.meta?.src === "string" ? value.meta.src : undefined;
			const storageKey =
				typeof value.meta?.storageKey === "string" ? value.meta.storageKey : value.id;
			const src = external ?? `${MEDIA_FILE_PREFIX}${storageKey}`;
			const mimeType = value.mimeType || "";

			if (mimeType.startsWith("video/")) {
				return {
					type: "video",
					src,
					width: value.width,
					height: value.height,
					controls: true,
					preload: "metadata",
				};
			}

			if (mimeType.startsWith("audio/")) {
				return { type: "audio", src, controls: true, preload: "metadata" };
			}

			return {
				type: "image",
				src,
				width: value.width,
				height: value.height,
				blurhash: value.blurhash,
				dominantColor: value.dominantColor,
				alt: value.alt,
			};
		},

		getThumbnailUrl(id: string) {
			// Link-only items use the remote URL as their id; library items use a
			// storage key, which has to be served through the media route.
			return id.startsWith("http://") || id.startsWith("https://")
				? id
				: `${MEDIA_FILE_PREFIX}${id}`;
		},
	};

	return provider;
};
