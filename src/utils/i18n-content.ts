import { getEmDashEntry, getTranslations } from "emdash";
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
