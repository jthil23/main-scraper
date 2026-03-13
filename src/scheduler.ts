import cron from "node-cron";
import { scrapeCurrentWeather, scrapeAirQuality } from "./scrapers/weather.js";
import { scrapeSensorReadings, scrapeDeviceTrackers, scrapeAutomations } from "./scrapers/homeassistant.js";
import { scrapeAdGuardStats } from "./scrapers/adguard.js";
import { scrapeLibraries, scrapeWatchHistory, scrapeActiveSessions } from "./scrapers/plex.js";
import { scrapePitStops, scrapeLapTimes, scrapeRaceWeather, scrapeTireStints } from "./scrapers/f1-extended.js";
import { scrapeCryptoPrices, scrapeStockPrices } from "./scrapers/finance.js";
import { scrapeNewsFeeds } from "./scrapers/news.js";
import { scrapeSystemHealth, scrapeDockerContainers, scrapeInternetHealth } from "./scrapers/system.js";
import { scrapeSteamGames } from "./scrapers/steam.js";
import { scrapeGitHubActivity } from "./scrapers/github.js";
import { getMetricsPool } from "./db/connection.js";

interface JobDefinition {
  name: string;
  defaultSchedule: string;
  fn: () => Promise<unknown>;
}

export interface JobStatus {
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  lastRecords: number | null;
  lastError: string | null;
}

const currentYear = new Date().getFullYear();

// Source of truth for all job definitions
const JOB_DEFINITIONS: JobDefinition[] = [
  // ── Weather ──
  { name: "weather_current", defaultSchedule: "*/30 * * * *", fn: scrapeCurrentWeather },
  { name: "air_quality", defaultSchedule: "0 */3 * * *", fn: scrapeAirQuality },

  // ── Home Assistant ──
  { name: "ha_sensors", defaultSchedule: "*/5 * * * *", fn: scrapeSensorReadings },
  { name: "ha_device_tracker", defaultSchedule: "*/15 * * * *", fn: scrapeDeviceTrackers },
  { name: "ha_automations", defaultSchedule: "0 * * * *", fn: scrapeAutomations },

  // ── AdGuard ──
  { name: "adguard", defaultSchedule: "5 * * * *", fn: scrapeAdGuardStats },

  // ── Plex ──
  { name: "plex_sessions", defaultSchedule: "*/5 * * * *", fn: scrapeActiveSessions },
  { name: "plex_history", defaultSchedule: "15 * * * *", fn: scrapeWatchHistory },
  { name: "plex_libraries", defaultSchedule: "0 4 * * *", fn: scrapeLibraries },

  // ── F1 ──
  { name: "f1_pitstops", defaultSchedule: "0 6 * * *", fn: () => scrapePitStops(currentYear) },
  { name: "f1_laptimes", defaultSchedule: "0 7 * * *", fn: () => scrapeLapTimes(currentYear) },
  { name: "f1_weather", defaultSchedule: "0 8 * * *", fn: () => scrapeRaceWeather(currentYear) },
  { name: "f1_stints", defaultSchedule: "0 9 * * *", fn: () => scrapeTireStints(currentYear) },

  // ── Finance ──
  { name: "crypto", defaultSchedule: "20 * * * *", fn: scrapeCryptoPrices },
  { name: "stocks", defaultSchedule: "0 17 * * 1-5", fn: scrapeStockPrices },

  // ── News ──
  { name: "news", defaultSchedule: "30 */2 * * *", fn: scrapeNewsFeeds },

  // ── System ──
  { name: "system_health", defaultSchedule: "*/5 * * * *", fn: scrapeSystemHealth },
  { name: "docker_containers", defaultSchedule: "*/10 * * * *", fn: scrapeDockerContainers },
  { name: "internet_health", defaultSchedule: "35 * * * *", fn: scrapeInternetHealth },

  // ── Steam ──
  { name: "steam", defaultSchedule: "0 */6 * * *", fn: scrapeSteamGames },

  // ── GitHub ──
  { name: "github", defaultSchedule: "45 * * * *", fn: scrapeGitHubActivity },
];

// Runtime state: name → { schedule, enabled }
const jobState = new Map<string, { schedule: string; enabled: boolean }>();

// Active cron tasks: name → task
const activeTasks = new Map<string, cron.ScheduledTask>();

// Job definition lookup
const jobDefs = new Map<string, JobDefinition>(
  JOB_DEFINITIONS.map((j) => [j.name, j])
);

// ── DB persistence ────────────────────────────────────────────────────────────

async function loadJobState(): Promise<void> {
  const pool = getMetricsPool();

  // Upsert all job definitions (adds new jobs, keeps existing state)
  for (const job of JOB_DEFINITIONS) {
    await pool.execute(
      `INSERT INTO scraper_jobs (name, schedule, enabled)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE name=name`,
      [job.name, job.defaultSchedule]
    );
  }

  const [rows] = await pool.execute("SELECT name, schedule, enabled FROM scraper_jobs");
  for (const row of rows as Array<{ name: string; schedule: string; enabled: number }>) {
    jobState.set(row.name, { schedule: row.schedule, enabled: !!row.enabled });
  }
}

async function persistJobState(name: string): Promise<void> {
  const state = jobState.get(name);
  if (!state) return;
  const pool = getMetricsPool();
  await pool.execute(
    "UPDATE scraper_jobs SET schedule=?, enabled=? WHERE name=?",
    [state.schedule, state.enabled, name]
  );
}

// ── Cron task management ──────────────────────────────────────────────────────

function startTask(name: string): void {
  const def = jobDefs.get(name);
  const state = jobState.get(name);
  if (!def || !state) return;

  // Stop existing task if any
  stopTask(name);

  const task = cron.schedule(state.schedule, async () => {
    try {
      await def.fn();
    } catch (error) {
      console.error(`[Scheduler] ${name} failed:`, error instanceof Error ? error.message : error);
    }
  });
  activeTasks.set(name, task);
}

function stopTask(name: string): void {
  const task = activeTasks.get(name);
  if (task) {
    task.stop();
    activeTasks.delete(name);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startScheduler(): Promise<void> {
  console.log("[Scheduler] Loading job state from DB...");
  await loadJobState();

  console.log("[Scheduler] Starting enabled cron jobs...\n");
  for (const job of JOB_DEFINITIONS) {
    const state = jobState.get(job.name);
    if (state?.enabled) {
      startTask(job.name);
      console.log(`  ${job.name.padEnd(22)} ${state.schedule}`);
    } else {
      console.log(`  ${job.name.padEnd(22)} (disabled)`);
    }
  }

  const enabledCount = [...jobState.values()].filter((s) => s.enabled).length;
  console.log(`\n[Scheduler] ${enabledCount}/${JOB_DEFINITIONS.length} jobs scheduled`);
}

export async function toggleJob(name: string): Promise<boolean> {
  const state = jobState.get(name);
  if (!state) throw new Error(`Unknown job: ${name}`);

  state.enabled = !state.enabled;
  await persistJobState(name);

  if (state.enabled) {
    startTask(name);
    console.log(`[Scheduler] Enabled: ${name}`);
  } else {
    stopTask(name);
    console.log(`[Scheduler] Disabled: ${name}`);
  }

  return state.enabled;
}

export async function updateJobSchedule(name: string, schedule: string): Promise<void> {
  if (!cron.validate(schedule)) throw new Error(`Invalid cron expression: ${schedule}`);

  const state = jobState.get(name);
  if (!state) throw new Error(`Unknown job: ${name}`);

  state.schedule = schedule;
  await persistJobState(name);

  if (state.enabled) {
    startTask(name); // restart with new schedule
    console.log(`[Scheduler] Rescheduled ${name}: ${schedule}`);
  }
}

export async function triggerJob(name: string): Promise<void> {
  const def = jobDefs.get(name);
  if (!def) throw new Error(`Unknown job: ${name}`);
  console.log(`[Scheduler] Manual trigger: ${name}`);
  await def.fn();
}

export async function getJobsStatus(): Promise<JobStatus[]> {
  const pool = getMetricsPool();
  const [logRows] = await pool.execute(`
    SELECT scraper, started_at, status, records_written, error_message
    FROM scrape_log
    WHERE (scraper, started_at) IN (
      SELECT scraper, MAX(started_at)
      FROM scrape_log
      GROUP BY scraper
    )
  `);

  const lastRuns = new Map<string, { started_at: Date; status: string; records_written: number; error_message: string | null }>();
  for (const row of logRows as Array<{ scraper: string; started_at: Date; status: string; records_written: number; error_message: string | null }>) {
    lastRuns.set(row.scraper, row);
  }

  return JOB_DEFINITIONS.map((def) => {
    const state = jobState.get(def.name) ?? { schedule: def.defaultSchedule, enabled: true };
    const last = lastRuns.get(def.name) ?? null;
    return {
      name: def.name,
      schedule: state.schedule,
      enabled: state.enabled,
      lastRun: last?.started_at?.toISOString() ?? null,
      lastStatus: last?.status ?? null,
      lastRecords: last?.records_written ?? null,
      lastError: last?.error_message ?? null,
    };
  });
}

// ── Startup run (used by index.ts) ───────────────────────────────────────────

export async function runAllNow(): Promise<void> {
  console.log("[Runner] Executing all scrapers now...\n");

  const enabledJobs = JOB_DEFINITIONS.filter((j) => {
    const state = jobState.get(j.name);
    // If state not loaded yet (first startup call), run all non-F1 jobs
    return state ? state.enabled : true;
  }).filter((j) => !j.name.startsWith("f1_"));

  const results = await Promise.allSettled(
    enabledJobs.map(async (job) => {
      try {
        await job.fn();
      } catch (error) {
        console.error(`[Runner] ${job.name} failed:`, error instanceof Error ? error.message : error);
      }
    })
  );

  console.log("\n[Runner] Independent scrapers complete");

  // F1 scrapers run sequentially to avoid rate limits
  console.log("[Runner] Running F1 scrapers...");
  const f1Jobs = JOB_DEFINITIONS.filter((j) => j.name.startsWith("f1_"));
  for (const job of f1Jobs) {
    const state = jobState.get(job.name);
    if (state && !state.enabled) continue;
    try {
      await job.fn();
    } catch (error) {
      console.error("[Runner] F1 scraper failed:", error instanceof Error ? error.message : error);
    }
  }

  void results; // suppress unused warning
  console.log("\n[Runner] All scrapers complete!");
}
