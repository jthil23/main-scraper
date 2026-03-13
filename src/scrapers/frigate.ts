import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  top_score: number;
  start_time: number;
  end_time: number | null;
  has_clip: boolean;
  has_snapshot: boolean;
  zones: string[];
}

interface FrigateStats {
  cameras: Record<string, {
    camera_fps: number;
    detection_fps: number;
    process_fps: number;
    skipped_fps: number;
    detection_enabled: boolean;
  }>;
}

export async function scrapeFrigateEvents(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    // Get events from last 24 hours
    const after = Math.floor(Date.now() / 1000) - 86400;
    const res = await fetch(`${config.frigate.url}/api/events?after=${after}&limit=500`);
    if (!res.ok) throw new Error(`Frigate events error: ${res.status}`);

    const sourceId = await getSourceId("frigate");
    const events: FrigateEvent[] = await res.json();
    let count = 0;

    for (const event of events) {
      const startTime = new Date(event.start_time * 1000).toISOString().slice(0, 19).replace("T", " ");
      const endTime = event.end_time ? new Date(event.end_time * 1000).toISOString().slice(0, 19).replace("T", " ") : null;

      await pool.execute(
        `INSERT INTO frigate_events
         (source_id, event_id, camera, label, score, start_time, end_time, has_clip, has_snapshot, zones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         end_time=VALUES(end_time), score=VALUES(score)`,
        [sourceId, event.id, event.camera, event.label, event.top_score, startTime, endTime, event.has_clip, event.has_snapshot, JSON.stringify(event.zones)]
      );
      count++;
    }

    await logScrape("frigate_events", count, "success", startedAt);
    console.log(`[Frigate] ${count} events recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Frigate] Events error:", msg);
    await logScrape("frigate_events", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeFrigateStats(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const res = await fetch(`${config.frigate.url}/api/stats`);
    if (!res.ok) throw new Error(`Frigate stats error: ${res.status}`);

    const sourceId = await getSourceId("frigate");
    const stats: FrigateStats = await res.json();
    let count = 0;

    for (const [camera, camStats] of Object.entries(stats.cameras || {})) {
      await pool.execute(
        `INSERT INTO frigate_stats
         (source_id, camera, fps, detection_fps, process_fps, skipped_fps, detection_enabled, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [sourceId, camera, camStats.camera_fps, camStats.detection_fps, camStats.process_fps, camStats.skipped_fps, camStats.detection_enabled]
      );
      count++;
    }

    await logScrape("frigate_stats", count, "success", startedAt);
    console.log(`[Frigate] ${count} camera stats recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Frigate] Stats error:", msg);
    await logScrape("frigate_stats", 0, "error", startedAt, msg);
    return 0;
  }
}
