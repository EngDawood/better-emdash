import ar from "./ar.json";
import en from "./en.json";

export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";

const translations: Record<Locale, typeof ar> = { ar, en };

/**
 * Get a translated string by key path (e.g., "hero.firstName")
 */
export function t(key: string, locale: Locale = defaultLocale): string {
	const keys = key.split(".");
	let value: unknown = translations[locale];

	for (const k of keys) {
		if (value && typeof value === "object" && k in value) {
			value = (value as Record<string, unknown>)[k];
		} else {
			// Fallback to default locale if key not found
			value = translations[defaultLocale];
			for (const fallbackKey of keys) {
				if (value && typeof value === "object" && fallbackKey in value) {
					value = (value as Record<string, unknown>)[fallbackKey];
				} else {
					return key; // Return key if not found
				}
			}
			break;
		}
	}

	return typeof value === "string" ? value : key;
}

/**
 * Get the opposite locale for language switching
 */
export function getOtherLocale(locale: Locale): Locale {
	return locale === "ar" ? "en" : "ar";
}

/**
 * Get the text direction for a locale
 */
export function getDir(locale: Locale): "rtl" | "ltr" {
	return locale === "ar" ? "rtl" : "ltr";
}

/**
 * Get locale from URL path
 */
export function getLocaleFromPath(path: string): Locale {
	const segments = path.split("/").filter(Boolean);
	const firstSegment = segments[0] as Locale;
	return locales.includes(firstSegment) ? firstSegment : defaultLocale;
}

/**
 * Build a localized path
 */
export function localizedPath(path: string, locale: Locale): string {
	// Remove leading slash for processing
	const cleanPath = path.replace(/^\//, "");

	// Check if path already has a locale prefix
	const segments = cleanPath.split("/");
	if (locales.includes(segments[0] as Locale)) {
		segments[0] = locale;
		return "/" + segments.join("/");
	}

	// Add locale prefix
	return `/${locale}/${cleanPath}`.replace(/\/$/, "") || `/${locale}`;
}

/**
 * Homepage path for a locale. The default locale's homepage is served
 * unprefixed at `/` — `/ar` 301-redirects there.
 */
export function homePath(locale: Locale): string {
	return locale === defaultLocale ? "/" : `/${locale}`;
}

/**
 * Re-point an EmDash menu URL at the locale being rendered.
 *
 * EmDash resolves menu URLs without a locale prefix (`/projects`), which redirects
 * to the default locale — so an English visitor would land on Arabic pages.
 * External, protocol-relative, mailto/tel and bare anchor hrefs pass through.
 */
export function localizeMenuHref(href: string, locale: Locale): string {
	if (!href.startsWith("/") || href.startsWith("//")) return href;

	const [beforeHash, ...hashRest] = href.split("#");
	const hash = hashRest.length ? `#${hashRest.join("#")}` : "";
	const [path, query] = beforeHash.split("?");
	const segments = path.split("/").filter(Boolean);

	if (segments.length && locales.includes(segments[0] as Locale)) {
		segments[0] = locale;
	} else {
		segments.unshift(locale);
	}

	// The default locale homepage is served unprefixed at `/`
	const prefixedPath =
		segments.length === 1 && segments[0] === locale ? homePath(locale) : `/${segments.join("/")}`;

	return `${prefixedPath}${query ? `?${query}` : ""}${hash}`;
}

/**
 * Get the path without locale prefix
 */
export function stripLocale(path: string): string {
	const segments = path.split("/").filter(Boolean);
	if (locales.includes(segments[0] as Locale)) {
		return "/" + segments.slice(1).join("/") || "/";
	}
	return path;
}
