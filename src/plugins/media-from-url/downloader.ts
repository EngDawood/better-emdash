/**
 * Client for the download-media Worker.
 *
 * Turns a social post URL into the direct media links behind it, plus whatever
 * text the post carried. Nothing here touches storage or the database.
 */

import type { ApiMediaItem, ResolvedPost } from "./types";

/** A failure worth showing the editor verbatim, rather than a generic error. */
export class SideloadError extends Error {}

/**
 * Reach the Workers `env` through a dynamic import so module evaluation still
 * works outside workerd (typecheck, vitest); only an actual call needs the
 * runtime.
 */
export async function getEnv(): Promise<Record<string, unknown> | null> {
	try {
		const { env } = await import("cloudflare:workers");
		return env as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

interface ApiPayload {
	status?: string;
	media?: ApiMediaItem[];
	caption?: string;
	title?: string;
	fullText?: string;
	error?: string;
	retryable?: boolean;
}

/** Translate a non-success response into the clearest message we can give. */
function describeFailure(payload: ApiPayload, status: number): SideloadError {
	const detail = payload.error ?? `HTTP ${status}`;
	if (status === 401) return new SideloadError("Downloader rejected the API key.");
	if (status === 403) return new SideloadError("This content is not allowed.");
	if (payload.retryable) {
		return new SideloadError(`Still extracting — try again in a few seconds. (${detail})`);
	}
	return new SideloadError(`Could not resolve that link: ${detail}`);
}

/**
 * Ask download-media to resolve a post URL into direct media links.
 *
 * Prefers the service binding (no public hop, no egress) and falls back to plain
 * HTTPS when the binding is absent — the normal case in `pnpm dev`, where
 * download-media-bot is not running locally.
 */
export async function resolveViaApi(
	rawUrl: string,
	cfg: { apiUrl: string; bindingName: string; apiKeyVar: string },
): Promise<ResolvedPost> {
	const env = await getEnv();
	const apiKey = typeof env?.[cfg.apiKeyVar] === "string" ? (env[cfg.apiKeyVar] as string) : null;
	if (!apiKey) {
		throw new SideloadError(
			`media-from-url: ${cfg.apiKeyVar} is not set — add it to .dev.vars for local dev and as a Worker secret in production.`,
		);
	}

	const binding = env?.[cfg.bindingName] as { fetch: typeof fetch } | undefined;
	const init: RequestInit = {
		method: "POST",
		headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
		body: JSON.stringify({ url: rawUrl, mode: "auto" }),
	};

	const response =
		binding && typeof binding.fetch === "function"
			? await binding.fetch(cfg.apiUrl, init)
			: await fetch(cfg.apiUrl, init);

	// download-media answers 502 for every non-success result, so the HTTP status
	// alone cannot distinguish "still extracting" from "unsupported".
	let payload: ApiPayload;
	try {
		payload = (await response.json()) as ApiPayload;
	} catch {
		throw new SideloadError(`Downloader returned a non-JSON response (HTTP ${response.status}).`);
	}

	if (payload.status !== "success") {
		throw describeFailure(payload, response.status);
	}

	return {
		links: (payload.media ?? [])
			.filter((item) => typeof item?.url === "string" && item.url)
			.map((item) => item.url),
		caption: payload.caption,
		title: payload.title,
		fullText: payload.fullText,
	};
}
