/**
 * Shared types for the "From URL" media provider.
 */

import type { MediaRepository } from "emdash";

/**
 * The database handle EmDash injects. Derived from MediaRepository rather than
 * imported, because emdash does not export its Kysely `Database` schema type.
 */
export type EmDashDb = ConstructorParameters<typeof MediaRepository>[0];

/** The slice of EmDash's Storage adapter this provider actually uses. */
export interface StorageLike {
	upload(options: {
		key: string;
		body: Uint8Array | ReadableStream<Uint8Array>;
		contentType: string;
	}): Promise<unknown>;
	delete(key: string): Promise<void>;
}

/** Database + storage pair passed to anything that writes a library row. */
export interface WriteDeps {
	db: EmDashDb;
	storage: StorageLike;
}

export interface FromUrlConfig {
	/** Absolute URL of the download-media API. Over a binding only the path matters. */
	apiUrl?: string;
	/** Service-binding name checked on `env` before falling back to plain HTTPS. */
	bindingName?: string;
	/** Name of the env var holding the download-media API key. */
	apiKeyVar?: string;
	/** Hard ceiling per file. Matches EmDash's DEFAULT_MAX_UPLOAD_SIZE. */
	maxUploadSize?: number;
	/**
	 * Files at or below this size are buffered so the content hash (dedupe) and
	 * image enrichment (dimensions, blurhash, dominant colour) can run. Larger
	 * files stream straight to R2 and skip both.
	 */
	bufferLimit?: number;
	/** Longest `alt` derived from a post caption before it is truncated. */
	altMaxLength?: number;
	/**
	 * Reference the remote URL instead of downloading it. Drives the "Link only"
	 * tab, which behaves like EmDash's built-in "Insert from URL" box except that
	 * it can still resolve post URLs into real media links first. Nothing is
	 * written to R2 or the media library in this mode, so the site hotlinks the
	 * origin and the media breaks if the source goes away.
	 */
	linkOnly?: boolean;
	/**
	 * When a post carries body text but no media (an X Article or thread), save
	 * that text as a Markdown document in the library rather than failing.
	 */
	saveArticles?: boolean;

	// Injected by the EmDash runtime (MediaProviderContext), not user config.
	db?: EmDashDb;
	getDb?: () => EmDashDb;
	storage?: StorageLike;
}

/** Config with every optional field filled in from DEFAULTS. */
export type ResolvedConfig = FromUrlConfig &
	Required<
		Pick<
			FromUrlConfig,
			| "apiUrl"
			| "bindingName"
			| "apiKeyVar"
			| "maxUploadSize"
			| "bufferLimit"
			| "altMaxLength"
			| "linkOnly"
			| "saveArticles"
		>
	>;

/** Shape returned by download-media's `media[]` (its src/types/downloader.ts). */
export interface ApiMediaItem {
	type: "video" | "photo" | "audio" | "document";
	url: string;
	quality?: string;
	filesize?: number;
}

/** What the downloader tells us about the post as a whole. */
export interface ResolvedPost {
	links: string[];
	caption?: string;
	title?: string;
	/** Body of long-form content (X Articles, threads) as Markdown. */
	fullText?: string;
}

/** Per-item context carried from the post into each saved file. */
export interface PostContext {
	caption?: string;
	title?: string;
	/** Filename stem, already made safe and unique within a gallery. */
	stem: string;
	/** The field's MIME filter, so a video is not offered to an image field. */
	mimeFilter?: string;
}

/** A media row as read back from the repository. */
export interface MediaRow {
	id: string;
	filename: string;
	mimeType: string;
	size?: number | null;
	width?: number | null;
	height?: number | null;
	blurhash?: string | null;
	dominantColor?: string | null;
	alt?: string | null;
	caption?: string | null;
	storageKey: string;
}
