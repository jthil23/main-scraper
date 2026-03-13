import Parser from "rss-parser";
import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "MainScraper/1.0",
  },
});

const FEED_NAMES: Record<string, string> = {
  "arstechnica.com": "Ars Technica",
  "reddit.com/r/formula1": "r/formula1",
  "reddit.com/r/homeassistant": "r/homeassistant",
  "hnrss.org": "Hacker News",
  "theverge.com": "The Verge",
  "techcrunch.com": "TechCrunch",
};

function getFeedName(url: string): string {
  for (const [pattern, name] of Object.entries(FEED_NAMES)) {
    if (url.includes(pattern)) return name;
  }
  // Extract domain as fallback
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return domain;
  } catch {
    return url.slice(0, 50);
  }
}

export async function scrapeNewsFeeds(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("news_rss");
    const feeds = config.news.feeds;
    let totalCount = 0;

    for (const feedUrl of feeds) {
      const feedName = getFeedName(feedUrl);

      try {
        const feed = await parser.parseURL(feedUrl);

        for (const item of (feed.items || []).slice(0, 50)) {
          const guid = item.guid || item.link || item.title || "";
          let publishedAt: Date | null = null;
          if (item.pubDate) {
            const d = new Date(item.pubDate);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 1970 && d.getFullYear() <= 2037) {
              publishedAt = d;
            }
          }

          // Truncate summary to avoid huge text
          const summary = item.contentSnippet
            ? item.contentSnippet.slice(0, 2000)
            : item.content
              ? item.content.replace(/<[^>]*>/g, "").slice(0, 2000)
              : null;

          await pool.execute(
            `INSERT INTO news_articles (source_id, feed_name, title, link, summary, author, published_at, fetched_at, guid)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE title=VALUES(title)`,
            [sourceId, feedName, item.title || "Untitled", item.link || null, summary, item.creator || item.author || null, publishedAt, guid.slice(0, 500)]
          );
          totalCount++;
        }

        console.log(`[News] ${feedName}: ${feed.items?.length || 0} articles`);
      } catch (feedError) {
        console.error(`[News] Error parsing ${feedName}:`, feedError instanceof Error ? feedError.message : feedError);
      }
    }

    await logScrape("news", totalCount, "success", startedAt);
    console.log(`[News] ${totalCount} total articles recorded`);
    return totalCount;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[News] Error:", msg);
    await logScrape("news", 0, "error", startedAt, msg);
    return 0;
  }
}
