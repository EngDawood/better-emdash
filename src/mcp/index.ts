/**
 * EmDash MCP Proxy (Cloudflare Workers)
 *
 * Single MCP endpoint at /mcp that proxies all requests to the built-in
 * EmDash MCP at /_emdash/api/mcp, merging in the inbox plugin tools.
 *
 * Auth: Bearer token via Authorization header OR ?token= query param.
 * The same token is forwarded upstream as `Authorization: Bearer <token>`,
 * so a valid EmDash PAT (ec_pat_*) authenticates against the built-in.
 */

import { DurableObject } from "cloudflare:workers";

interface Env extends Cloudflare.Env {
	MCP_OBJECT: DurableObjectNamespace<EmDashMCP>;
}

const UPSTREAM_PATH = "/_emdash/api/mcp";

/** Path of this endpoint's OAuth protected-resource metadata (RFC 9728 path insertion). */
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

/** How long a merged tools/list stays in the edge cache. Tool definitions only change on deploy. */
const TOOLS_CACHE_TTL_S = 3600;

// `caches.default` is a Cloudflare Workers runtime API not present on the DOM `CacheStorage` type.
const edgeCache = (caches as unknown as { default: Cache }).default;

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: { name?: string; arguments?: Record<string, unknown> } & Record<string, unknown>;
}

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version",
	"Access-Control-Expose-Headers": "mcp-session-id",
	"Access-Control-Max-Age": "86400",
};

async function parseSseOrJson(res: Response): Promise<{ result?: { tools?: unknown[] } }> {
	const ct = res.headers.get("Content-Type") ?? "";
	if (ct.includes("application/json")) return res.json();
	const text = await res.text();
	const match = text.match(/^data: (.+)$/m);
	if (!match) throw new Error(`No data event in SSE response: ${text.slice(0, 200)}`);
	return JSON.parse(match[1]);
}

const INBOX_TOOL_NAMES = new Set([
	"list_threads",
	"get_thread",
	"search_messages",
	"mark_read",
	"pin_thread",
	"snooze_thread",
	"mark_done",
]);

// Mirrors EmDash's own VALID_SCOPES — kept in sync with the built-in authorization server.
const SUPPORTED_SCOPES = [
	"content:read",
	"content:write",
	"media:read",
	"media:write",
	"schema:read",
	"schema:write",
	"taxonomies:manage",
	"menus:manage",
	"settings:read",
	"settings:manage",
	"mcp:tools",
	"admin",
];

/**
 * OAuth protected-resource metadata for `/mcp` (RFC 9728).
 *
 * EmDash serves `/.well-known/oauth-protected-resource` for its own built-in
 * endpoint, declaring `resource: <origin>/_emdash/api/mcp`. That identifier does
 * not match this proxy's URL, so clients discovering auth for `/mcp` reject it.
 * This route advertises `/mcp` as its own resource, delegating to the same
 * EmDash authorization server.
 */
export function handleProtectedResourceMetadata(request: Request): Response {
	if (request.method === "OPTIONS") {
		return new Response(null, { headers: CORS_HEADERS });
	}

	const { origin } = new URL(request.url);
	return Response.json(
		{
			resource: `${origin}/mcp`,
			authorization_servers: [`${origin}/_emdash`],
			scopes_supported: SUPPORTED_SCOPES,
			bearer_methods_supported: ["header"],
		},
		{ headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
	);
}

/** Stable, non-reversible cache-key fragment so tool lists never leak across tokens. */
async function tokenFingerprint(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest).slice(0, 16))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ── Proxy handler ────────────────────────────────────────────────────────────

export async function handleMcp(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "OPTIONS") {
		return new Response(null, { headers: CORS_HEADERS });
	}

	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
		?? url.searchParams.get("token");

	if (!token) {
		return new Response("Unauthorized", {
			status: 401,
			headers: {
				...CORS_HEADERS,
				// Point clients straight at this endpoint's own metadata, so they never
				// fall back to EmDash's origin-level document (which names a different resource).
				"WWW-Authenticate": `Bearer resource_metadata="${url.origin}${RESOURCE_METADATA_PATH}"`,
			},
		});
	}

	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
	}

	const baseUrl = env.EMDASH_URL ?? url.origin;
	// Use Service Binding for same-worker calls to avoid 522 subrequest errors.
	const upstreamUrl = `${baseUrl}${UPSTREAM_PATH}`;
	const upstreamFetch = (req: RequestInit & { url?: string }) =>
		env.SELF.fetch(new Request(upstreamUrl, req));

	// RSS Aggregator plugin MCP route (same-worker subrequest via Service Binding).
	const rssMcpUrl = `${baseUrl}/_emdash/api/plugins/rss-aggregator/mcp`;

	let rpc: JsonRpcRequest;
	try {
		rpc = await request.json();
	} catch {
		return Response.json(
			{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
			{ headers: CORS_HEADERS },
		);
	}

	const upstreamHeaders = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${token}`,
	};

	// Notification (no id) — fire-and-forget
	if (rpc.id === undefined) {
		void upstreamFetch({ method: "POST", headers: upstreamHeaders, body: JSON.stringify(rpc) }).catch(() => {});
		return new Response(null, { status: 202, headers: CORS_HEADERS });
	}

	// tools/list — merge upstream tools and inbox plugin tools
	if (rpc.method === "tools/list") {
		// Each source below is a Service Binding subrequest that re-enters this Worker
		// and boots a full Astro SSR pass (several seconds each). Serving from cache
		// keeps the handshake well inside MCP client timeouts.
		const cacheKey = new Request(`${url.origin}/__mcp-tools-cache/${await tokenFingerprint(token)}`);
		const cached = await edgeCache.match(cacheKey);
		if (cached) {
			const tools = await cached.json();
			return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools } }, { headers: CORS_HEADERS });
		}

		// Fetch all three sources concurrently — they are independent.
		const [upstreamTools, inboxTools, rssTools] = await Promise.all([
			(async (): Promise<unknown[]> => {
				try {
					const res = await upstreamFetch({ method: "POST", headers: upstreamHeaders, body: JSON.stringify(rpc) });
					const upstreamData = await parseSseOrJson(res);
					return (upstreamData.result?.tools as unknown[]) ?? [];
				} catch {
					// upstream unavailable
					return [];
				}
			})(),
			(async (): Promise<unknown[]> => {
				try {
					const inboxRes = await env.SELF.fetch(new Request(`${baseUrl}/_emdash/api/plugins/emdash-inbox/messages/mcp`, {
						method: "POST",
						headers: upstreamHeaders,
						body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
					}));
					if (!inboxRes.ok) return [];
					const inboxData = (await inboxRes.json()) as any;
					return inboxData.result?.tools ?? [];
				} catch (e) {
					console.error("Failed to fetch inbox plugin tools:", e);
					return [];
				}
			})(),
			// RSS Aggregator plugin tools. The plugin route returns a JSON-RPC
			// envelope wrapped by the plugin API layer as `{ data: <envelope> }`.
			(async (): Promise<unknown[]> => {
				try {
					const rssRes = await env.SELF.fetch(new Request(rssMcpUrl, {
						method: "POST",
						headers: upstreamHeaders,
						body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
					}));
					if (!rssRes.ok) return [];
					const rssData = (await rssRes.json()) as any;
					return rssData.data?.result?.tools ?? rssData.result?.tools ?? [];
				} catch (e) {
					console.error("Failed to fetch rss-aggregator plugin tools:", e);
					return [];
				}
			})(),
		]);

		const tools = [...upstreamTools, ...inboxTools, ...rssTools];

		// Only cache a list that actually has the built-in tools — never pin a
		// degraded result from a transient upstream failure.
		if (upstreamTools.length > 0) {
			const toStore = Response.json(tools, {
				headers: { "Cache-Control": `public, s-maxage=${TOOLS_CACHE_TTL_S}` },
			});
			const put = edgeCache.put(cacheKey, toStore).catch((e) => console.error("tools/list cache put failed:", e));
			if (ctx) ctx.waitUntil(put);
			else await put;
		}

		return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools } }, { headers: CORS_HEADERS });
	}

	// tools/call for inbox plugin tools
	if (rpc.method === "tools/call" && typeof rpc.params?.name === "string" && INBOX_TOOL_NAMES.has(rpc.params.name)) {
		try {
			const inboxRes = await env.SELF.fetch(new Request(`${baseUrl}/_emdash/api/plugins/emdash-inbox/messages/mcp`, {
				method: "POST",
				headers: upstreamHeaders,
				body: JSON.stringify(rpc),
			}));
			if (!inboxRes.ok) {
				const body = await inboxRes.text().catch(() => "<no body>");
				throw new Error(`Inbox plugin returned ${inboxRes.status}: ${body}`);
			}
			const inboxData = (await inboxRes.json()) as any;
			return Response.json(inboxData, { headers: CORS_HEADERS });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return Response.json(
				{ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: message }], isError: true } },
				{ headers: CORS_HEADERS },
			);
		}
	}

	// tools/call for RSS Aggregator plugin tools (rss_ prefix)
	if (rpc.method === "tools/call" && typeof rpc.params?.name === "string" && rpc.params.name.startsWith("rss_")) {
		try {
			const rssRes = await env.SELF.fetch(new Request(rssMcpUrl, {
				method: "POST",
				headers: upstreamHeaders,
				body: JSON.stringify(rpc),
			}));
			if (!rssRes.ok) {
				const body = await rssRes.text().catch(() => "<no body>");
				throw new Error(`RSS plugin returned ${rssRes.status}: ${body}`);
			}
			const rssData = (await rssRes.json()) as any;
			// Unwrap the plugin API layer's `{ data: <envelope> }` wrapper.
			const envelope = rssData.data ?? rssData;
			return Response.json(envelope, { headers: CORS_HEADERS });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return Response.json(
				{ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: message }], isError: true } },
				{ headers: CORS_HEADERS },
			);
		}
	}

	// Everything else (initialize, ping, content_*, schema_*, media_*, etc.) → forward
	const res = await upstreamFetch({ method: "POST", headers: upstreamHeaders, body: JSON.stringify(rpc) });
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
	return new Response(res.body, { status: res.status, headers });
}

// ── Durable Object stub (kept for wrangler binding compatibility) ────────────

export class EmDashMCP extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		return handleMcp(request, this.env);
	}
}
