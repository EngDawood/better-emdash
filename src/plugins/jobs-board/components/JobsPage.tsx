import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import * as React from "react";
import type { JobDoc, SyncState } from "../lib/types";

const API = "/_emdash/api/plugins/jobs-board";

interface JobRow extends JobDoc {
	id: string;
}

interface ListResponse {
	items: JobRow[];
	meta: { page: number; limit: number; total: number; totalPages: number };
}

interface StatsResponse {
	total: number;
	maxJobs: number;
	lastSync: SyncState | null;
}

function formatDate(value: string | null): string {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function JobsPage() {
	const [rows, setRows] = React.useState<JobRow[]>([]);
	const [meta, setMeta] = React.useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
	const [stats, setStats] = React.useState<StatsResponse | null>(null);
	const [page, setPage] = React.useState(1);
	const [loading, setLoading] = React.useState(true);
	const [syncing, setSyncing] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const load = React.useCallback(async (forPage: number) => {
		setLoading(true);
		setError(null);
		try {
			const [list, statsRes] = await Promise.all([
				apiFetch(`${API}/jobs?page=${forPage}`, { method: "GET" }).then((res) =>
					parseApiResponse<ListResponse>(res, "Failed to load jobs"),
				),
				apiFetch(`${API}/stats`, { method: "GET" }).then((res) =>
					parseApiResponse<StatsResponse>(res, "Failed to load stats"),
				),
			]);
			setRows(list.items);
			setMeta(list.meta);
			setStats(statsRes);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		void load(page);
	}, [load, page]);

	const handleSync = async () => {
		setSyncing(true);
		setError(null);
		try {
			const res = await apiFetch(`${API}/jobs/sync`, { method: "POST" });
			await parseApiResponse<{ state: SyncState }>(res, "Sync failed");
			setPage(1);
			await load(1);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSyncing(false);
		}
	};

	const handleDelete = async (id: string) => {
		setError(null);
		const previous = rows;
		setRows((list) => list.filter((row) => row.id !== id));
		try {
			const res = await apiFetch(`${API}/jobs/delete`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: [id] }),
			});
			await parseApiResponse(res, "Failed to delete job");
		} catch (err) {
			setRows(previous);
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const lastSync = stats?.lastSync;

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold">Jobs</h1>
					<p className="text-muted-foreground mt-1">
						Jobs imported from the external jobs Worker. Synced hourly.
					</p>
				</div>
				<button
					type="button"
					onClick={handleSync}
					disabled={syncing}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				>
					{syncing ? "Syncing…" : "Sync now"}
				</button>
			</div>

			{error && (
				<div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 text-sm text-destructive">
					{error}
				</div>
			)}

			<div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
				<span>
					<strong className="text-foreground">{stats?.total ?? meta.total}</strong> stored
					{stats?.maxJobs ? ` (cap ${stats.maxJobs})` : ""}
				</span>
				{lastSync && (
					<span>
						Last sync {formatDate(lastSync.lastRunAt)} —{" "}
						{lastSync.ok
							? `${lastSync.fetched} fetched, ${lastSync.stored} stored, ${lastSync.pruned} pruned`
							: `failed: ${lastSync.error}`}
					</span>
				)}
			</div>

			{loading ? (
				<div className="text-muted-foreground text-sm">Loading jobs…</div>
			) : rows.length === 0 ? (
				<div className="p-6 rounded-lg border text-sm text-muted-foreground">
					No jobs stored yet. Check the API base URL in Settings, then run a sync.
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-sm">
						<thead className="bg-muted/50 text-left">
							<tr>
								<th className="px-3 py-2 font-medium">Title</th>
								<th className="px-3 py-2 font-medium">Company</th>
								<th className="px-3 py-2 font-medium">Source</th>
								<th className="px-3 py-2 font-medium">Posted</th>
								<th className="px-3 py-2 font-medium">Deadline</th>
								<th className="px-3 py-2" />
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.id} className="border-t align-top">
									<td className="px-3 py-2">
										{row.telegraphUrl || row.sourceUrl ? (
											<a
												href={row.telegraphUrl ?? row.sourceUrl ?? "#"}
												target="_blank"
												rel="noopener noreferrer"
												className="font-medium hover:underline"
											>
												{row.title}
											</a>
										) : (
											<span className="font-medium">{row.title}</span>
										)}
										{row.location && (
											<div className="text-muted-foreground text-xs mt-0.5">{row.location}</div>
										)}
									</td>
									<td className="px-3 py-2">{row.company ?? "—"}</td>
									<td className="px-3 py-2 text-muted-foreground">{row.source}</td>
									<td className="px-3 py-2 text-muted-foreground">{formatDate(row.postedAt)}</td>
									<td className="px-3 py-2 text-muted-foreground">{formatDate(row.deadline)}</td>
									<td className="px-3 py-2 text-right">
										<button
											type="button"
											onClick={() => handleDelete(row.id)}
											className="text-xs text-destructive hover:underline"
										>
											Delete
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{meta.totalPages > 1 && (
				<div className="flex items-center justify-center gap-4 text-sm">
					<button
						type="button"
						onClick={() => setPage((p) => Math.max(1, p - 1))}
						disabled={meta.page <= 1}
						className="rounded-md border px-3 py-1.5 disabled:opacity-40"
					>
						Previous
					</button>
					<span className="text-muted-foreground">
						Page {meta.page} / {meta.totalPages}
					</span>
					<button
						type="button"
						onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
						disabled={meta.page >= meta.totalPages}
						className="rounded-md border px-3 py-1.5 disabled:opacity-40"
					>
						Next
					</button>
				</div>
			)}
		</div>
	);
}
