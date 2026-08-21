import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";
import { buildLlmsTxt, type LlmsTxtEntry } from "../plugins/seo/llms";

// One llms.txt covers the whole site. Spec: https://llmstxt.org/
const LOCALES = ["ar", "en"] as const;

const SECTIONS = [
	{ type: "posts", label: "Writing", basePath: "/blog" },
	{ type: "projects", label: "Work", basePath: "/projects" },
	{ type: "pages", label: "Pages", basePath: "/pages" },
] as const;

export const GET: APIRoute = async ({ url }) => {
	// Query per locale and prefix each entry with the locale it actually lives
	// in. A single unscoped query returns both locales' rows, and listing them
	// all under /ar/ pointed crawlers at URLs that redirect (or, before the
	// locale-scoped routes landed, served the wrong language).
	const [settingsR, ...collectionResults] = await Promise.allSettled([
		getSiteSettings(),
		...LOCALES.flatMap((locale) =>
			SECTIONS.map(async (section) => {
				const { entries } = await getEmDashCollection(section.type, {
					locale,
					orderBy: { published_at: "desc" },
				});
				return { locale, section, entries };
			}),
		),
	]);

	const settings = settingsR.status === "fulfilled" ? settingsR.value : null;

	const sections: Record<string, LlmsTxtEntry[]> = {};
	for (const result of collectionResults) {
		if (result.status !== "fulfilled") continue;
		const { locale, section, entries } = result.value;

		const list = (sections[section.label] ??= []);
		for (const item of entries) {
			// Entries here span three collections, so `data` is a union: posts carry
			// `excerpt`, projects carry `summary`, pages carry neither.
			const data = item.data as {
				slug?: string | null;
				title?: string;
				excerpt?: string;
				summary?: string;
			};
			const slug = data.slug || item.id;
			list.push({
				title: data.title || slug,
				url: `${url.origin}/${locale}${section.basePath}/${slug}`,
				description: data.excerpt ?? data.summary ?? undefined,
			});
		}
	}

	const body = buildLlmsTxt({
		siteName: settings?.title || "Dawood Saleh",
		siteDescription: settings?.tagline || undefined,
		sections,
	});

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
