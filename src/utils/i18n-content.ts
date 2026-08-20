import { getEmDashCollection, getEmDashEntry, getTranslations } from "emdash";
import { getOtherLocale, locales, type Locale } from "../i18n/utils";

/** A locale variant of a content entry that actually exists and is published. */
export interface Alternate {
	locale: Locale;
	/** Locale-agnostic path, e.g. `/projects/my-slug` */
	path: string;
}

/**
 * Look a slug up inside `locale`.
 *
 * EmDash resolves a bare slug with `WHERE slug = ?` and no locale predicate, so
 * an unscoped lookup returns whichever row happens to match first — that is how
 * `/ar/projects/<slug>` ended up rendering English rows (and hiding the Arabic
 * translation entirely). Scoping the query fixes that, but then a slug that only
 * exists in the other locale would 404. `foundIn` reports that case so the route
 * can redirect to the language that really has the entry instead of serving the
 * wrong one under the requested prefix.
 */
export async function resolveLocalizedEntry<T extends string>(
	collection: T,
	slug: string,
	locale: Locale,
) {
	const scoped = await getEmDashEntry(collection, slug, { locale });
	if (scoped.entry) {
		return { entry: scoped.entry, cacheHint: scoped.cacheHint, foundIn: locale };
	}

	const other = getOtherLocale(locale);
	const fallback = await getEmDashEntry(collection, slug, { locale: other });
	return {
		entry: null,
		cacheHint: fallback.cacheHint,
		foundIn: fallback.entry ? other : null,
	};
}

/**
 * Entries to show in a locale's listing.
 *
 * Returns everything published in `locale`, plus entries that exist *only* in
 * the other locale, each tagged with the locale it actually lives in so the
 * caller links to its one real URL. That keeps an untranslated project visible
 * to Arabic visitors without minting a second, duplicate URL for it.
 *
 * Costs one `getTranslations` call per other-locale entry, so this is for small
 * collections (projects). The blog has hundreds of rows in both locales and
 * needs no fallback — use a plain locale-scoped query there.
 */
export async function getListingEntries<T extends string>(
	collection: T,
	locale: Locale,
	options?: { limit?: number },
) {
	const other = getOtherLocale(locale);
	const orderBy = { published_at: "desc" } as const;

	const [primary, secondary] = await Promise.all([
		getEmDashCollection(collection, { locale, orderBy }),
		getEmDashCollection(collection, { locale: other, orderBy }),
	]);

	// `T` is generic here, so `data` widens to Record<string, unknown> inside the
	// body. Callers still get the collection's real type back.
	const meta = (entry: { data: unknown }) =>
		entry.data as { id: string; publishedAt?: Date | null };

	const untranslated = (
		await Promise.all(
			secondary.entries.map(async (entry) => {
				const { translations } = await getTranslations(collection, meta(entry).id);
				const hasSibling = translations.some(
					(t) => t.locale === locale && t.status === "published",
				);
				return hasSibling ? null : { entry, locale: other };
			}),
		)
	).filter((item) => item !== null);

	// Merge, then sort — each query is only sorted within its own locale.
	const entries = [
		...primary.entries.map((entry) => ({ entry, locale })),
		...untranslated,
	].sort(
		(a, b) =>
			(meta(b.entry).publishedAt?.getTime() ?? 0) -
			(meta(a.entry).publishedAt?.getTime() ?? 0),
	);

	return {
		entries: options?.limit ? entries.slice(0, options.limit) : entries,
		cacheHint: primary.cacheHint,
	};
}

/**
 * Build hreflang alternates for an entry from its EmDash translation group.
 *
 * Only published siblings with a slug in a locale this site serves are returned,
 * so we never advertise an alternate URL that does not resolve — Google drops
 * the whole annotation when return links are missing or broken.
 */
export async function getContentAlternates(
	collection: string,
	id: string,
	toPath: (slug: string) => string,
): Promise<Alternate[]> {
	const { translations, error } = await getTranslations(collection, id);
	if (error) return [];

	return translations.flatMap((t) =>
		t.slug && t.status === "published" && locales.includes(t.locale as Locale)
			? [{ locale: t.locale as Locale, path: toPath(t.slug) }]
			: [],
	);
}
