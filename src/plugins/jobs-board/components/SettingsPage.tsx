import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import * as React from "react";
import { DEFAULT_SETTINGS, type JobsSettings } from "../lib/types";

const API = "/_emdash/api/plugins/jobs-board";

export function SettingsPage() {
	const [settings, setSettings] = React.useState<JobsSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = React.useState(true);
	const [saving, setSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [saved, setSaved] = React.useState(false);

	React.useEffect(() => {
		apiFetch(`${API}/settings/get`, { method: "GET" })
			.then((res) => parseApiResponse<JobsSettings>(res, "Failed to load settings"))
			.then(setSettings)
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, []);

	const update = <K extends keyof JobsSettings>(key: K, value: JobsSettings[K]) => {
		setSettings((prev) => ({ ...prev, [key]: value }));
		setSaved(false);
	};

	const handleSave = async (event: React.FormEvent) => {
		event.preventDefault();
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			const res = await apiFetch(`${API}/settings/update`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(settings),
			});
			const data = await parseApiResponse<{ settings: JobsSettings }>(res, "Failed to save settings");
			setSettings(data.settings);
			setSaved(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	if (loading) return <div className="text-muted-foreground text-sm">Loading settings…</div>;

	return (
		<div className="space-y-6 max-w-lg">
			<div>
				<h1 className="text-3xl font-bold">Jobs Settings</h1>
				<p className="text-muted-foreground mt-1">
					Where jobs are imported from and how many are kept.
				</p>
			</div>

			{error && (
				<div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 text-sm text-destructive">
					{error}
				</div>
			)}
			{saved && (
				<div className="p-3 rounded-lg border border-green-500/50 bg-green-500/5 text-sm text-green-700">
					Settings saved.
				</div>
			)}

			<form onSubmit={handleSave} className="space-y-4">
				<div className="space-y-1">
					<label className="text-sm font-medium" htmlFor="jobs-api-base">
						Jobs API base URL
					</label>
					<input
						id="jobs-api-base"
						type="url"
						value={settings.apiBaseUrl}
						onChange={(e) => update("apiBaseUrl", e.target.value)}
						placeholder="https://yemen-hr-worker.example.workers.dev"
						className="w-full rounded-md border px-3 py-2 text-sm bg-background"
					/>
					<p className="text-xs text-muted-foreground">
						The plugin calls <code>{"{base}"}/api/jobs</code> on this host.
					</p>
				</div>

				<div className="space-y-1">
					<label className="text-sm font-medium" htmlFor="jobs-api-status">
						Upstream status filter
					</label>
					<input
						id="jobs-api-status"
						type="text"
						value={settings.apiStatus}
						onChange={(e) => update("apiStatus", e.target.value)}
						placeholder="posted"
						className="w-full rounded-md border px-3 py-2 text-sm bg-background"
					/>
				</div>

				<div className="grid grid-cols-3 gap-3">
					<div className="space-y-1">
						<label className="text-sm font-medium" htmlFor="jobs-page-size">
							Items per page
						</label>
						<input
							id="jobs-page-size"
							type="number"
							min={1}
							max={100}
							value={settings.pageSize}
							onChange={(e) => update("pageSize", Number(e.target.value))}
							className="w-full rounded-md border px-3 py-2 text-sm bg-background"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-sm font-medium" htmlFor="jobs-max">
							Max stored
						</label>
						<input
							id="jobs-max"
							type="number"
							min={0}
							value={settings.maxJobs}
							onChange={(e) => update("maxJobs", Number(e.target.value))}
							className="w-full rounded-md border px-3 py-2 text-sm bg-background"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-sm font-medium" htmlFor="jobs-sync-pages">
							Pages per sync
						</label>
						<input
							id="jobs-sync-pages"
							type="number"
							min={1}
							max={100}
							value={settings.maxSyncPages}
							onChange={(e) => update("maxSyncPages", Number(e.target.value))}
							className="w-full rounded-md border px-3 py-2 text-sm bg-background"
						/>
					</div>
				</div>

				<button
					type="submit"
					disabled={saving}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save settings"}
				</button>
			</form>
		</div>
	);
}
