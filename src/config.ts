import "dotenv/config";

export const config = {
  mysql: {
    host: process.env.MYSQL_HOST || "192.168.1.103",
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER || "mainUser",
    password: process.env.MYSQL_PASSWORD || "mainPass",
    metricsDb: process.env.MYSQL_METRICS_DB || "JT-METRICS",
    f1Db: process.env.MYSQL_F1_DB || "JT-F1",
  },
  homeAssistant: {
    url: process.env.HA_URL || "http://192.168.1.103:8123",
    token: process.env.HA_TOKEN || "",
  },
  adguard: {
    url: process.env.ADGUARD_URL || "http://192.168.1.103:3000",
    user: process.env.ADGUARD_USER || "admin",
    password: process.env.ADGUARD_PASSWORD || "",
  },
  plex: {
    url: process.env.PLEX_URL || "http://192.168.1.103:32400",
    token: process.env.PLEX_TOKEN || "",
  },
  frigate: {
    url: process.env.FRIGATE_URL || "http://192.168.1.103:5000",
  },
  weather: {
    latitude: parseFloat(process.env.WEATHER_LAT || "40.7128"),
    longitude: parseFloat(process.env.WEATHER_LON || "-74.0060"),
  },
  finance: {
    stocks: (process.env.FINANCE_STOCKS || "AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,SPY,QQQ").split(","),
    cryptos: (process.env.FINANCE_CRYPTOS || "bitcoin,ethereum,solana,cardano,dogecoin").split(","),
  },
  news: {
    feeds: (process.env.NEWS_FEEDS || [
      "https://feeds.arstechnica.com/arstechnica/index",
      "https://hnrss.org/frontpage",
      "https://www.theverge.com/rss/index.xml",
      "https://feeds.feedburner.com/TechCrunch",
    ] as string[]),
  },
  server: {
    host: process.env.SERVER_HOST || "192.168.1.103",
  },
};

// Parse NEWS_FEEDS from env if provided as comma-separated
if (typeof config.news.feeds === "string") {
  config.news.feeds = (config.news.feeds as unknown as string).split(",");
}

// Load config overrides from JT-COMMAND database
// Maps DB keys like "weather.latitude" to config paths
export async function initConfig(): Promise<void> {
  let conn;
  try {
    const mysql = await import("mysql2/promise");
    conn = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: "JT-COMMAND",
    });
    const [rows] = await conn.query("SELECT config_key, config_value, config_type FROM scraper_config");
    const dbConfig = rows as { config_key: string; config_value: string; config_type: string }[];

    for (const row of dbConfig) {
      const parts = row.config_key.split(".");
      if (parts.length !== 2) continue;

      const [section, key] = parts;
      const target = config[section as keyof typeof config];
      if (!target || typeof target !== "object") continue;

      let value: unknown = row.config_value;
      if (row.config_type === "number") value = parseFloat(row.config_value);
      else if (row.config_type === "boolean") value = row.config_value === "true";
      else if (row.config_type === "json") {
        try { value = JSON.parse(row.config_value); } catch { continue; }
      }

      (target as Record<string, unknown>)[key] = value;
    }

    console.log(`[Config] Loaded ${dbConfig.length} config overrides from JT-COMMAND`);
  } catch {
    console.log("[Config] Could not load DB config, using env vars only");
  } finally {
    if (conn) await conn.end();
  }
}
