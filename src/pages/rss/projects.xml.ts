import type { APIRoute } from "astro";
import { getSiteSettings } from "emdash";
import { collectFeedEntries } from "../../utils/feed";

export const GET: APIRoute = async ({ site, url }) => {
	const siteUrl = site?.toString() || url.origin;
	const settings = await getSiteSettings();
	const siteTitle = settings?.title || "Studio";

	const projects = await collectFeedEntries("projects", "/projects", siteUrl, 20);

	const items = projects
		.map(
			(p) => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${p.url}</link>
      <guid isPermaLink="true">${p.url}</guid>
      <pubDate>${p.pubDate.toUTCString()}</pubDate>
      <description xml:lang="${p.locale}">${escapeXml(p.description)}</description>
    </item>`,
		)
		.join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)} — Work</title>
    <description>Latest projects from ${escapeXml(siteTitle)}</description>
    <link>${siteUrl}/ar/projects</link>
    <atom:link href="${siteUrl}/rss/projects.xml" rel="self" type="application/rss+xml"/>
    <!-- Bilingual feed: each item carries its own xml:lang. -->
    <language>ar</language>
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
