import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface SteamGame {
  appid: number;
  name: string;
  playtime_2weeks?: number;
  playtime_forever: number;
}

export async function scrapeSteamGames(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.steam.apiKey || !config.steam.steamId) {
      console.log("[Steam] STEAM_API_KEY or STEAM_ID not configured, skipping");
      return 0;
    }

    const sourceId = await getSourceId("steam");

    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${config.steam.apiKey}&steamid=${config.steam.steamId}&count=20&format=json`,
      { headers: { "User-Agent": "MainScraper/1.0" } }
    );
    if (!res.ok) throw new Error(`Steam API error: ${res.status}`);

    const data = await res.json() as { response: { games?: SteamGame[]; total_count?: number } };
    const games = data.response?.games ?? [];
    let count = 0;

    for (const game of games) {
      await pool.execute(
        `INSERT INTO steam_recent_games
         (source_id, app_id, name, playtime_2weeks_min, playtime_forever_min, recorded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [sourceId, game.appid, game.name, game.playtime_2weeks ?? 0, game.playtime_forever]
      );
      count++;
    }

    await logScrape("steam", count, "success", startedAt);
    console.log(`[Steam] ${count} recently played games recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Steam] Error:", msg);
    await logScrape("steam", 0, "error", startedAt, msg);
    return 0;
  }
}
