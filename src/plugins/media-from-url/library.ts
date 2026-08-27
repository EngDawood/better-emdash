/**
 * Writes into the EmDash media library.
 *
 * Everything here produces a real row in the media table backed by an object in
 * R2 — the behaviour that separates the "From URL" tab from EmDash's built-in
 * "Insert from URL" box, which only ever stores a remote URL.
 */

import { MediaRepository, computeContentHash } from "emdash";
import { enrichImageMetadata } from "emdash/media";
import type { MediaProviderItem } from "emdash/media";

import { ARTICLE_MIME, MEDIA_FILE_PREFIX } from "./constants";
import { SideloadError } from "./downloader";
import {
	bareMime,
	extensionFor,
	isAllowedMime,
	matchesFilter,
	parseHttpUrl,
	toAltText,
} from "./normalize";
import type { MediaRow, PostContext, WriteDeps } from "./types";

/** Shape a persisted row the way the picker expects (mirrors the local provider). */
export function toProviderItem(item: MediaRow): MediaProviderItem {
	return {
		id: item.id,
		filename: item.filename,
		mimeType: item.mimeType,
		size: item.size ?? undefined,
		width: item.width ?? undefined,
		height: item.height ?? undefined,
		blurhash: item.blurhash ?? undefined,
		dominantColor: item.dominantColor ?? undefined,
		alt: item.alt ?? undefined,
		previewUrl: `${MEDIA_FILE_PREFIX}${item.storageKey}`,
		meta: {
			storageKey: item.storageKey,
			caption: item.caption ?? undefined,
			blurhash: item.blurhash ?? undefined,
			dominantColor: item.dominantColor ?? undefined,
		},
	};
}

/**
 * Create the row for an object already uploaded under `storageKey`, removing
 * that object if the insert fails so storage never keeps an orphan.
 */
async function createOrCleanUp(
	deps: WriteDeps,
	storageKey: string,
	input: Parameters<MediaRepository["create"]>[0],
): Promise<MediaProviderItem> {
	try {
		return toProviderItem(await new MediaRepository(deps.db).create(input));
	} catch (error) {
		try {
			await deps.storage.delete(storageKey);
		} catch {
			// Cleanup is best-effort.
		}
		throw error;
	}
}

/**
 * Fetch one media link and persist it as a library row.
 *
 * Small files are buffered so dedupe and enrichment can run; anything larger
 * streams directly into R2 to stay inside the Worker's memory budget. Unknown
 * length counts as large — streaming is always safe, buffering an unbounded
 * body is not.
 */
export async function sideload(
	link: string,
	deps: WriteDeps,
	cfg: { maxUploadSize: number; bufferLimit: number; altMaxLength: number },
	post: PostContext,
): Promise<MediaProviderItem | null> {
	const url = parseHttpUrl(link);
	if (!url) return null;

	const response = await fetch(url.href, { headers: { accept: "*/*" } });
	if (!response.ok || !response.body) {
		throw new SideloadError(`Failed to fetch media (HTTP ${response.status}).`);
	}

	// MIME comes from the response, not the path — that is what lets extensionless
	// CDN and signed URLs work at all.
	const mimeType = bareMime(response.headers.get("Content-Type") ?? "");
	if (!mimeType) throw new SideloadError("Could not determine the file type.");
	if (!isAllowedMime(mimeType)) throw new SideloadError(`File type not allowed: ${mimeType}`);
	if (!matchesFilter(mimeType, post.mimeFilter)) return null;

	const declaredLength = Number(response.headers.get("Content-Length") ?? "");
	if (Number.isFinite(declaredLength) && declaredLength > cfg.maxUploadSize) {
		throw new SideloadError(
			`File is ${Math.round(declaredLength / 1024 / 1024)}MB, over the ${Math.round(
				cfg.maxUploadSize / 1024 / 1024,
			)}MB limit.`,
		);
	}

	// The post's own text becomes the caption; alt is a trimmed form of the title
	// or caption, since a full post body is useless as accessibility text.
	const caption = post.caption?.trim() || undefined;
	const alt = toAltText(post.title?.trim() || caption, cfg.altMaxLength);

	const extension = extensionFor(url, mimeType);
	const storageKey = `${crypto.randomUUID()}${extension}`;
	const shouldBuffer = Number.isFinite(declaredLength) && declaredLength <= cfg.bufferLimit;

	if (!shouldBuffer) {
		await deps.storage.upload({ key: storageKey, body: response.body, contentType: mimeType });
		return createOrCleanUp(deps, storageKey, {
			filename: `${post.stem}${extension}`,
			mimeType,
			size: Number.isFinite(declaredLength) ? declaredLength : 0,
			alt,
			caption,
			storageKey,
		});
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > cfg.maxUploadSize) {
		throw new SideloadError("File is over the upload size limit.");
	}

	const contentHash = await computeContentHash(bytes);
	const existing = await new MediaRepository(deps.db).findByContentHash(contentHash);
	if (existing) return toProviderItem(existing);

	const enriched = await enrichImageMetadata(bytes, mimeType);
	await deps.storage.upload({ key: storageKey, body: bytes, contentType: mimeType });

	return createOrCleanUp(deps, storageKey, {
		filename: `${post.stem}${extension}`,
		mimeType,
		size: bytes.byteLength,
		width: enriched.width,
		height: enriched.height,
		alt,
		caption,
		storageKey,
		contentHash,
		blurhash: enriched.blurhash,
		dominantColor: enriched.dominantColor,
	});
}

/**
 * Persist a post's body text as a Markdown document in the library.
 *
 * Used for X Articles and threads, which carry `fullText` but often no media at
 * all — without this they would come back as "no downloadable media found".
 */
export async function saveArticle(
	deps: WriteDeps,
	cfg: { altMaxLength: number },
	post: PostContext & { fullText: string },
): Promise<MediaProviderItem | null> {
	if (!matchesFilter(ARTICLE_MIME, post.mimeFilter)) return null;

	const heading = post.title?.trim();
	const bytes = new TextEncoder().encode(
		heading ? `# ${heading}\n\n${post.fullText}` : post.fullText,
	);

	const contentHash = await computeContentHash(bytes);
	const existing = await new MediaRepository(deps.db).findByContentHash(contentHash);
	if (existing) return toProviderItem(existing);

	const storageKey = `${crypto.randomUUID()}.md`;
	await deps.storage.upload({ key: storageKey, body: bytes, contentType: ARTICLE_MIME });

	return createOrCleanUp(deps, storageKey, {
		filename: `${post.stem}.md`,
		mimeType: ARTICLE_MIME,
		size: bytes.byteLength,
		alt: toAltText(heading || post.caption, cfg.altMaxLength),
		caption: post.caption?.trim() || undefined,
		storageKey,
		contentHash,
	});
}
