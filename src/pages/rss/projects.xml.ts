import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";

export const GET: APIRoute = async ({ site, url }) => {
	const siteUrl = site?.toString() || url.origin;
	const settings = await getSiteSettings();
	const siteTitle = settings?.title || "Studio";

	const { entries: projects } = await getEmDashCollection("projects", {
		orderBy: { published_at: "desc" },
		limit: 20,
	});

	const items = projects
		.map((p) => {
			if (!p.data.publishedAt) return null;
			const entryUrl = `${siteUrl}/projects/${p.data.slug || p.id}`;
			return `    <item>
      <title>${escapeXml(p.data.title || "Untitled")}</title>
      <link>${entryUrl}</link>
      <guid isPermaLink="true">${entryUrl}</guid>
      <pubDate>${p.data.publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(p.data.summary || "")}</description>
    </item>`;
		})
		.filter(Boolean)
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)} — Work</title>
    <description>Latest projects from ${escapeXml(siteTitle)}</description>
    <link>${siteUrl}/projects</link>
    <atom:link href="${siteUrl}/rss/projects.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

	return new Response(rss, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};

const XML_ESCAPE_PATTERNS = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
] as const;

function escapeXml(str: string): string {
	let result = str;
	for (const [pattern, replacement] of XML_ESCAPE_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}
