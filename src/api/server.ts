import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getMetricsPool } from "../db/connection.js";
import { getJobsStatus, toggleJob, updateJobSchedule, triggerJob } from "../scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Jobs ──────────────────────────────────────────────────────────────────────

app.get("/api/jobs", async (_req, res) => {
  try {
    const jobs = await getJobsStatus();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/jobs/:name/toggle", async (req, res) => {
  try {
    const enabled = await toggleJob(req.params.name);
    res.json({ enabled });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

app.post("/api/jobs/:name/schedule", async (req, res) => {
  const { schedule } = req.body as { schedule: string };
  if (!schedule) return res.status(400).json({ error: "schedule required" });
  try {
    await updateJobSchedule(req.params.name, schedule);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

app.post("/api/jobs/:name/run", async (req, res) => {
  try {
    // Fire and forget — return immediately, job runs async
    void triggerJob(req.params.name);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────────

app.get("/api/logs", async (req, res) => {
  try {
    const pool = getMetricsPool();
    const scraper = req.query.scraper as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string ?? "100"), 500);

    const [rows] = scraper
      ? await pool.execute(
          "SELECT * FROM scrape_log WHERE scraper=? ORDER BY started_at DESC LIMIT ?",
          [scraper, limit]
        )
      : await pool.execute(
          "SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT ?",
          [limit]
        );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startWebServer(port: number): void {
  app.listen(port, "0.0.0.0", () => {
    console.log(`[Web] Dashboard running at http://0.0.0.0:${port}`);
  });
}
