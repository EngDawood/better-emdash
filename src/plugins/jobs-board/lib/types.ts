/**
 * Shape returned by the external jobs Worker API (`GET /api/jobs`).
 * Snake_case because that is what the upstream Worker serves.
 */
export interface ApiJobRecord {
	id: string;
	title: string;
	company: string | null;
	location: string | null;
	description_clean: string | null;
	ai_summary_ar: string | null;
	image_url: string | null;
	source_url: string | null;
	posted_date: string | null;
	deadline: string | null;
	telegraph_url: string | null;
	category: string | null;
	status: string;
	source: string;
	scraped_at: string;
	posted_at: string | null;
	word_count: number | null;
}

/**
 * A job as stored in plugin storage. The document id is the upstream `id`,
 * so re-syncing the same record upserts rather than duplicating.
 */
export interface JobDoc {
	externalId: string;
	title: string;
	company: string | null;
	location: string | null;
	summary: string | null;
	/** Arabic AI summary from upstream, used on the Arabic locale. */
	summaryAr: string | null;
	imageUrl: string | null;
	sourceUrl: string | null;
	telegraphUrl: string | null;
	category: string | null;
	status: string;
	source: string;
	/**
	 * ISO timestamp, never null, so ordering and pruning are total. Upstream
	 * `posted_date` ("06 Aug, 26") is deliberately not a fallback — it does not
	 * sort lexicographically.
	 */
	postedAt: string;
	deadline: string | null;
	scrapedAt: string | null;
	wordCount: number | null;
	syncedAt: string;
}

export interface JobsSettings {
	/** Base URL of the jobs Worker, no trailing slash needed. */
	apiBaseUrl: string;
	/** `status` filter sent upstream when syncing. */
	apiStatus: string;
	/** Items per page on the public site listing. */
	pageSize: number;
	/** Keep at most this many jobs; oldest are pruned. 0 = keep everything. */
	maxJobs: number;
	/** Upstream pages to walk per sync run (100 records per page). */
	maxSyncPages: number;
}

/**
 * The upstream API serves newest-first, so three pages covers the recent
 * window without pulling its full ~1k record history on every cron tick.
 */

export const DEFAULT_SETTINGS: JobsSettings = {
	apiBaseUrl: "https://yemen-hr-worker.engdawood.workers.dev",
	apiStatus: "posted",
	pageSize: 20,
	maxJobs: 500,
	maxSyncPages: 3,
};

/** Result of a sync run, persisted under `state:lastSync`. */
export interface SyncState {
	lastRunAt: string;
	ok: boolean;
	fetched: number;
	stored: number;
	pruned: number;
	error: string | null;
}

export function normalizeJob(record: ApiJobRecord, now: string): JobDoc {
	return {
		externalId: String(record.id),
		title: record.title,
		company: record.company ?? null,
		location: record.location ?? null,
		summary: record.description_clean ?? null,
		summaryAr: record.ai_summary_ar ?? null,
		imageUrl: record.image_url ?? null,
		sourceUrl: record.source_url ?? null,
		telegraphUrl: record.telegraph_url ?? null,
		category: record.category ?? null,
		status: record.status ?? "unknown",
		source: record.source ?? "unknown",
		postedAt: record.posted_at ?? record.scraped_at ?? now,
		deadline: record.deadline ?? null,
		scrapedAt: record.scraped_at ?? null,
		wordCount: record.word_count ?? null,
		syncedAt: now,
	};
}
