import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "emdash";

export const GET: APIRoute = async ({ site, url }) => {
	const siteUrl = site?.toString() || url.origin;
	const settings = await getSiteSettings();
	const siteTitle = settings?.title || "Studio";
	const siteDescription = settings?.tagline || "Design & Development";

	const [{ entries: projects }, { entries: posts }] = await Promise.all([
		getEmDashCollection("projects", { orderBy: { published_at: "desc" }, limit: 20 }),
		getEmDashCollection("posts", { orderBy: { published_at: "desc" }, limit: 20 }),
	]);

	type FeedItem = { pubDate: Date; xml: string };

	const toItem = (entryUrl: string, title: string | undefined, description: string | undefined, publishedAt: Date | null | undefined): FeedItem | null => {
		if (!publishedAt) return null;
		return {
			pubDate: publishedAt,
			xml: `    <item>
      <title>${escapeXml(title || "Untitled")}</title>
      <link>${entryUrl}</link>
      <guid isPermaLink="true">${entryUrl}</guid>
      <pubDate>${publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(description || "")}</description>
    </item>`,
		};
	};

	const feedItems: FeedItem[] = [
		...projects.map((p) => toItem(`${siteUrl}/projects/${p.data.slug || p.id}`, p.data.title, p.data.summary, p.data.publishedAt)),
		...posts.map((p) => toItem(`${siteUrl}/blog/${p.data.slug || p.id}`, p.data.title, p.data.excerpt, p.data.publishedAt)),
	]
		.filter((item): item is FeedItem => item !== null)
		.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

	const items = feedItems.map((item) => item.xml).join("\n");

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <description>${escapeXml(siteDescription)}</description>
    <link>${siteUrl}</link>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
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
