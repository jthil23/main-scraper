import cron from "node-cron";
import { scrapeCurrentWeather, scrapeAirQuality } from "./scrapers/weather.js";
import { scrapeSensorReadings, scrapeDeviceTrackers, scrapeAutomations } from "./scrapers/homeassistant.js";
import { scrapeAdGuardStats } from "./scrapers/adguard.js";
import { scrapeLibraries, scrapeWatchHistory, scrapeActiveSessions } from "./scrapers/plex.js";
import { scrapeFrigateEvents, scrapeFrigateStats } from "./scrapers/frigate.js";
import { scrapePitStops, scrapeLapTimes, scrapeRaceWeather, scrapeTireStints } from "./scrapers/f1-extended.js";
import { scrapeCryptoPrices, scrapeStockPrices } from "./scrapers/finance.js";
import { scrapeNewsFeeds } from "./scrapers/news.js";
import { scrapeSystemHealth, scrapeDockerContainers, scrapeInternetHealth } from "./scrapers/system.js";

interface ScheduledJob {
  name: string;
  schedule: string;
  fn: () => Promise<unknown>;
}

const currentYear = new Date().getFullYear();

const jobs: ScheduledJob[] = [
  // ── Weather ── every 30 minutes
  { name: "weather_current", schedule: "*/30 * * * *", fn: scrapeCurrentWeather },
  { name: "air_quality", schedule: "0 */3 * * *", fn: scrapeAirQuality },

  // ── Home Assistant ── every 5 minutes for sensors, hourly for others
  { name: "ha_sensors", schedule: "*/5 * * * *", fn: scrapeSensorReadings },
  { name: "ha_device_tracker", schedule: "*/15 * * * *", fn: scrapeDeviceTrackers },
  { name: "ha_automations", schedule: "0 * * * *", fn: scrapeAutomations },

  // ── AdGuard ── every hour
  { name: "adguard", schedule: "5 * * * *", fn: scrapeAdGuardStats },

  // ── Plex ── sessions every 5min, history hourly, libraries daily
  { name: "plex_sessions", schedule: "*/5 * * * *", fn: scrapeActiveSessions },
  { name: "plex_history", schedule: "15 * * * *", fn: scrapeWatchHistory },
  { name: "plex_libraries", schedule: "0 4 * * *", fn: scrapeLibraries },

  // ── Frigate ── events every 15min, stats hourly
  { name: "frigate_events", schedule: "*/15 * * * *", fn: scrapeFrigateEvents },
  { name: "frigate_stats", schedule: "10 * * * *", fn: scrapeFrigateStats },

  // ── F1 ── daily check for new data (pit stops, laps, weather, stints)
  { name: "f1_pitstops", schedule: "0 6 * * *", fn: () => scrapePitStops(currentYear) },
  { name: "f1_laptimes", schedule: "0 7 * * *", fn: () => scrapeLapTimes(currentYear) },
  { name: "f1_weather", schedule: "0 8 * * *", fn: () => scrapeRaceWeather(currentYear) },
  { name: "f1_stints", schedule: "0 9 * * *", fn: () => scrapeTireStints(currentYear) },

  // ── Finance ── crypto every hour, stocks once daily (market hours)
  { name: "crypto", schedule: "20 * * * *", fn: scrapeCryptoPrices },
  { name: "stocks", schedule: "0 17 * * 1-5", fn: scrapeStockPrices },

  // ── News ── every 2 hours
  { name: "news", schedule: "30 */2 * * *", fn: scrapeNewsFeeds },

  // ── System ── health every 5min, docker every 10min, internet hourly
  { name: "system_health", schedule: "*/5 * * * *", fn: scrapeSystemHealth },
  { name: "docker_containers", schedule: "*/10 * * * *", fn: scrapeDockerContainers },
  { name: "internet_health", schedule: "35 * * * *", fn: scrapeInternetHealth },
];

export function startScheduler(): void {
  console.log("[Scheduler] Starting all cron jobs...\n");

  for (const job of jobs) {
    cron.schedule(job.schedule, async () => {
      try {
        await job.fn();
      } catch (error) {
        console.error(`[Scheduler] ${job.name} failed:`, error instanceof Error ? error.message : error);
      }
    });
    console.log(`  ${job.name.padEnd(22)} ${job.schedule}`);
  }

  console.log(`\n[Scheduler] ${jobs.length} jobs scheduled`);
}

export async function runAllNow(): Promise<void> {
  console.log("[Runner] Executing all scrapers now...\n");

  // Group 1: Independent scrapers (run in parallel)
  const independentJobs = [
    { name: "weather_current", fn: scrapeCurrentWeather },
    { name: "air_quality", fn: scrapeAirQuality },
    { name: "ha_sensors", fn: scrapeSensorReadings },
    { name: "ha_device_tracker", fn: scrapeDeviceTrackers },
    { name: "ha_automations", fn: scrapeAutomations },
    { name: "adguard", fn: scrapeAdGuardStats },
    { name: "plex_sessions", fn: scrapeActiveSessions },
    { name: "plex_history", fn: scrapeWatchHistory },
    { name: "plex_libraries", fn: scrapeLibraries },
    { name: "frigate_events", fn: scrapeFrigateEvents },
    { name: "frigate_stats", fn: scrapeFrigateStats },
    { name: "crypto", fn: scrapeCryptoPrices },
    { name: "stocks", fn: scrapeStockPrices },
    { name: "news", fn: scrapeNewsFeeds },
    { name: "system_health", fn: scrapeSystemHealth },
    { name: "docker_containers", fn: scrapeDockerContainers },
    { name: "internet_health", fn: scrapeInternetHealth },
  ];

  const results = await Promise.allSettled(
    independentJobs.map(async (job) => {
      try {
        const count = await job.fn();
        return { name: job.name, count };
      } catch (error) {
        console.error(`[Runner] ${job.name} failed:`, error instanceof Error ? error.message : error);
        return { name: job.name, count: 0 };
      }
    })
  );

  console.log("\n[Runner] Independent scrapers complete");

  // Group 2: F1 scrapers (sequential to avoid rate limits)
  console.log("[Runner] Running F1 scrapers...");
  for (const fn of [
    () => scrapePitStops(currentYear),
    () => scrapeLapTimes(currentYear),
    () => scrapeRaceWeather(currentYear),
    () => scrapeTireStints(currentYear),
  ]) {
    try {
      await fn();
    } catch (error) {
      console.error("[Runner] F1 scraper failed:", error instanceof Error ? error.message : error);
    }
  }

  console.log("\n[Runner] All scrapers complete!");
}
