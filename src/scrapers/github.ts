import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface GitHubUser {
  public_repos: number;
  followers: number;
  following: number;
}

interface GitHubEvent {
  id: string;
  type: string;
  repo: { name: string };
  payload: {
    ref?: string;
    size?: number;
  };
  created_at: string;
}

export async function scrapeGitHubActivity(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.github.token || !config.github.username) {
      console.log("[GitHub] GITHUB_TOKEN or GITHUB_USERNAME not configured, skipping");
      return 0;
    }

    const headers = {
      Authorization: `Bearer ${config.github.token}`,
      "User-Agent": "MainScraper/1.0",
      Accept: "application/vnd.github+json",
    };

    const sourceId = await getSourceId("github");

    // Fetch user stats
    const userRes = await fetch(`https://api.github.com/users/${config.github.username}`, { headers });
    if (!userRes.ok) throw new Error(`GitHub user API error: ${userRes.status}`);
    const user: GitHubUser = await userRes.json();

    await pool.execute(
      `INSERT INTO github_stats (source_id, public_repos, followers, following, recorded_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [sourceId, user.public_repos, user.followers, user.following]
    );

    // Fetch recent push events
    const eventsRes = await fetch(
      `https://api.github.com/users/${config.github.username}/events?per_page=100`,
      { headers }
    );
    if (!eventsRes.ok) throw new Error(`GitHub events API error: ${eventsRes.status}`);
    const events: GitHubEvent[] = await eventsRes.json();

    let pushCount = 0;
    for (const event of events) {
      if (event.type !== "PushEvent") continue;

      const branch = event.payload.ref?.replace("refs/heads/", "") ?? null;
      const commitCount = event.payload.size ?? 0;
      const pushedAt = new Date(event.created_at).toISOString().slice(0, 19).replace("T", " ");

      await pool.execute(
        `INSERT IGNORE INTO github_pushes
         (source_id, event_id, repo_name, branch, commit_count, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sourceId, event.id, event.repo.name, branch, commitCount, pushedAt]
      );
      pushCount++;
    }

    const total = 1 + pushCount;
    await logScrape("github", total, "success", startedAt);
    console.log(`[GitHub] Stats recorded, ${pushCount} push events upserted`);
    return total;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[GitHub] Error:", msg);
    await logScrape("github", 0, "error", startedAt, msg);
    return 0;
  }
}
