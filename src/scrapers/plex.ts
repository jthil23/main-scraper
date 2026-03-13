import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface PlexLibrary {
  key: string;
  title: string;
  type: string;
  count?: number;
}

interface PlexMediaContainer<T> {
  MediaContainer: {
    size: number;
    Metadata?: T[];
    Directory?: T[];
  };
}

interface PlexHistoryItem {
  title: string;
  type: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  duration?: number;
  viewedAt: number;
  accountID?: number;
  Player?: { title: string };
  ratingKey: string;
}

async function plexFetch<T>(path: string): Promise<PlexMediaContainer<T>> {
  const res = await fetch(`${config.plex.url}${path}?X-Plex-Token=${config.plex.token}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Plex API error: ${res.status}`);
  return res.json() as Promise<PlexMediaContainer<T>>;
}

export async function scrapeLibraries(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.plex.token) {
      console.log("[Plex] No token configured, skipping");
      return 0;
    }

    const sourceId = await getSourceId("plex");
    const data = await plexFetch<PlexLibrary>("/library/sections");
    let count = 0;

    for (const lib of data.MediaContainer.Directory || []) {
      let itemCount = 0;
      try {
        const libData = await plexFetch<unknown>(`/library/sections/${lib.key}/all`);
        itemCount = libData.MediaContainer.size || 0;
      } catch {
        // Some libraries may not support /all
      }

      await pool.execute(
        `INSERT INTO plex_libraries (source_id, library_key, library_name, library_type, item_count, recorded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [sourceId, lib.key, lib.title, lib.type, itemCount]
      );
      count++;
    }

    await logScrape("plex_libraries", count, "success", startedAt);
    console.log(`[Plex] ${count} libraries recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Plex] Library error:", msg);
    await logScrape("plex_libraries", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeWatchHistory(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.plex.token) return 0;

    const sourceId = await getSourceId("plex");
    const data = await plexFetch<PlexHistoryItem>("/status/sessions/history/all");
    const items = data.MediaContainer.Metadata || [];
    let count = 0;

    for (const item of items.slice(0, 100)) {
      const viewedAt = new Date(item.viewedAt * 1000).toISOString().slice(0, 19).replace("T", " ");

      await pool.execute(
        `INSERT INTO plex_watch_history
         (source_id, title, media_type, grandparent_title, parent_index, \`index\`, year, duration_ms, viewed_at, device_name, rating_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title)`,
        [
          sourceId,
          item.title || "Unknown", item.type || null, item.grandparentTitle ?? null,
          item.parentIndex ?? null, item.index ?? null, item.year ?? null,
          item.duration ?? null, viewedAt, item.Player?.title ?? null, item.ratingKey || "unknown",
        ]
      );
      count++;
    }

    await logScrape("plex_history", count, "success", startedAt);
    console.log(`[Plex] ${count} watch history entries recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Plex] History error:", msg);
    await logScrape("plex_history", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeActiveSessions(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.plex.token) return 0;

    const res = await fetch(`${config.plex.url}/status/sessions?X-Plex-Token=${config.plex.token}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Plex sessions error: ${res.status}`);

    const sourceId = await getSourceId("plex");
    const data = await res.json() as { MediaContainer: { size: number } };

    await pool.execute(
      `INSERT INTO plex_sessions (source_id, active_sessions, bandwidth_total, recorded_at) VALUES (?, ?, 0, NOW())`,
      [sourceId, data.MediaContainer.size || 0]
    );

    await logScrape("plex_sessions", 1, "success", startedAt);
    console.log(`[Plex] Active sessions: ${data.MediaContainer.size || 0}`);
    return 1;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Plex] Sessions error:", msg);
    await logScrape("plex_sessions", 0, "error", startedAt, msg);
    return 0;
  }
}
