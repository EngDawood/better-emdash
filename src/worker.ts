import handler from "@astrojs/cloudflare/entrypoints/server";
import { EmDashMCP, handleMcp, handleProtectedResourceMetadata, RESOURCE_METADATA_PATH } from "./mcp";

interface WorkerEnv extends Cloudflare.Env {
	MCP_OBJECT: DurableObjectNamespace<EmDashMCP>;
}

export { PluginBridge } from "@emdash-cms/cloudflare/sandbox";
export { EmDashMCP };

// `caches.default` is a Cloudflare Workers runtime API not present on the DOM `CacheStorage` type.
const edgeCache = (caches as unknown as { default: Cache }).default;

// Serve a cached page as "fresh" for this long; after it, refresh in the background (SWR).
const FRESH_TTL_MS = 60_000;
// Keep the (possibly stale) copy available in the edge cache for this long so SWR can serve it.
const EDGE_MAX_AGE_S = 86_400;

// Render via Astro and store the result in the edge cache. Returns the rendered response.
async function renderAndStore(
	request: Request,
	env: WorkerEnv,
	ctx: ExecutionContext,
	cacheKey: Request,
): Promise<Response> {
	const response = await handler.fetch(request, env, ctx);
	if (response.status !== 200) return response;

	const toCache = new Response(response.body, response);
	toCache.headers.set("Cache-Control", `public, s-maxage=${EDGE_MAX_AGE_S}`);
	toCache.headers.set("X-Rendered-At", Date.now().toString());
	// Store without blocking the response to the client.
	ctx.waitUntil(edgeCache.put(cacheKey, toCache.clone()));
	return toCache;
}

export default {
	async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return handleMcp(request, env, ctx);
		}

		if (url.pathname === RESOURCE_METADATA_PATH) {
			return handleProtectedResourceMetadata(request);
		}

		// Only cache GET requests from unauthenticated users
		const isGet = request.method === "GET";
		const hasSession = request.headers.get("Cookie")?.includes("astro-session");
		const isApiOrAdmin = url.pathname.startsWith("/_emdash/");

		if (isGet && !hasSession && !isApiOrAdmin) {
			const cacheKey = new Request(url.toString(), { method: "GET" });
			const cached = await edgeCache.match(cacheKey);

			if (cached) {
				// Stale-while-revalidate: always serve the cached copy instantly. If it's
				// older than FRESH_TTL_MS, kick off a background re-render so the next
				// visitor gets fresh content — the slow SSR never blocks a real request.
				const renderedAt = Number(cached.headers.get("X-Rendered-At") ?? "0");
				if (Date.now() - renderedAt > FRESH_TTL_MS) {
					ctx.waitUntil(renderAndStore(request, env, ctx, cacheKey));
				}
				return cached;
			}

			// Cold cache (first request / after eviction): render and store.
			return renderAndStore(request, env, ctx, cacheKey);
		}

		return handler.fetch(request, env, ctx);
	},

	async email(
		message: {
			readonly from: string;
			readonly to: string;
			readonly raw: ReadableStream<Uint8Array>;
			readonly rawSize: number;
			setReject(reason: string): void;
		},
		env: WorkerEnv,
		ctx: ExecutionContext,
	): Promise<void> {
		const inboundSecret = await env.SESSION.get("settings:inboundSecret");
		if (!inboundSecret) {
			console.error("[worker:email] settings:inboundSecret not set in KV");
			message.setReject("Receiver not configured");
			return;
		}

		const rawMime = await new Response(message.raw).text();

		const response = await env.SELF.fetch("http://localhost/_emdash/api/plugins/emdash-inbox/inbound", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Inbound-Secret": inboundSecret,
				"X-EmDash-Request": "1",
			},
			body: JSON.stringify({ rawMime }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "<no body>");
			console.error(`[worker:email] inbound forward failed: ${response.status} ${body}`);
			message.setReject(`Ingest failed: ${response.status}`);
		}
	},
};
