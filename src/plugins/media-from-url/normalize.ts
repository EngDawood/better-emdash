/**
 * URL, MIME, and text normalization helpers.
 *
 * Pure functions only — no network, no database. Everything here is safe to
 * unit test in isolation.
 */

import { ALLOWED_MIME, MIME_EXTENSION } from "./constants";

/** Strip parameters from a Content-Type header value (e.g. "; charset=..."). */
export function bareMime(headerValue: string): string {
	return (headerValue.split(";")[0] ?? "").trim().toLowerCase();
}

/** True when the MIME is one this provider is willing to store. */
export function isAllowedMime(mime: string): boolean {
	return ALLOWED_MIME.some((entry) =>
		entry.endsWith("/") ? mime.startsWith(entry) : mime === entry,
	);
}

/** True when `mime` satisfies the field's filter (same prefix rules as EmDash). */
export function matchesFilter(mime: string, filter?: string): boolean {
	if (!filter) return true;
	const normalized = filter.toLowerCase();
	return normalized.endsWith("/") ? mime.startsWith(normalized) : mime === normalized;
}

/** Collapse a post caption into something usable as alt text. */
export function toAltText(caption: string | undefined, limit: number): string | undefined {
	if (!caption) return undefined;
	const flat = caption.replace(/\s+/g, " ").trim();
	if (!flat) return undefined;
	return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** Turn arbitrary text into a safe filename stem. */
export function toStem(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const slug = text
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}-]/gu, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
	return slug || undefined;
}

/** Pick a file extension, preferring the URL's own over one derived from MIME. */
export function extensionFor(url: URL, mime: string): string {
	const last = url.pathname.split("/").pop() ?? "";
	const dot = last.lastIndexOf(".");
	// Only trust a short, alphanumeric extension — long tails are usually path
	// noise or a signature fragment rather than a real file suffix.
	if (dot > -1) {
		const ext = last.slice(dot);
		if (/^\.[a-z0-9]{2,5}$/i.test(ext)) return ext.toLowerCase();
	}
	return MIME_EXTENSION[mime] ?? "";
}

/** True when the path already names a file, so no lookup is needed to fetch it. */
export function looksLikeFileUrl(url: URL): boolean {
	return /\.[a-z0-9]{2,5}$/i.test(url.pathname);
}

/** Reject anything that is not a plain http(s) URL with a hostname. */
export function parseHttpUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (!url.hostname || !url.hostname.includes(".")) return null;
	return url;
}
