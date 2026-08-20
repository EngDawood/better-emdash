import { getEmDashCollection } from "emdash";
import { locales, type Locale } from "../i18n/utils";

export interface FeedEntry {
	title: string;
	description: string;
	/** Absolute, locale-prefixed URL — resolves directly, no redirect hop. */
	url: string;
	pubDate: Date;
	locale: Locale;
}

/**
 * Collect feed entries across every locale, each linked to its own locale's URL.
 *
 * A single unscoped query returns both locales' rows with no way to tell them
 * apart, which is how feed links ended up unprefixed (`/projects/<slug>`) and
 * bounced through two redirects — `/projects/x` → `/ar/projects/x` → and for an
 * untranslated entry → `/en/projects/x`.
 */
export async function collectFeedEntries<T extends string>(
	type: T,
	basePath: string,
	siteUrl: string,
	limit: number,
): Promise<FeedEntry[]> {
	const results = await Promise.allSettled(
		locales.map(async (locale) => {
			const { entries } = await getEmDashCollection(type, {
				locale,
				orderBy: { published_at: "desc" },
				limit,
			});
			return { locale, entries };
		}),
	);

	const collected: FeedEntry[] = [];
	for (const result of results) {
		if (result.status !== "fulfilled") continue;
		const { locale, entries } = result.value;

		for (const entry of entries) {
			const data = entry.data as {
				slug?: string | null;
				title?: string;
				excerpt?: string;
				summary?: string;
				publishedAt?: Date | null;
			};
			if (!data.publishedAt) continue;

			collected.push({
				title: data.title || "Untitled",
				description: data.excerpt ?? data.summary ?? "",
				url: `${siteUrl}/${locale}${basePath}/${data.slug || entry.id}`,
				pubDate: data.publishedAt,
				locale,
			});
		}
	}

	return collected
		.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
		.slice(0, limit);
}
