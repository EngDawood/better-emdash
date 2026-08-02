import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";
import { buildLlmsTxt, type LlmsTxtEntry } from "../plugins/seo/llms";

// Canonical llms.txt lists default-locale (ar) URLs. Spec: https://llmstxt.org/
const LOCALE = "ar";

export const GET: APIRoute = async ({ url }) => {
	const base = `${url.origin}/${LOCALE}`;

	const [settingsR, postsR, projectsR, pagesR] = await Promise.allSettled([
		getSiteSettings(),
		getEmDashCollection("posts", { orderBy: { published_at: "desc" } }),
		getEmDashCollection("projects", { orderBy: { published_at: "desc" } }),
		getEmDashCollection("pages"),
	]);

	const settings = settingsR.status === "fulfilled" ? settingsR.value : null;
	const posts = postsR.status === "fulfilled" ? postsR.value.entries : [];
	const projects = projectsR.status === "fulfilled" ? projectsR.value.entries : [];
	const pages = pagesR.status === "fulfilled" ? pagesR.value.entries : [];

	const entry = (title: string, path: string, description?: string): LlmsTxtEntry => ({
		title: title || path,
		url: `${base}${path}`,
		description: description || undefined,
	});

	const sections: Record<string, LlmsTxtEntry[]> = {
		Writing: posts.map((p) => entry(p.data.title, `/blog/${p.data.slug || p.id}`, p.data.excerpt)),
		Work: projects.map((p) => entry(p.data.title, `/projects/${p.data.slug || p.id}`, p.data.summary)),
		Pages: pages.map((p) => entry(p.data.title, `/pages/${p.data.slug || p.id}`)),
	};

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
