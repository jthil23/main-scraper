import mysql from "mysql2/promise";
import { config } from "../config.js";

let metricsPool: mysql.Pool | null = null;
let f1Pool: mysql.Pool | null = null;

// Cache source IDs after first lookup
const sourceIdCache = new Map<string, number>();

export function getMetricsPool(): mysql.Pool {
  if (!metricsPool) {
    metricsPool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.metricsDb,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return metricsPool;
}

export function getF1Pool(): mysql.Pool {
  if (!f1Pool) {
    f1Pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.f1Db,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return f1Pool;
}

export async function getSourceId(sourceKey: string): Promise<number> {
  const cached = sourceIdCache.get(sourceKey);
  if (cached) return cached;

  const pool = getMetricsPool();
  const [rows] = await pool.execute(
    "SELECT id FROM data_sources WHERE source_key = ?",
    [sourceKey]
  );
  const results = rows as Array<{ id: number }>;
  if (results.length === 0) {
    throw new Error(`data_source not found for key: ${sourceKey}`);
  }
  sourceIdCache.set(sourceKey, results[0].id);
  return results[0].id;
}

export async function logScrape(
  scraper: string,
  recordsWritten: number,
  status: "success" | "error",
  startedAt: Date,
  errorMessage?: string
): Promise<void> {
  const pool = getMetricsPool();
  await pool.execute(
    `INSERT INTO scrape_log (scraper, started_at, finished_at, status, records_written, error_message)
     VALUES (?, ?, NOW(), ?, ?, ?)`,
    [scraper, startedAt, status, recordsWritten, errorMessage || null]
  );
}

export async function closePools(): Promise<void> {
  if (metricsPool) await metricsPool.end();
  if (f1Pool) await f1Pool.end();
  metricsPool = null;
  f1Pool = null;
}
