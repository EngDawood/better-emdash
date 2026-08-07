import type { PluginContext, StorageCollection } from "emdash";
import {
	DEFAULT_SETTINGS,
	normalizeJob,
	type ApiJobRecord,
	type JobDoc,
	type JobsSettings,
	type SyncState,
} from "./types";

export const SYNC_STATE_KEY = "state:lastSync";

/** Upstream page size. The API caps at 100. */
const UPSTREAM_PAGE_SIZE = 100;
/** Rows per storage write batch. */
const WRITE_CHUNK = 50;
/** Hard stop when walking storage pages, so a bad cursor can't spin forever. */
const MAX_STORAGE_PAGES = 50;

export function jobs(ctx: PluginContext): StorageCollection<JobDoc> {
	return ctx.storage.jobs as StorageCollection<JobDoc>;
}

export async function loadSettings(ctx: PluginContext): Promise<JobsSettings> {
	const entries = await ctx.kv.list("settings:");
	const settings: JobsSettings = { ...DEFAULT_SETTINGS };
	for (const { key, value } of entries) {
		const field = key.slice("settings:".length) as keyof JobsSettings;
		if (field in settings && value !== null && value !== undefined) {
			(settings as unknown as Record<string, unknown>)[field] = value;
		}
	}
	return settings;
}

export async function getSyncState(ctx: PluginContext): Promise<SyncState | null> {
	return await ctx.kv.get<SyncState>(SYNC_STATE_KEY);
}

/**
 * Pull jobs from the upstream Worker into plugin storage.
 *
 * Records are upserted under their upstream id, so a repeat sync refreshes
 * existing rows instead of duplicating them. Never throws — failures are
 * recorded on the returned (and persisted) state so the admin can see them.
 */
export async function syncJobs(ctx: PluginContext, settings: JobsSettings): Promise<SyncState> {
	const now = new Date().toISOString();
	const state: SyncState = {
		lastRunAt: now,
		ok: false,
		fetched: 0,
		stored: 0,
		pruned: 0,
		error: null,
	};

	const base = settings.apiBaseUrl.trim().replace(/\/+$/, "");

	try {
		if (!base) throw new Error("No jobs API base URL configured");
		if (!ctx.http) throw new Error("network:fetch capability is unavailable");

		const batch: Array<{ id: string; data: JobDoc }> = [];
		const seenIds = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= settings.maxSyncPages) {
			const url =
				`${base}/api/jobs?status=${encodeURIComponent(settings.apiStatus)}` +
				`&limit=${UPSTREAM_PAGE_SIZE}&page=${page}`;
			const res = await ctx.http.fetch(url);
			if (!res.ok) throw new Error(`Jobs API responded ${res.status} for page ${page}`);

			const json = (await res.json()) as {
				data?: ApiJobRecord[];
				meta?: { totalPages?: number };
			};
			const records = json.data ?? [];
			totalPages = json.meta?.totalPages ?? page;
			state.fetched += records.length;

			for (const record of records) {
				if (!record?.id) continue;
				const id = String(record.id);
				if (seenIds.has(id)) continue;
				seenIds.add(id);
				batch.push({ id, data: normalizeJob(record, now) });
			}

			if (records.length === 0) break;
			page++;
		}

		for (let i = 0; i < batch.length; i += WRITE_CHUNK) {
			const chunk = batch.slice(i, i + WRITE_CHUNK);
			await jobs(ctx).putMany(chunk);
			state.stored += chunk.length;
		}

		state.pruned = await pruneJobs(ctx, settings);
		state.ok = true;
		ctx.log.info("jobs-board: sync complete", {
			fetched: state.fetched,
			stored: state.stored,
			pruned: state.pruned,
		});
	} catch (err) {
		state.error = err instanceof Error ? err.message : String(err);
		ctx.log.error("jobs-board: sync failed", { error: state.error });
	}

	await ctx.kv.set(SYNC_STATE_KEY, state);
	return state;
}

/**
 * Delete the oldest jobs beyond `maxJobs`. Ids are collected in a read-only
 * pass first so deletions can't disturb the cursor walk.
 */
export async function pruneJobs(ctx: PluginContext, settings: JobsSettings): Promise<number> {
	if (!settings.maxJobs || settings.maxJobs <= 0) return 0;

	const total = await jobs(ctx).count();
	if (total <= settings.maxJobs) return 0;

	const doomed: string[] = [];
	let seen = 0;
	let cursor: string | undefined;
	let pages = 0;

	do {
		const result = await jobs(ctx).query({
			orderBy: { postedAt: "desc" },
			limit: 200,
			cursor,
		});
		for (const item of result.items) {
			seen++;
			if (seen > settings.maxJobs) doomed.push(item.id);
		}
		cursor = result.hasMore ? result.cursor : undefined;
		pages++;
	} while (cursor && pages < MAX_STORAGE_PAGES);

	let deleted = 0;
	for (let i = 0; i < doomed.length; i += WRITE_CHUNK) {
		deleted += await jobs(ctx).deleteMany(doomed.slice(i, i + WRITE_CHUNK));
	}

	if (deleted > 0) ctx.log.info("jobs-board: pruned old jobs", { deleted });
	return deleted;
}

/**
 * Page-numbered read over cursor-paginated storage.
 *
 * Storage only exposes cursors, but the public listing wants "page 3 of 12".
 * Rows stay bounded by `maxJobs`, so skipping forward a few cursors is cheap.
 */
export async function queryJobsPage(
	ctx: PluginContext,
	options: { page: number; limit: number; where?: Record<string, unknown> },
): Promise<{ items: Array<{ id: string; data: JobDoc }>; total: number; totalPages: number }> {
	const where = options.where && Object.keys(options.where).length > 0 ? options.where : undefined;
	const total = await jobs(ctx).count(where as never);
	const totalPages = Math.max(1, Math.ceil(total / options.limit));
	const page = Math.min(Math.max(1, options.page), totalPages);

	let cursor: string | undefined;
	let items: Array<{ id: string; data: JobDoc }> = [];

	for (let current = 1; current <= page; current++) {
		const result = await jobs(ctx).query({
			where: where as never,
			orderBy: { postedAt: "desc" },
			limit: options.limit,
			cursor,
		});
		items = result.items;
		cursor = result.cursor;
		if (!result.hasMore) break;
	}

	return { items, total, totalPages };
}
