import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";

const LOCALES = ["ar", "en"] as const;

// Content collections and the locale-agnostic path they are served under.
const SECTIONS = [
	{ type: "posts", basePath: "/blog" },
	{ type: "projects", basePath: "/projects" },
	{ type: "pages", basePath: "/pages" },
] as const;

// The Arabic homepage is served unprefixed at `/` — `/ar` 301s there, so it
// must never appear in the sitemap.
function localeUrl(origin: string, locale: string, basePath: string): string {
	if (locale === "ar" && basePath === "") return `${origin}/`;
	return `${origin}/${locale}${basePath}`;
}

function urlEntry(loc: string, lastmod?: string, alternates?: string): string {
	return [
		"  <url>",
		`    <loc>${loc}</loc>`,
		alternates ?? "",
		lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
		"  </url>",
	]
		.filter(Boolean)
		.join("\n");
}

export const GET: APIRoute = async ({ url: reqUrl }) => {
	const origin = reqUrl.origin;

	// Query per locale. A single unscoped query returns every locale's rows,
	// and cross-multiplying those by LOCALES advertised URLs that do not exist
	// (an English-only post listed under /ar/blog/…, and every translated entry
	// listed twice).
	const results = await Promise.allSettled(
		LOCALES.flatMap((locale) =>
			SECTIONS.map(async (section) => {
				const { entries } = await getEmDashCollection(section.type, {
					locale,
					orderBy: { published_at: "desc" },
				});
				return { locale, basePath: section.basePath, entries };
			}),
		),
	);

	const today = new Date().toISOString().split("T")[0];

	// The homepage genuinely exists in both locales, so it keeps its hreflang
	// cluster. Content hreflang is emitted in each page's <head>, built from the
	// entry's real translation group.
	const homeAlternates = LOCALES.map(
		(lang) =>
			`    <xhtml:link rel="alternate" hreflang="${lang}" href="${localeUrl(origin, lang, "")}"/>`,
	).join("\n");

	const staticUrls = LOCALES.map((locale) =>
		urlEntry(localeUrl(origin, locale, ""), today, homeAlternates),
	);

	const contentUrls = results.flatMap((result) => {
		if (result.status !== "fulfilled") return [];
		const { locale, basePath, entries } = result.value;

		return entries.map((entry) => {
			const slug = entry.data.slug || entry.id;
			const lastmod = (entry.data.updatedAt ?? entry.data.publishedAt)
				?.toISOString()
				.split("T")[0];
			return urlEntry(localeUrl(origin, locale, `${basePath}/${slug}`), lastmod);
		});
	});

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
>
${[...staticUrls, ...contentUrls].join("\n")}
</urlset>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "text/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
