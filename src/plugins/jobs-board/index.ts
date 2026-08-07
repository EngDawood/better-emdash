/**
 * jobs-board — local native EmDash plugin.
 *
 * Replaces the old `src/pages/[locale]/jobs/index.astro` page, which fetched
 * the external jobs Worker on every request. The plugin syncs that API into
 * plugin storage on a cron, so the site reads local rows and the admin gets
 * a place to inspect, sync, and prune them.
 *
 * `createPlugin` (default export) is the runtime entrypoint; the descriptor is
 * declared inline in `astro.config.mjs` with a `fileURLToPath` entrypoint, the
 * same wiring as the seo and emdash-inbox plugins.
 */

import { definePlugin, PluginRouteError } from "emdash";
import type { PluginDescriptor, RouteContext } from "emdash";
import { DEFAULT_SETTINGS, type JobDoc, type JobsSettings } from "./lib/types";
import { getSyncState, jobs, loadSettings, queryJobsPage, syncJobs } from "./lib/sync";

export type { ApiJobRecord, JobDoc, JobsSettings, SyncState } from "./lib/types";

const CRON_SYNC = "sync-jobs";

/** Public site payload — one row of the listing. */
export interface PublicJob extends JobDoc {
	id: string;
}

/**
 * Plugin descriptor — build-time only, must stay side-effect-free.
 * Provided for parity with the other plugins; `astro.config.mjs` declares the
 * descriptor inline because the entrypoint has to be an absolute file URL.
 */
export function jobsBoardPlugin(): PluginDescriptor {
	return {
		id: "jobs-board",
		version: "1.0.0",
		format: "native",
		entrypoint: "jobs-board",
		adminEntry: "jobs-board/admin",
		adminPages: [
			{ path: "/", label: "Jobs", icon: "list" },
			{ path: "/settings", label: "Settings", icon: "settings" },
		],
		capabilities: ["network:fetch"],
		allowedHosts: ["*"],
		options: {},
	};
}

function toPublicJob(row: { id: string; data: JobDoc }): PublicJob {
	return { id: row.id, ...row.data };
}

function readPageParams(ctx: RouteContext, fallbackLimit: number) {
	const url = new URL(ctx.request.url);
	const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
	const limit = Math.min(
		100,
		Math.max(1, Number.parseInt(url.searchParams.get("limit") || String(fallbackLimit), 10) || fallbackLimit),
	);
	const where: Record<string, unknown> = {};
	const status = url.searchParams.get("status");
	const category = url.searchParams.get("category");
	const source = url.searchParams.get("source");
	if (status) where.status = status;
	if (category) where.category = category;
	if (source) where.source = source;
	return { page, limit, where };
}

export function createPlugin() {
	return definePlugin({
		id: "jobs-board",
		version: "1.0.0",

		capabilities: ["network:fetch"],
		allowedHosts: ["*"],

		storage: {
			jobs: {
				indexes: ["status", "category", "source", "postedAt", "syncedAt"],
			},
		},

		hooks: {
			"plugin:install": async (_event, ctx) => {
				for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
					if ((await ctx.kv.get(`settings:${key}`)) === null) {
						await ctx.kv.set(`settings:${key}`, value);
					}
				}
				ctx.log.info("jobs-board installed");
			},

			"plugin:activate": async (_event, ctx) => {
				// Hourly. The upstream Worker scrapes on its own schedule; more
				// frequent polling just burns subrequests.
				await ctx.cron!.schedule(CRON_SYNC, { schedule: "0 * * * *" });
				ctx.log.info("jobs-board activated — hourly sync scheduled");
			},

			"plugin:deactivate": async (_event, ctx) => {
				await ctx.cron!.cancel(CRON_SYNC);
				ctx.log.info("jobs-board deactivated — sync cancelled");
			},

			"plugin:uninstall": async (event, ctx) => {
				if (!(event as { deleteData?: boolean }).deleteData) return;

				let cursor: string | undefined;
				do {
					const result = await jobs(ctx).query({ limit: 500, cursor });
					if (result.items.length > 0) {
						await jobs(ctx).deleteMany(result.items.map((i) => i.id));
					}
					cursor = result.hasMore ? result.cursor : undefined;
				} while (cursor);

				for (const entry of await ctx.kv.list()) {
					await ctx.kv.delete(entry.key);
				}
				ctx.log.info("jobs-board data deleted");
			},

			cron: async (event, ctx) => {
				if (event.name !== CRON_SYNC) return;
				await syncJobs(ctx, await loadSettings(ctx));
			},
		},

		routes: {
			// ── Admin ────────────────────────────────────────────────────────
			jobs: {
				handler: async (ctx: RouteContext) => {
					const settings = await loadSettings(ctx);
					const { page, limit, where } = readPageParams(ctx, settings.pageSize);
					const result = await queryJobsPage(ctx, { page, limit, where });
					return {
						items: result.items.map(toPublicJob),
						meta: { page, limit, total: result.total, totalPages: result.totalPages },
					};
				},
			},

			"jobs/sync": {
				handler: async (ctx: RouteContext) => {
					const state = await syncJobs(ctx, await loadSettings(ctx));
					if (!state.ok) throw PluginRouteError.badRequest(state.error ?? "Sync failed");
					return { success: true, state };
				},
			},

			"jobs/delete": {
				handler: async (ctx: RouteContext) => {
					const { ids } = (ctx.input ?? {}) as { ids?: unknown };
					if (!Array.isArray(ids) || ids.length === 0) {
						throw PluginRouteError.badRequest("Provide an `ids` array");
					}
					const deleted = await jobs(ctx).deleteMany(ids.map(String));
					return { success: true, deleted };
				},
			},

			stats: {
				handler: async (ctx: RouteContext) => {
					const settings = await loadSettings(ctx);
					return {
						total: await jobs(ctx).count(),
						maxJobs: settings.maxJobs,
						lastSync: await getSyncState(ctx),
					};
				},
			},

			"settings/get": {
				handler: async (ctx: RouteContext) => await loadSettings(ctx),
			},

			"settings/update": {
				handler: async (ctx: RouteContext) => {
					const input = (ctx.input ?? {}) as Partial<Record<keyof JobsSettings, unknown>>;

					for (const key of ["apiBaseUrl", "apiStatus"] as const) {
						const value = input[key];
						if (typeof value === "string") {
							await ctx.kv.set(`settings:${key}`, value.trim());
						}
					}
					for (const key of ["pageSize", "maxJobs", "maxSyncPages"] as const) {
						const value = Number(input[key]);
						if (input[key] !== undefined && Number.isFinite(value) && value >= 0) {
							await ctx.kv.set(`settings:${key}`, Math.floor(value));
						}
					}

					return { success: true, settings: await loadSettings(ctx) };
				},
			},

			// ── Public (site listing) ────────────────────────────────────────
			"public/jobs": {
				public: true,
				cacheControl: "public, max-age=300, stale-while-revalidate=600",
				handler: async (ctx: RouteContext) => {
					const settings = await loadSettings(ctx);
					const { page, limit, where } = readPageParams(ctx, settings.pageSize);
					const result = await queryJobsPage(ctx, { page, limit, where });
					return {
						items: result.items.map(toPublicJob),
						meta: { page, limit, total: result.total, totalPages: result.totalPages },
					};
				},
			},
		},

		admin: {
			pages: [
				{ path: "/", label: "Jobs", icon: "list" },
				{ path: "/settings", label: "Settings", icon: "settings" },
			],
			settingsSchema: {
				apiBaseUrl: {
					type: "string",
					label: "Jobs API base URL",
					description: "Base URL of the jobs Worker, e.g. https://yemen-hr-worker.engdawood.workers.dev",
				},
				apiStatus: {
					type: "string",
					label: "Upstream status filter",
					description: "Only jobs with this upstream status are imported. Default: posted.",
				},
				pageSize: {
					type: "number",
					label: "Items per page",
					description: "Page size for the public jobs listing.",
				},
				maxJobs: {
					type: "number",
					label: "Max stored jobs",
					description: "Oldest jobs beyond this count are pruned after each sync. 0 = keep everything.",
				},
				maxSyncPages: {
					type: "number",
					label: "Max pages per sync",
					description: "Upstream pages walked per sync run, 100 records each.",
				},
			},
		},
	});
}

export default createPlugin;
