import { startScheduler, runAllNow } from "./scheduler.js";
import { closePools } from "./db/connection.js";
import { initConfig } from "./config.js";

const args = process.argv.slice(2);
const runNow = args.includes("--run-now");

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║         Main Scraper v1.0.0          ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Load config overrides from JT-COMMAND database
  await initConfig();

  if (runNow) {
    console.log("Mode: Run all scrapers once\n");
    await runAllNow();
    await closePools();
    process.exit(0);
  }

  console.log("Mode: Scheduled (cron)\n");

  // Run an initial scrape on startup
  console.log("[Startup] Running initial scrape...\n");
  await runAllNow();

  // Then start the scheduler
  console.log("\n[Startup] Initial scrape complete, starting scheduler...\n");
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}, closing connections...`);
    await closePools();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(async (error) => {
  console.error("[Fatal]", error);
  await closePools();
  process.exit(1);
});
