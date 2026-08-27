/**
 * Reference remote media without downloading it — the "Link only" tab.
 *
 * Nothing here writes to storage or the database. The site ends up hotlinking
 * the origin, exactly like EmDash's built-in "Insert from URL" box, so the media
 * breaks if the source disappears or starts blocking hotlinks. The one thing it
 * adds over the built-in box is that a post URL is still resolved to a real
 * media link first.
 */

import type { MediaProviderItem } from "emdash/media";

import { SideloadError } from "./downloader";
import { bareMime, isAllowedMime, matchesFilter, parseHttpUrl, toAltText } from "./normalize";
import type { PostContext } from "./types";

/**
 * Describe a remote file from its response headers alone.
 *
 * The body is cancelled as soon as the headers arrive, so this costs one
 * round-trip and no storage. Dimensions stay unknown: reading them needs the
 * bytes, which is exactly what this mode exists to avoid.
 */
export async function linkItem(
	link: string,
	cfg: { altMaxLength: number },
	post: Omit<PostContext, "stem">,
): Promise<MediaProviderItem | null> {
	const url = parseHttpUrl(link);
	if (!url) return null;

	const response = await fetch(url.href, { headers: { accept: "*/*" } });
	try {
		if (!response.ok) {
			throw new SideloadError(`Failed to reach media (HTTP ${response.status}).`);
		}

		const mimeType = bareMime(response.headers.get("Content-Type") ?? "");
		if (!mimeType) throw new SideloadError("Could not determine the file type.");
		if (!isAllowedMime(mimeType)) throw new SideloadError(`File type not allowed: ${mimeType}`);
		if (!matchesFilter(mimeType, post.mimeFilter)) return null;

		const declaredLength = Number(response.headers.get("Content-Length") ?? "");
		const caption = post.caption?.trim() || undefined;

		return {
			// No library row exists, so the URL itself is the stable identity.
			id: url.href,
			filename: url.pathname.split("/").pop() || url.hostname,
			mimeType,
			size: Number.isFinite(declaredLength) ? declaredLength : undefined,
			alt: toAltText(post.title?.trim() || caption, cfg.altMaxLength),
			previewUrl: url.href,
			// `src` marks this as an external reference for getEmbed; without it the
			// embed would look for a storage key that was never written.
			meta: { src: url.href, caption },
		};
	} finally {
		await response.body?.cancel().catch(() => {});
	}
}
