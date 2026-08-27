/**
 * Defaults and lookup tables for the "From URL" media provider.
 */

export const DEFAULTS = {
	apiUrl: "https://dl.engdawood.com/api/download",
	bindingName: "MEDIA_DL",
	apiKeyVar: "PUBLIC_API_KEY",
	maxUploadSize: 50 * 1024 * 1024,
	bufferLimit: 20 * 1024 * 1024,
	altMaxLength: 200,
	linkOnly: false,
	saveArticles: true,
} as const;

/** Route EmDash serves stored objects from. */
export const MEDIA_FILE_PREFIX = "/_emdash/api/media/file/";

/** Extension per MIME, used when the source URL carries none of its own. */
export const MIME_EXTENSION: Record<string, string> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/svg+xml": ".svg",
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
	"audio/mpeg": ".mp3",
	"audio/mp4": ".m4a",
	"audio/ogg": ".ogg",
	"audio/wav": ".wav",
	"application/pdf": ".pdf",
};

/** Mirrors EmDash's GLOBAL_UPLOAD_ALLOWLIST. Entries ending in "/" are prefixes. */
export const ALLOWED_MIME: readonly string[] = ["image/", "video/", "audio/", "application/pdf"];

/**
 * Saved article bodies. Deliberately outside ALLOWED_MIME: that list mirrors the
 * guard on EmDash's own upload routes, which this provider does not go through,
 * and an article is written from text we generated rather than an arbitrary
 * uploaded file.
 */
export const ARTICLE_MIME = "text/markdown";
