import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface AdGuardStats {
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing: number;
  num_replaced_parental: number;
  avg_processing_time: number;
  top_queried_domains: Array<Record<string, number>>;
  top_blocked_domains: Array<Record<string, number>>;
  top_clients: Array<Record<string, number>>;
}

async function adguardFetch<T>(path: string): Promise<T> {
  const auth = Buffer.from(`${config.adguard.user}:${config.adguard.password}`).toString("base64");
  const res = await fetch(`${config.adguard.url}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`AdGuard API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function scrapeAdGuardStats(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.adguard.password) {
      console.log("[AdGuard] No password configured, skipping");
      return 0;
    }

    const sourceId = await getSourceId("adguard");
    const stats = await adguardFetch<AdGuardStats>("/control/stats");

    const totalBlocked = stats.num_blocked_filtering + stats.num_replaced_safebrowsing + stats.num_replaced_parental;
    const blockedPct = stats.num_dns_queries > 0 ? (totalBlocked / stats.num_dns_queries) * 100 : 0;

    await pool.execute(
      `INSERT INTO adguard_stats (source_id, total_queries, blocked_queries, blocked_percentage, avg_processing_time, recorded_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [sourceId, stats.num_dns_queries, totalBlocked, blockedPct, stats.avg_processing_time]
    );

    let count = 1;

    for (const entry of (stats.top_queried_domains || []).slice(0, 20)) {
      for (const [domain, queryCount] of Object.entries(entry)) {
        await pool.execute(
          `INSERT INTO adguard_top_domains (source_id, domain, query_count, is_blocked, recorded_at) VALUES (?, ?, ?, FALSE, NOW())`,
          [sourceId, domain, queryCount]
        );
        count++;
      }
    }

    for (const entry of (stats.top_blocked_domains || []).slice(0, 20)) {
      for (const [domain, queryCount] of Object.entries(entry)) {
        await pool.execute(
          `INSERT INTO adguard_top_domains (source_id, domain, query_count, is_blocked, recorded_at) VALUES (?, ?, ?, TRUE, NOW())`,
          [sourceId, domain, queryCount]
        );
        count++;
      }
    }

    for (const entry of (stats.top_clients || []).slice(0, 20)) {
      for (const [clientIp, queryCount] of Object.entries(entry)) {
        await pool.execute(
          `INSERT INTO adguard_top_clients (source_id, client_ip, query_count, recorded_at) VALUES (?, ?, ?, NOW())`,
          [sourceId, clientIp, queryCount]
        );
        count++;
      }
    }

    await logScrape("adguard", count, "success", startedAt);
    console.log(`[AdGuard] ${count} records written`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[AdGuard] Error:", msg);
    await logScrape("adguard", 0, "error", startedAt, msg);
    return 0;
  }
}
